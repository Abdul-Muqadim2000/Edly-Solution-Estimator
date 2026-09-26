import { describe, expect, it } from 'vitest';
import { quoteSheet } from '../src/lib/quoteExport';
import { readWorkbook, writeWorkbook } from '../src/lib/xlsx';
import { calcEstimate, DEFAULT_ROLES } from '../src/domain/estimate';
import { schedule } from '../src/domain/planner';
import { DEFAULT_DISPLAY } from '../src/state/reducer';
import type { Catalog, EstimateRequest, Estimation, EstimationSnapshot, Solution } from '../src/types';

/**
 * The workbook a client receives.
 *
 * Asserted by writing the real file and reading it back, because that is what the client opens —
 * a row built correctly and then lost in the writer is the same bug to them as one never built.
 *
 * The rule under test throughout: **whatever sales has hidden on screen is absent from the file.**
 * "Present to client" that a download undoes is worse than no privacy control at all, because
 * sales believes it worked.
 */

const solution = (id: string, name: string, first: number | null, over: Partial<Solution> = {}): Solution => ({
  id,
  name,
  desc: '',
  form: 'Integration',
  status: 'Production',
  deploy: '2 days',
  first,
  repeat: first === null ? null : Math.round(first * 0.3),
  build: first === null ? null : first * 4,
  saving: null,
  account: null,
  integrations: null,
  notes: null,
  ref: null,
  category: 'Core Platform',
  subCategory: null,
  ...over
});

const catalog: Catalog = {
  meta: {
    title: 'Test',
    subtitle: '',
    compiled: '',
    totals: { features: 4, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 1, inDev: 1 },
    notes: []
  },
  bundles: [
    {
      id: 'B01',
      name: 'Core Platform',
      pitch: '',
      offerWhen: '',
      featureCount: 4,
      buildHrs: null,
      firstHrs: null,
      repeatHrs: null,
      saved: null,
      noEstimate: 1,
      inDev: 1,
      accounts: null,
      pairsWith: null,
      items: [
        solution('OX-1', 'Stripe Payments', 40, { account: 'Stripe' }),
        solution('OX-2', 'Single sign-on', 60),
        solution('OX-3', 'Unpriced thing', null),
        solution('OX-4', 'Still building', 20, { status: 'In Development' })
      ]
    }
  ]
};

const snap: EstimationSnapshot = {
  sel: { 'OX-1': true, 'OX-2': true, 'OX-3': true, 'OX-4': true },
  buf: { 'OX-1': 8 },
  bufPct: 10,
  pm: 10,
  qa: 5,
  rate: 120,
  cur: 'USD',
  roles: [...DEFAULT_ROLES],
  lineRole: {},
  plan: {},
  hpw: 40,
  maxPar: 4,
  planStart: ''
};

const estimation: Estimation = {
  id: 'EST-1',
  plat: 'openedx',
  name: 'Acme Academy',
  slug: 'acme-academy',
  client: 'Acme Inc',
  tag: 'Active',
  due: '2026-03-01',
  at: '2026-01-01',
  up: '2026-01-01',
  total: 0,
  cost: 0,
  items: 4,
  snap
};

const request = (over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id: 'RQ-01',
  plat: 'openedx',
  estId: 'EST-1',
  estName: 'Acme Academy',
  client: 'Acme Inc',
  title: 'Bespoke reporting',
  details: 'Weekly exports',
  area: 'Reporting',
  urgency: '',
  integrations: '',
  name: 'Rep',
  email: 'rep@edly.io',
  org: 'Edly',
  at: '2026-01-01',
  ...over
});

/** Build the real file and read back every cell as one blob of text — what the client sees. */
const sheetText = async (display = DEFAULT_DISPLAY, requests: EstimateRequest[] = []): Promise<string> => {
  const estimate = calcEstimate(catalog, snap, requests);
  const sheet = quoteSheet({
    estimation,
    estimate,
    requests,
    plan: schedule(estimate, requests, snap, { blendBuffer: display.blendBuffer }),
    display,
    currency: 'USD',
    platformName: 'Open edX'
  });
  const workbook = await readWorkbook(writeWorkbook({ Estimate: sheet }));
  return (workbook.Estimate ?? []).map((row) => row.join(' | ')).join('\n');
};

