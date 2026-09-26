import { describe, expect, it } from 'vitest';
import { readWorkbook, writeWorkbook } from '../src/lib/xlsx';
import { coerceState, countRows, sheetsToState, stateToSheets, storedForm, syncKey, SHEETS } from '../server/schema';
import type { Catalog, PersistedState } from '../src/types';

/**
 * These tests exist because every one of them once failed.
 * If you change the schema, they are the contract: nothing may be lost in a round-trip.
 */

/** A catalog big enough to exceed one Excel cell when serialised (32,767 chars). */
function bigCatalog(): Catalog {
  return {
    meta: {
      title: 'Loaded sheet',
      subtitle: '',
      compiled: '2026-09-01',
      totals: { features: 270, buildHrs: null, firstHrs: 1000, repeatHrs: 300, saved: null, noEstimate: 0, inDev: 0 },
      notes: []
    },
    bundles: Array.from({ length: 30 }, (_, bundleIndex) => ({
      id: `B${String(bundleIndex + 1).padStart(2, '0')}`,
      name: `Bundle number ${bundleIndex + 1}`,
      pitch: 'A pitch long enough to matter when serialised, with spaces near the boundaries. '.repeat(8),
      offerWhen: '',
      featureCount: 9,
      buildHrs: null,
      firstHrs: 100,
      repeatHrs: 30,
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items: Array.from({ length: 9 }, (_, itemIndex) => ({
        id: `X-${bundleIndex}-${itemIndex}`,
        name: `Solution ${bundleIndex}.${itemIndex}`,
        desc: 'What it does, described at the length a real catalog row uses, with spaces. '.repeat(5),
        form: 'Integration',
        status: 'Production' as const,
        deploy: '2–3 days',
        first: 8 + itemIndex,
        repeat: 3 + itemIndex,
        build: 40 + itemIndex,
        saving: null,
        account: null,
        integrations: null,
        notes: null,
        ref: null,
        category: 'Core Platform',
        subCategory: null
      }))
    }))
  };
}

function sample(): PersistedState {
  const catalog = bigCatalog();
  return {
    estimations: [
      {
        id: 'EST-1',
        plat: 'openedx',
        name: 'Acme Corporate Academy',
        slug: 'acme-corporate-academy',
        client: 'Acme Ltd',
        tag: 'Urgent',
        due: '2026-10-15',
        at: '2026-09-01',
        up: '2026-09-22',
        total: 1259.95,
        cost: 74_250,
        items: 13,
        snap: {
          sel: { 'EDU-071': true, 'EDU-041': true, 'CS-01': true },
          buf: { 'EDU-071': 4.5 },
          bufPct: 12,
          pm: 10,
          qa: 8,
          rate: 62,
          cur: 'EUR',
          cap: 80,
          gs: { B01: 0, B05: 2.5 },
          roles: [
            { id: 'sr', name: 'Senior Engineer', rate: 55 },
            { id: 'devops', name: 'DevOps', rate: 50 }
          ],
          lineRole: { 'EDU-071': 'devops', 'EDU-041': 'sr' },
          pmRole: 'pm',
          qaRole: 'qa',
          plan: { 'EDU-071': { start: 2, people: 3, order: 0 }, 'EDU-041': { people: 2, order: 1 } },
          hpw: 38,
          maxPar: 5,
          planStart: '2026-10-01'
        }
      },
      {
        id: 'EST-2',
        plat: 'moodle',
        name: 'Nordic University',
        slug: 'nordic-university',
        client: '',
        tag: 'Closed',
        due: '',
        at: '2026-08-02',
        up: '2026-08-30',
        total: 0,
        cost: 0,
        items: 0,
        snap: { sel: {}, buf: {}, bufPct: 0 }
      }
    ],
    requests: [
      {
        id: 'RQ-01',
        plat: 'openedx',
        estId: 'EST-1',
        estName: 'Acme Corporate Academy',
        client: 'Acme Ltd',
        title: 'Proctored exam integration',
        details: 'Live proctoring with identity check and session recording',
        area: 'Assessment',
        urgency: 'Blocking a Q4 deal',
        integrations: 'Proctorio',
        name: 'Sara',
        email: 'sara@edly.io',
        org: 'Edly',
        at: '2026-09-10',
        est: 48,
        repeatEst: 12,
        csId: 'CS-01',
        catBundle: 'B05',
        estBy: 'admin',
        estAt: '2026-09-12',
        estNote: 'Assumes the Proctorio contract is already in place',
        catForm: 'Custom development',
        catDeploy: '3–4 days',
        catInteg: 'Proctorio',
        catCategory: 'Assessment',
        catSub: 'Custom',
        catAccount: 'Proctorio',
        catLimits: 'One exam window per course'
      },
      {
        id: 'RQ-02',
        plat: 'openedx',
        estId: 'EST-1',
        estName: 'Acme Corporate Academy',
        client: 'Acme Ltd',
        title: 'Manually added line',
        details: 'Manually added custom item',
        area: 'Custom',
        urgency: '',
        integrations: '',
        name: '',
        email: '',
        org: '',
        at: '2026-09-11',
        manual: true,
        est: 16
      },
      {
        id: 'RQ-03',
        plat: 'moodle',
        estId: 'EST-2',
        estName: 'Nordic University',
        client: '',
        title: 'Teams attendance sync',
        details: 'Still pending',
        area: 'Integration',
        urgency: '',
        integrations: '',
        name: '',
        email: '',
        org: '',
        at: '2026-09-18'
      }
    ],
    solutions: [
      {
        id: 'CS-01',
        plat: 'openedx',
        bundleId: 'B05',
        name: 'Proctored exam integration',
        desc: 'Live proctoring',
        first: 48,
        repeat: 12,
        form: 'Custom development',
        deploy: '3–4 days',
        integrations: '',
        category: 'Assessment',
        subCategory: 'Custom',
        account: 'Proctorio',
        limits: 'One exam window per course',
        note: 'Vendor contract assumed',
        from: 'RQ-01',
        estAt: '2026-09-12',
        direct: false
      },
      {
        id: 'CS-02',
        plat: 'moodle',
        bundleId: 'CB-01',
        name: 'Blue-green deployment pipeline',
        desc: 'Zero downtime releases',
        first: 64,
        repeat: 16,
        form: 'Custom development',
        deploy: '1 week',
        integrations: '',
        category: 'Infrastructure',
        subCategory: '',
        account: '',
        limits: 'Single-region only',
        note: '',
        from: '',
        estAt: '2026-09-20',
        direct: true
      }
    ],
    bundles: [
      {
        id: 'CB-01',
        plat: 'moodle',
        name: 'Deployment & Infrastructure',
        pitch: 'Zero-downtime releases',
        offerWhen: 'release safety, uptime',
        pairsWith: null,
        at: '2026-09-20'
      }
    ],
    settings: {
      'edly-platform-v2': { practice: 'edtech', plat: 'openedx' },
      'edly-open-estimation-v2': 'EST-1',
      'edly-workspace-v2': { display: { savings: true, notes: true, money: false, controls: true, blendBuffer: false } },
      'edly-loaded-catalogs-v2': { openedx: catalog, moodle: catalog }
    }
  };
}

