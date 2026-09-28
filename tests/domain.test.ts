import { describe, expect, it } from 'vitest';
import type { Catalog, EstimateRequest, EstimationSnapshot, Solution } from '../src/types';
import { cachedTotals, calcEstimate, DEFAULT_ROLES, overheadRoleOf, roleLabel, SENIORITY_LEVELS } from '../src/domain/estimate';
import { peopleForDuration, reorder, schedule } from '../src/domain/planner';
import {
  allSolutions,
  bundlesOfKind,
  categories,
  composeCatalog,
  diffCatalogs,
  guessBundle,
  kindCounts,
  mergeCatalogs,
  nextBundleId,
  solutionKind,
  subCategories,
  toSolution
} from '../src/domain/catalog';
import type { AddedSolution, Bundle } from '../src/types';
import { nextId } from '../src/lib/format';

const solution = (id: string, first: number | null, extra: Partial<Solution> = {}): Solution => ({
  id,
  name: `Solution ${id}`,
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
  ...extra
});

const catalog = (items: Solution[]): Catalog => ({
  meta: {
    title: 'Test',
    subtitle: '',
    compiled: '',
    totals: { features: items.length, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 },
    notes: []
  },
  bundles: [
    {
      id: 'B01',
      name: 'Bundle one',
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
    }
  ]
});

const snapshot = (over: Partial<EstimationSnapshot> = {}): EstimationSnapshot => ({ sel: {}, buf: {}, bufPct: 0, ...over });

describe('calcEstimate', () => {
  const book = catalog([solution('A', 40), solution('B', 60), solution('C', null, { status: 'In Development' })]);

  it('adds up only what is selected', () => {
    const result = calcEstimate(book, snapshot({ sel: { A: true } }), []);
    expect(result.first).toBe(40);
    expect(result.grand).toBe(40);
    expect(result.selIds).toEqual(['A']);
  });

  it('applies per-line buffers, then the percentage, then overhead', () => {
    const result = calcEstimate(book, snapshot({ sel: { A: true, B: true }, buf: { A: 10 }, bufPct: 10, pm: 10, qa: 5 }), []);
    /* 100 solution hours + 10 line buffer = 110; +10% = 121; PM 12.1 + QA 6.05 */
    expect(result.bufH).toBeCloseTo(21, 5);
    expect(result.pmH).toBeCloseTo(12.1, 5);
    expect(result.qaH).toBeCloseTo(6.05, 5);
    expect(result.grand).toBeCloseTo(139.15, 5);
  });

  it('counts in-development and unestimated items as caveats, not hours', () => {
    const result = calcEstimate(book, snapshot({ sel: { A: true, C: true } }), []);
    expect(result.first).toBe(40);
    expect(result.inDev).toBe(1);
  });

  it('includes returned custom hours and counts the rest as pending', () => {
    const requests: EstimateRequest[] = [
      { id: 'RQ-1', plat: 'openedx', estId: 'E', estName: '', client: '', title: 'Priced', details: '', area: '', urgency: '', integrations: '', name: '', email: '', org: '', at: '', est: 20 },
      { id: 'RQ-2', plat: 'openedx', estId: 'E', estName: '', client: '', title: 'Pending', details: '', area: '', urgency: '', integrations: '', name: '', email: '', org: '', at: '' }
    ];
    const result = calcEstimate(book, snapshot({ sel: { A: true } }), requests);
    expect(result.estSum).toBe(20);
    expect(result.pend).toBe(1);
    expect(result.grand).toBe(60);
  });

  it('hides a solution that a request already owns, so it is not billed twice', () => {
    const withCustom = catalog([solution('A', 40), solution('CS-01', 30, { status: 'Estimation' })]);
    const requests: EstimateRequest[] = [
      { id: 'RQ-1', plat: 'openedx', estId: 'E', estName: '', client: '', title: 'Custom', details: '', area: '', urgency: '', integrations: '', name: '', email: '', org: '', at: '', est: 30, csId: 'CS-01' }
    ];
    const result = calcEstimate(withCustom, snapshot({ sel: { A: true, 'CS-01': true } }), requests);
    expect(result.selIds).toEqual(['A']);
    expect(result.grand).toBe(70);
  });

  it('prices each line at its assigned role, not one blended rate', () => {
    const result = calcEstimate(
      book,
      snapshot({ sel: { A: true, B: true }, rate: 60, roles: [...DEFAULT_ROLES], lineRole: { A: 'sr' } }),
      []
    );
    /* 40 h at 55 (senior) + 60 h at 60 (blended) */
    expect(result.usd).toBe(40 * 55 + 60 * 60);
    expect(result.assignedH).toBe(40);
    expect(result.unassignedH).toBe(60);
    expect(result.effRate).toBeCloseTo((40 * 55 + 60 * 60) / 100, 5);
  });

  it('prices PM and QA overhead at their own roles', () => {
    const result = calcEstimate(book, snapshot({ sel: { A: true }, pm: 50, rate: 100, roles: [...DEFAULT_ROLES] }), []);
    const pmRow = result.roleRows.find((row) => row.id === 'ov-pm');
    expect(pmRow?.hrs).toBe(20);
    expect(pmRow?.rate).toBe(40);
  });

  it('turns an estimate into the totals a deal caches, as the card would show them', () => {
    const result = calcEstimate(book, snapshot({ sel: { A: true, B: true }, bufPct: 12, qa: 8 }), []);
    /* 120.96 in exact decimals, but 120.96000000000001 in floating point: a store that prints
       fewer digits would hand back a different number, and the sync loop would see a change */
    expect(result.grand).not.toBe(120.96);
    expect(cachedTotals(result)).toEqual({ total: 120.96, cost: result.usd, items: 2 });
  });

  it('reports reuse savings from recorded build hours', () => {
    const result = calcEstimate(book, snapshot({ sel: { A: true, B: true } }), []);
    /* 100 first vs 400 engineered */
    expect(result.savedPct).toBe(75);
  });
});

