import { describe, expect, it } from 'vitest';
import {
  commitDraft,
  currentPlatform,
  DEFAULT_DISPLAY,
  effectiveDisplay,
  EMPTY_SNAPSHOT,
  findEstimation,
  INITIAL_STATE,
  openEstimationRecord,
  openRequests,
  platformEstimations,
  platformRequests,
  catalogSourceLabel,
  reducer,
  requestsFor,
  toPersisted,
  type Action,
  type AppState
} from '../src/state/reducer';
import type { EstimateRequest, Estimation } from '../src/types';

/**
 * The reducer is every state transition in the app, and it is pure, so it is tested with plain
 * objects rather than clicked. What is asserted here is mostly *loss*: a draft that must not be
 * dropped, a slug that must not be recomputed, an id that must not be reissued, a selection that
 * must not survive its solution. Those are the failures a screenshot never shows.
 */

const estimation = (id: string, over: Partial<Estimation> = {}): Estimation => ({
  id,
  plat: 'openedx',
  name: `Deal ${id}`,
  slug: id.toLowerCase(),
  client: 'Acme',
  tag: 'Active',
  due: '',
  at: '2026-01-01',
  up: '2026-01-01',
  total: 0,
  cost: 0,
  items: 0,
  snap: { ...EMPTY_SNAPSHOT },
  ...over
});

const request = (id: string, over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id,
  plat: 'openedx',
  estId: '',
  estName: '',
  client: '',
  title: `Request ${id}`,
  details: '',
  area: '',
  urgency: '',
  integrations: '',
  name: '',
  email: '',
  org: '',
  at: '2026-01-01',
  ...over
});

const workspace = (over: Partial<AppState> = {}): AppState => ({
  ...INITIAL_STATE,
  ready: true,
  auth: { user: 'admin', role: 'sales', at: 0 },
  practice: 'edtech',
  platform: 'openedx',
  ...over
});

/** Apply a sequence, so a test reads as the click path that produced the bug. */
const run = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, state);

const submission = {
  hours: 24,
  bundleId: 'B02',
  form: 'Integration',
  deploy: '3 days',
  integrations: 'Zoom',
  category: 'Core Platform',
  subCategory: '',
  account: '',
  limits: '',
  note: 'Priced off the Zoom pattern',
  by: 'desk@edly.io'
};

/* ------------------------------------------------------------------ the draft */

