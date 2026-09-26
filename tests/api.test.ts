import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from '../api/state';
import { storeKind } from '../server/store';
import { coerceState, countRows, EMPTY_STATE } from '../server/schema';
import type { Estimation, PersistedState } from '../src/types';

/**
 * The endpoint, driven end to end against a real spreadsheet in a temp directory.
 *
 * `/api/state` is the only thing standing between a browser that has lost its data and the
 * spreadsheet holding a quarter of deals. The guard it enforces — a zero-row PUT is refused while
 * the store holds rows — is asserted here against the real store rather than a mock, because the
 * bug it prevents happened once: an empty tab pushed at boot and blanked the file.
 */

let dir: string;
let previous: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'edly-api-'));
  previous = { EDLY_STORE: process.env.EDLY_STORE, EDLY_STATE_PATH: process.env.EDLY_STATE_PATH };
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

const url = (query = ''): string => `http://localhost/api/state${query}`;

const get = (query = ''): Promise<Response> => handle(new Request(url(query)));

const put = (body: unknown, query = ''): Promise<Response> =>
  handle(new Request(url(query), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

const estimation = (id: string, over: Partial<Estimation> = {}): Estimation => ({
  id,
  plat: 'openedx',
  name: `Deal ${id}`,
  slug: id.toLowerCase(),
  client: 'Acme',
  tag: 'Active',
  due: '2026-03-01',
  at: '2026-01-01',
  up: '2026-01-02',
  total: 120,
  cost: 14400,
  items: 3,
  snap: { sel: { 'OX-1': true }, buf: { 'OX-1': 8 }, bufPct: 10, cur: 'EUR' },
  ...over
});

const state = (over: Partial<PersistedState> = {}): PersistedState => ({ ...EMPTY_STATE, ...over });

describe('GET /api/state', () => {
  it('says the store is empty rather than inventing rows', async () => {
    const body = (await (await get()).json()) as { ok: boolean; empty: boolean; state: PersistedState; store: string };

    expect(body.ok).toBe(true);
    expect(body.empty).toBe(true);
    expect(body.store).toBe('local');
    expect(body.state).toEqual(EMPTY_STATE);
  });

  it('never caches, because two tabs share one spreadsheet', async () => {
    expect((await get()).headers.get('cache-control')).toBe('no-store');
  });

  it('round-trips everything a deal carries', async () => {
    await put(state({ estimations: [estimation('EST-1')] }));

    const body = (await (await get()).json()) as { empty: boolean; state: PersistedState };
    const back = body.state.estimations[0];

    expect(body.empty).toBe(false);
    expect(back).toMatchObject({ id: 'EST-1', name: 'Deal EST-1', slug: 'est-1', total: 120, cost: 14400 });
    /* the nested snapshot is the part a column-per-field schema would quietly lose */
    expect(back?.snap.sel).toEqual({ 'OX-1': true });
    expect(back?.snap.buf).toEqual({ 'OX-1': 8 });
    expect(back?.snap.cur).toBe('EUR');
  });

  it('hands back a downloadable workbook', async () => {
    await put(state({ estimations: [estimation('EST-1')] }));
    const response = await get('?format=xlsx');
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get('content-disposition')).toContain('edly-state.xlsx');
    /* a real zip, not an error page with a spreadsheet mime type on it */
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it('probes the configured store and reports whether it holds anything', async () => {
    const before = (await (await get('?probe=1')).json()) as { store: string; reachable: boolean; hasData: boolean };
    expect(before).toMatchObject({ store: 'local', reachable: true, hasData: false });

    await put(state({ estimations: [estimation('EST-1')] }));

    const after = (await (await get('?probe=1')).json()) as { hasData: boolean; targets: unknown[] };
    expect(after.hasData).toBe(true);
    expect(after.targets.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/state', () => {
  it('reports what it wrote, per sheet', async () => {
    const response = await put(
      state({
        estimations: [estimation('EST-1'), estimation('EST-2')],
        settings: { lastPlatform: 'openedx' }
      })
    );
    const body = (await response.json()) as { ok: boolean; counts: Record<string, number> };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.counts).toMatchObject({ estimations: 2, requests: 0, solutions: 0, bundles: 0, settings: 1 });
  });

  it('replaces rather than merges, so a deletion actually deletes', async () => {
    await put(state({ estimations: [estimation('EST-1'), estimation('EST-2')] }));
    await put(state({ estimations: [estimation('EST-2')] }));

    const body = (await (await get()).json()) as { state: PersistedState };
    expect(body.state.estimations.map((one) => one.id)).toEqual(['EST-2']);
  });

  it('accepts a beacon, which can only POST', async () => {
    const response = await handle(
      new Request(url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state({ estimations: [estimation('EST-1')] })) })
    );
    expect(response.status).toBe(200);
    expect(countRows((await (await get()).json() as { state: PersistedState }).state)).toBe(1);
  });

  it('ignores fields it does not recognise instead of storing them', async () => {
    const response = await put({ estimations: [estimation('EST-1')], nonsense: true, settings: 'not an object' });
    expect(response.status).toBe(200);

    const body = (await (await get()).json()) as { state: PersistedState & { nonsense?: unknown } };
    expect(body.state.nonsense).toBeUndefined();
    expect(body.state.settings).toEqual({});
  });
});

describe('the empty-payload guard', () => {
  it('refuses to blank a store that holds rows', async () => {
    await put(state({ estimations: [estimation('EST-1'), estimation('EST-2')] }));

    const response = await put(EMPTY_STATE);
    const body = (await response.json()) as { ok: boolean; refused: boolean; error: string };

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.refused).toBe(true);
    /* the message has to say how much it is protecting, or nobody knows whether to force it */
    expect(body.error).toContain('2 stored rows');
    expect(body.error).toContain('force=1');

    const after = (await (await get()).json()) as { state: PersistedState };
    expect(after.state.estimations).toHaveLength(2);
  });

  it('clears the store when the caller says so deliberately', async () => {
    await put(state({ estimations: [estimation('EST-1')] }));

    const response = await put(EMPTY_STATE, '?force=1');
    expect(response.status).toBe(200);

    const after = (await (await get()).json()) as { empty: boolean };
    expect(after.empty).toBe(true);
  });

  it('allows an empty write to an empty store, so a first boot is not an error', async () => {
    expect((await put(EMPTY_STATE)).status).toBe(200);
  });

  it('still calls a seeded-but-empty workbook empty, so hydration cannot wipe the browser', async () => {
    /* `bun run state:seed` writes an empty workbook, and the quick start tells everyone to run it.
       A file that merely exists is not data: reporting it as populated makes `useSync` hydrate the
       browser with zero rows and discard whatever it was holding. The sheets provider always got
       this right; the four file-backed ones did not. */
    await put(EMPTY_STATE);

    const body = (await (await get()).json()) as { empty: boolean };
    expect(body.empty).toBe(true);
    expect(((await (await get('?probe=1')).json()) as { hasData: boolean }).hasData).toBe(false);
  });

  it('counts every sheet, not just estimations', async () => {
    /* a payload with only settings is not "empty": losing the last platform is annoying, but
       losing the desk queue is not, and the guard must not let a requests-only store be blanked */
    await put(state({ requests: [{ id: 'RQ-01', plat: 'openedx', estId: '', estName: '', client: '', title: 'Custom SSO', details: '', area: '', urgency: '', integrations: '', name: '', email: '', org: '', at: '2026-01-01' }] }));

    expect((await put(EMPTY_STATE)).status).toBe(409);
  });
});

describe('bad requests', () => {
  it('rejects a body that is not JSON', async () => {
    const response = await handle(new Request(url(), { method: 'PUT', body: 'not json at all' }));
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('JSON');
  });

  it('rejects a JSON body that is not an object', async () => {
    const response = await handle(new Request(url(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '"a string"' }));
    expect(response.status).toBe(400);
  });

  it('refuses a method it does not implement', async () => {
    expect((await handle(new Request(url(), { method: 'DELETE' }))).status).toBe(405);
  });
});

describe('coerceState', () => {
  it('turns anything at all into the persisted shape', () => {
    expect(coerceState(null)).toEqual(EMPTY_STATE);
    expect(coerceState('nonsense')).toEqual(EMPTY_STATE);
    expect(coerceState({ estimations: 'not an array' })).toEqual(EMPTY_STATE);
    expect(coerceState({ settings: [1, 2] }).settings).toEqual({});
  });

  it('counts rows across every sheet but the settings', () => {
    expect(countRows(null)).toBe(0);
    expect(countRows(EMPTY_STATE)).toBe(0);
    expect(countRows(state({ settings: { lastPlatform: 'openedx' } }))).toBe(0);
    expect(countRows(state({ estimations: [estimation('EST-1')], bundles: [{ id: 'CB-01', plat: 'openedx', name: 'X', pitch: '', offerWhen: '', pairsWith: null, at: '2026-01-01' }] }))).toBe(2);
  });
});

describe('storeKind', () => {
  const clear = (...keys: string[]): void => {
    for (const key of keys) delete process.env[key];
  };

  it('honours an explicit choice', () => {
    process.env.EDLY_STORE = 'gsheet';
    expect(storeKind()).toBe('gsheet');
    process.env.EDLY_STORE = 'GRAPH';
    expect(storeKind()).toBe('graph');
  });

  it('ignores a store name it does not know, rather than failing to boot', () => {
    process.env.EDLY_STORE = 'postgres';
    clear('MS_CLIENT_SECRET', 'GOOGLE_SA_KEY', 'DROPBOX_TOKEN', 'DROPBOX_REFRESH_TOKEN', 'BLOB_READ_WRITE_TOKEN');
    expect(storeKind()).toBe('local');
  });

  it('detects Google Sheets from the credentials alone', () => {
    clear('EDLY_STORE', 'MS_CLIENT_SECRET', 'MS_DRIVE_ID');
    process.env.GOOGLE_SA_KEY = 'key';
    process.env.GOOGLE_SHEET_ID = 'sheet';
    expect(storeKind()).toBe('gsheet');
    clear('GOOGLE_SA_KEY', 'GOOGLE_SHEET_ID');
  });

  it('falls back to a local file when nothing is configured', () => {
    clear('EDLY_STORE', 'MS_CLIENT_SECRET', 'MS_DRIVE_ID', 'GOOGLE_SA_KEY', 'GOOGLE_SHEET_ID', 'DROPBOX_TOKEN', 'DROPBOX_REFRESH_TOKEN', 'BLOB_READ_WRITE_TOKEN');
    expect(storeKind()).toBe('local');
  });
});