describe('seniority on the rate card', () => {
  const book = catalog([solution('A', 40), solution('B', 60)]);

  it('names a role by its level and title, the way people say it', () => {
    expect(roleLabel({ name: 'Engineer', level: 'Senior' })).toBe('Senior Engineer');
    expect(roleLabel({ name: 'Engineer', level: 'Junior' })).toBe('Junior Engineer');
    expect(roleLabel({ name: 'Designer' })).toBe('Designer');
  });

  it('does not say the level twice on a card saved before levels existed', () => {
    /* an older card already called the role "Senior Engineer"; giving it the level Senior must not
       turn it into "Senior Senior Engineer" */
    expect(roleLabel({ name: 'Senior Engineer', level: 'Senior' })).toBe('Senior Engineer');
    expect(roleLabel({ name: 'Senior Engineer' })).toBe('Senior Engineer');
  });

  it('gives every default role a level, and keeps the ids lines are assigned to', () => {
    expect(DEFAULT_ROLES.map((role) => role.id)).toEqual(['sr', 'eng', 'devops', 'qa', 'pm']);
    for (const role of DEFAULT_ROLES) expect(SENIORITY_LEVELS).toContain(role.level);
    /* the first default still reads as it always did */
    expect(roleLabel(DEFAULT_ROLES[0]!)).toBe('Senior Engineer');
  });

  it('bills one role at two levels at two rates', () => {
    const roles = [
      { id: 'eng-sr', name: 'Engineer', level: 'Senior' as const, rate: 60 },
      { id: 'eng-jr', name: 'Engineer', level: 'Junior' as const, rate: 30 }
    ];
    const result = calcEstimate(book, snapshot({ sel: { A: true, B: true }, rate: 100, roles, lineRole: { A: 'eng-sr', B: 'eng-jr' } }), []);
    expect(result.usd).toBe(40 * 60 + 60 * 30);
    expect(result.roleRows.map((row) => row.name).sort()).toEqual(['Junior Engineer', 'Senior Engineer']);
  });

  it('says which role an overhead row bills at, so the team sheet can put it on that role', () => {
    const result = calcEstimate(book, snapshot({ sel: { A: true }, pm: 10, qa: 5, rate: 100, roles: [...DEFAULT_ROLES] }), []);
    expect(result.roleRows.find((row) => row.id === 'ov-pm')?.roleId).toBe('pm');
    expect(result.roleRows.find((row) => row.id === 'ov-qa')?.roleId).toBe('qa');
    expect(result.roleRows.find((row) => row.id === 'ov-pm')?.name).toBe('PM overhead · Senior Project Manager');
  });

  it('finds the overhead role by its chosen id, then by name, and falls back to the blended rate', () => {
    const roles = [
      { id: 'lead', name: 'Delivery Lead', rate: 70 },
      { id: 'tester', name: 'Quality Analyst', rate: 30 }
    ];
    expect(overheadRoleOf('pm', { pmRole: 'lead' }, roles)?.id).toBe('lead');
    expect(overheadRoleOf('qa', {}, roles)?.id).toBe('tester');
    expect(overheadRoleOf('pm', {}, roles)).toBeNull();
  });
});