describe('the open estimation and its draft', () => {
  it('creates an estimation, opens it, and gives it the default rate card', () => {
    const next = reducer(workspace(), {
      type: 'createEstimation',
      input: { name: 'Nordic University', client: 'Nordic', tag: 'Active', due: '2026-03-01' }
    });

    const created = next.estimations[0];
    expect(next.estimations).toHaveLength(1);
    expect(created?.name).toBe('Nordic University');
    expect(created?.slug).toBe('nordic-university');
    expect(created?.plat).toBe('openedx');
    expect(next.openEstimation).toBe(created?.id);
    /* a new deal starts with a rate card, or the cost column reads zero until someone finds it */
    expect(created?.snap.roles?.length).toBeGreaterThan(0);
    expect(next.draft.roles?.length).toBeGreaterThan(0);
  });

  it('numbers a second deal of the same name rather than reusing its URL', () => {
    const next = run(
      workspace(),
      { type: 'createEstimation', input: { name: 'Acme Academy', client: 'Acme', tag: 'Active', due: '' } },
      { type: 'createEstimation', input: { name: 'Acme Academy', client: 'Acme', tag: 'Active', due: '' } }
    );
    expect(next.estimations.map((one) => one.slug)).toEqual(['acme-academy', 'acme-academy-2']);
  });

  it('scopes that uniqueness to the platform, because a URL carries one', () => {
    const seeded = workspace({ estimations: [estimation('EST-1', { plat: 'moodle', name: 'Acme', slug: 'acme' })] });
    const next = reducer(seeded, {
      type: 'createEstimation',
      input: { name: 'Acme', client: '', tag: 'Active', due: '' }
    });
    /* the Moodle deal is in a different namespace, so Open edX may still have `acme` */
    expect(next.estimations[1]?.slug).toBe('acme');
  });

  it('commits the draft into the estimation when another one is opened', () => {
    const state = workspace({
      estimations: [estimation('EST-1'), estimation('EST-2')],
      openEstimation: 'EST-1',
      draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-1': true }, bufPct: 10 }
    });

    const next = reducer(state, { type: 'openEstimation', id: 'EST-2' });

    expect(next.estimations[0]?.snap.sel).toEqual({ 'OX-1': true });
    expect(next.estimations[0]?.snap.bufPct).toBe(10);
    expect(next.openEstimation).toBe('EST-2');
    /* and the newly opened deal's own snapshot is what is now live */
    expect(next.draft.sel).toEqual({});
  });

  it('fills a sparse stored snapshot with the empty one, so an old row cannot arrive short', () => {
    const sparse = { sel: { 'OX-1': true }, buf: {}, bufPct: 0 } as Estimation['snap'];
    const state = workspace({ estimations: [estimation('EST-1', { snap: sparse })] });

    const next = reducer(state, { type: 'openEstimation', id: 'EST-1' });

    expect(next.draft.sel).toEqual({ 'OX-1': true });
    expect(next.draft.hpw).toBe(EMPTY_SNAPSHOT.hpw);
    expect(next.draft.cur).toBe('USD');
  });

  it('ignores an open for an estimation that is not there', () => {
    const state = workspace({ estimations: [estimation('EST-1')] });
    expect(reducer(state, { type: 'openEstimation', id: 'EST-404' })).toBe(state);
  });

  it('commits on close and leaves nothing behind in the draft', () => {
    const state = workspace({
      estimations: [estimation('EST-1')],
      openEstimation: 'EST-1',
      draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-9': true } }
    });

    const next = reducer(state, { type: 'closeEstimation' });

    expect(next.estimations[0]?.snap.sel).toEqual({ 'OX-9': true });
    expect(next.openEstimation).toBeNull();
    expect(next.draft).toEqual(EMPTY_SNAPSHOT);
  });

  it('refreshes the cached totals only when it is given them', () => {
    const state = workspace({
      estimations: [estimation('EST-1', { total: 5, cost: 500, items: 1 })],
      openEstimation: 'EST-1'
    });

    expect(commitDraft(state)[0]).toMatchObject({ total: 5, cost: 500, items: 1 });
    expect(commitDraft(state, { hours: 80, cost: 9600, items: 4 })[0]).toMatchObject({
      total: 80,
      cost: 9600,
      items: 4
    });
  });

  it('leaves the list alone when nothing is open', () => {
    const state = workspace({ estimations: [estimation('EST-1')] });
    expect(commitDraft(state)).toBe(state.estimations);
  });
});

/* ------------------------------------------------------------------- deleting */

describe('deleting an estimation', () => {
  const state = workspace({
    estimations: [estimation('EST-1'), estimation('EST-2')],
    requests: [request('RQ-01', { estId: 'EST-1' }), request('RQ-02', { estId: 'EST-2' })],
    openEstimation: 'EST-1',
    deskView: 'EST-1',
    draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-1': true } }
  });

  it('takes its requests with it, so the desk queue cannot outlive the deal', () => {
    const next = reducer(state, { type: 'deleteEstimation', id: 'EST-1' });
    expect(next.estimations.map((one) => one.id)).toEqual(['EST-2']);
    expect(next.requests.map((one) => one.id)).toEqual(['RQ-02']);
  });

  it('clears the open deal and the desk page when they were the one deleted', () => {
    const next = reducer(state, { type: 'deleteEstimation', id: 'EST-1' });
    expect(next.openEstimation).toBeNull();
    expect(next.draft).toEqual(EMPTY_SNAPSHOT);
    expect(next.deskView).toBeNull();
  });

  it('leaves the open deal alone when a different one is deleted', () => {
    const next = reducer(state, { type: 'deleteEstimation', id: 'EST-2' });
    expect(next.openEstimation).toBe('EST-1');
    expect(next.draft.sel).toEqual({ 'OX-1': true });
  });
});

/* ------------------------------------------------------------------ selection */

