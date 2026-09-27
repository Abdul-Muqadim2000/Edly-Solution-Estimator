import { describe, expect, it } from 'vitest';
import type { Bundle, Catalog, Solution } from '../src/types';
import { planEstimateImport, TO_UNASSIGNED, toBundle, toNew, type EstimateRow } from '../src/domain/estimateImport';
import { planBundleImport, toCurrent, toIncoming } from '../src/domain/bundleImport';
import { approveAll, EMPTY_REVIEW, setGroup, setRow, type ImportReview } from '../src/domain/importReview';

/**
 * The review step before an import saves anything. A file proposes where its rows go; a person
 * approves each group, renames or redirects it, and moves or drops single rows. The rule that
 * matters most: nothing in a group that is still pending reaches the catalog.
 */

/* ------------------------------------------------------------ estimates */

const row = (n: number, over: Partial<EstimateRow> = {}): EstimateRow => ({
  row: n + 1, sourceId: `NU-${n}`, name: `Estimate ${n}`, desc: '', first: 10, repeat: null, client: 'Nordic University', bundleId: '', area: '',
  category: '', subCategory: '', form: '', deploy: '', integrations: '', account: '', limits: '', note: '', estBy: '', estAt: '', ...over
});

const catalogBundles = [
  { id: 'B09', name: 'Branding & White-Label' },
  { id: 'B15', name: 'Platform Engineering & Integrations' }
];

const rows = [
  row(1, { bundleId: 'B15' }),
  row(2, { area: 'Mobile Apps' }),
  row(3, { area: 'mobile apps' }),
  row(4, { area: 'Gamification' }),
  row(5),
  row(6, { area: 'branding and white-label' })
];

const plan = (review?: ImportReview, extra: Partial<Parameters<typeof planEstimateImport>[0]> = {}) =>
  planEstimateImport({ rows, file: 'nordic.xlsx', platform: 'openedx', catalogBundles, solutions: [], bundles: [], today: '2026-09-27', review, ...extra });

const approved = (keys: string[], review: ImportReview = EMPTY_REVIEW): ImportReview =>
  keys.reduce((next, groupKey) => setGroup(next, groupKey, { status: 'approved' }), review);

const ALL = [toBundle('B15'), toNew('Mobile Apps'), toNew('Gamification'), TO_UNASSIGNED, toBundle('B09')];