describe('schedule', () => {
  const book = catalog([solution('A', 80), solution('B', 80), solution('C', 80), solution('D', 80), solution('E', 80)]);
  const all = { A: true, B: true, C: true, D: true, E: true };

  it('derives duration from staffing', () => {
    const estimate = calcEstimate(book, snapshot({ sel: { A: true } }), []);
    const solo = schedule(estimate, [], snapshot({ sel: { A: true }, hpw: 40 }));
    expect(solo.tasks[0]?.dur).toBe(2);

    const paired = schedule(estimate, [], snapshot({ sel: { A: true }, hpw: 40, plan: { A: { people: 2 } } }));
    expect(paired.tasks[0]?.dur).toBe(1);
  });

  it('packs unpinned work within the team cap', () => {
    const estimate = calcEstimate(book, snapshot({ sel: all }), []);
    const plan = schedule(estimate, [], snapshot({ sel: all, hpw: 40, maxPar: 2 }));
    /* two at a time, so the third starts once one finishes */
    expect(plan.tasks.filter((task) => task.start === 0)).toHaveLength(2);
    expect(plan.peak).toBeLessThanOrEqual(2);
  });

  it('holds a pinned bar at its week and reports the overload', () => {
    const estimate = calcEstimate(book, snapshot({ sel: all }), []);
    const plan = schedule(
      estimate,
      [],
      snapshot({ sel: all, hpw: 40, maxPar: 1, plan: { A: { start: 0 }, B: { start: 0 }, C: { start: 0 } } })
    );
    expect(plan.tasks.find((task) => task.key === 'B')?.start).toBe(0);
    expect(plan.over).toBe(true);
  });

  it('adds spanning bars for overhead without scheduling them', () => {
    const estimate = calcEstimate(book, snapshot({ sel: { A: true }, pm: 10, qa: 10 }), []);
    const plan = schedule(estimate, [], snapshot({ sel: { A: true } }));
    const spans = plan.bars.filter((bar) => bar.span);
    expect(spans).toHaveLength(2);
    expect(spans[0]?.dur).toBe(plan.end);
    expect(plan.tasks.some((task) => task.span)).toBe(false);
  });

  it('reorders by rewriting the whole order, so no two rows collide', () => {
    const estimate = calcEstimate(book, snapshot({ sel: all }), []);
    const plan = schedule(estimate, [], snapshot({ sel: all }));
    const patch = reorder(plan.tasks, plan.tasks[2]!.key, -1);
    expect(Object.keys(patch)).toHaveLength(plan.tasks.length);
    expect(patch[plan.tasks[2]!.key]?.order).toBe(1);
  });

  it('turns a dragged width back into a headcount', () => {
    expect(peopleForDuration(80, 40, 2)).toBe(1);
    expect(peopleForDuration(80, 40, 1)).toBe(2);
    expect(peopleForDuration(80, 40, 0.5)).toBe(4);
    expect(peopleForDuration(80, 40, 99)).toBe(1);
  });
});