describe('selection and per-line settings', () => {
  const open = workspace({ estimations: [estimation('EST-1')], openEstimation: 'EST-1' });

  it('toggles a solution on and off', () => {
    const on = reducer(open, { type: 'toggleSolution', id: 'OX-1' });
    expect(on.draft.sel).toEqual({ 'OX-1': true });
    expect(reducer(on, { type: 'toggleSolution', id: 'OX-1' }).draft.sel).toEqual({});
  });

  it('selects and deselects a whole bundle at once', () => {
    const on = reducer(open, { type: 'selectMany', ids: ['OX-1', 'OX-2', 'OX-3'], selected: true });
    expect(Object.keys(on.draft.sel)).toEqual(['OX-1', 'OX-2', 'OX-3']);

    const off = reducer(on, { type: 'selectMany', ids: ['OX-1', 'OX-3'], selected: false });
    expect(Object.keys(off.draft.sel)).toEqual(['OX-2']);
  });

  it('clears the selection without touching the rest of the draft', () => {
    const state = reducer(open, { type: 'patchDraft', patch: { sel: { 'OX-1': true }, bufPct: 15 } });
    const cleared = reducer(state, { type: 'clearSelection' });
    expect(cleared.draft.sel).toEqual({});
    expect(cleared.draft.bufPct).toBe(15);
  });

  it('removes a line buffer rather than storing a zero', () => {
    const state = reducer(open, { type: 'setLineBuffer', id: 'OX-1', hours: 8 });
    expect(state.draft.buf).toEqual({ 'OX-1': 8 });

    /* zero and null both mean "no buffer". Storing 0 would ship a meaningless row to the sheet
       and make the line look deliberately buffered at nothing. */
    expect(reducer(state, { type: 'setLineBuffer', id: 'OX-1', hours: 0 }).draft.buf).toEqual({});
    expect(reducer(state, { type: 'setLineBuffer', id: 'OX-1', hours: null }).draft.buf).toEqual({});
  });

  it('assigns a role to several lines, and unassigns with null', () => {
    const assigned = reducer(open, { type: 'assignRole', ids: ['OX-1', 'OX-2'], roleId: 'be' });
    expect(assigned.draft.lineRole).toEqual({ 'OX-1': 'be', 'OX-2': 'be' });

    const cleared = reducer(assigned, { type: 'assignRole', ids: ['OX-1'], roleId: null });
    expect(cleared.draft.lineRole).toEqual({ 'OX-2': 'be' });
  });

  it('drops a desk solution out of the selection when it is removed from the catalog', () => {
    const state = run(
      workspace({ solutions: [], estimations: [estimation('EST-1')], openEstimation: 'EST-1' }),
      { type: 'addSolution', input: { ...submission, name: 'Custom SSO', desc: '', first: 20, repeat: 6 } }
    );
    const id = state.solutions[0]!.id;
    const selected = reducer(state, { type: 'toggleSolution', id });

    const removed = reducer(selected, { type: 'removeSolution', id });

    expect(removed.solutions).toHaveLength(0);
    /* a selection pointing at a solution that no longer exists silently drops hours from the total */
    expect(removed.draft.sel).toEqual({});
  });
});

/* ---------------------------------------------------------------------- plan */

