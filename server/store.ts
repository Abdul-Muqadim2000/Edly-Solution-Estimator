import type { PersistedState } from '../src/types.js';
import { readWorkbook, writeWorkbook, type Workbook } from '../src/lib/xlsx.js';
import { EMPTY_STATE, sheetsToState, stateToSheets } from './schema.js';
import { rowsToUsers, USERS_SHEET, usersToRows, type UserRecord } from './users.js';
import type { DiscoveredTarget, Provider } from './providers/types.js';
import { blobProvider, localProvider } from './providers/builtin.js';

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
      return (await import('./providers/graph.js')).graphProvider;
    case 'gsheet':
      return (await import('./providers/gsheet.js')).gsheetProvider;
    case 'dropbox':
      return (await import('./providers/dropbox.js')).dropboxProvider;
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

/**
 * Has anything actually been stored, as opposed to a workbook merely existing?
 *
 * A seeded-but-empty file is not data. `useSync` hydrates the browser from any read it is not
 * told is empty, so calling an empty workbook populated makes the app replace the browser's own
 * rows with nothing — and `bun run state:seed`, which the quick start tells everyone to run,
 * writes exactly such a workbook. Every provider has to answer this the same way, or the bug
 * exists on the four file-backed ones and not on Google Sheets.
 */
const populated = (state: PersistedState): boolean =>
  state.estimations.length > 0 ||
  state.requests.length > 0 ||
  state.solutions.length > 0 ||
  state.bundles.length > 0 ||
  state.tenders.length > 0 ||
  state.salesLegal.length > 0 ||
  Object.keys(state.settings).length > 0;

async function loadTables(): Promise<Workbook | null> {
  const store = await provider();
  if (store.kind === 'sheets') return store.loadSheets();
  const bytes = await store.load();
  return bytes ? readWorkbook(bytes) : null;
}

/**
 * The stored state and the accounts, from one read. The accounts do not count towards `populated`:
 * a store holding nothing but accounts holds no work, and calling it populated would hydrate a
 * browser with nothing and discard what it was holding.
 */
export async function loadStore(): Promise<{ state: PersistedState | null; users: UserRecord[] }> {
  const tables = await loadTables();
  if (!tables) return { state: null, users: [] };
  const state = sheetsToState(tables);
  return { state: populated(state) ? state : null, users: rowsToUsers(tables[USERS_SHEET]) };
}

/** The stored state, or null when nothing has been written yet. */
export async function loadState(): Promise<PersistedState | null> {
  return (await loadStore()).state;
}

export async function loadUsers(): Promise<UserRecord[]> {
  return (await loadStore()).users;
}

export interface SaveOutcome {
  store: string;
  pathname?: string | null;
  url?: string | null;
  bytes: number | null;
}

/**
 * Saves the work. The accounts are never part of it, and never lost by it: a browser does not hold
 * them, so a save that wrote the Users tab from what a browser sent would delete every account.
 */
export async function saveState(state: PersistedState): Promise<SaveOutcome> {
  const store = await provider();
  const tables = stateToSheets(state);
  if (store.kind === 'sheets') {
    /* a Sheets save writes only the tabs it is given, and the Users tab is not one of them */
    const result = await store.saveSheets(tables);
    return { ...result, bytes: null, store: store.label() };
  }
  /* A file is written whole, so the accounts in it are carried over exactly as they are. A read
     that fails fails the save, rather than writing the file without them. */
  const held = await store.load();
  const users = held ? (await readWorkbook(held))[USERS_SHEET] : undefined;
  if (users && users.length > 0) tables[USERS_SHEET] = users;
  const bytes = writeWorkbook(tables);
  const result = await store.save(bytes);
  return { ...result, bytes: bytes.length, store: store.label() };
}

/**
 * Saves the accounts, and nothing else. On Google Sheets that is the Users tab alone. A file is
 * written whole, so the work in it is read and written back with them, the way the app saves it.
 */
export async function saveUsers(users: readonly UserRecord[]): Promise<void> {
  const store = await provider();
  const rows = usersToRows(users);
  if (store.kind === 'sheets') {
    await store.saveSheets({ [USERS_SHEET]: rows });
    return;
  }
  const held = await store.load();
  const tables = stateToSheets(held ? sheetsToState(await readWorkbook(held)) : EMPTY_STATE);
  tables[USERS_SHEET] = rows;
  await store.save(writeWorkbook(tables));
}

/** Raw .xlsx for download, whatever the provider stores natively. The accounts are left out: the file is for reading the work. */
export async function exportBytes(): Promise<Uint8Array> {
  const state = (await loadState()) ?? EMPTY_STATE;
  return writeWorkbook(stateToSheets(state));
}

export async function discover(): Promise<DiscoveredTarget[]> {
  const store = await provider();
  return store.discover ? store.discover() : [];
}
