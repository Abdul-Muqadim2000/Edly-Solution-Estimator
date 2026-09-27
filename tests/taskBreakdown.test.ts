import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET,
  readSheetPrefs,
  SHEET_COLUMNS,
  sheetBlockers,
  sheetColumns,
  sheetHas,
  taskBreakdown,
  type BreakdownInput
} from '../src/domain/taskBreakdown';
import { calcEstimate, DEFAULT_ROLES } from '../src/domain/estimate';
import { schedule } from '../src/domain/planner';
import type { Bundle, Catalog, EstimateRequest, EstimationSnapshot, Solution } from '../src/types';

/**
 * The task breakdown: an estimate regrouped as deliverables, one per area.
 *
 * The first thing asserted is that it adds up. A client totals the Hours column; if that does not
 * come to the figure on the cover, the sheet has done more damage than no sheet. Everything after
 * that is about where a line lands and what it says about itself.
 */

const solution = (id: string, name: string, first: number | null, over: Partial<Solution> = {}): Solution => ({
  id,
  name,
  desc: `${name}, described.`,
  form: 'Integration',
  status: 'Production',
  deploy: '2 days',
  first,
  repeat: null,
  build: first === null ? null : first * 4,
  saving: null,
  account: null,
  integrations: null,
  notes: null,
  ref: null,
  category: 'Integration',
  subCategory: null,
  ...over
});

const bundle = (id: string, name: string, items: Solution[]): Bundle => ({
  id,
  name,
  pitch: '',
  offerWhen: '',
  featureCount: items.length,
  buildHrs: null,
  firstHrs: null,
  repeatHrs: null,
  saved: null,
  noEstimate: 0,
  inDev: 0,
  accounts: null,
  pairsWith: null,
  items
});

const catalog: Catalog = {
  meta: {
    title: 'Test',
    subtitle: '',
    compiled: '',
    totals: { features: 6, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 1, inDev: 1 },
    notes: []
  },
  bundles: [
    bundle('B01', 'Commerce', [
      solution('OX-1', 'Stripe Payments', 40, { account: 'Stripe', notes: 'Runs through the storefront plugin.' }),
      solution('OX-2', 'PayPal Payments', 12)
    ]),
    bundle('B02', 'Reporting', [solution('OX-3', 'Weekly exports', 20)]),
    bundle('B03', 'Identity', [solution('OX-4', 'Single sign-on', null), solution('OX-5', 'Passkeys', 30, { status: 'In Development' })])
  ]
};

const snap = (over: Partial<EstimationSnapshot> = {}): EstimationSnapshot => ({
  sel: { 'OX-1': true, 'OX-2': true, 'OX-4': true, 'OX-5': true },
  buf: { 'OX-1': 8 },
  bufPct: 10,
  pm: 10,
  qa: 5,
  rate: 100,
  cur: 'USD',
  roles: [...DEFAULT_ROLES],
  lineRole: {},
  plan: {},
  hpw: 40,
  maxPar: 4,
  planStart: '',
  ...over
});

const request = (id: string, over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id,
  plat: 'openedx',
  estId: 'EST-1',
  estName: 'Acme Academy',
  client: 'Acme Academy',
  title: `Custom ${id}`,
  details: 'What sales asked for.',
  area: '',
  urgency: '',
  integrations: '',
  name: '',
  email: '',
  org: '',
  at: '2026-01-01',
  ...over
});

const build = (over: Partial<BreakdownInput> & { snapshot?: EstimationSnapshot } = {}) => {
  const snapshot = over.snapshot ?? snap();
  const requests = over.requests ?? [];
  const blendBuffer = over.blendBuffer ?? false;
  const estimate = calcEstimate(catalog, snapshot, requests);
  const plan = schedule(estimate, requests, snapshot, { blendBuffer });
  const breakdown = taskBreakdown({ estimate, requests, plan, snap: snapshot, bundles: catalog.bundles, blendBuffer, ...over });
  return { estimate, plan, breakdown, lines: breakdown.deliverables.flatMap((deliverable) => deliverable.lines) };
};

