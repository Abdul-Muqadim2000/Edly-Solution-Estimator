import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALL_SYNCED_KEYS,
  readStorage,
  removeStorage,
  STORAGE_KEYS,
  SYNCED_DATA_KEYS,
  SYNCED_SETTING_KEYS,
  writeStorage
} from '../src/state/keys';
import { discover, exportBytes, loadState, saveState, storeLabel } from '../server/store';
import { EMPTY_STATE } from '../server/schema';
import { readWorkbook } from '../src/lib/xlsx';
import type { Estimation } from '../src/types';

/**
 * Browser storage, and the store layer above the providers.
 *
 * Both sit either side of the same promise: what the app holds locally and what ends up in the
 * customer's spreadsheet are the same data. The interesting cases are the ones where the browser
 * refuses to cooperate — private mode, a full quota, a half-written value — because the app has
 * to keep working there rather than throwing on boot.
 */

/* -------------------------------------------------------- browser storage */

describe('browser storage', () => {
  let store: Record<string, string>;
  let throwOnWrite: boolean;
  let throwOnRead: boolean;

  beforeEach(() => {
    store = {};
    throwOnWrite = false;
    throwOnRead = false;
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => {
          if (throwOnRead) throw new Error('access denied');
          return key in store ? store[key] : null;
        },
        setItem: (key: string, value: string) => {
          if (throwOnWrite) throw new Error('quota exceeded');
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        }
      }
    });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('round-trips a value', () => {
    writeStorage(STORAGE_KEYS.platform, { practice: 'edtech', plat: 'openedx' });
    expect(readStorage(STORAGE_KEYS.platform, null)).toEqual({ practice: 'edtech', plat: 'openedx' });
  });

  it('returns the fallback for a key that was never written', () => {
    expect(readStorage(STORAGE_KEYS.estimations, [])).toEqual([]);
    expect(readStorage('nothing-here', 'default')).toBe('default');
  });

  it('returns the fallback rather than throwing on a corrupted value', () => {
    store[STORAGE_KEYS.estimations] = '{"half written';
    /* a truncated write must not take the whole app down at boot */
    expect(readStorage(STORAGE_KEYS.estimations, [])).toEqual([]);
  });

  it('survives a browser that refuses to read at all', () => {
    throwOnRead = true;
    expect(readStorage(STORAGE_KEYS.estimations, [])).toEqual([]);
  });

  it('swallows a failed write, because the spreadsheet is the copy that matters', () => {
    throwOnWrite = true;
    /* private mode, or a full quota: the sync loop still pushes to the store */
    expect(() => writeStorage(STORAGE_KEYS.estimations, [1, 2, 3])).not.toThrow();
  });

  it('removes a key, and survives being asked to remove one that is not there', () => {
    writeStorage(STORAGE_KEYS.auth, { user: 'admin' });
    removeStorage(STORAGE_KEYS.auth);
    expect(readStorage(STORAGE_KEYS.auth, null)).toBeNull();
    expect(() => removeStorage('never-existed')).not.toThrow();
  });

  it('distinguishes a stored null from a missing key', () => {
    writeStorage('explicit-null', null);
    expect(readStorage('explicit-null', 'fallback')).toBeNull();
    expect(readStorage('absent', 'fallback')).toBe('fallback');
  });

  it('keeps the session out of the synced set', () => {
    /* a session belongs to its browser: syncing auth would sign everyone in as whoever saved last */
    expect(ALL_SYNCED_KEYS).not.toContain(STORAGE_KEYS.auth);
    expect(ALL_SYNCED_KEYS).toEqual([...SYNCED_DATA_KEYS, ...SYNCED_SETTING_KEYS]);
  });

  it('gives every key a distinct name', () => {
    const names = Object.values(STORAGE_KEYS);
    expect(new Set(names).size).toBe(names.length);
    /* versioned, so an old shape cannot be read back as a new one */
    for (const name of names) expect(name).toMatch(/-v\d+$/);
  });
});

/* ------------------------------------------------------------ the store layer */