describe('the delivery plan', () => {
  const open = workspace({ estimations: [estimation('EST-1')], openEstimation: 'EST-1' });

  it('merges a patch into the entries it names', () => {
    const state = run(
      open,
      { type: 'patchPlan', patch: { 'OX-1': { start: 0, people: 2 } } },
      { type: 'patchPlan', patch: { 'OX-1': { people: 3 } } }
    );
    expect(state.draft.plan?.['OX-1']).toEqual({ start: 0, people: 3 });
  });

  it('drops an entry emptied field by field, instead of leaving a husk behind', () => {
    const state = reducer(open, { type: 'setPlanEntry', key: 'OX-1', entry: { people: 2 } });
    expect(state.draft.plan?.['OX-1']).toEqual({ people: 2 });

    const emptied = reducer(state, { type: 'setPlanEntry', key: 'OX-1', entry: { people: undefined } });
    expect(emptied.draft.plan?.['OX-1']).toBeUndefined();
  });

  it('treats a null from a stored snapshot as no value, not as a value', () => {
    /* `people?: number` cannot be null in TypeScript, but a snapshot that has been through the
       spreadsheet and back can carry one — which is why the reducer checks for it at runtime */
    const state = reducer(open, { type: 'setPlanEntry', key: 'OX-1', entry: { people: 2, start: 4 } });
    const emptied = reducer(state, {
      type: 'setPlanEntry',
      key: 'OX-1',
      entry: { people: null, start: null } as unknown as { people?: number; start?: number }
    });
    expect(emptied.draft.plan?.['OX-1']).toBeUndefined();
  });

  it('deletes an entry outright when it is set to null', () => {
    const state = reducer(open, { type: 'setPlanEntry', key: 'OX-1', entry: { people: 2 } });
    expect(reducer(state, { type: 'setPlanEntry', key: 'OX-1', entry: null }).draft.plan).toEqual({});
  });

  it('levels several tasks to the same headcount, keeping their other fields', () => {
    const state = run(
      open,
      { type: 'patchPlan', patch: { 'OX-1': { start: 0, people: 1 }, 'OX-2': { start: 5, people: 4 } } },
      { type: 'levelPeople', keys: ['OX-1', 'OX-2'], people: 2 }
    );
    expect(state.draft.plan?.['OX-1']).toEqual({ start: 0, people: 2 });
    expect(state.draft.plan?.['OX-2']).toEqual({ start: 5, people: 2 });
  });

  it('resets the plan without disturbing the selection', () => {
    const state = run(
      open,
      { type: 'toggleSolution', id: 'OX-1' },
      { type: 'patchPlan', patch: { 'OX-1': { people: 2 } } },
      { type: 'resetPlan' }
    );
    expect(state.draft.plan).toEqual({});
    expect(state.draft.sel).toEqual({ 'OX-1': true });
  });
});

/* ------------------------------------------------------------- desk workflow */

describe('requests and the estimation desk', () => {
  const open = workspace({
    estimations: [estimation('EST-1', { name: 'Acme Academy', client: 'Acme Inc' })],
    openEstimation: 'EST-1'
  });

  it('stamps a request with the deal it was raised from', () => {
    const next = reducer(open, {
      type: 'addRequest',
      input: {
        title: 'Custom SSO',
        details: 'Okta',
        area: 'Auth',
        urgency: 'High',
        integrations: 'Okta',
        name: 'Rep',
        email: 'rep@edly.io',
        org: 'Edly'
      }
    });

    const raised = next.requests[0];
    expect(raised?.id).toBe('RQ-01');
    expect(raised?.estId).toBe('EST-1');
    expect(raised?.estName).toBe('Acme Academy');
    expect(raised?.client).toBe('Acme Inc');
    expect(raised?.plat).toBe('openedx');
    /* still pending: no hours at all, not zero */
    expect(raised?.est).toBeUndefined();
  });

  it('adds a manual item already priced, so it counts immediately', () => {
    const next = reducer(open, { type: 'addManualItem', title: 'Discovery workshop', hours: 12 });
    expect(next.requests[0]).toMatchObject({ manual: true, est: 12, title: 'Discovery workshop', estId: 'EST-1' });
  });

  it('numbers a request from the highest id, not the row count', () => {
    const state = workspace({ requests: [request('RQ-01'), request('RQ-07')] });
    const next = reducer(state, { type: 'addManualItem', title: 'Third', hours: 1 });
    /* RQ-03 would collide the moment RQ-07 is deleted and re-added */
    expect(next.requests[2]?.id).toBe('RQ-08');
  });

  it('turns a priced request into a catalog solution', () => {
    const raised = reducer(open, { type: 'addManualItem', title: 'Custom SSO', hours: 0 });
    const priced = reducer(raised, { type: 'submitEstimate', id: 'RQ-01', submission });

    expect(priced.requests[0]).toMatchObject({ est: 24, estBy: 'desk@edly.io', csId: 'CS-01' });
    expect(priced.solutions[0]).toMatchObject({
      id: 'CS-01',
      name: 'Custom SSO',
      first: 24,
      bundleId: 'B02',
      from: 'RQ-01',
      direct: false
    });
  });

  it('falls back to the first-delivery hours when the desk gives no repeat figure', () => {
    const priced = run(
      open,
      { type: 'addManualItem', title: 'Custom SSO', hours: 0 },
      { type: 'submitEstimate', id: 'RQ-01', submission }
    );
    expect(priced.requests[0]?.repeatEst).toBe(24);
    expect(priced.solutions[0]?.repeat).toBe(24);

    const withRepeat = run(
      open,
      { type: 'addManualItem', title: 'Custom SSO', hours: 0 },
      { type: 'submitEstimate', id: 'RQ-01', submission: { ...submission, repeatHours: 6 } }
    );
    expect(withRepeat.requests[0]?.repeatEst).toBe(6);
    expect(withRepeat.solutions[0]?.repeat).toBe(6);
  });

  it('re-estimating updates the same catalog entry instead of adding a second one', () => {
    const first = run(
      open,
      { type: 'addManualItem', title: 'Custom SSO', hours: 0 },
      { type: 'submitEstimate', id: 'RQ-01', submission }
    );
    const again = reducer(first, { type: 'submitEstimate', id: 'RQ-01', submission: { ...submission, hours: 40 } });

    expect(again.solutions).toHaveLength(1);
    expect(again.solutions[0]).toMatchObject({ id: 'CS-01', first: 40 });
  });

  it('ignores an estimate for a request that has been deleted', () => {
    const state = workspace({ requests: [] });
    expect(reducer(state, { type: 'submitEstimate', id: 'RQ-99', submission })).toBe(state);
  });

  it('marks a solution the desk added directly, so it is distinguishable from a priced request', () => {
    const next = reducer(open, {
      type: 'addSolution',
      input: { ...submission, name: 'Proctoring', desc: '', first: 30, repeat: 10 }
    });
    expect(next.solutions[0]).toMatchObject({ id: 'CS-01', direct: true, from: '', plat: 'openedx' });
  });

  it('adds and removes a custom bundle', () => {
    const added = reducer(open, { type: 'addBundle', name: 'Compliance', pitch: 'SOC2', offerWhen: 'Enterprise' });
    expect(added.bundles[0]).toMatchObject({ id: 'CB-01', name: 'Compliance', plat: 'openedx' });
    expect(reducer(added, { type: 'removeBundle', id: 'CB-01' }).bundles).toHaveLength(0);
  });

  it('deletes a request', () => {
    const state = workspace({ requests: [request('RQ-01'), request('RQ-02')] });
    expect(reducer(state, { type: 'deleteRequest', id: 'RQ-01' }).requests.map((one) => one.id)).toEqual(['RQ-02']);
  });
});