const roundTrip = async (state: PersistedState): Promise<PersistedState> =>
  sheetsToState(await readWorkbook(writeWorkbook(stateToSheets(state))));

describe('spreadsheet round-trip', () => {
  it('writes a workbook Excel can open', () => {
    expect(writeWorkbook(stateToSheets(sample())).length).toBeGreaterThan(2000);
  });

  it('keeps every estimation field, including the nested snapshot', async () => {
    const original = sample();
    const back = await roundTrip(original);
    expect(back.estimations).toHaveLength(2);
    expect(back.estimations[0]?.total).toBe(1259.95);
    expect(back.estimations[0]?.cost).toBe(74_250);
    /* the snapshot carries selections, buffers, rate card, role assignments and the plan */
    expect(back.estimations[0]?.snap).toEqual(original.estimations[0]?.snap);
  });

  it('keeps the slug a deep link is built from', async () => {
    const back = await roundTrip(sample());
    expect(back.estimations[0]?.slug).toBe('acme-corporate-academy');
    expect(back.estimations[1]?.slug).toBe('nordic-university');
  });

  it('gives a file written before the slug column a slug, unique within its platform', async () => {
    /* exactly what an older build wrote: the slug column is not there at all */
    const columns = ['id', 'plat', 'name', 'client', 'tag', 'due', 'created', 'updated', 'totalHours', 'cost', 'solutions', 'snapshotJson'];
    const row = (id: string, plat: string, client: string): (string | number)[] => [
      id, plat, 'Acme Corporate Academy', client, 'Active', '', '2026-01-01', '2026-01-02', 0, 0, 0, '{}'
    ];
    const legacy = {
      [SHEETS.estimations]: [columns, row('EST-1', 'openedx', 'One'), row('EST-2', 'openedx', 'Two'), row('EST-3', 'moodle', 'Three')]
    };

    const back = sheetsToState(await readWorkbook(writeWorkbook(legacy)));
    expect(back.estimations[0]?.slug).toBe('acme-corporate-academy');
    /* two deals with one name on one platform must not share a URL */
    expect(back.estimations[1]?.slug).toBe('acme-corporate-academy-2');
    /* another platform is its own namespace, so it starts clean */
    expect(back.estimations[2]?.slug).toBe('acme-corporate-academy');
  });

  it('never rewrites a slug that is already set', async () => {
    /* a renamed deal keeps its original slug, so a link shared last week still opens it */
    const renamed = sample();
    const first = renamed.estimations[0];
    if (first) first.name = 'Acme Global Academy — renamed';
    const back = await roundTrip(renamed);
    expect(back.estimations[0]?.slug).toBe('acme-corporate-academy');
  });

  it('keeps a closed estimation with blank fields', async () => {
    const back = await roundTrip(sample());
    expect(back.estimations[1]?.tag).toBe('Closed');
    expect(back.estimations[1]?.total).toBe(0);
    expect(back.estimations[1]?.due).toBe('');
  });

  it('keeps request hours and every catalog field', async () => {
    const back = await roundTrip(sample());
    expect(back.requests[0]?.est).toBe(48);
    expect(back.requests[0]?.repeatEst).toBe(12);
    expect(back.requests[0]?.catLimits).toBe('One exam window per course');
    expect(back.requests[0]?.catAccount).toBe('Proctorio');
    expect(back.requests[1]?.manual).toBe(true);
  });

  it('leaves an un-estimated request with NO hours, not zero', async () => {
    /* zero would read as "estimated at nothing" and would join the totals */
    const back = await roundTrip(sample());
    expect(back.requests[2]?.est).toBeUndefined();
  });

  it('keeps desk-added solutions and their direct flag', async () => {
    const back = await roundTrip(sample());
    expect(back.solutions).toHaveLength(2);
    expect(back.solutions[0]?.direct).toBe(false);
    expect(back.solutions[1]?.direct).toBe(true);
    expect(back.solutions[1]?.plat).toBe('moodle');
  });

  it('keeps custom bundle categories', async () => {
    const back = await roundTrip(sample());
    expect(back.bundles[0]?.name).toBe('Deployment & Infrastructure');
  });

  it('keeps settings, including a raw string value', async () => {
    const back = await roundTrip(sample());
    expect(back.settings['edly-open-estimation-v2']).toBe('EST-1');
    expect(back.settings['edly-platform-v2']).toEqual({ practice: 'edtech', plat: 'openedx' });
  });
});

