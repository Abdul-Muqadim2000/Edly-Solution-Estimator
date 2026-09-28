import Anthropic from '@anthropic-ai/sdk';
import { usdOf } from '../../src/domain/aiPrice.js';
import { DEFAULT_AI_LIMIT, type AiErrorCode } from '../../src/domain/tender.js';
import type { TenderTokens } from '../../src/types.js';

/**
 * The only code that talks to Anthropic.
 *
 * Tender documents are client material. They go to Anthropic's API under its commercial terms and
 * nowhere else; zero data retention is a separate agreement, noted in DEFERRED.md. Nothing here
 * logs document contents or model output.
 */

/**
 * Opus 5.5: cheaper than Opus 5 per token ($4 / $20 against $5 / $25 per million) and far cheaper
 * to re-read from cache ($0.20 against $0.50), which is most of what extraction does. Chosen on
 * 2026-09-28. `EDLY_AI_MODEL=claude-opus-5` goes back, for a key that cannot use it yet.
 */
export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Uploaded tenders are deleted at Anthropic after this long even if nobody removes them. */
export const FILE_TTL_SECONDS = 72 * 3600;

/** Only files whose name starts with this were uploaded here, and only those may be deleted here. */
export const TENDER_FILE_PREFIX = 'edly-tender-';

/**
 * How long one AI call may run, start to last streamed token. A Vercel function is stopped at
 * 300 s (vercel.json), and giving up just before that returns an answer the browser can act on,
 * splitting the range, instead of a gateway page. Enforced with an abort signal, because the SDK's
 * own `timeout` only covers the wait for response headers, not a long streamed answer.
 * `EDLY_AI_DEADLINE_MS` moves it, for a plan with a longer function limit.
 */
export function callDeadlineMs(): number {
  const configured = Number.parseInt(process.env.EDLY_AI_DEADLINE_MS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 270_000;
}

export function aiModel(): string {
  return process.env.EDLY_AI_MODEL?.trim() || DEFAULT_MODEL;
}

export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly AiEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * How hard the model thinks, from `EDLY_AI_EFFORT`, `medium` when it is unset or not a level.
 * Thinking is billed as output, the dearest tokens, so this is the first lever on cost once the
 * real run has shown which level still reads tenders well (DEFERRED.md 8).
 *
 * Always sent, never left to the API: the API's default differs by model (`medium` on Opus 5.5,
 * `high` on Opus 5), so leaving it out would let a change of model change the thinking unseen.
 * One setting for every call, never per operation: effort is part of the cached prompt, so a fit
 * call and an extraction call at different levels would each pay for the whole tender.
 */
export function aiEffort(): AiEffort {
  const value = process.env.EDLY_AI_EFFORT?.trim().toLowerCase() as AiEffort | undefined;
  return value && EFFORTS.includes(value) ? value : 'medium';
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export class AiError extends Error {
  /** What the failed call used before it failed, when it got that far. */
  tokens?: TenderTokens;

  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * A client per request. `fetch` is looked up when a call is made rather than captured when the
 * client is built, so the tests can drive every reply through a stub, as they do for the stores.
 */
export function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new AiError('not_configured', 'The AI is not set up on this server: ANTHROPIC_API_KEY is not set.', 503);
  }
  const retries = Number.parseInt(process.env.EDLY_AI_RETRIES ?? '', 10);
  return new Anthropic({
    apiKey,
    maxRetries: Number.isFinite(retries) && retries >= 0 ? retries : 2,
    fetch: (input, init) => globalThis.fetch(input, init)
  });
}

/**
 * Dollars the AI may spend on one tender before a person is asked whether to go on, from
 * `EDLY_AI_TENDER_LIMIT_USD`, $4 when it is unset or not a positive number. The browser learns it
 * from the probe and keeps it on each tender it creates.
 */
export function tenderLimitUsd(): number {
  const configured = Number.parseFloat(process.env.EDLY_AI_TENDER_LIMIT_USD ?? '');
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AI_LIMIT;
}

/** One attempt's usage, as the API reports it at the top level and in `usage.iterations`. */
interface AttemptUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null;
}

interface ReplyUsage extends AttemptUsage {
  iterations?: readonly (AttemptUsage & { type: string; model?: string | null })[] | null;
}

/**
 * Tokens from a reply, in the shape the tender keeps its running total in, with what they cost.
 *
 * When the refusal fallback ran, the top-level usage covers only the attempt that answered, and
 * `usage.iterations` lists every attempt, the declined one too, each with the model that ran it.
 * A declined attempt can be billed, so every attempt is counted, at its own model's rate. `model`
 * prices the top-level usage, and an attempt that does not name its model.
 */
export function tokensOf(usage: ReplyUsage | null | undefined, model: string): TenderTokens {
  const attempts = (usage?.iterations ?? []).filter((entry) => entry.type === 'message' || entry.type === 'fallback_message');
  const priced: [AttemptUsage, string][] = attempts.length > 0 ? attempts.map((entry) => [entry, entry.model || model]) : usage ? [[usage, model]] : [];
  const total: TenderTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 };
  for (const [one, at] of priced) {
    const billed = {
      input: one.input_tokens ?? 0,
      output: one.output_tokens ?? 0,
      cacheRead: one.cache_read_input_tokens ?? 0,
      cacheWrite: one.cache_creation_input_tokens ?? 0,
      cacheWrite1h: one.cache_creation?.ephemeral_1h_input_tokens ?? 0
    };
    total.input += billed.input;
    total.output += billed.output;
    total.cacheRead += billed.cacheRead;
    total.cacheWrite += billed.cacheWrite;
    total.usd += usdOf(billed, at);
  }
  return total;
}

/**
 * An SDK failure, in terms the browser can act on. Most specific first: every class below
 * extends `APIError`, so testing that first would swallow the distinctions.
 */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError('timeout', 'The AI took too long on this part of the tender.', 504);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('upstream', 'Could not reach the Anthropic API. Try again in a moment.', 503);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY on the server.', 502);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('auth', 'The API key is not allowed to do this. Check its workspace and permissions.', 502);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError('rate_limited', 'Too many AI requests at once. Wait a minute and retry.', 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    const detail = error.message.toLowerCase();
    if (detail.includes('too long') || detail.includes('too large') || detail.includes('exceed')) {
      return new AiError('too_large', 'That is more than the AI can read in one go. Split the tender into smaller files.', 413);
    }
    return new AiError('bad_request', `Anthropic refused the request: ${error.message}`, 400);
  }
  /* a model the key cannot use answers "not found" too; blaming the tender files would send
     someone to upload them again, which cannot help */
  if (error instanceof Anthropic.NotFoundError && /\bmodel\b/i.test(error.message)) {
    return new AiError('not_configured', `This API key cannot use the model ${aiModel()}. Set EDLY_AI_MODEL to one it can, such as claude-opus-5.`, 503);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError('bad_request', 'A tender file is no longer at Anthropic (it may have expired). Upload the tender again.', 410);
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError('upstream', `The Anthropic API failed (${error.status ?? 'no status'}). Try again in a moment.`, 503);
  }
  return new AiError('upstream', String((error as Error)?.message ?? error), 500);
}