describe('the estimates review', () => {
  it('groups the rows by where the file puts them, in the order the file first does', () => {
    const { review } = plan(EMPTY_REVIEW);
    expect(review.groups.map((group) => [group.key, group.kind, group.label, group.rows.length])).toEqual([
      [toBundle('B15'), 'existing', 'B15 · Platform Engineering & Integrations', 1],
      [toNew('Mobile Apps'), 'new', 'Mobile Apps', 2],
      [toNew('Gamification'), 'new', 'Gamification', 1],
      [TO_UNASSIGNED, 'unassigned', 'Unassigned', 1],
      /* an Area spelled "and" still finds the bundle spelled "&" */
      [toBundle('B09'), 'existing', 'B09 · Branding & White-Label', 1]
    ]);
  });

  it('imports nothing while a group is still pending', () => {
    const pending = plan(EMPTY_REVIEW);
    expect(pending.review.pending).toBe(5);
    expect(pending.added).toEqual([]);
    expect(pending.bundles).toEqual([]);
    /* every row says why it is not in yet */
    expect(pending.review.groups.flatMap((group) => group.rows.map((one) => one.lands))).toEqual(Array(6).fill('Waiting for its group'));

    const some = plan(approved([toNew('Mobile Apps')]));
    expect(some.added.map((one) => one.name)).toEqual(['Estimate 2', 'Estimate 3']);
    expect(some.review.pending).toBe(4);
  });

  it('imports approved groups where the file proposed, making one bundle per new Area', () => {
    const done = plan(approved(ALL));
    expect(done.review.pending).toBe(0);
    expect(done.added.map((one) => [one.name, one.bundleId])).toEqual([
      ['Estimate 1', 'B15'],
      ['Estimate 2', 'CB-01'],
      ['Estimate 3', 'CB-01'],
      ['Estimate 4', 'CB-02'],
      ['Estimate 5', 'CX'],
      ['Estimate 6', 'B09']
    ]);
    expect(done.bundles.map((bundle) => bundle.name)).toEqual(['Mobile Apps', 'Gamification']);
  });

  it('approves every pending group in one click, except one that cannot be approved as it stands', () => {
    const blank = setGroup(EMPTY_REVIEW, toNew('Gamification'), { name: '  ' });
    const groups = plan(blank).review.groups;
    expect(groups.find((group) => group.key === toNew('Gamification'))?.blocked).toBe('Give the new bundle a name first.');

    const all = plan(approveAll(blank, groups));
    expect(all.review.pending).toBe(1);
    expect(all.review.included).toBe(5);
  });

  it('leaves a whole group out, and counts it', () => {
    const done = plan(setGroup(approved(ALL), toNew('Mobile Apps'), { status: 'skipped' }));
    expect(done.added.map((one) => one.name)).not.toContain('Estimate 2');
    expect(done.bundles.map((bundle) => bundle.name)).toEqual(['Gamification']);
    expect(done.review).toMatchObject({ included: 4, leftOut: 2 });
    expect(done.review.groups.find((group) => group.key === toNew('Mobile Apps'))?.lands).toBe('Left out');
  });

  it('names a new bundle as renamed', () => {
    const done = plan(setGroup(approved(ALL), toNew('Mobile Apps'), { name: 'Mobile Learning' }));
    expect(done.bundles.map((bundle) => bundle.name)).toEqual(['Mobile Learning', 'Gamification']);
    expect(done.review.groups[1]).toMatchObject({ name: 'Mobile Learning', lands: 'New bundle "Mobile Learning"' });
  });

  it('sends a new bundle renamed like an existing one into that bundle, and says so', () => {
    const done = plan(setGroup(approved(ALL), toNew('Gamification'), { name: 'Platform engineering and integrations' }));
    expect(done.added.find((one) => one.name === 'Estimate 4')?.bundleId).toBe('B15');
    expect(done.bundles.map((bundle) => bundle.name)).toEqual(['Mobile Apps']);
    expect(done.review.groups[2]?.note).toBe('The catalog already has a bundle called that (B15), so these go into it.');
  });

  it('makes one bundle of two new groups given the same name', () => {
    const done = plan(setGroup(approved(ALL), toNew('Gamification'), { name: 'Mobile Apps' }));
    expect(done.bundles.map((bundle) => bundle.name)).toEqual(['Mobile Apps']);
    expect(done.added.filter((one) => one.bundleId === 'CB-01')).toHaveLength(3);
    expect(done.review.groups[2]?.note).toBe('Another new bundle in this file has the same name, so the two become one bundle.');
  });

  it('sends a whole group somewhere else: a new one into an existing bundle, an existing one to Unassigned', () => {
    const review = setGroup(setGroup(approved(ALL), toNew('Gamification'), { to: toBundle('B09') }), toBundle('B15'), { to: TO_UNASSIGNED });
    const done = plan(review);
    expect(done.added.find((one) => one.name === 'Estimate 4')?.bundleId).toBe('B09');
    expect(done.added.find((one) => one.name === 'Estimate 1')?.bundleId).toBe('CX');
    /* no bundle is made for an Area whose rows all went elsewhere, and it is no longer on offer */
    expect(done.bundles.map((bundle) => bundle.name)).toEqual(['Mobile Apps']);
    expect(done.review.destinations.map((one) => one.key)).not.toContain(toNew('Gamification'));
    expect(done.review.groups[2]).toMatchObject({ renameable: false, lands: 'B09 · Branding & White-Label' });
  });

  it('merges one new group into another, and survives two sent into each other', () => {
    const merged = plan(setGroup(approved(ALL), toNew('Gamification'), { to: toNew('Mobile Apps') }));
    expect(merged.added.find((one) => one.name === 'Estimate 4')?.bundleId).toBe('CB-01');

    const loop = setGroup(setGroup(approved(ALL), toNew('Gamification'), { to: toNew('Mobile Apps') }), toNew('Mobile Apps'), { to: toNew('Gamification') });
    /* a loop must not hang the preview; each row still lands somewhere */
    expect(plan(loop).review.included).toBe(6);
  });

  it('moves a single row to another bundle, and back again by choosing its group', () => {
    const moved = setRow(approved(ALL), '3', { to: toBundle('B15') });
    const done = plan(moved);
    expect(done.added.find((one) => one.name === 'Estimate 2')?.bundleId).toBe('B15');
    expect(done.review.groups[1]?.rows[0]).toMatchObject({ to: toBundle('B15'), lands: 'B15 · Platform Engineering & Integrations' });

    const back = setRow(moved, '3', { to: undefined });
    expect(back.rows).toEqual({});

    /* moved out of a group still pending, it says where it is going and what it waits for */
    const early = plan(setRow(EMPTY_REVIEW, '3', { to: toBundle('B15') }));
    expect(early.review.groups[1]?.rows[0]?.lands).toBe('B15 · Platform Engineering & Integrations, once this group is approved');
    expect(early.added).toEqual([]);
  });

  it('moves a row into a new bundle from another group, and to Unassigned if that bundle is then left out', () => {
    const review = setRow(approved(ALL), '2', { to: toNew('Gamification') });
    const moved = plan(review);
    /* ids are handed out as rows first reach a new bundle, so check the bundle by its name */
    const gamification = moved.bundles.find((one) => one.name === 'Gamification')?.id;
    expect(moved.added.find((one) => one.name === 'Estimate 1')?.bundleId).toBe(gamification);
    const dropped = plan(setGroup(review, toNew('Gamification'), { status: 'skipped' }));
    expect(dropped.added.find((one) => one.name === 'Estimate 1')?.bundleId).toBe('CX');
  });

  it('leaves a single row out', () => {
    const done = plan(setRow(approved(ALL), '4', { skip: true }));
    expect(done.added.map((one) => one.name)).not.toContain('Estimate 3');
    expect(done.review).toMatchObject({ included: 5, leftOut: 1 });
    expect(done.review.groups[1]?.rows[1]).toMatchObject({ skip: true, lands: 'Left out' });
  });

  it('keeps a re-imported row with no Area in the bundle the desk filed it under, and says it is an update', () => {
    const earlier = plan(approved(ALL)).solutions.map((one) => (one.name === 'Estimate 5' ? { ...one, bundleId: 'B09' } : one));
    const again = plan(EMPTY_REVIEW, { solutions: earlier });
    const b09 = again.review.groups.find((group) => group.key === toBundle('B09'));
    expect(b09?.rows.map((one) => one.title)).toEqual(['Estimate 5', 'Estimate 6']);
    expect(b09?.rows[0]?.detail).toMatch(/updates CS-05/);
  });

  it('approves everything as proposed when there is no review at all, as older callers expect', () => {
    const legacy = plan(undefined);
    expect(legacy.review.pending).toBe(0);
    expect(legacy.added).toHaveLength(6);
  });
});