describe('oversized values', () => {
  it('splits anything past an Excel cell and rejoins it exactly', async () => {
    const original = sample();
    const payload = JSON.stringify(original.settings['edly-loaded-catalogs-v2']);
    expect(payload.length).toBeGreaterThan(32_767);

    const sheets = stateToSheets(original);
    const settings = sheets[SHEETS.settings] ?? [];
    const chunked = settings.filter((row) => String(row[0]).includes('##'));
    expect(chunked.length).toBeGreaterThanOrEqual(2);
    /* no cell may exceed the limit, or the tail is silently truncated */
    for (const row of settings) expect(String(row[1] ?? '').length).toBeLessThanOrEqual(28_002);

    const back = await roundTrip(original);
    expect(back.settings['edly-loaded-catalogs-v2']).toEqual(original.settings['edly-loaded-catalogs-v2']);
  });

  it('keeps settings in the order they were written, even one split across rows', async () => {
    /* a split value used to be re-added after the plain ones, so it came back last */
    const original = sample();
    original.settings['edly-catalog-source-v2'] = { source: 'auto', at: '2026-09-26' };
    const back = await roundTrip(original);
    expect(Object.keys(back.settings)).toEqual(Object.keys(original.settings));
  });

  it('drops a split value with a chunk missing, and leaves no empty key where it was', async () => {
    /* a hand-edited sheet with one chunk row deleted: half a catalog would fail to parse later */
    const sheets = stateToSheets(sample());
    const settings = sheets[SHEETS.settings] ?? [];
    sheets[SHEETS.settings] = settings.filter((row) => !String(row[0]).startsWith('edly-loaded-catalogs-v2##2/'));

    const back = sheetsToState(await readWorkbook(writeWorkbook(sheets)));
    expect(Object.keys(back.settings)).not.toContain('edly-loaded-catalogs-v2');
    expect(back.settings['edly-platform-v2']).toEqual({ practice: 'edtech', plat: 'openedx' });
  });

  it('survives a space landing on a chunk boundary', async () => {
    /* chunks are pipe-wrapped because the reader trims cells */
    const spaced = { ...sample(), settings: { 'edly-workspace-v2': { blob: 'word '.repeat(12_000) } } };
    const back = await roundTrip(spaced);
    expect(back.settings['edly-workspace-v2']).toEqual(spaced.settings['edly-workspace-v2']);
  });
});