describe('what the quote always contains', () => {
  it('is branded, names the deal and lists the selected solutions', async () => {
    const text = await sheetText();

    expect(text).toContain('EDLY — OPEN EDX SOLUTION BUNDLE ESTIMATE');
    expect(text).toContain('Acme Academy · Acme Inc');
    expect(text).toContain('Stripe Payments');
    expect(text).toContain('Single sign-on');
    expect(text).toContain('TOTAL — solution hours');
  });

  it('names an unpriced item as unpriced instead of pricing it at zero', async () => {
    const text = await sheetText();
    /* "0" in an hours column reads as free work; the client has to see that nobody has priced it */
    expect(text).toContain('no estimate');
    expect(text).toContain('in development');
  });

  it('carries the overheads that were applied', async () => {
    const text = await sheetText();
    expect(text).toContain('PM overhead (10%)');
    expect(text).toContain('QA overhead (5%)');
    expect(text).toContain('Total estimate');
  });

  it('lists the accounts the client has to hold', async () => {
    expect(await sheetText()).toContain('Stripe');
  });

  it('carries the scope caveat whatever else is hidden', async () => {
    const hidden = { savings: false, notes: false, money: false, controls: false, blendBuffer: true };
    for (const display of [DEFAULT_DISPLAY, hidden]) {
      expect(await sheetText(display)).toContain('Engineering hours only');
    }
  });

  it('warns that totals understate when items are unpriced', async () => {
    const text = await sheetText();
    expect(text).toContain('Caveats:');
    expect(text).toContain('without recorded estimates');
    expect(text).toContain('in development');
  });

  it('is a single sheet called Estimate', async () => {
    const estimate = calcEstimate(catalog, snap, []);
    const workbook = await readWorkbook(
      writeWorkbook({
        Estimate: quoteSheet({
          estimation,
          estimate,
          requests: [],
          plan: schedule(estimate, [], snap),
          display: DEFAULT_DISPLAY,
          currency: 'USD',
          platformName: 'Open edX'
        })
      })
    );
    expect(Object.keys(workbook)).toEqual(['Estimate']);
  });
});

describe('what "Present to client" must keep out of the file', () => {
  it('leaves every money figure out when money is hidden', async () => {
    const hidden = await sheetText({ ...DEFAULT_DISPLAY, money: false });

    expect(hidden).not.toMatch(/\$[\d,]/);
    expect(hidden).not.toContain('/h');
    expect(hidden).not.toContain('COST BY ROLE');
    /* the hours are still there: hiding the economics is not hiding the work */
    expect(hidden).toContain('Total estimate');
  });

  it('includes the rate and the cost when money is shown', async () => {
    const shown = await sheetText({ ...DEFAULT_DISPLAY, money: true });
    expect(shown).toMatch(/\$[\d,]/);
    expect(shown).toContain('(USD)');
  });

  it('leaves the reuse saving out when savings are hidden', async () => {
    expect(await sheetText({ ...DEFAULT_DISPLAY, savings: true })).toContain('effort saved vs building new');
    expect(await sheetText({ ...DEFAULT_DISPLAY, savings: false })).not.toContain('effort saved');
  });

  it('folds the buffer into the line hours when it is blended, and does not name it', async () => {
    const separate = await sheetText({ ...DEFAULT_DISPLAY, blendBuffer: false });
    expect(separate).toContain('Risk buffer');

    const blended = await sheetText({ ...DEFAULT_DISPLAY, blendBuffer: true });
    expect(blended).not.toContain('Risk buffer');
  });

  it('adds the per-line buffer to that line only when it is blended', async () => {
    /* OX-1 is 40 h with an 8 h line buffer: blended it is 48 before the percentage, not 40 */
    const blended = await sheetText({ ...DEFAULT_DISPLAY, blendBuffer: true });
    expect(blended).toContain('52.8');

    const separate = await sheetText({ ...DEFAULT_DISPLAY, blendBuffer: false });
    expect(separate).toContain('| 40 |');
  });
});

