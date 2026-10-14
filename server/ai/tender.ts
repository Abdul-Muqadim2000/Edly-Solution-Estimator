import Anthropic, { toFile } from '@anthropic-ai/sdk';
import {
  GROUP_CONTEXT,
  GROUP_LIMIT,
  GROUP_TEXT,
  readFit,
  readGroups,
  readMatches,
  readRequirements,
  TEXT_LIMIT,
  type BundleLine,
  type CatalogLine,
  type DocRef,
  type ExtractedRequirement,
  type FitResult,
  type GroupInput,
  type GroupResult,
  type MatchInput,
  type PlatformDigest
} from '../../src/domain/tender.js';
import { readCategories, readTerms, type ExtractedTerm, type SortInput } from '../../src/domain/salesLegal.js';
import type { RequirementMatch, SalesLegalCategory, TenderTokens } from '../../src/types.js';
import { record, text as str, whole as int } from '../../src/lib/narrow.js';
import { AiError, aiEffort, aiModel, anthropic, callDeadlineMs, FILE_TTL_SECONDS, TENDER_FILE_PREFIX, toAiError, tokensOf } from './anthropic.js';
import {
  catalogText,
  documentBlocks,
  extractInstruction,
  fitInstruction,
  groupInstruction,
  KEEP_WARM_TEXT,
  matchInstruction,
  sortInstruction,
  SYSTEM,
  termsInstruction,
  TOOLS,
  type ToolName
} from './prompts.js';

/**
 * The tender operations, each one call to Claude.
 *
 * The browser drives them one at a time, so no single request has to read a whole tender and
 * outlive a function's time limit. Each operation narrows what the model returned with the pure
 * `read*` functions in `src/domain/tender.ts` before anything leaves the server.
 */

/* ------------------------------------------------------- request bodies */

/** A list, refused outright when it is not one or is longer than one request should carry. */
const list = (value: unknown, max: number, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new AiError('bad_request', `${what} must be a list.`, 400);
  if (value.length > max) throw new AiError('bad_request', `At most ${max} ${what} per request.`, 400);
  return value;
};

export function readDocRefs(value: unknown): DocRef[] {
  /* any number: a reference is a few hundred bytes, the request body is capped, and what the API
     can read at once is answered by the API itself */
  if (!Array.isArray(value)) throw new AiError('bad_request', 'documents must be a list.', 400);
  const docs = value.map((entry) => {
    const raw = record(entry);
    return {
      n: int(raw.n),
      name: str(raw.name, 200) || 'document',
      kind: raw.kind === 'text' ? ('text' as const) : ('pdf' as const),
      fileId: str(raw.fileId, 200),
      pages: int(raw.pages)
    };
  });
  if (docs.length === 0) throw new AiError('bad_request', 'No documents were sent.', 400);
  for (const doc of docs) {
    if (!doc.n || !doc.fileId) {
      throw new AiError('bad_request', 'A document is missing its file. It may have been removed from Anthropic; upload the tender again.', 400);
    }
  }
  return docs;
}

export function readPlatforms(value: unknown): PlatformDigest[] {
  return list(value, 80, 'platforms')
    .map((entry) => {
      const raw = record(entry);
      return {
        id: str(raw.id, 60),
        name: str(raw.name, 120),
        practice: str(raw.practice, 120),
        note: str(raw.note, 300),
        bundles: (Array.isArray(raw.bundles) ? raw.bundles : []).slice(0, 40).map((bundle) => str(bundle, 200)).filter(Boolean)
      };
    })
    .filter((platform) => platform.id);
}

export function readCatalog(value: unknown): CatalogLine[] {
  return list(value, 3000, 'catalog lines')
    .map((entry) => {
      const raw = record(entry);
      return {
        id: str(raw.id, 80),
        bundle: str(raw.bundle, 60),
        bundleName: str(raw.bundleName, 160),
        name: str(raw.name, 200),
        category: str(raw.category, 120),
        status: str(raw.status, 40),
        desc: str(raw.desc, 600),
        form: str(raw.form, 120),
        works: str(raw.works, 320),
        notes: str(raw.notes, 300),
        more: str(raw.more, 700)
      };
    })
    .filter((line) => line.id);
}