/**
 * What `useSync` compares. It used to compare raw JSON text, and the text of what the browser
 * holds never equals the text of what a store hands back for the same data: cells cannot tell ''
 * from a missing field, the reader trims every cell, and a split setting came back last. So every
 * 45 s poll looked like a change, and each open tab re-read and rewrote the whole workbook.
 */
describe('the sync key', () => {
  /** A workspace shaped the way the reducer shapes one, including the parts a cell flattens. */
  function heldByTheBrowser(): PersistedState {
    const state = sample();
    /* the deal seeded for a fresh workspace has no tag at all */
    state.estimations.push({
      id: 'EST-3', plat: 'openedx', name: 'General estimation', slug: 'general-estimation', client: '', tag: '',
      due: '', at: '2026-09-01', up: '2026-09-01', total: 0, cost: 0, items: 0,
      snap: { sel: {}, buf: {}, bufPct: 0, pm: null, qa: null, cur: 'USD', planStart: '' }
    });
    const pending = state.requests[2];
    /* typed into a textarea, so it ends in a newline the reader will trim */
    if (pending) pending.details = 'Still pending, see the thread\n';
    const priced = state.requests[0];
    /* the desk left the note blank: '' here, and no cell at all in the sheet */
    if (priced) priced.estNote = '';
    const custom = state.solutions[0];
    /* two fields the reducer sets that the sheet has no column for */
    if (custom) Object.assign(custom, { integrations: 'Proctorio', estName: 'Acme Corporate Academy' });
    /* the order `SYNCED_SETTING_KEYS` produces, with the split catalog in the middle */
    const catalogs = state.settings['edly-loaded-catalogs-v2'];
    state.settings = {
      'edly-workspace-v2': state.settings['edly-workspace-v2'],
      'edly-open-estimation-v2': 'EST-1',
      'edly-platform-v2': { practice: 'edtech', plat: 'openedx' },
      'edly-loaded-catalogs-v2': catalogs,
      'edly-catalog-source-v2': { source: 'auto', name: 'catalog-source.xlsx', at: '2026-09-26' }
    };
    return state;
  }

  it('is the same for what the browser holds and what the store hands back', async () => {
    const held = heldByTheBrowser();
    const back = await roundTrip(held);
    expect(syncKey(back)).toBe(syncKey(held));
  });

  it('stays the same through a second read, so a quiet poll is not a change', async () => {
    const once = await roundTrip(heldByTheBrowser());
    const twice = await roundTrip(once);
    expect(syncKey(twice)).toBe(syncKey(once));
  });

  it('matches storedForm to what the file actually returns', async () => {
    /* storedForm is the in-memory model of the file round trip; if the two drift, the key lies */
    const held = heldByTheBrowser();
    expect(storedForm(held)).toEqual(await roundTrip(held));
  });

  it('ignores the order keys arrive in', () => {
    const held = heldByTheBrowser();
    const reversed: PersistedState = {
      ...held,
      settings: Object.fromEntries(Object.entries(held.settings).reverse()),
      estimations: held.estimations.map((one) => ({ ...one, snap: Object.fromEntries(Object.entries(one.snap).reverse()) as typeof one.snap }))
    };
    expect(syncKey(reversed)).toBe(syncKey(held));
  });

  it('changes when the store would hold something different', () => {
    const held = heldByTheBrowser();
    const base = syncKey(held);

    const edited = heldByTheBrowser();
    const deal = edited.estimations[0];
    if (deal) deal.snap = { ...deal.snap, bufPct: 13 };
    expect(syncKey(edited)).not.toBe(base);

    const retitled = heldByTheBrowser();
    const first = retitled.requests[0];
    if (first) first.title = 'Proctored exam integration, phase two';
    expect(syncKey(retitled)).not.toBe(base);

    const reopened = heldByTheBrowser();
    reopened.settings['edly-open-estimation-v2'] = 'EST-2';
    expect(syncKey(reopened)).not.toBe(base);

    const removed = heldByTheBrowser();
    removed.bundles = [];
    expect(syncKey(removed)).not.toBe(base);
  });
});

describe('coerceState', () => {
  it('narrows anything to the persisted shape', () => {
    expect(coerceState(null)).toEqual({ estimations: [], requests: [], solutions: [], bundles: [], settings: {} });
    expect(coerceState({ estimations: 'nope', settings: 7 }).estimations).toEqual([]);
    expect(coerceState({ settings: { a: 1 } }).settings).toEqual({ a: 1 });
  });

  it('counts rows for the empty-payload guard', () => {
    expect(countRows(null)).toBe(0);
    expect(countRows(sample())).toBe(2 + 3 + 2 + 1);
  });
});