describe('it adds up to the estimate the builder shows', () => {
  const requests = [request('RQ-01', { area: 'Reporting', est: 24 }), request('RQ-02')];

  for (const blendBuffer of [false, true]) {
    it(`in hours, with buffers ${blendBuffer ? 'blended into the lines' : 'listed apart'}`, () => {
      const { estimate, breakdown } = build({ requests, blendBuffer });
      const { totals } = breakdown;
      expect(totals.hours + totals.buffer + totals.pm + totals.qa).toBeCloseTo(estimate.grand, 1);
      expect(totals.total).toBeCloseTo(estimate.grand, 2);
    });

    it(`in money, with buffers ${blendBuffer ? 'blended into the lines' : 'listed apart'}`, () => {
      const { estimate, breakdown } = build({ requests, blendBuffer, snapshot: snap({ lineRole: { 'OX-1': 'sr', 'RQ-01': 'eng' } }) });
      expect(Math.round(breakdown.totals.totalCost)).toBe(estimate.usd);
    });
  }

  it('makes each deliverable the sum of its lines', () => {
    const { breakdown } = build({ requests });
    for (const deliverable of breakdown.deliverables) {
      expect(deliverable.hours).toBeCloseTo(deliverable.lines.reduce((sum, line) => sum + (line.hours ?? 0), 0), 2);
    }
  });
});

describe('where a line lands', () => {
  it('makes one deliverable per bundle, in catalog order, numbered from 1', () => {
    const { breakdown } = build();
    expect(breakdown.deliverables.map((deliverable) => [deliverable.n, deliverable.area])).toEqual([
      [1, 'Commerce'],
      [2, 'Identity']
    ]);
  });

  it('numbers the lines within each deliverable, so "2.1" can be said in a call', () => {
    const { lines } = build();
    expect(lines.map((line) => line.item)).toEqual(['1.1', '1.2', '2.1', '2.2']);
  });

  it('puts a custom request in the bundle its area names, by name or by id', () => {
    const { breakdown } = build({ requests: [request('RQ-01', { area: 'Commerce', est: 10 }), request('RQ-02', { area: 'B03', est: 6 })] });
    const commerce = breakdown.deliverables.find((deliverable) => deliverable.area === 'Commerce');
    const identity = breakdown.deliverables.find((deliverable) => deliverable.area === 'Identity');
    expect(commerce?.lines.map((line) => line.key)).toEqual(['OX-1', 'OX-2', 'RQ-01']);
    expect(identity?.lines.map((line) => line.key)).toEqual(['OX-4', 'OX-5', 'RQ-02']);
  });

  it('opens a bundle no solution was picked from, in its catalog place, when a request names it', () => {
    const { breakdown } = build({ requests: [request('RQ-01', { area: 'Reporting', est: 10 })] });
    expect(breakdown.deliverables.map((deliverable) => deliverable.area)).toEqual(['Commerce', 'Reporting', 'Identity']);
  });

  it('gathers requests with no real area under Custom development, after everything else', () => {
    const { breakdown } = build({
      requests: [
        request('RQ-01', { area: 'Custom' }),
        request('RQ-02', { area: 'Something new — not in any bundle' }),
        request('RQ-03', { area: 'Mobile apps' }),
        request('RQ-04', { area: '' })
      ]
    });
    const areas = breakdown.deliverables.map((deliverable) => deliverable.area);
    expect(areas.slice(-2)).toEqual(['Mobile apps', 'Custom development']);
    expect(breakdown.deliverables.at(-1)?.lines.map((line) => line.key)).toEqual(['RQ-01', 'RQ-02', 'RQ-04']);
  });
});