describe('catalog composition', () => {
  const base = catalog([solution('A', 40)]);

  it('folds desk additions into their bundle', () => {
    const composed = composeCatalog({
      base,
      platform: 'openedx',
      added: [
        {
          id: 'CS-01', plat: 'openedx', bundleId: 'B01', name: 'Custom thing', desc: 'Does a thing',
          first: 20, repeat: 6, form: 'Custom development', deploy: '', integrations: '', category: 'Custom',
          subCategory: '', account: '', notes: '', from: 'RQ-1', estAt: '2026-09-01'
        }
      ],
      ownBundles: []
    });
    expect(composed.bundles[0]?.items).toHaveLength(2);
    expect(composed.bundles[0]?.items[1]?.status).toBe('Estimation');
  });

  it('lists a bundle once when the sheet and the app both use its number, and the sheet keeps it', () => {
    /* bundles made here continue the sheet's B numbers, so a sheet that later adds the same
       number would otherwise show the bundle twice, with every estimate filed under it in both */
    const composed = composeCatalog({
      base,
      platform: 'openedx',
      added: [
        {
          id: 'CS-01', plat: 'openedx', bundleId: 'B01', name: 'Offline app', desc: '',
          first: 20, repeat: 6, form: '', deploy: '', integrations: '', category: '', subCategory: '',
          account: '', notes: '', from: '', estAt: ''
        }
      ],
      ownBundles: [{ id: 'B01', plat: 'openedx', name: 'Mobile Apps', pitch: '', offerWhen: '', pairsWith: null, at: '' }]
    });
    expect(composed.bundles.map((bundle) => bundle.id)).toEqual(['B01']);
    expect(composed.bundles[0]?.name).toBe('Bundle one');
    expect(allSolutions(composed).filter((one) => one.id === 'CS-01')).toHaveLength(1);
  });

  it('keeps additions whose bundle is gone, rather than dropping them', () => {
    const composed = composeCatalog({
      base,
      platform: 'openedx',
      added: [
        {
          id: 'CS-09', plat: 'openedx', bundleId: 'GONE', name: 'Orphan', desc: '',
          first: 10, repeat: 3, form: '', deploy: '', integrations: '', category: '', subCategory: '',
          account: '', notes: '', from: '', estAt: ''
        }
      ],
      ownBundles: []
    });
    expect(composed.bundles.find((bundle) => bundle.id === 'CX')?.items).toHaveLength(1);
  });

  it("ignores another platform's additions", () => {
    const composed = composeCatalog({
      base,
      platform: 'openedx',
      added: [
        {
          id: 'CS-02', plat: 'moodle', bundleId: 'B01', name: 'Moodle thing', desc: '',
          first: 10, repeat: 3, form: '', deploy: '', integrations: '', category: '', subCategory: '',
          account: '', notes: '', from: '', estAt: ''
        }
      ],
      ownBundles: []
    });
    expect(composed.bundles[0]?.items).toHaveLength(1);
  });

  it('marks a desk addition as an estimation, never as shipped', () => {
    const converted = toSolution({
      id: 'CS-01', plat: 'openedx', bundleId: 'B01', name: 'Thing', desc: '',
      first: 10, repeat: 3, form: '', deploy: '', integrations: '', category: '', subCategory: '',
      account: '', notes: 'Single region only.\nAssumes the client runs on AWS.', from: 'RQ-1', estAt: '2026-09-01'
    });
    expect(converted.status).toBe('Estimation');
    expect(converted.build).toBeNull();
  });

  it("carries a desk addition's Notes / Assumptions to the catalog as written, and none as none", () => {
    const base = {
      id: 'CS-01', plat: 'openedx', bundleId: 'B01', name: 'Thing', desc: '',
      first: 10, repeat: 3, form: '', deploy: '', integrations: '', category: '', subCategory: '',
      account: '', from: 'RQ-1', estAt: '2026-09-01'
    };
    /* no "Estimator note:" prefix any more: the text reaches the client's sheet, so it is theirs */
    expect(toSolution({ ...base, notes: 'Single region only.\nAssumes the client runs on AWS.' }).notes).toBe('Single region only.\nAssumes the client runs on AWS.');
    expect(toSolution({ ...base, notes: '  ' }).notes).toBeNull();
  });

  it('guesses a bundle from the category, falling back to CX', () => {
    const book = catalog([solution('A', 40, { category: 'Assessment' })]);
    expect(guessBundle(book, 'Assessment')).toBe('B01');
    expect(guessBundle(book, 'Nothing like this')).toBe('CX');
    expect(guessBundle(book, '')).toBe('CX');
  });

  it('diffs two catalogs field by field', () => {
    const before = catalog([solution('A', 40), solution('B', 60)]);
    const after = catalog([solution('A', 48), solution('C', 20)]);
    const diff = diffCatalogs(before, after);
    expect(diff.added.map((entry) => entry.id)).toEqual(['C']);
    expect(diff.removed.map((entry) => entry.id)).toEqual(['B']);
    expect(diff.changed[0]?.fields).toContain('first');
  });
});

describe('nextId', () => {
  it('counts from the highest number, not the array length', () => {
    /* deleting a record must never reissue a live id */
    expect(nextId('RQ', [{ id: 'RQ-01' }, { id: 'RQ-07' }], 'id')).toBe('RQ-08');
    expect(nextId('CS', [], 'id')).toBe('CS-01');
    expect(nextId('CB', [{ id: 'other' }], 'id')).toBe('CB-01');
  });
});