/* ------------------------------------------------------------------ sessions */

describe('signing in, out and choosing a platform', () => {
  it('lands on the picker and remembers where you were', () => {
    const state = workspace({ platform: 'moodle', openEstimation: 'EST-1', deskView: 'EST-1' });
    const next = reducer(state, { type: 'signIn', user: 'admin', role: 'sales' });

    expect(next.auth).toMatchObject({ user: 'admin', role: 'sales' });
    expect(next.platform).toBe('');
    expect(next.lastPlatform).toBe('moodle');
    expect(next.openEstimation).toBeNull();
    expect(next.deskView).toBeNull();
  });

  it('signing out keeps the shortcut but drops the session', () => {
    const next = reducer(workspace({ platform: 'openedx' }), { type: 'signOut' });
    expect(next.auth).toBeNull();
    expect(next.lastPlatform).toBe('openedx');
  });

  it('switching platform resets the workspace around it', () => {
    const state = workspace({
      openEstimation: 'EST-1',
      draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-1': true } },
      deskTab: 'estimations',
      deskView: 'EST-1',
      catalogSource: { source: 'file', name: 'mine.xlsx' }
    });

    const next = reducer(state, { type: 'choosePlatform', practice: 'edtech', platform: 'moodle' });

    expect(next.platform).toBe('moodle');
    expect(next.lastPlatform).toBe('moodle');
    expect(next.openEstimation).toBeNull();
    expect(next.draft).toEqual(EMPTY_SNAPSHOT);
    expect(next.deskTab).toBe('queue');
    expect(next.deskView).toBeNull();
    /* the source label belongs to the catalog that was in play, not the new one */
    expect(next.catalogSource).toBeNull();
  });
});

/* --------------------------------------------------------- the sibling tab */