describe('what a line says about itself', () => {
  it('leaves an unpriced line with no hours, not zero, and counts it', () => {
    const { lines, breakdown } = build({ requests: [request('RQ-01')] });
    /* zero would read as "estimated at nothing" and join the totals */
    expect(lines.find((line) => line.key === 'OX-4')?.hours).toBeNull();
    expect(lines.find((line) => line.key === 'RQ-01')?.hours).toBeNull();
    expect(lines.find((line) => line.key === 'RQ-01')?.cost).toBeNull();
    expect(breakdown.totals.unpriced).toBe(2);
  });

  it('names the status the client sees', () => {
    const { lines } = build({ requests: [request('RQ-01', { est: 8 }), request('RQ-02')] });
    const status = Object.fromEntries(lines.map((line) => [line.key, line.status]));
    expect(status).toMatchObject({ 'OX-1': 'prebuilt', 'OX-5': 'development', 'RQ-01': 'custom', 'RQ-02': 'pending' });
  });

  it('calls a desk-priced catalog entry custom and a benchmark row a benchmark', () => {
    const scoped = solution('OX-1', 'Scoped', 10, { status: 'Estimation' });
    const sample = solution('OX-2', 'Sample', 10, { status: 'Sample' });
    const estimate = calcEstimate({ ...catalog, bundles: [bundle('B01', 'Commerce', [scoped, sample])] }, snap(), []);
    const breakdown = taskBreakdown({ estimate, requests: [], plan: schedule(estimate, [], snap()), snap: snap(), bundles: catalog.bundles, blendBuffer: false });
    expect(breakdown.deliverables[0]?.lines.map((line) => line.status)).toEqual(['custom', 'benchmark']);
  });

  it('folds the buffer into the line when blended, and lists it apart otherwise', () => {
    /* OX-1: 40 h with an 8 h line buffer and 10% on top is 52.8 h billed */
    const apart = build().lines.find((line) => line.key === 'OX-1');
    expect(apart?.hours).toBe(40);
    expect(apart?.buffer).toBeCloseTo(12.8, 5);

    const blended = build({ blendBuffer: true }).lines.find((line) => line.key === 'OX-1');
    expect(blended?.hours).toBeCloseTo(52.8, 5);
    expect(blended?.buffer).toBe(0);
  });

  it('names the role with its seniority, so two levels of one role read apart', () => {
    const { lines } = build({ snapshot: snap({ lineRole: { 'OX-1': 'sr', 'OX-2': 'eng' } }) });
    expect(lines.find((line) => line.key === 'OX-1')?.role).toBe('Senior Engineer');
    expect(lines.find((line) => line.key === 'OX-2')?.role).toBe('Mid-level Engineer');
  });

  it("prices a line at its role's rate, and the rest at the blended rate", () => {
    const { lines } = build({ snapshot: snap({ lineRole: { 'OX-1': 'sr' } }) });
    const stripe = lines.find((line) => line.key === 'OX-1');
    const paypal = lines.find((line) => line.key === 'OX-2');
    expect([stripe?.role, stripe?.rate, stripe?.cost]).toEqual(['Senior Engineer', 55, 40 * 55]);
    expect([paypal?.role, paypal?.rate, paypal?.cost]).toEqual(['', 100, 12 * 100]);
  });

  it("puts sales' own note first, then the caveats the sheet adds", () => {
    const { lines } = build({ snapshot: snap({ sheet: { notes: { 'OX-5': 'Pilot with one faculty first.' } } }) });
    expect(lines.find((line) => line.key === 'OX-5')?.notes).toEqual([
      'Pilot with one faculty first.',
      'Still in development, so its delivery date is to be confirmed.'
    ]);
  });

  it('says which account a line needs, unless the account has a column of its own', () => {
    const said = build().lines.find((line) => line.key === 'OX-1');
    expect(said?.notes).toContain('Needs a client-held Stripe account. Vendor fees are payable by the client.');
    expect(build({ accountNote: false }).lines.find((line) => line.key === 'OX-1')?.notes).toEqual([]);
  });

  it("keeps catalog and desk notes out of the client's notes", () => {
    /* they are written for Edly; the Internal Notes column carries them only when ticked */
    const { lines } = build({ requests: [request('RQ-01', { est: 8, estNote: 'Priced low to win it.' })] });
    const stripe = lines.find((line) => line.key === 'OX-1');
    const custom = lines.find((line) => line.key === 'RQ-01');
    expect(stripe?.notes.join(' ')).not.toContain('storefront');
    expect(stripe?.internal).toEqual(['Runs through the storefront plugin.']);
    expect(custom?.notes.join(' ')).not.toContain('Priced low');
    expect(custom?.internal).toEqual(['Priced low to win it.']);
  });

  it('describes a tender-drafted request by its first paragraph only', () => {
    const drafted = request('RQ-01', {
      tender: 'TD-1',
      details: 'Learners download units to study offline.\n\nTender priority: must have.\nFrom the tender (Doc 1, p. 4): "..."'
    });
    expect(build({ requests: [drafted] }).lines.find((line) => line.key === 'RQ-01')?.description).toBe('Learners download units to study offline.');
  });

  it('gives a manually added item no description, rather than its placeholder', () => {
    const manual = request('RQ-01', { manual: true, details: 'Manually added custom item', est: 5 });
    expect(build({ requests: [manual] }).lines.find((line) => line.key === 'RQ-01')?.description).toBe('');
  });

  it('reads the delivery window from the plan, in weeks from 1', () => {
    const { lines, plan } = build();
    const stripe = lines.find((line) => line.key === 'OX-1');
    const task = plan.tasks.find((candidate) => candidate.key === 'OX-1')!;
    expect(stripe?.window).toEqual({ from: Math.floor(task.start) + 1, to: Math.ceil(task.start + task.dur) });
    /* an unpriced line has no hours to schedule */
    expect(lines.find((line) => line.key === 'OX-4')?.window).toBeNull();
  });
});