/* -------------------------------------------------------------- bundles */

const item = (id: string, first: number | null = 5, extra: Partial<Solution> = {}): Solution => ({
  id, name: `Feature ${id}`, desc: '', form: null, status: 'Production', deploy: null, first, repeat: first, build: first === null ? null : 40,
  saving: null, account: null, integrations: null, notes: null, ref: null, category: null, subCategory: null, ...extra
});
const bundle = (id: string, name: string, items: Solution[], pitch = ''): Bundle => ({
  id, name, pitch, offerWhen: '', featureCount: items.length, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null,
  noEstimate: 0, inDev: 0, accounts: null, pairsWith: null, items
});
const book = (...bundles: Bundle[]): Catalog => ({
  meta: { title: 'Catalog', subtitle: '', compiled: '', totals: { features: 0, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 }, notes: [] },
  bundles
});

const current = book(bundle('B01', 'Commerce', [item('EDU-1'), item('EDU-2')], 'Sell courses'), bundle('B03', 'AI Learning Experience', [item('EDU-3')]));
const incoming = book(
  bundle('B01', 'Commerce', [item('EDU-2', 9), item('EDU-10')], 'Sell courses anywhere'),
  bundle('B03', 'AI Tutoring Pro', [item('EDU-20'), item('EDU-21')]),
  bundle('B16', 'Mobile Apps', [item('EDU-30'), item('EDU-31', null, { status: 'In Development' })])
);
const bplan = (review: ImportReview) => planBundleImport({ current, incoming, review });
const BUNDLE_GROUPS = [toIncoming('B01'), toIncoming('B03'), toIncoming('B16')];