describe('the next bundle number', () => {
  it('continues after the highest B number, so a bundle made here follows the sheet\'s own', () => {
    expect(nextBundleId(['B01', 'B02', 'B15'])).toBe('B16');
  });

  it('never hands out a gap, so a link to a retired bundle cannot open a different one', () => {
    expect(nextBundleId(['B01', 'B03'])).toBe('B04');
  });

  it('is not moved by the CB numbers bundles were given before, or by Unassigned', () => {
    expect(nextBundleId(['B15', 'CB-01', 'CB-07', 'CX'])).toBe('B16');
    expect(nextBundleId(['CB-03'])).toBe('B01');
    expect(nextBundleId([])).toBe('B01');
  });

  it('reads a lower-case or unpadded number as the same one', () => {
    expect(nextBundleId(['b7', 'B09'])).toBe('B10');
  });

  it('keeps two digits, like the sheet, and goes on past B99', () => {
    expect(nextBundleId(['B07'])).toBe('B08');
    expect(nextBundleId(['B99'])).toBe('B100');
  });
});

describe('reading a catalog', () => {
  const book = catalog([
    solution('A', 40, { category: 'Integration', subCategory: 'Out-of-the-box' }),
    solution('B', 60, { category: 'Assessment', subCategory: null }),
    solution('C', 20, { category: 'Integration', subCategory: 'Bespoke' })
  ]);

  it('flattens every bundle into one list', () => {
    expect(allSolutions(book).map((one) => one.id)).toEqual(['A', 'B', 'C']);
    expect(allSolutions({ ...book, bundles: [] })).toEqual([]);
  });

  it('offers each category once, sorted, with Custom always available', () => {
    /* the desk types into this: a duplicate or a missing Custom is a dead end mid-estimate */
    expect(categories(book)).toEqual(['Assessment', 'Integration', 'Custom']);
  });

  it('does not offer Custom twice when the catalog already uses it', () => {
    const withCustom = catalog([solution('A', 10, { category: 'Custom' })]);
    expect(categories(withCustom)).toEqual(['Custom']);
  });

  it('offers the sub-categories in use, and nothing for a catalog without any', () => {
    expect(subCategories(book)).toEqual(['Bespoke', 'Out-of-the-box']);
    expect(subCategories(catalog([solution('A', 10)]))).toEqual([]);
  });
});

/* --------------------------------------------- bundles and estimates */

const added = (id: string, over: Partial<AddedSolution> = {}): AddedSolution => ({
  id, plat: 'openedx', bundleId: 'B01', name: `Estimate ${id}`, desc: '',
  first: 20, repeat: 6, form: '', deploy: '', integrations: '', category: '', subCategory: '',
  account: '', notes: '', from: '', estAt: '2026-03-01', ...over
});

const bundle = (id: string, name: string, items: Solution[]): Bundle => ({
  ...catalog(items).bundles[0]!,
  id,
  name,
  items
});

const book = (...bundles: Bundle[]): Catalog => ({ ...catalog([]), bundles });

describe('telling bundles from estimates', () => {
  const composed = composeCatalog({
    base: catalog([solution('EDU-1', 5), solution('EDU-2', null, { status: 'In Development' }), solution('EDU-3', 8, { status: 'Sample' })]),
    platform: 'openedx',
    added: [added('CS-01'), added('CS-02', { bundleId: 'CX' })],
    ownBundles: []
  });

  it('counts what was built, still being built, or a benchmark as bundles, and what the desk priced as estimates', () => {
    expect(composed.bundles.flatMap((one) => one.items).map((item) => [item.id, solutionKind(item)])).toEqual([
      ['EDU-1', 'bundles'],
      ['EDU-2', 'bundles'],
      ['EDU-3', 'bundles'],
      ['CS-01', 'estimates'],
      ['CS-02', 'estimates']
    ]);
    expect(kindCounts(composed)).toEqual({ all: 5, bundles: 3, estimates: 2 });
  });

  it('lists only one kind, and drops a bundle left with none of it', () => {
    const estimates = bundlesOfKind(composed.bundles, 'estimates');
    expect(estimates.map((one) => [one.id, one.items.map((item) => item.id)])).toEqual([
      ['B01', ['CS-01']],
      ['CX', ['CS-02']]
    ]);
    /* the rail lists bundles, not "Unassigned estimates", when only built work is showing */
    expect(bundlesOfKind(composed.bundles, 'bundles').map((one) => one.id)).toEqual(['B01']);
    expect(bundlesOfKind(composed.bundles, null)).toEqual(composed.bundles);
  });

  it('calls the group an estimate lands in when nobody filed it Unassigned', () => {
    expect(composed.bundles.find((one) => one.id === 'CX')?.name).toBe('Unassigned estimates');
  });

  it('says where an imported estimate came from, for whoever reads the row', () => {
    const row = toSolution(added('CS-03', { imported: 'Nordic.xlsx', sourceId: 'NU-014', client: 'Nordic University', estBy: 'Sam' }));
    expect(row.ref).toBe('Imported from Nordic.xlsx (NU-014), estimated for Nordic University on 2026-03-01 by Sam');
    expect(row.status).toBe('Estimation');
  });
});

