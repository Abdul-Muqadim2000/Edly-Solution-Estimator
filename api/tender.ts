import { json, universal } from '../server/handler.js';
import { whole } from '../src/lib/narrow.js';
import { AiError, aiConfigured, aiModel, tenderLimitUsd, toAiError } from '../server/ai/anthropic.js';
import {
  discardDocuments,
  extractRange,
  fitTender,
  keepWarm,
  matchRequirements,
  readCatalog,
  readDocRefs,
  readMatchInputs,
  readPlatforms,
  uploadDocument
} from '../server/ai/tender.js';

/**
 * GET  /api/tender?probe=1                           whether the AI is set up here, the model, and a tender's limit in dollars
 * POST /api/tender?op=upload&name=…&kind=pdf|text    raw file bytes in, a Files API id out
 * POST /api/tender?op=fit       { docs, platforms }  platform fit, deal details, outline, page counts
 * POST /api/tender?op=warm      { docs }             keeps the tender's cache alive, nothing answered
 * POST /api/tender?op=extract   { docs, range }      one range's requirements
 * POST /api/tender?op=match     { catalog, reqs }    catalog matches for up to 60 requirements
 * POST /api/tender?op=discard   { fileIds }          deletes tender files at Anthropic
 *
 * Nothing here writes to the store. The browser turns what a person approves into state, and
 * that goes through /api/state like every other change.
 */

/** Vercel refuses a larger request body before the function runs; refusing it here says why. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

const failure = (error: AiError): Response =>
  json({ ok: false, code: error.code, error: error.message, ...(error.tokens ? { tokens: error.tokens } : {}) }, error.status);

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_JSON_BYTES) throw new AiError('too_large', 'That request is too large.', 413);
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new AiError('too_large', 'That request is too large.', 413);
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* answered below */
  }
  throw new AiError('bad_request', 'Body must be a JSON object.', 400);
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'GET') {
    if (url.searchParams.get('probe')) return json({ ok: true, configured: aiConfigured(), model: aiModel(), limit: tenderLimitUsd() });
    return json({ ok: false, error: 'Nothing to get here. See the comment at the top of api/tender.ts.' }, 404);
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const op = url.searchParams.get('op') ?? '';
  try {
    if (op === 'upload') {
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > MAX_UPLOAD_BYTES) throw new AiError('too_large', 'Files can be at most 4 MB for now.', 413);
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.length === 0) throw new AiError('bad_request', 'The file is empty.', 400);
      if (body.length > MAX_UPLOAD_BYTES) throw new AiError('too_large', 'Files can be at most 4 MB for now.', 413);
      const kind = url.searchParams.get('kind') === 'text' ? 'text' : 'pdf';
      if (kind === 'pdf' && new TextDecoder().decode(body.slice(0, 5)) !== '%PDF-') {
        throw new AiError('bad_request', 'That file is not a PDF.', 400);
      }
      const name = (url.searchParams.get('name') ?? '').trim().slice(0, 200) || 'tender';
      return json({ ok: true, ...(await uploadDocument(body, name, kind)) });
    }

    const body = await jsonBody(request);

    if (op === 'fit') {
      const { result, tokens } = await fitTender(readDocRefs(body.docs), readPlatforms(body.platforms));
      return json({ ok: true, result, tokens });
    }

    if (op === 'warm') {
      return json({ ok: true, ...(await keepWarm(readDocRefs(body.docs))) });
    }

    if (op === 'extract') {
      const range = (body.range ?? {}) as Record<string, unknown>;
      const { found, tokens } = await extractRange(readDocRefs(body.docs), { doc: whole(range.doc), from: Math.max(1, whole(range.from)), to: whole(range.to) });
      return json({ ok: true, found, tokens });
    }

    if (op === 'match') {
      const { matches, tokens } = await matchRequirements(readCatalog(body.catalog), readMatchInputs(body.reqs));
      return json({ ok: true, matches, tokens });
    }

    if (op === 'discard') {
      const ids = (Array.isArray(body.fileIds) ? body.fileIds : []).filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 20);
      return json({ ok: true, ...(await discardDocuments(ids)) });
    }

    return json({ ok: false, code: 'bad_request', error: `Unknown operation "${op}".` }, 400);
  } catch (error) {
    return failure(toAiError(error));
  }
}

export default universal(handle);