/** Each bundle's pitch and when to offer it, for the match step. A body from an older browser sends none. */
export function readBundleLines(value: unknown): BundleLine[] {
  return (Array.isArray(value) ? value : [])
    .slice(0, 100)
    .map((entry) => {
      const raw = record(entry);
      return { id: str(raw.id, 60), name: str(raw.name, 160), pitch: str(raw.pitch, 600), offerWhen: str(raw.offerWhen, 400) };
    })
    .filter((bundle) => bundle.id);
}

export function readMatchInputs(value: unknown): MatchInput[] {
  return list(value, 60, 'requirements')
    .map((entry) => {
      const raw = record(entry);
      return {
        id: str(raw.id, 40),
        title: str(raw.title, 160),
        text: str(raw.text, TEXT_LIMIT),
        section: str(raw.section, 160),
        priority: raw.priority === 'should' ? ('should' as const) : ('must' as const)
      };
    })
    .filter((req) => req.id && req.text);
}

/** Requirements for the grouping call: all of a tender's, as words, so a repeat is found wherever it sits. */
export function readGroupInputs(value: unknown): GroupInput[] {
  return list(value, GROUP_LIMIT, 'requirements')
    .map((entry) => {
      const raw = record(entry);
      return {
        id: str(raw.id, 40),
        ref: str(raw.ref, 80),
        section: str(raw.section, 160),
        title: str(raw.title, 160),
        text: str(raw.text, GROUP_TEXT),
        context: str(raw.context, GROUP_CONTEXT)
      };
    })
    .filter((req) => req.id && req.text);
}

/** The topic names a tender already uses. Names only, and a few dozen at most. */
export function readTopicNames(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .slice(0, 60)
    .map((name) => str(name, 80))
    .filter(Boolean);
}

/** Out-of-scope items for the sort call. A tender with more than this is sorted in several calls. */
export function readSortInputs(value: unknown): SortInput[] {
  return list(value, 150, 'items')
    .map((entry) => {
      const raw = record(entry);
      return { id: str(raw.id, 40), text: str(raw.text, 800), section: str(raw.section, 160), reason: str(raw.reason, 500) };
    })
    .filter((item) => item.id && item.text);
}

/* ------------------------------------------------------------ one call */

/**
 * One streamed call that must end in a call to `tool`. Streamed because an answer can run to
 * minutes, which a plain request would time out on.
 *
 * `fallbacks: "default"` has the API retry a request its safety classifiers decline on the
 * model Anthropic recommends for that case, instead of failing the tender outright.
 */