describe('the bundles review', () => {
  it('tells an update, a new bundle and a clash of IDs apart', () => {
    const { review } = bplan(EMPTY_REVIEW);
    expect(review.groups.map((group) => [group.label, group.kind, group.renameable])).toEqual([
      ['B01 · Commerce', 'existing', false],
      ['B03 · AI Tutoring Pro', 'clash', true],
      ['B16 · Mobile Apps', 'new', true]
    ]);
    /* a clash no longer blocks the import: it becomes a new bundle under a free ID unless sent elsewhere */
    expect(review.groups[1]).toMatchObject({ lands: 'New: B02 · AI Tutoring Pro (renumbered from B03)', note: 'B03 in the catalog is "AI Learning Experience", so this one becomes B02.' });
  });

  it('puts nothing in the reviewed workbook while groups are pending', () => {
    const pending = bplan(EMPTY_REVIEW);
    expect(pending.reviewed.bundles).toEqual([]);
    expect(pending.review.pending).toBe(3);
    expect(pending.merge.added).toEqual([]);
  });

  it('adds the approved workbook: an update with its new words, the clash renumbered, the new bundle as it is', () => {
    const done = bplan(approved(BUNDLE_GROUPS));
    expect(done.merge.conflicts).toEqual([]);
    expect(done.merge.catalog.bundles.map((one) => [one.id, one.name, one.items.map((it) => it.id)])).toEqual([
      ['B01', 'Commerce', ['EDU-1', 'EDU-2', 'EDU-10']],
      ['B03', 'AI Learning Experience', ['EDU-3']],
      ['B02', 'AI Tutoring Pro', ['EDU-20', 'EDU-21']],
      ['B16', 'Mobile Apps', ['EDU-30', 'EDU-31']]
    ]);
    expect(done.merge.catalog.bundles[0]?.pitch).toBe('Sell courses anywhere');
    expect(done.merge.catalog.bundles[0]?.items.find((it) => it.id === 'EDU-2')?.first).toBe(9);
  });

  it('sends a clash into the catalog bundle of that ID when a person says they are the same', () => {
    const done = bplan(setGroup(approved(BUNDLE_GROUPS), toIncoming('B03'), { to: toCurrent('B03') }));
    expect(done.merge.catalog.bundles.find((one) => one.id === 'B03')?.items.map((it) => it.id)).toEqual(['EDU-3', 'EDU-20', 'EDU-21']);
    expect(done.merge.catalog.bundles.map((one) => one.id)).not.toContain('B02');
  });

  it('renames a new bundle, and warns when the name is one the catalog already uses', () => {
    const renamed = bplan(setGroup(approved(BUNDLE_GROUPS), toIncoming('B16'), { name: 'Mobile Learning' }));
    expect(renamed.merge.catalog.bundles.find((one) => one.id === 'B16')?.name).toBe('Mobile Learning');
    const same = bplan(setGroup(approved(BUNDLE_GROUPS), toIncoming('B16'), { name: 'commerce' }));
    expect(same.review.groups[2]?.note).toBe('The catalog already has a bundle called that (B01); send these into it above to join them.');
  });

  it('sends a new bundle into an existing one, moves one solution, and leaves one out', () => {
    const review = setRow(setRow(setGroup(approved(BUNDLE_GROUPS), toIncoming('B16'), { to: toCurrent('B01') }), 'EDU-21', { to: toCurrent('B03') }), 'EDU-31', { skip: true });
    const done = bplan(review);
    const byId = (id: string) => done.merge.catalog.bundles.find((one) => one.id === id)?.items.map((it) => it.id);
    expect(byId('B01')).toEqual(['EDU-1', 'EDU-2', 'EDU-10', 'EDU-30']);
    expect(byId('B03')).toEqual(['EDU-3', 'EDU-21']);
    expect(byId('B16')).toBeUndefined();
    expect(done.review).toMatchObject({ included: 5, leftOut: 1 });
  });

  it('leaves a group out, and a solution moved into a group that is then left out goes with it', () => {
    const review = setGroup(setRow(approved(BUNDLE_GROUPS), 'EDU-10', { to: toIncoming('B16') }), toIncoming('B16'), { status: 'skipped' });
    const done = bplan(review);
    expect(done.merge.added).toEqual(['EDU-20', 'EDU-21']);
    expect(done.review.leftOut).toBe(3);
    expect(done.review.groups[0]?.rows.find((one) => one.key === 'EDU-10')?.lands).toBe('Left out');
  });

  it('replaces the catalog with the workbook as reviewed, not as uploaded', () => {
    const done = bplan(setGroup(setRow(approved(BUNDLE_GROUPS), 'EDU-30', { skip: true }), toIncoming('B03'), { status: 'skipped' }));
    expect(done.reviewed.bundles.map((one) => one.id)).toEqual(['B01', 'B16']);
    expect(done.replace.removed.map((one) => one.id).sort()).toEqual(['EDU-1', 'EDU-3']);
    expect(done.reviewed.meta.totals.features).toBe(3);
  });
});
