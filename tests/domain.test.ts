import { describe, expect, it } from 'vitest';
import type { Catalog, EstimateRequest, EstimationSnapshot, Solution } from '../src/types';
import { cachedTotals, calcEstimate, DEFAULT_ROLES, overheadRoleOf, roleLabel, SENIORITY_LEVELS } from '../src/domain/estimate';
import { peopleForDuration, reorder, schedule } from '../src/domain/planner';
import { allSolutions, categories, composeCatalog, diffCatalogs, guessBundle, subCategories, toSolution } from '../src/domain/catalog';
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
          subCategory: '', account: '', limits: '', note: '', from: 'RQ-1', estAt: '2026-09-01'
        }
      ],
      ownBundles: []
    });
    expect(composed.bundles[0]?.items).toHaveLength(2);
    expect(composed.bundles[0]?.items[1]?.status).toBe('Estimation');
  });

  it('keeps additions whose bundle is gone, rather than dropping them', () => {
    const composed = composeCatalog({
      base,
      platform: 'openedx',
      added: [
        {
          id: 'CS-09', plat: 'openedx', bundleId: 'GONE', name: 'Orphan', desc: '',
          first: 10, repeat: 3, form: '', deploy: '', integrations: '', category: '', subCategory: '',
          account: '', limits: '', note: '', from: '', estAt: ''
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
          account: '', limits: '', note: '', from: '', estAt: ''
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
      account: '', limits: 'Single region', note: 'Assumes X', from: 'RQ-1', estAt: '2026-09-01'
    });
    expect(converted.status).toBe('Estimation');
    expect(converted.build).toBeNull();
    expect(converted.notes).toBe('Single region · Estimator note: Assumes X');
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
