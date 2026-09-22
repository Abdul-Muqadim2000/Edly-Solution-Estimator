/* Where the workbook lives. One env var picks the provider:

     EDLY_STORE=graph     OneDrive / SharePoint  (a real .xlsx in your Microsoft 365 drive)
     EDLY_STORE=gsheet    Google Sheets          (live rows in a spreadsheet you own)
     EDLY_STORE=dropbox   Dropbox                (a real .xlsx in your Dropbox)
     EDLY_STORE=blob      Vercel Blob            (no account of yours needed)
     EDLY_STORE=local     ./data/edly-state.xlsx (bun dev)

   Unset, it picks the first provider whose credentials are present, then falls back to local.

   Two shapes of provider:
     file-backed  — load()/save(bytes): we serialise the workbook ourselves
     sheet-backed — loadSheets()/saveSheets(tables): the provider stores rows natively */

import { readWorkbook, writeWorkbook } from './xlsx.js';
import { stateToSheets, sheetsToState, EMPTY_STATE } from './schema.js';

const FILE_PROVIDERS = { graph: './providers/graph.js', dropbox: './providers/dropbox.js' };
const SHEET_PROVIDERS = { gsheet: './providers/gsheet.js' };

function autoDetect() {
  if (process.env.MS_CLIENT_SECRET && process.env.MS_DRIVE_ID) return 'graph';
  if (process.env.GOOGLE_SA_KEY && process.env.GOOGLE_SHEET_ID) return 'gsheet';
  if (process.env.DROPBOX_TOKEN || process.env.DROPBOX_REFRESH_TOKEN) return 'dropbox';
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  return 'local';
}

export const storeKind = () => (process.env.EDLY_STORE || autoDetect()).toLowerCase();

async function provider() {
  const kind = storeKind();
  if (FILE_PROVIDERS[kind]) return { kind, mode: 'file', mod: await import(FILE_PROVIDERS[kind]) };
  if (SHEET_PROVIDERS[kind]) return { kind, mode: 'sheets', mod: await import(SHEET_PROVIDERS[kind]) };
  if (kind === 'blob') return { kind, mode: 'file', mod: await blobProvider() };
  return { kind: 'local', mode: 'file', mod: localProvider() };
}

/* ---------- built-in providers ---------- */

async function blobProvider() {
  const KEY = process.env.EDLY_STATE_BLOB || 'edly-state.xlsx';
  const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
  const url = async () => {
    const res = await fetch('https://blob.vercel-storage.com/?prefix=' + encodeURIComponent(KEY) + '&limit=1', {
      headers: { authorization: 'Bearer ' + TOKEN, 'x-api-version': '7' }
    });
    if (!res.ok) return null;
    const body = await res.json();
    const hit = (body.blobs || []).find(b => b.pathname === KEY) || (body.blobs || [])[0];
    return hit ? hit.url : null;
  };
  return {
    label: () => 'vercel-blob:' + KEY,
    async load() {
      const u = await url();
      if (!u) return null;
      const res = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async save(bytes) {
      const res = await fetch('https://blob.vercel-storage.com/' + encodeURIComponent(KEY), {
        method: 'PUT',
        headers: {
          authorization: 'Bearer ' + TOKEN,
          'x-api-version': '7',
          'x-content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-add-random-suffix': '0',
          'x-cache-control-max-age': '0'
        },
        body: bytes
      });
      if (!res.ok) throw new Error('Blob write failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
      return res.json();
    },
    async discover() { return [{ kind: 'blob', name: KEY, url: await url() }]; }
  };
}

function localProvider() {
  const PATH = process.env.EDLY_STATE_PATH || './data/edly-state.xlsx';
  return {
    label: () => 'local-file:' + PATH,
    async load() {
      try {
        const { readFile } = await import('node:fs/promises');
        return new Uint8Array(await readFile(PATH));
      } catch { return null; }
    },
    async save(bytes) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const dir = PATH.replace(/[^/\\]+$/, '');
      if (dir) await mkdir(dir, { recursive: true });
      await writeFile(PATH, bytes);
      return { pathname: PATH };
    },
    async discover() { return [{ kind: 'local', name: PATH }]; }
  };
}

/* ---------- public API: state in, state out ---------- */

export async function storeLabel() {
  try { const p = await provider(); return p.mod.label(); }
  catch (err) { return storeKind() + ' (not configured: ' + (err.message || err) + ')'; }
}

/** The app state, or null when nothing has been stored yet. */
export async function loadState() {
  const p = await provider();
  if (p.mode === 'sheets') {
    const tables = await p.mod.loadSheets();
    if (!tables) return null;
    const state = sheetsToState(tables);
    const any = state.estimations.length || state.requests.length || state.solutions.length
      || state.bundles.length || Object.keys(state.settings).length;
    return any ? state : null;
  }
  const bytes = await p.mod.load();
  if (!bytes) return null;
  return sheetsToState(await readWorkbook(bytes));
}

export async function saveState(state) {
  const p = await provider();
  const tables = stateToSheets(state);
  if (p.mode === 'sheets') {
    const out = await p.mod.saveSheets(tables);
    return { ...out, bytes: null, store: p.mod.label() };
  }
  const bytes = writeWorkbook(tables);
  const out = await p.mod.save(bytes);
  return { ...out, bytes: bytes.length, store: p.mod.label() };
}

/** Raw .xlsx for download, whatever the provider stores natively. */
export async function exportBytes() {
  const state = (await loadState()) || EMPTY_STATE;
  return writeWorkbook(stateToSheets(state));
}

export async function discover() {
  const p = await provider();
  return p.mod.discover ? p.mod.discover() : [];
}