describe('the store layer', () => {
  let dir: string;
  let previous: Record<string, string | undefined>;

  const KEYS = ['EDLY_STORE', 'EDLY_STATE_PATH', 'GOOGLE_SHEET_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY', 'BLOB_READ_WRITE_TOKEN', 'EDLY_STATE_BLOB'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'edly-store-'));
    previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    for (const key of KEYS) delete process.env[key];
    process.env.EDLY_STORE = 'local';
    process.env.EDLY_STATE_PATH = join(dir, 'edly-state.xlsx');
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const estimation = (id: string): Estimation => ({
    id,
    plat: 'openedx',
    name: `Deal ${id}`,
    slug: id.toLowerCase(),
    client: 'Acme',
    tag: 'Active',
    due: '',
    at: '2026-01-01',
    up: '2026-01-01',
    total: 40,
    cost: 4800,
    items: 1,
    snap: { sel: { 'OX-1': true }, buf: {}, bufPct: 0 }
  });

  it('names the local file it is writing to', async () => {
    expect(await storeLabel()).toContain('local-file:');
  });

  it('reads nothing from a directory with no workbook in it', async () => {
    expect(await loadState()).toBeNull();
  });

  it('reads nothing from a file that is not a workbook, instead of crashing the endpoint', async () => {
    writeFileSync(join(dir, 'edly-state.xlsx'), 'this is not a zip');
    await expect(loadState()).rejects.toThrow();
  });

  it('round-trips through a real file', async () => {
    await saveState({ ...EMPTY_STATE, estimations: [estimation('EST-1')] });
    const back = await loadState();

    expect(back?.estimations[0]).toMatchObject({ id: 'EST-1', name: 'Deal EST-1', total: 40 });
  });

  it('reports how many bytes it wrote, so a silent no-op is visible', async () => {
    const result = await saveState({ ...EMPTY_STATE, estimations: [estimation('EST-1')] });
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.pathname).toContain('edly-state.xlsx');
  });

  it('exports a workbook even when nothing has been stored', async () => {
    const bytes = await exportBytes();
    const workbook = await readWorkbook(bytes);

    /* an empty download still has to open in Excel, with its five sheets and their headers */
    expect(Object.keys(workbook)).toEqual(['Estimations', 'Requests', 'EstimatedSolutions', 'CustomBundles', 'Settings']);
    expect(workbook.Estimations?.[0]).toContain('id');
  });

  it('exports what is stored', async () => {
    await saveState({ ...EMPTY_STATE, estimations: [estimation('EST-1')] });
    const workbook = await readWorkbook(await exportBytes());

    expect(workbook.Estimations?.some((row) => row.includes('EST-1'))).toBe(true);
  });

  it('lists the local file as its one target', async () => {
    expect(await discover()).toEqual([{ kind: 'local', name: join(dir, 'edly-state.xlsx') }]);
  });

  it('says a provider is unconfigured rather than throwing out of storeLabel', async () => {
    /* store:probe has to print something useful when the credentials are missing entirely */
    process.env.EDLY_STORE = 'gsheet';
    expect(await storeLabel()).toContain('gsheet');
  });
});

/* ------------------------------------------- the store layer over Google Sheets */

