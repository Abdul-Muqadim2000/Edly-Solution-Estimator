import type { PersistedState } from '../src/types';
import { readWorkbook, writeWorkbook } from '../src/lib/xlsx';
import { EMPTY_STATE, sheetsToState, stateToSheets } from './schema';
import type { DiscoveredTarget, Provider } from './providers/types';
import { blobProvider, localProvider } from './providers/builtin';

/**
 * Where the spreadsheet lives. One env var picks the provider:
 *
 *   EDLY_STORE=graph     OneDrive / SharePoint  — a real .xlsx in your Microsoft 365 drive
 *   EDLY_STORE=gsheet    Google Sheets          — live rows in a spreadsheet you own
 *   EDLY_STORE=dropbox   Dropbox                — a real .xlsx in your Dropbox
 *   EDLY_STORE=blob      Vercel Blob            — no account of yours needed
 *   EDLY_STORE=local     ./data/edly-state.xlsx — development
 *
 * Unset, it picks whichever credentials are present and falls back to local.
 */

export type StoreKind = 'graph' | 'gsheet' | 'dropbox' | 'blob' | 'local';

function autoDetect(): StoreKind {
  if (process.env.MS_CLIENT_SECRET && process.env.MS_DRIVE_ID) return 'graph';
  if (process.env.GOOGLE_SA_KEY && process.env.GOOGLE_SHEET_ID) return 'gsheet';
  if (process.env.DROPBOX_TOKEN || process.env.DROPBOX_REFRESH_TOKEN) return 'dropbox';
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  return 'local';
}

export function storeKind(): StoreKind {
  const explicit = (process.env.EDLY_STORE ?? '').toLowerCase();
  if (explicit === 'graph' || explicit === 'gsheet' || explicit === 'dropbox' || explicit === 'blob' || explicit === 'local') {
    return explicit;
  }
  return autoDetect();
}

/** Providers are imported lazily so an unconfigured one never runs. */
async function provider(): Promise<Provider> {
  switch (storeKind()) {
    case 'graph':
      return (await import('./providers/graph')).graphProvider;
    case 'gsheet':
      return (await import('./providers/gsheet')).gsheetProvider;
    case 'dropbox':
      return (await import('./providers/dropbox')).dropboxProvider;
    case 'blob':
      return blobProvider;
    default:
      return localProvider;
  }
}

export async function storeLabel(): Promise<string> {
  try {
    return (await provider()).label();
  } catch (error) {
    return `${storeKind()} (not configured: ${(error as Error).message})`;
  }
}

/** The stored state, or null when nothing has been written yet. */
export async function loadState(): Promise<PersistedState | null> {
  const store = await provider();
  if (store.kind === 'sheets') {
    const tables = await store.loadSheets();
    if (!tables) return null;
    const state = sheetsToState(tables);
    const populated =
      state.estimations.length > 0 ||
      state.requests.length > 0 ||
      state.solutions.length > 0 ||
      state.bundles.length > 0 ||
      Object.keys(state.settings).length > 0;
    return populated ? state : null;
  }
  const bytes = await store.load();
  if (!bytes) return null;
  return sheetsToState(await readWorkbook(bytes));
}

export interface SaveOutcome {
  store: string;
  pathname?: string | null;
  url?: string | null;
  bytes: number | null;
}

export async function saveState(state: PersistedState): Promise<SaveOutcome> {
  const store = await provider();
  const tables = stateToSheets(state);
  if (store.kind === 'sheets') {
    const result = await store.saveSheets(tables);
    return { ...result, bytes: null, store: store.label() };
  }
  const bytes = writeWorkbook(tables);
  const result = await store.save(bytes);
  return { ...result, bytes: bytes.length, store: store.label() };
}

/** Raw .xlsx for download, whatever the provider stores natively. */
export async function exportBytes(): Promise<Uint8Array> {
  const state = (await loadState()) ?? EMPTY_STATE;
  return writeWorkbook(stateToSheets(state));
}

export async function discover(): Promise<DiscoveredTarget[]> {
  const store = await provider();
  return store.discover ? store.discover() : [];
}