async function callTool(tool: ToolName, content: Anthropic.Beta.BetaContentBlockParam[]): Promise<{ input: unknown; tokens: TenderTokens }> {
  const client = anthropic();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), callDeadlineMs());
  /* what has streamed so far, read if the call fails part way */
  let partial: (() => Anthropic.Beta.BetaMessage | undefined) | undefined;
  let tokens: TenderTokens | undefined;
  const effort = aiEffort();
  try {
    const stream = client.beta.messages.stream(
      {
        model: aiModel(),
        max_tokens: 64000,
        thinking: { type: 'adaptive' },
        output_config: { effort },
        system: SYSTEM,
        tools: TOOLS,
        messages: [{ role: 'user', content }],
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      },
      /* the signal also stops the SDK retrying, so the deadline bounds every attempt together */
      { signal: deadline.signal }
    );
    partial = () => stream.currentMessage;
    const message = await stream.finalMessage();
    /* the model that answered, which after a refusal fallback is not the one asked for */
    tokens = tokensOf(message.usage, message.model || aiModel());

    if (message.stop_reason === 'refusal') throw new AiError('refused', 'The AI declined to read this part of the tender.', 422);
    if (message.stop_reason === 'max_tokens') {
      throw new AiError('truncated', 'The answer was cut off because there was too much in one part.', 502);
    }
    const call = message.content.find((block) => block.type === 'tool_use' && block.name === tool);
    if (!call || call.type !== 'tool_use') throw new AiError('no_result', 'The AI did not return a result. Try again.', 502);
    return { input: call.input, tokens };
  } catch (error) {
    const failure = deadline.signal.aborted && !(error instanceof AiError) ? new AiError('timeout', 'The AI took too long on this part of the tender.', 504) : toAiError(error);
    /* A failed call is still billed, and the tender's token count should say so. A call stopped
       mid-answer has no final usage, but the part already streamed reports what it read. */
    const streamed = partial?.();
    const spent = tokens ?? (streamed ? tokensOf(streamed.usage, streamed.model || aiModel()) : undefined);
    if (spent) failure.tokens = spent;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------- operations */

export interface Uploaded {
  fileId: string;
  bytes: number;
  expiresAt: string;
}

export async function uploadDocument(body: Uint8Array, name: string, kind: 'pdf' | 'text'): Promise<Uploaded> {
  const client = anthropic();
  const base = kind === 'pdf' ? name : `${name.replace(/\.[^.]+$/, '') || 'document'}.txt`;
  /* the prefix is how `discardDocuments` knows a file is ours to delete */
  const filename = `${TENDER_FILE_PREFIX}${base}`;
  try {
    const file = await client.files.upload({
      file: await toFile(body, filename, { type: kind === 'pdf' ? 'application/pdf' : 'text/plain' }),
      expires_in_seconds: FILE_TTL_SECONDS
    });
    return {
      fileId: file.id,
      bytes: file.size_bytes,
      expiresAt: file.expires_at ?? new Date(Date.now() + FILE_TTL_SECONDS * 1000).toISOString()
    };
  } catch (error) {
    throw toAiError(error);
  }
}

/**
 * Deletes tender files at Anthropic, all at once. One already gone counts as deleted: that was
 * the point.
 *
 * Only files this endpoint uploaded, recognised by their name, are deleted. The endpoint has no
 * sign-in yet (DEFERRED.md 4), and without this check anyone could pass it the id of any file in
 * the Anthropic workspace, another application's included, and have it deleted.
 */
export async function discardDocuments(fileIds: readonly string[]): Promise<{ deleted: string[]; failed: string[] }> {
  const client = anthropic();
  const outcomes = await Promise.all(
    fileIds.map(async (id): Promise<boolean> => {
      try {
        const meta = await client.files.retrieveMetadata(id);
        if (!meta.filename.startsWith(TENDER_FILE_PREFIX)) return false;
        await client.files.delete(id);
        return true;
      } catch (error) {
        return error instanceof Anthropic.NotFoundError;
      }
    })
  );
  return {
    deleted: fileIds.filter((_, index) => outcomes[index]),
    failed: fileIds.filter((_, index) => !outcomes[index])
  };
}

/**
 * Keeps the tender's cache alive while a person decides on the platform, for a twentieth of the
 * tender's price on Opus 5.5 (a tenth on Opus 5) instead of writing it again at 1.25 times.
 *
 * `max_tokens: 0` runs the prompt and stops before answering, so no output is billed. Everything
 * that is part of the cached prompt matches the real calls exactly (model, thinking, effort, tools,
 * system, documents and their markers); a different one would write a second entry nothing reads.
 * Not streamed, because the API refuses `max_tokens: 0` on a stream.
 */
export async function keepWarm(docs: readonly DocRef[]): Promise<{ tokens: TenderTokens }> {
  const client = anthropic();
  try {
    const message = await client.beta.messages.create({
      model: aiModel(),
      max_tokens: 0,
      thinking: { type: 'adaptive' },
      output_config: { effort: aiEffort() },
      system: SYSTEM,
      tools: TOOLS,
      messages: [{ role: 'user', content: [...documentBlocks(docs), { type: 'text', text: KEEP_WARM_TEXT }] }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    });
    return { tokens: tokensOf(message.usage, message.model || aiModel()) };
  } catch (error) {
    throw toAiError(error);
  }
}

export async function fitTender(docs: readonly DocRef[], platforms: readonly PlatformDigest[]): Promise<{ result: FitResult; tokens: TenderTokens }> {
  if (platforms.length === 0) throw new AiError('bad_request', 'No platforms were sent to choose from.', 400);
  const { input, tokens } = await callTool('report_fit', [...documentBlocks(docs), { type: 'text', text: fitInstruction(platforms, docs) }]);
  return {
    result: readFit(
      input,
      platforms.map((platform) => platform.id),
      docs
    ),
    tokens
  };
}

export async function extractRange(
  docs: readonly DocRef[],
  range: { doc: number; from: number; to: number }
): Promise<{ found: ExtractedRequirement[]; tokens: TenderTokens }> {
  const doc = docs.find((one) => one.n === range.doc);
  if (!doc) throw new AiError('bad_request', `There is no document ${range.doc} in this tender.`, 400);
  const { input, tokens } = await callTool('report_requirements', [
    ...documentBlocks(docs, doc.n),
    { type: 'text', text: extractInstruction(doc, range.from, range.to) }
  ]);
  return { found: readRequirements(input, range, doc.pages), tokens };
}

export async function matchRequirements(
  catalog: readonly CatalogLine[],
  reqs: readonly MatchInput[],
  bundles: readonly BundleLine[] = []
): Promise<{ matches: Record<string, RequirementMatch>; tokens: TenderTokens }> {
  if (catalog.length === 0) throw new AiError('bad_request', 'This platform has no catalog to match against yet.', 400);
  if (reqs.length === 0) return { matches: {}, tokens: tokensOf(null, aiModel()) };
  const { input, tokens } = await callTool('report_matches', [
    /* the catalog is the same for every batch, so it is cached; the requirements come after it */
    { type: 'text', text: catalogText(catalog, bundles), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: matchInstruction(reqs) }
  ]);
  return {
    matches: readMatches(
      input,
      reqs.map((req) => req.id),
      new Set(catalog.map((line) => line.id)),
      new Set(catalog.map((line) => line.bundle))
    ),
    tokens
  };
}

/**
 * Puts a tender's requirements under topics and sets side by side the ones that ask for the same
 * work. Their words only: no documents and no catalog, so the call costs cents. What comes back is
 * narrowed to the ids asked about.
 */
export async function groupRequirements(reqs: readonly GroupInput[], topics: readonly string[]): Promise<GroupResult & { tokens: TenderTokens }> {
  if (reqs.length === 0) return { topics: {}, repeats: [], tokens: tokensOf(null, aiModel()) };
  const { input, tokens } = await callTool('report_groups', [{ type: 'text', text: groupInstruction(reqs, topics) }]);
  return {
    ...readGroups(
      input,
      reqs.map((req) => req.id)
    ),
    tokens
  };
}

/**
 * Sorts out-of-scope items into the teams that act on them. Only their words go: no documents and no
 * catalog, so the call costs cents. What comes back is narrowed to the five teams and the ids asked.
 */
export async function sortItems(items: readonly SortInput[]): Promise<{ categories: Record<string, SalesLegalCategory>; tokens: TenderTokens }> {
  if (items.length === 0) return { categories: {}, tokens: tokensOf(null, aiModel()) };
  const { input, tokens } = await callTool('report_categories', [{ type: 'text', text: sortInstruction(items) }]);
  return {
    categories: readCategories(
      input,
      items.map((item) => item.id)
    ),
    tokens
  };
}

/**
 * One document's key legal and commercial terms, or those of some of its pages after a split. The documents go first, in the order and with the
 * cache markers every other call uses, so this reads the tender from the cache the extraction left
 * and pays in full only for its short answer.
 */
export async function readKeyTerms(
  docs: readonly DocRef[],
  range: { doc: number; from: number; to: number }
): Promise<{ found: ExtractedTerm[]; tokens: TenderTokens }> {
  const doc = docs.find((one) => one.n === range.doc);
  if (!doc) throw new AiError('bad_request', `There is no document ${range.doc} in this tender.`, 400);
  const { input, tokens } = await callTool('report_terms', [...documentBlocks(docs, doc.n), { type: 'text', text: termsInstruction(doc, range.from, range.to) }]);
  return { found: readTerms(input, doc.n, doc.pages), tokens };
}