describe('a sibling tab rewriting the list', () => {
  const incoming = [estimation('EST-1', { name: 'Renamed elsewhere' }), estimation('EST-2')];

  it('keeps the local copy of whatever is open here', () => {
    const state = workspace({
      estimations: [estimation('EST-1', { name: 'Mine, unsaved' })],
      openEstimation: 'EST-1'
    });

    const next = reducer(state, { type: 'mergeEstimations', estimations: incoming });

    /* the other tab could not have known about unsaved work in this one */
    expect(next.estimations.find((one) => one.id === 'EST-1')?.name).toBe('Mine, unsaved');
    expect(next.estimations.map((one) => one.id)).toEqual(['EST-1', 'EST-2']);
  });

  it('re-adds the open deal when the other tab has dropped it', () => {
    const state = workspace({ estimations: [estimation('EST-9', { name: 'Only here' })], openEstimation: 'EST-9' });
    const next = reducer(state, { type: 'mergeEstimations', estimations: incoming });
    expect(next.estimations.map((one) => one.id)).toEqual(['EST-1', 'EST-2', 'EST-9']);
  });

  it('takes the incoming list wholesale at the desk, which holds no draft', () => {
    const state = workspace({
      auth: { user: 'admin', role: 'estimator', at: 0 },
      estimations: [estimation('EST-1', { name: 'Stale' })],
      openEstimation: 'EST-1'
    });
    const next = reducer(state, { type: 'mergeEstimations', estimations: incoming });
    expect(next.estimations.find((one) => one.id === 'EST-1')?.name).toBe('Renamed elsewhere');
  });

  it('takes it wholesale when nothing is open', () => {
    const next = reducer(workspace(), { type: 'mergeEstimations', estimations: incoming });
    expect(next.estimations).toEqual(incoming);
  });
});

/* -------------------------------------------------------------- presentation */

describe('what the client is allowed to see', () => {
  it('hides the economics in presentation mode regardless of the saved preferences', () => {
    const state = reducer(workspace({ display: { ...DEFAULT_DISPLAY, money: true } }), { type: 'togglePresenting' });

    expect(state.presenting).toBe(true);
    expect(effectiveDisplay(state)).toEqual({
      savings: false,
      notes: false,
      money: false,
      controls: false,
      blendBuffer: true
    });
    /* the stored preference is untouched — leaving presentation restores it */
    expect(state.display.money).toBe(true);
    expect(effectiveDisplay(reducer(state, { type: 'togglePresenting' })).money).toBe(true);
  });

  it('leaves presentation mode as soon as a preference is changed', () => {
    const presenting = reducer(workspace(), { type: 'togglePresenting' });
    const next = reducer(presenting, { type: 'setDisplay', patch: { money: true } });
    /* otherwise the toggle appears dead: you flip "show money" and nothing happens */
    expect(next.presenting).toBe(false);
    expect(next.display.money).toBe(true);
  });
});

/* ------------------------------------------------------------------ catalogs */

describe('the loaded catalog', () => {
  const catalog = { meta: { title: 'Mine', subtitle: '', compiled: '', totals: { features: 0, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 }, notes: [] }, bundles: [] };

  it('stores a catalog per platform and clears the error it replaces', () => {
    const state = workspace({ catalogError: 'Could not read the sheet' });
    const next = reducer(state, {
      type: 'setLoadedCatalog',
      platform: 'moodle',
      catalog,
      source: { source: 'file', name: 'moodle.xlsx' }
    });

    expect(next.loadedCatalogs.moodle).toBe(catalog);
    expect(next.catalogError).toBeNull();
    expect(next.autoAvail).toBe(false);
  });

  it('removing a catalog leaves an existing error standing', () => {
    const state = workspace({ loadedCatalogs: { moodle: catalog }, catalogError: 'still broken' });
    const next = reducer(state, { type: 'setLoadedCatalog', platform: 'moodle', catalog: null, source: null });

    expect(next.loadedCatalogs.moodle).toBeUndefined();
    expect(next.catalogError).toBe('still broken');
  });
});

/* ----------------------------------------------------------------- selectors */

