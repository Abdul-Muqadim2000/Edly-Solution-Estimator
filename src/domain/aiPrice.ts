/**
 * What a call to Claude costs, from Anthropic's published per-token rates.
 *
 * US dollars per million tokens, from platform.claude.com/docs/en/about-claude/pricing as read on
 * 2026-09-29. Standard rates only: the app asks for neither fast mode nor US-only inference, the
 * two things that would change them, and these models charge the same per token across their
 * whole context window. The figure this gives is an estimate; the Anthropic Console holds the bill.
 */

export interface ModelPrice {
  input: number;
  /** Writing the prompt to the five-minute cache: 1.25 times input. */
  write5m: number;
  /** Writing it to the hour-long cache: twice input. */
  write1h: number;
  /** Reading it back from cache: a tenth of input on most models, less on Opus 5.5 and Fable 5.1. */
  read: number;
  output: number;
}

const OPUS_5: ModelPrice = { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 };
const SONNET_5: ModelPrice = { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 };

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
  'claude-fable-5': { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 },
  'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-opus-5': OPUS_5,
  'claude-opus-4-8': OPUS_5,
  'claude-opus-4-7': OPUS_5,
  'claude-opus-4-6': OPUS_5,
  'claude-sonnet-5-5': SONNET_5,
  'claude-sonnet-5': SONNET_5,
  'claude-sonnet-4-6': { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 }
};

const KINDS: (keyof ModelPrice)[] = ['input', 'write5m', 'write1h', 'read', 'output'];
const DEAREST = Object.fromEntries(KINDS.map((kind) => [kind, Math.max(...Object.values(MODEL_PRICES).map((price) => price[kind]))])) as unknown as ModelPrice;

/**
 * The rate for a model id, dated ids ('claude-opus-5-20260401') included. A model the table does
 * not know is priced at the dearest rate of each kind, so a spending limit that errs stops a tender
 * early rather than late. A family match ('claude-opus-5-7' read as Opus 5) would err the other way.
 */
export function priceOf(model: string | null | undefined): ModelPrice {
  const id = (model ?? '').trim().toLowerCase().replace(/-\d{8}$/, '');
  return MODEL_PRICES[id] ?? DEAREST;
}

/** One attempt's tokens, in the kinds they are billed as. */
export interface BilledTokens {
  input: number;
  output: number;
  cacheRead: number;
  /** Every cache write; `cacheWrite1h` says how many of them went to the hour-long cache. */
  cacheWrite: number;
  cacheWrite1h?: number;
}

/** What one attempt cost, in dollars. */
export function usdOf(tokens: BilledTokens, model: string | null | undefined): number {
  const price = priceOf(model);
  const hour = Math.min(tokens.cacheWrite, Math.max(0, tokens.cacheWrite1h ?? 0));
  const perMillion =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheRead * price.read +
    (tokens.cacheWrite - hour) * price.write5m +
    hour * price.write1h;
  return perMillion / 1_000_000;
}