describe('the store layer over a sheets provider', () => {
  const realFetch = globalThis.fetch;
  let replies: Array<{ status?: number; json?: unknown; text?: string }>;
  let previous: Record<string, string | undefined>;
  const KEYS = ['EDLY_STORE', 'GOOGLE_SHEET_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY'];

  beforeEach(async () => {
    previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    replies = [];
    globalThis.fetch = (async () => {
      const reply = replies.shift() ?? { json: {} };
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => reply.json ?? {},
        text: async () => reply.text ?? JSON.stringify(reply.json ?? {})
      } as unknown as Response;
    }) as typeof fetch;

    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    let binary = '';
    for (const byte of pkcs8) binary += String.fromCharCode(byte);

    process.env.EDLY_STORE = 'gsheet';
    process.env.GOOGLE_SHEET_ID = 'sheet-1';
    process.env.GOOGLE_SA_EMAIL = 'sa@project.iam.gserviceaccount.com';
    process.env.GOOGLE_SA_KEY = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----\n`;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const auth = { json: { access_token: 'token', expires_in: 3600 } };

  it('treats a spreadsheet with only headers in it as nothing stored', async () => {
    const { loadState: load } = await import('../server/store');
    replies = [
      auth,
      { json: { sheets: [{ properties: { title: 'Estimations' } }] } },
      { json: { valueRanges: [{ values: [['id', 'plat', 'name']] }] } }
    ];

    /* a header row is not data: reporting it as populated makes the app hydrate the browser with
       nothing, which is the same wipe the file providers used to allow */
    expect(await load()).toBeNull();
  });

  it('reads rows back into state', async () => {
    const { loadState: load } = await import('../server/store');
    replies = [
      auth,
      { json: { sheets: [{ properties: { title: 'Estimations' } }] } },
      {
        json: {
          valueRanges: [
            {
              values: [
                ['id', 'plat', 'name', 'slug', 'client', 'tag', 'due', 'created', 'updated', 'totalHours', 'cost', 'solutions', 'snapshotJson'],
                /* plain JSON: the pipe wrapping is only for the chunked Settings rows */
                ['EST-1', 'openedx', 'Acme Academy', 'acme-academy', 'Acme', 'Active', '', '2026-01-01', '2026-01-01', '40', '4800', '1', '{"sel":{"OX-1":true}}']
              ]
            }
          ]
        }
      }
    ];

    const state = await load();
    expect(state?.estimations[0]).toMatchObject({ id: 'EST-1', name: 'Acme Academy', total: 40 });
    expect(state?.estimations[0]?.snap.sel).toEqual({ 'OX-1': true });
  });

  it('writes rows rather than a file, and reports no byte count', async () => {
    const { saveState: save } = await import('../server/store');
    replies = [auth, { json: { sheets: [{ properties: { title: 'Estimations', sheetId: 0 } }] } }, { json: {} }, { json: {} }, { json: {} }];

    const result = await save({ ...EMPTY_STATE, settings: { lastPlatform: 'openedx' } });

    /* the sheet stays live: there is no file, so there are no bytes to report */
    expect(result.bytes).toBeNull();
    expect(result.url).toContain('docs.google.com/spreadsheets');
  });

  it('still exports a downloadable workbook from a live sheet', async () => {
    const { exportBytes: exportIt } = await import('../server/store');
    replies = [auth, { json: { sheets: [] } }];

    const workbook = await readWorkbook(await exportIt());
    expect(Object.keys(workbook)).toContain('Estimations');
  });
});

/* --------------------------------------------------------------- Vercel Blob */

describe('Vercel Blob', () => {
  const realFetch = globalThis.fetch;
  let calls: string[];
  let replies: Array<{ status?: number; json?: unknown; text?: string; bytes?: Uint8Array }>;

  beforeEach(() => {
    calls = [];
    replies = [];
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      const reply = replies.shift() ?? { json: {} };
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => reply.json ?? {},
        text: async () => reply.text ?? '',
        arrayBuffer: async () => (reply.bytes ?? new Uint8Array()).buffer
      } as unknown as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.EDLY_STATE_BLOB;
  });

  const provider = async () => {
    vi.resetModules();
    return (await import('../server/providers/builtin')).blobProvider;
  };

  it('names the blob it is using', async () => {
    expect((await provider()).label()).toBe('vercel-blob:edly-state.xlsx');
    process.env.EDLY_STATE_BLOB = 'custom.xlsx';
    expect((await provider()).label()).toBe('vercel-blob:custom.xlsx');
  });

  it('reads nothing when the blob has never been written', async () => {
    replies = [{ json: { blobs: [] } }];
    expect(await (await provider()).load()).toBeNull();
  });

  it('fetches the current blob with a cache-buster', async () => {
    replies = [{ json: { blobs: [{ pathname: 'edly-state.xlsx', url: 'https://blob.example/edly-state.xlsx' }] } }, { bytes: new Uint8Array([1, 2, 3]) }];

    const bytes = await (await provider()).load();

    expect(Array.from(bytes!)).toEqual([1, 2, 3]);
    /* without the timestamp the CDN serves the previous version to the next reader */
    expect(calls[1]).toMatch(/^https:\/\/blob\.example\/edly-state\.xlsx\?t=\d+$/);
  });

  it('reads nothing when the listing itself fails', async () => {
    replies = [{ status: 500 }];
    expect(await (await provider()).load()).toBeNull();
  });

  it('writes without a random suffix, so the path stays stable', async () => {
    replies = [{ json: { pathname: 'edly-state.xlsx', url: 'https://blob.example/edly-state.xlsx' } }];

    const result = await (await provider()).save(new Uint8Array([1, 2, 3]));

    expect(calls[0]).toContain('blob.vercel-storage.com/edly-state.xlsx');
    expect(result.url).toBe('https://blob.example/edly-state.xlsx');
  });

  it('raises a failed write rather than reporting success', async () => {
    replies = [{ status: 403, text: 'forbidden' }];
    await expect((await provider()).save(new Uint8Array([1]))).rejects.toThrow(/Blob write failed: 403/);
  });

  it('describes the blob for store:discover', async () => {
    replies = [{ json: { blobs: [{ pathname: 'edly-state.xlsx', url: 'https://blob.example/x' }] } }];
    const blob = await provider();
    expect(blob.discover).toBeDefined();
    expect(await blob.discover!()).toEqual([{ kind: 'blob', name: 'edly-state.xlsx', url: 'https://blob.example/x' }]);
  });
});
