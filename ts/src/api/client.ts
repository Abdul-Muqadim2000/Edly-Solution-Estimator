import type { PersistedState } from '@/types';

/** Typed client for /api/state. The only place the app talks to the server. */

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
  counts?: { estimations: number; requests: number; solutions: number; bundles: number; settings: number };
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

export async function saveState(state: PersistedState): Promise<SaveResponse> {
  const response = await fetch(API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state)
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