describe('adding a bundles workbook to the catalog', () => {
  const current = book(
    bundle('B01', 'Commerce & Monetization', [solution('EDU-071', 5), solution('EDU-073', 5)]),
    bundle('B02', 'Localization', [solution('EDU-004', 160)])
  );

  it('adds what is new, updates what it names, and keeps everything it does not mention', () => {
    const incoming = book(
      bundle('B01', 'Commerce and monetization', [solution('EDU-071', 9), solution('EDU-200', 12)]),
      bundle('B16', 'Mobile Apps', [solution('EDU-300', 40)])
    );
    const merge = mergeCatalogs(current, incoming);

    expect(merge.conflicts).toEqual([]);
    expect(merge.added.sort()).toEqual(['EDU-200', 'EDU-300']);
    expect(merge.updated).toEqual(['EDU-071']);
    expect(merge.kept).toBe(2);
    expect(merge.bundlesAdded).toEqual(['B16 · Mobile Apps']);
    expect(merge.catalog.bundles.map((one) => [one.id, one.items.map((item) => `${item.id}:${item.first}`)])).toEqual([
      ['B01', ['EDU-073:5', 'EDU-071:9', 'EDU-200:12']],
      ['B02', ['EDU-004:160']],
      ['B16', ['EDU-300:40']]
    ]);
  });

  it('works out the figures again for a bundle it changed, and for the whole catalog', () => {
    const incoming = book(bundle('B01', 'Commerce & Monetization', [solution('EDU-200', null)]));
    const merged = mergeCatalogs(current, incoming).catalog;
    const b01 = merged.bundles[0]!;

    expect(b01).toMatchObject({ featureCount: 3, firstHrs: 10, noEstimate: 1 });
    /* the hero reads these, so a stale total would show the old catalog's engineered hours */
    expect(merged.meta.totals).toMatchObject({ features: 4, firstHrs: 170, noEstimate: 1 });
  });

  it('moves a solution to the bundle the workbook now puts it in, and drops a bundle it emptied', () => {
    const incoming = book(bundle('B01', 'Commerce & Monetization', [solution('EDU-004', 100)]));
    const merged = mergeCatalogs(current, incoming).catalog;
    expect(merged.bundles.map((one) => [one.id, one.items.map((item) => item.id)])).toEqual([['B01', ['EDU-071', 'EDU-073', 'EDU-004']]]);
  });

  it('works out the figures again for a bundle that lost a solution to another one', () => {
    const incoming = book(bundle('B02', 'Localization', [solution('EDU-073', 5)]));
    const merged = mergeCatalogs(current, incoming).catalog;
    /* B01 is not in the workbook, but it no longer holds EDU-073, so its 10 h would be stale */
    expect(merged.bundles[0]).toMatchObject({ id: 'B01', featureCount: 1, firstHrs: 5 });
    expect(merged.bundles[1]?.items.map((item) => item.id)).toEqual(['EDU-004', 'EDU-073']);
  });

  it('refuses a bundle id the catalog already uses for a different bundle, and names a free one', () => {
    const incoming = book(bundle('B02', 'AI Tutoring', [solution('EDU-500', 30)]));
    const merge = mergeCatalogs(current, incoming);

    expect(merge.conflicts).toHaveLength(1);
    expect(merge.conflicts[0]).toMatch(/B02 is "Localization" in the catalog but "AI Tutoring" in this workbook/);
    expect(merge.conflicts[0]).toMatch(/B03 is free/);
    /* nothing is merged while a conflict stands */
    expect(merge.catalog).toBe(current);
  });

  it('takes the whole workbook when the catalog in play is empty', () => {
    const incoming = book(bundle('B01', 'Commerce', [solution('EDU-1', 5)]));
    const merged = mergeCatalogs(book(), incoming);
    expect(merged.catalog.bundles.map((one) => one.id)).toEqual(['B01']);
    expect(merged.added).toEqual(['EDU-1']);
  });
});