describe('the choices sales makes', () => {
  it("ticks Edly's template columns, with hours and estimate, for someone who has not chosen", () => {
    const ticked = SHEET_COLUMNS.filter((column) => DEFAULT_SHEET.columns[column.id]).map((column) => column.label);
    expect(ticked).toEqual(['Deliverable no.', 'Area', 'Component', 'Description', 'Support Status', 'Notes/Assumptions', 'Hours', 'Estimate']);
  });

  it('gives a column added after the choices were saved its default, not "off"', () => {
    const saved = readSheetPrefs({ columns: { deliverable: false }, sections: { cover: false } });
    expect(saved.columns.deliverable).toBe(false);
    expect(saved.columns.hours).toBe(true);
    expect(saved.sections.cover).toBe(false);
    expect(saved.sections.timeline).toBe(true);
  });

  it('reads anything that is not a saved choice as the defaults', () => {
    for (const junk of [null, undefined, 'columns', 42, [], { columns: 'all' }, { columns: { hours: 'yes' } }]) {
      expect(readSheetPrefs(junk)).toEqual(DEFAULT_SHEET);
    }
  });

  it('keeps Component whatever was saved', () => {
    expect(readSheetPrefs({ columns: { component: false } }).columns.component).toBe(true);
  });

  it('lists the columns in sheet order, whatever order they were ticked in', () => {
    const prefs = readSheetPrefs({ columns: { estimate: true, solutionId: true, item: true } });
    const ids = sheetColumns(prefs, { blendBuffer: false, planned: 1, assigned: 0 }).map((column) => column.id);
    expect(ids.indexOf('item')).toBeLessThan(ids.indexOf('solutionId'));
    expect(ids.at(-1)).toBe('estimate');
  });

  it('says why a ticked option will not appear, instead of dropping it silently', () => {
    const prefs = readSheetPrefs({ columns: { buffer: true, hours: false, estimate: false } });
    const blocked = sheetBlockers(prefs, { blendBuffer: true, planned: 0, assigned: 0 });
    expect(Object.keys(blocked).sort()).toEqual(['buffer', 'roles', 'team', 'timeline', 'totals']);
    expect(sheetColumns(prefs, { blendBuffer: true, planned: 0, assigned: 0 }).map((column) => column.id)).not.toContain('buffer');
    expect(sheetHas(prefs, { blendBuffer: true, planned: 0, assigned: 0 }, 'totals')).toBe(false);
    expect(sheetHas(DEFAULT_SHEET, { blendBuffer: false, planned: 3, assigned: 10 }, 'totals')).toBe(true);
  });

  it('offers the team composition sheet ticked, and holds it back until a line has a role', () => {
    expect(DEFAULT_SHEET.sections.team).toBe(true);
    /* with nobody assigned the sheet would be one "Unassigned" row, so it says what to do instead */
    expect(sheetBlockers(DEFAULT_SHEET, { blendBuffer: false, planned: 3, assigned: 0 }).team).toBe('Assign roles to lines in Rates first');
    expect(sheetHas(DEFAULT_SHEET, { blendBuffer: false, planned: 3, assigned: 12 }, 'team')).toBe(true);
    expect(sheetHas(readSheetPrefs({ sections: { team: false } }), { blendBuffer: false, planned: 3, assigned: 12 }, 'team')).toBe(false);
  });
});