describe('custom development', () => {
  it('says how many custom items are still awaiting hours and excluded', async () => {
    const text = await sheetText(DEFAULT_DISPLAY, [request(), request({ id: 'RQ-02', est: 24 })]);

    expect(text).toContain('CUSTOM DEVELOPMENT');
    expect(text).toContain('1 still awaiting hours and excluded');
    expect(text).toContain('awaiting estimate');
    expect(text).toContain('Bespoke reporting — Weekly exports');
  });

  it('says nothing about exclusions when everything has been priced', async () => {
    const text = await sheetText(DEFAULT_DISPLAY, [request({ est: 24 })]);
    expect(text).toContain('CUSTOM DEVELOPMENT');
    expect(text).not.toContain('awaiting hours and excluded');
  });

  it('leaves the section out entirely when there are no custom items', async () => {
    expect(await sheetText()).not.toContain('CUSTOM DEVELOPMENT');
  });
});

describe('the delivery timeline', () => {
  it('lists each bar with its weeks', async () => {
    const text = await sheetText();
    expect(text).toContain('DELIVERY TIMELINE');
    expect(text).toContain('wks');
  });
});

describe('the shape of the sheet', () => {
  it('sets column widths, so the client does not open a wall of ####', () => {
    const estimate = calcEstimate(catalog, snap, []);
    const sheet = quoteSheet({
      estimation,
      estimate,
      requests: [],
      plan: schedule(estimate, [], snap),
      display: DEFAULT_DISPLAY,
      currency: 'USD',
      platformName: 'Open edX'
    });

    expect(sheet.widths).toEqual([30, 12, 56, 14, 34]);
    expect(sheet.merges).toContain('A1:E1');
    expect(sheet.rows.length).toBeGreaterThan(10);
  });

  it('renders hours as numbers, so the client can total the column', async () => {
    const estimate = calcEstimate(catalog, snap, []);
    const sheet = quoteSheet({
      estimation,
      estimate,
      requests: [],
      plan: schedule(estimate, [], snap),
      display: DEFAULT_DISPLAY,
      currency: 'USD',
      platformName: 'Open edX'
    });

    const hourCells = sheet.rows.flatMap((row) => (row.cells ?? []).filter((cell) => cell && typeof cell === 'object' && 'n' in cell));
    expect(hourCells.length).toBeGreaterThan(0);
  });
});

describe('when work has been assigned to roles', () => {
  const assigned: EstimationSnapshot = { ...snap, lineRole: { 'OX-1': DEFAULT_ROLES[0]!.id, 'OX-2': DEFAULT_ROLES[1]!.id } };

  const withRoles = async (display = DEFAULT_DISPLAY): Promise<string> => {
    const estimate = calcEstimate(catalog, assigned, []);
    const sheet = quoteSheet({
      estimation: { ...estimation, snap: assigned },
      estimate,
      requests: [],
      plan: schedule(estimate, [], assigned, { blendBuffer: display.blendBuffer }),
      display,
      currency: 'USD',
      platformName: 'Open edX'
    });
    const workbook = await readWorkbook(writeWorkbook({ Estimate: sheet }));
    return (workbook.Estimate ?? []).map((row) => row.join(' | ')).join('\n');
  };

  it('breaks the cost down by role and quotes a blended rate', async () => {
    const text = await withRoles({ ...DEFAULT_DISPLAY, money: true });

    expect(text).toContain('COST BY ROLE');
    expect(text).toContain('blended across roles');
    expect(text).toContain(DEFAULT_ROLES[0]!.name);
  });

  it('still says nothing about cost when money is hidden', async () => {
    /* the role breakdown is the easiest place for a rate to leak into a client file */
    const text = await withRoles({ ...DEFAULT_DISPLAY, money: false });

    expect(text).not.toContain('COST BY ROLE');
    expect(text).not.toContain('blended across roles');
    expect(text).not.toMatch(/\$[\d,]/);
  });

  it('quotes the flat rate when nothing has been assigned', async () => {
    const text = await sheetText({ ...DEFAULT_DISPLAY, money: true });
    expect(text).toContain('$120/h');
    expect(text).not.toContain('COST BY ROLE');
  });
});