describe('selectors', () => {
  const state = workspace({
    estimations: [
      estimation('EST-1', { slug: 'acme-academy' }),
      estimation('EST-2', { plat: 'moodle', slug: 'elsewhere' }),
      estimation('EST-3', { plat: '', slug: 'legacy-row' })
    ],
    requests: [request('RQ-01', { estId: 'EST-1' }), request('RQ-02', { plat: 'moodle' }), request('RQ-03', { estId: 'EST-1' })],
    openEstimation: 'EST-1'
  });

  it('never mixes platforms', () => {
    expect(platformEstimations(state).map((one) => one.id)).toEqual(['EST-1', 'EST-3']);
    expect(platformRequests(state).map((one) => one.id)).toEqual(['RQ-01', 'RQ-03']);
  });

  it('treats a row with no platform as Open edX, so an older sheet still loads', () => {
    expect(platformEstimations(state).some((one) => one.id === 'EST-3')).toBe(true);
    expect(currentPlatform(workspace({ platform: '' }))).toBe('openedx');
  });

  it('finds an estimation by slug or by id, case-insensitively', () => {
    expect(findEstimation(state, 'acme-academy')?.id).toBe('EST-1');
    expect(findEstimation(state, 'ACME-ACADEMY')?.id).toBe('EST-1');
    expect(findEstimation(state, 'est-1')?.id).toBe('EST-1');
    expect(findEstimation(state, '')).toBeNull();
    /* another platform's deal is not reachable from this one */
    expect(findEstimation(state, 'elsewhere')).toBeNull();
  });

  it('reads the open record and its requests', () => {
    expect(openEstimationRecord(state)?.id).toBe('EST-1');
    expect(openRequests(state).map((one) => one.id)).toEqual(['RQ-01', 'RQ-03']);
    expect(requestsFor(state, 'EST-2')).toEqual([]);
    expect(openEstimationRecord(workspace())).toBeNull();
  });

  it('persists the open draft, not the last committed copy', () => {
    const live = { ...state, draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-4': true } } };
    const persisted = toPersisted(live);

    expect(persisted.estimations.find((one) => one.id === 'EST-1')?.snap.sel).toEqual({ 'OX-4': true });
    expect(persisted.requests).toHaveLength(3);
  });
});

describe('unknown actions', () => {
  it('returns the same object, so React does not re-render for nothing', () => {
    const state = workspace();
    expect(reducer(state, { type: 'nonsense' } as unknown as Action)).toBe(state);
  });
});

describe('where the catalog in play came from', () => {
  const book = {
    meta: { title: 'Mine', subtitle: '', compiled: '', totals: { features: 0, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 }, notes: [] },
    bundles: []
  };

  it('describes each source of the live Open edX catalog', () => {
    const live = (source: AppState['catalogSource']): string => catalogSourceLabel(workspace({ platform: 'openedx', catalogSource: source }));

    expect(live(null)).toBe('from the master sales sheet');
    expect(live({ source: 'builtin' })).toBe('built-in copy of the master sheet');
    expect(live({ source: 'file', name: 'catalog-2026.xlsx' })).toBe('loaded from catalog-2026.xlsx');
    expect(live({ source: 'auto', name: 'catalog-source.xlsx' })).toBe('live from catalog-source.xlsx');
  });

  it('falls back to a phrase rather than to "undefined" when the name is missing', () => {
    expect(catalogSourceLabel(workspace({ platform: 'openedx', catalogSource: { source: 'file' } }))).toBe('loaded from your sheet');
    expect(catalogSourceLabel(workspace({ platform: 'openedx', catalogSource: { source: 'auto' } }))).toBe('live from the sheet beside the app');
  });

  it('calls a benchmark platform what it is, so nobody quotes it as delivery data', () => {
    /* only Open edX is client-proven; the rest are labelled Sample throughout the UI */
    expect(catalogSourceLabel(workspace({ platform: 'moodle' }))).toBe('industry benchmark set for Moodle');
  });

  it('says where a benchmark platform s replacement catalog came from', () => {
    const state = workspace({ platform: 'moodle', loadedCatalogs: { moodle: book }, catalogSource: { source: 'file', name: 'moodle.xlsx' } });
    expect(catalogSourceLabel(state)).toBe('loaded from moodle.xlsx');
  });

  it('copes with a platform it has never heard of', () => {
    expect(catalogSourceLabel(workspace({ platform: 'nonesuch' }))).toBe('industry benchmark set for this platform');
  });
});
