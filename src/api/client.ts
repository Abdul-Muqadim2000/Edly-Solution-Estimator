import type { PersistedState, RequirementMatch, TenderTokens } from '@/types';
import type { AiErrorCode, CatalogLine, DocRef, ExtractedRequirement, FitResult, MatchInput, PlatformDigest } from '@/domain/tender';

/** Typed client for /api/state and /api/tender. The only place the app talks to the server. */

export interface StateResponse {
  ok: boolean;
  store: string;
  label: string;
  empty?: boolean;
  state: PersistedState;
  error?: string;
}

export interface SaveResponse {
  ok: boolean;
  label?: string;
  refused?: boolean;
  error?: string;
  at?: string | null;
  url?: string | null;
  bytes?: number | null;
  counts?: { estimations: number; requests: number; solutions: number; bundles: number; tenders: number; settings: number };
}

export interface ProbeResponse {
  ok: boolean;
  store: string;
  label: string;
  reachable: boolean;
  hasData: boolean;
  detail: string | null;
  targets: unknown[];
}

const API = '/api/state';

export async function fetchState(): Promise<StateResponse> {
  const response = await fetch(`${API}?t=${Date.now()}`, { cache: 'no-store' });
  const body = (await response.json()) as StateResponse;
  if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

/** `signal` lets a newer save cancel this one. A request cancelled while still uploading never reaches the server. */
export async function saveState(state: PersistedState, signal?: AbortSignal): Promise<SaveResponse> {
  const response = await fetch(API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
    signal
  });
  const body = (await response.json()) as SaveResponse;
  if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export async function probeStore(): Promise<ProbeResponse> {
  const response = await fetch(`${API}?probe=1`, { cache: 'no-store' });
  return (await response.json()) as ProbeResponse;
}

export const stateDownloadUrl = `${API}?format=xlsx`;

/** Last-chance save on the way out. Beacons can only POST. */
export function beaconSave(state: PersistedState): void {
  try {
    navigator.sendBeacon(API, new Blob([JSON.stringify(state)], { type: 'application/json' }));
  } catch {
    /* nothing useful to do if the browser refuses */
  }
}

/* ------------------------------------------------------------------ tenders */

const TENDER_API = '/api/tender';

/** A tender call that failed, with the reason the server gave. `code` decides what the runner does next. */
export class TenderApiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status: number,
    /** What a failed call still used; it is billed all the same. */
    readonly tokens?: TenderTokens
  ) {
    super(message);
  }
}

async function tenderCall<T>(op: string, init: RequestInit, query = ''): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${TENDER_API}?op=${op}${query}`, { method: 'POST', ...init });
  } catch (error) {
    throw new TenderApiError('upstream', `Could not reach the server: ${(error as Error).message}`, 0);
  }
  let body: { ok?: boolean; code?: AiErrorCode; error?: string; tokens?: TenderTokens } & Record<string, unknown>;
  try {
    body = (await response.json()) as typeof body;
  } catch {
    /* a platform timeout or a proxy page answers with HTML, not with our JSON */
    const code: AiErrorCode = response.status === 504 ? 'timeout' : response.status === 413 ? 'too_large' : 'upstream';
    throw new TenderApiError(code, `The server answered ${response.status} without a readable reply.`, response.status);
  }
  if (!response.ok || !body.ok) {
    throw new TenderApiError(body.code ?? 'upstream', body.error ?? `HTTP ${response.status}`, response.status, body.tokens);
  }
  return body as T;
}

const jsonInit = (body: unknown): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface AiProbe {
  ok: boolean;
  configured: boolean;
  model: string;
  /** Dollars a tender may spend on AI before a person is asked; missing from a server older than the limit. */
  limit?: number;
}

export async function tenderProbe(): Promise<AiProbe> {
  const response = await fetch(`${TENDER_API}?probe=1`, { cache: 'no-store' });
  return (await response.json()) as AiProbe;
}

export interface UploadedFile {
  fileId: string;
  bytes: number;
  expiresAt: string;
}

export function tenderUpload(name: string, kind: 'pdf' | 'text', body: Uint8Array): Promise<UploadedFile> {
  return tenderCall<UploadedFile>(
    'upload',
    { headers: { 'content-type': 'application/octet-stream' }, body: body as unknown as BodyInit },
    `&kind=${kind}&name=${encodeURIComponent(name)}`
  );
}

export function tenderFit(docs: DocRef[], platforms: PlatformDigest[]): Promise<{ result: FitResult; tokens: TenderTokens }> {
  return tenderCall('fit', jsonInit({ docs, platforms }));
}

/** Keeps the tender's cache alive while a person decides; see `nextKeepWarm`. */
export function tenderWarm(docs: DocRef[]): Promise<{ tokens: TenderTokens }> {
  return tenderCall('warm', jsonInit({ docs }));
}

export function tenderExtract(docs: DocRef[], range: { doc: number; from: number; to: number }): Promise<{ found: ExtractedRequirement[]; tokens: TenderTokens }> {
  return tenderCall('extract', jsonInit({ docs, range }));
}

export function tenderMatch(catalog: CatalogLine[], reqs: MatchInput[]): Promise<{ matches: Record<string, RequirementMatch>; tokens: TenderTokens }> {
  return tenderCall('match', jsonInit({ catalog, reqs }));
}

/** Deletes tender files at Anthropic. Resolves with the ids that are gone. */
export async function tenderDiscard(fileIds: string[]): Promise<string[]> {
  if (fileIds.length === 0) return [];
  const { deleted } = await tenderCall<{ deleted: string[]; failed: string[] }>('discard', jsonInit({ fileIds }));
  return deleted;
}
