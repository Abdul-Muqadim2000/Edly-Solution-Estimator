import { describe, expect, it } from 'vitest';
import {
  catalogReady,
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
  platformTotals,
  catalogSourceLabel,
  reducer,
  requestsFor,
  toPersisted,
  findTender,
  openTenderRecord,
  platformTenders,
  sentRequirementIds,
  baseSourceOf,
  catalogPin,
  sourceAfterImport,
  type Action,
  type AppState
} from '../src/state/reducer';
import { TO_UNASSIGNED, toBundle, toNew, type EstimateRow } from '../src/domain/estimateImport';
import { EMPTY_REVIEW, setGroup, setRow } from '../src/domain/importReview';
import type { Catalog, EstimateRequest, Estimation, RequirementMatch, Solution, Tender, TenderDocument } from '../src/types';
import { NO_TOKENS, type DeskDraft, type ExtractedRequirement, type NewTenderInput } from '../src/domain/tender';

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
  notes: 'Assumes the client already holds a Zoom licence.',
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

  it('carries the cached totals through a commit rather than resetting them', () => {
    const state = workspace({
      estimations: [estimation('EST-1', { total: 5, cost: 500, items: 1 })],
      openEstimation: 'EST-1'
    });
    expect(commitDraft(state)[0]).toMatchObject({ total: 5, cost: 500, items: 1 });
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

  it('keeps each seniority level of a role as its own rate-card row, assigned by id', () => {
    const roles = [
      { id: 'eng-sr', name: 'Engineer', level: 'Senior' as const, rate: 60 },
      { id: 'eng-jr', name: 'Engineer', level: 'Junior' as const, rate: 30 }
    ];
    const state = run(open, { type: 'setRoles', roles }, { type: 'assignRole', ids: ['OX-1'], roleId: 'eng-jr' });
    expect(state.draft.roles).toEqual(roles);
    /* the same name twice is fine: a line points at a row, so at a level and its rate */
    expect(state.draft.lineRole).toEqual({ 'OX-1': 'eng-jr' });
    expect(commitDraft(state)[0]?.snap.roles?.[1]?.level).toBe('Junior');
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

  it('gives the request and its catalog entry the same one Notes / Assumptions', () => {
    const priced = run(open, { type: 'addManualItem', title: 'Custom SSO', hours: 0 }, { type: 'submitEstimate', id: 'RQ-01', submission });
    expect(priced.requests[0]?.catNotes).toBe('Assumes the client already holds a Zoom licence.');
    expect(priced.solutions[0]?.notes).toBe('Assumes the client already holds a Zoom licence.');
  });

  it('keeps no notes entry on a request the desk wrote none for, and clears one on a second estimate', () => {
    const plain = run(
      open,
      { type: 'addManualItem', title: 'Custom SSO', hours: 0 },
      { type: 'submitEstimate', id: 'RQ-01', submission: { ...submission, notes: '' } }
    );
    /* the way a request with no notes reads back from the sheet, so a reload is not a change */
    expect(plain.requests[0]).not.toHaveProperty('catNotes');
    expect(plain.solutions[0]?.notes).toBe('');

    const noted = reducer(plain, { type: 'submitEstimate', id: 'RQ-01', submission });
    const cleared = reducer(noted, { type: 'submitEstimate', id: 'RQ-01', submission: { ...submission, notes: '' } });
    expect(cleared.requests[0]).not.toHaveProperty('catNotes');
    expect(cleared.solutions[0]?.notes).toBe('');
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
    expect(next.solutions[0]?.notes).toBe('Assumes the client already holds a Zoom licence.');
  });

  it("rewords an estimate's notes, and the copy on the request it was priced from with it", () => {
    const priced = run(
      open,
      { type: 'addManualItem', title: 'Custom SSO', hours: 0 },
      { type: 'addManualItem', title: 'Proctoring', hours: 0 },
      { type: 'submitEstimate', id: 'RQ-01', submission }
    );
    const reworded = reducer(priced, { type: 'setSolutionNotes', id: 'CS-01', notes: '  Single sign-on through Azure AD only.\n' });
    expect(reworded.solutions[0]?.notes).toBe('Single sign-on through Azure AD only.');
    /* the request's own line in the sheet reads its copy, so a stale one would contradict the catalog */
    expect(reworded.requests[0]?.catNotes).toBe('Single sign-on through Azure AD only.');
    expect(reworded.requests[1]).toEqual(priced.requests[1]);

    const cleared = reducer(reworded, { type: 'setSolutionNotes', id: 'CS-01', notes: ' ' });
    expect(cleared.solutions[0]?.notes).toBe('');
    expect(cleared.requests[0]).not.toHaveProperty('catNotes');
  });

  it('changes nothing for notes that are the same, or for an estimate that is gone', () => {
    const priced = run(open, { type: 'addManualItem', title: 'Custom SSO', hours: 0 }, { type: 'submitEstimate', id: 'RQ-01', submission });
    /* the same object back, so saving the unchanged notes does not trigger a save */
    expect(reducer(priced, { type: 'setSolutionNotes', id: 'CS-01', notes: 'Assumes the client already holds a Zoom licence. ' })).toBe(priced);
    expect(reducer(priced, { type: 'setSolutionNotes', id: 'CS-99', notes: 'Anything' })).toBe(priced);
  });

  it("adds and removes a custom bundle, numbered after the catalog's last B number", () => {
    const added = reducer(open, { type: 'addBundle', name: 'Compliance', pitch: 'SOC2', offerWhen: 'Enterprise', catalogBundleIds: ['B01', 'B15'] });
    expect(added.bundles[0]).toMatchObject({ id: 'B16', name: 'Compliance', plat: 'openedx' });
    expect(reducer(added, { type: 'removeBundle', id: 'B16' }).bundles).toHaveLength(0);
  });

  it('numbers the next bundle after the ones already made here, whatever older CB numbers there are', () => {
    const older = { ...open, bundles: [{ id: 'CB-01', plat: 'openedx', name: 'Older', pitch: '', offerWhen: '', pairsWith: null, at: '' }] };
    const twice = run(
      older,
      { type: 'addBundle', name: 'Compliance', pitch: '', offerWhen: '', catalogBundleIds: ['B01', 'B15'] },
      { type: 'addBundle', name: 'Proctoring', pitch: '', offerWhen: '', catalogBundleIds: ['B01', 'B15'] }
    );
    /* the catalog passed in does not list the first one yet, and the second must still not reuse B16 */
    expect(twice.bundles.map((bundle) => bundle.id)).toEqual(['CB-01', 'B16', 'B17']);
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

  /* Sign out is a button in the builder, so it fires with a deal open. Persistence writes
     `commitDraft(state)`, which with nothing open is the stale list, so the next save used to
     put the snapshot from when the deal was opened back over everything done since. */
  it('signing out from the builder keeps the edits made to the open deal', () => {
    const building = workspace({
      estimations: [estimation('EST-1')],
      openEstimation: 'EST-1',
      draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-1': true }, bufPct: 12 }
    });
    const next = reducer(building, { type: 'signOut' });

    expect(next.openEstimation).toBeNull();
    expect(toPersisted(next).estimations[0]?.snap).toMatchObject({ sel: { 'OX-1': true }, bufPct: 12 });
  });

  it('signing in again keeps the edits of a deal that was left open', () => {
    const building = workspace({
      estimations: [estimation('EST-1')],
      openEstimation: 'EST-1',
      draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-2': true } }
    });
    const next = reducer(building, { type: 'signIn', user: 'admin', role: 'estimator' });
    expect(toPersisted(next).estimations[0]?.snap.sel).toEqual({ 'OX-2': true });
  });

  it('switching platform commits the open deal before clearing the draft', () => {
    const building = workspace({
      estimations: [estimation('EST-1')],
      openEstimation: 'EST-1',
      draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-3': true } }
    });
    const next = reducer(building, { type: 'choosePlatform', practice: 'edtech', platform: 'moodle' });

    expect(next.draft).toEqual(EMPTY_SNAPSHOT);
    expect(toPersisted(next).estimations[0]?.snap.sel).toEqual({ 'OX-3': true });
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

/* -------------------------------------------------------------- the Excel sheet */

describe('what goes in the Excel sheet', () => {
  const open = workspace({ estimations: [estimation('EST-1')], openEstimation: 'EST-1' });

  it("starts with Edly's template columns, hours and estimate ticked", () => {
    const { columns } = INITIAL_STATE.sheet;
    for (const id of ['deliverable', 'area', 'component', 'description', 'status', 'notes', 'hours', 'estimate'] as const) {
      expect(columns[id]).toBe(true);
    }
    expect(columns.solutionId).toBe(false);
    /* Internal Notes went when the notes became one entry: its text is now the Notes/Assumptions */
    expect(columns).not.toHaveProperty('internal');
    expect(INITIAL_STATE.sheet.catalogNotes).toBe(true);
  });

  it("switches each solution's own notes off and back on without touching the columns", () => {
    const off = reducer(open, { type: 'setSheet', catalogNotes: false });
    expect(off.sheet.catalogNotes).toBe(false);
    expect(off.sheet.columns).toEqual(INITIAL_STATE.sheet.columns);
    /* a column change afterwards must not quietly switch them back on */
    expect(reducer(off, { type: 'setSheet', columns: { item: true } }).sheet.catalogNotes).toBe(false);
    expect(reducer(off, { type: 'setSheet', catalogNotes: true }).sheet.catalogNotes).toBe(true);
  });

  it('ticks and unticks one column without touching the others', () => {
    const state = reducer(open, { type: 'setSheet', columns: { solutionId: true, notes: false } });
    expect(state.sheet.columns.solutionId).toBe(true);
    expect(state.sheet.columns.notes).toBe(false);
    expect(state.sheet.columns.hours).toBe(true);
    expect(state.sheet.sections).toEqual(INITIAL_STATE.sheet.sections);
  });

  it('never drops the Component column, which every other column describes', () => {
    const state = reducer(open, { type: 'setSheet', columns: { component: false } });
    expect(state.sheet.columns.component).toBe(true);
  });

  it('switches sheets and sections independently of the columns', () => {
    const state = reducer(open, { type: 'setSheet', sections: { cover: false, roles: true } });
    expect(state.sheet.sections.cover).toBe(false);
    expect(state.sheet.sections.roles).toBe(true);
    expect(state.sheet.columns).toEqual(INITIAL_STATE.sheet.columns);
  });

  it('puts everything back with reset', () => {
    const changed = run(open, { type: 'setSheet', columns: { hours: false } }, { type: 'setSheet', sections: { terms: false } });
    expect(reducer(changed, { type: 'resetSheet' }).sheet).toEqual(INITIAL_STATE.sheet);
  });

  it('leaves presenting alone, unlike a display setting', () => {
    /* the sheet is not what the client is watching, so choosing columns must not end the demo */
    const presenting = reducer(open, { type: 'togglePresenting' });
    expect(reducer(presenting, { type: 'setSheet', columns: { item: true } }).presenting).toBe(true);
  });

  it("keeps the contact and comments on the open estimation's draft", () => {
    const state = reducer(open, { type: 'setSheetDetails', patch: { contact: 'Jane Rivera', comments: 'Phase one only.' } });
    expect(state.draft.sheet).toEqual({ contact: 'Jane Rivera', comments: 'Phase one only.' });
    /* and they are saved with the deal, not with the browser */
    expect(commitDraft(state)[0]?.snap.sheet?.contact).toBe('Jane Rivera');
  });

  it('changes one detail without clearing the other, and removes one cleared to blank', () => {
    const both = reducer(open, { type: 'setSheetDetails', patch: { contact: 'Jane', comments: 'Phase one.' } });
    const contactOnly = reducer(both, { type: 'setSheetDetails', patch: { comments: '  ' } });
    expect(contactOnly.draft.sheet).toEqual({ contact: 'Jane' });
  });

  it('removes a line note cleared to blank when the line has no catalog text to fall back on', () => {
    const noted = reducer(open, { type: 'setLineNote', id: 'OX-1', note: 'Client supplies the logo files.' });
    expect(noted.draft.sheet?.notes).toEqual({ 'OX-1': 'Client supplies the logo files.' });

    /* blank is what the line prints anyway, so an entry would only be clutter in the deal */
    expect(reducer(noted, { type: 'setLineNote', id: 'OX-1', note: ' ' }).draft.sheet?.notes).toEqual({});
  });

  it("keeps an empty entry when a line with catalog text is cleared, so that text stays off this client's sheet", () => {
    const cleared = reducer(open, { type: 'setLineNote', id: 'OX-1', note: '', catalogNote: 'Assumes AWS.' });
    /* without the entry the line would print the catalog's text again, which is what was removed */
    expect(cleared.draft.sheet?.notes).toEqual({ 'OX-1': '' });
    expect(reducer(open, { type: 'setLineNote', id: 'OX-1', note: '   ', catalogNote: 'Assumes AWS.' }).draft.sheet?.notes).toEqual({ 'OX-1': '' });
  });

  it("stores this client's wording of a catalog note, and drops it once it reads the same as the catalog's", () => {
    const reworded = reducer(open, { type: 'setLineNote', id: 'OX-1', note: 'Assumes Azure.', catalogNote: 'Assumes AWS.' });
    expect(reworded.draft.sheet?.notes).toEqual({ 'OX-1': 'Assumes Azure.' });

    /* "Use catalog text" sends the catalog's own words; the line then follows the catalog again */
    const reset = reducer(reworded, { type: 'setLineNote', id: 'OX-1', note: 'Assumes AWS.', catalogNote: 'Assumes AWS.' });
    expect(reset.draft.sheet?.notes).toEqual({});
    expect(reducer(reworded, { type: 'setLineNote', id: 'OX-1', note: ' Assumes AWS. ', catalogNote: 'Assumes AWS.' }).draft.sheet?.notes).toEqual({});
  });

  it('keeps the other notes and the cover details when one note changes', () => {
    const state = run(
      open,
      { type: 'setSheetDetails', patch: { contact: 'Jane' } },
      { type: 'setLineNote', id: 'OX-1', note: 'One' },
      { type: 'setLineNote', id: 'RQ-01', note: 'Two' }
    );
    expect(state.draft.sheet).toEqual({ contact: 'Jane', notes: { 'OX-1': 'One', 'RQ-01': 'Two' } });
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

/* ------------------------------------------------------------ cached totals */

/* `total`, `cost` and `items` feed the hub's "hours in play" and the sheet's readable columns.
   Nothing kept them current after the move to TypeScript, so both read zero beside cards that
   showed real hours. */
describe('the totals each deal caches', () => {
  const item = (id: string, first: number): Solution => ({
    id, name: `Solution ${id}`, desc: '', form: 'Integration', status: 'Production', deploy: '', first,
    repeat: null, build: null, saving: null, account: null, integrations: null, notes: null, ref: null,
    category: 'Core Platform', subCategory: null
  });
  const book: Catalog = {
    meta: { title: 'Mine', subtitle: '', compiled: '', totals: { features: 2, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 }, notes: [] },
    bundles: [
      {
        id: 'B01', name: 'One', pitch: '', offerWhen: '', featureCount: 2, buildHrs: null, firstHrs: null, repeatHrs: null,
        saved: null, noEstimate: 0, inDev: 0, accounts: null, pairsWith: null, items: [item('OX-1', 40), item('OX-2', 60)]
      }
    ]
  };

  it('writes the totals it is handed onto each deal', () => {
    const state = workspace({ estimations: [estimation('EST-1'), estimation('EST-2')] });
    const next = reducer(state, { type: 'cacheTotals', totals: { 'EST-2': { total: 80, cost: 4800, items: 2 } } });

    expect(next.estimations[1]).toMatchObject({ total: 80, cost: 4800, items: 2 });
    /* a deal it was not given totals for is left exactly as it was */
    expect(next.estimations[0]).toBe(state.estimations[0]);
    /* a recount is not an edit, so it must not jump the deal to the top of the hub */
    expect(next.estimations[1]?.up).toBe(state.estimations[1]?.up);
  });

  it('returns the same state when nothing moved, so caching cannot loop a render or a save', () => {
    const state = workspace({ estimations: [estimation('EST-1', { total: 80, cost: 4800, items: 2 })] });
    expect(reducer(state, { type: 'cacheTotals', totals: { 'EST-1': { total: 80, cost: 4800, items: 2 } } })).toBe(state);
    expect(reducer(state, { type: 'cacheTotals', totals: { 'EST-404': { total: 1, cost: 1, items: 1 } } })).toBe(state);
  });

  it('prices the open deal from its live draft and every other deal from its snapshot', () => {
    const state = workspace({
      estimations: [
        estimation('EST-1', { snap: { ...EMPTY_SNAPSHOT, sel: { 'OX-1': true } } }),
        estimation('EST-2', { snap: { ...EMPTY_SNAPSHOT, sel: { 'OX-1': true, 'OX-2': true } } }),
        estimation('EST-3', { plat: 'moodle', snap: { ...EMPTY_SNAPSHOT, sel: { 'OX-2': true } } })
      ],
      requests: [request('RQ-01', { estId: 'EST-2', est: 20 })],
      openEstimation: 'EST-1',
      draft: { ...EMPTY_SNAPSHOT, sel: { 'OX-2': true } }
    });

    const totals = platformTotals(state, book);

    /* the draft picked OX-2, not the committed OX-1 */
    expect(totals['EST-1']).toMatchObject({ total: 60, items: 1 });
    /* the desk's returned hours count toward the deal they belong to */
    expect(totals['EST-2']).toMatchObject({ total: 120, items: 2 });
    /* another platform's deal is priced against its own catalog, not this one */
    expect(totals['EST-3']).toBeUndefined();
  });

  it('only trusts a real catalog, so a slow sheet cannot write zeros over real totals', () => {
    /* Open edX has no bundled copy: until its sheet loads, the catalog in play is an empty
       stand-in, and every deal priced against it would come out at 0 h */
    expect(catalogReady(workspace({ platform: 'openedx' }))).toBe(false);
    expect(catalogReady(workspace({ platform: 'openedx', loadedCatalogs: { openedx: book } }))).toBe(true);
    /* the sample platforms ship benchmark hours, which are what their cards show */
    expect(catalogReady(workspace({ platform: 'moodle' }))).toBe(true);
    expect(catalogReady(workspace({ platform: '' }))).toBe(false);
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

/* ------------------------------------------------------------------ tenders */

describe('tenders', () => {
  const doc: TenderDocument = { n: 1, name: 'Acme RFP.pdf', kind: 'pdf', bytes: 1000, pages: 30, fileId: 'file_1', expiresAt: '2026-10-01T00:00:00Z' };
  const input: NewTenderInput = {
    plat: 'openedx',
    name: 'Acme Academy tender',
    client: 'Acme Academy',
    due: '2026-11-30',
    summary: 'A new LMS',
    docs: [doc],
    fit: null,
    outline: [],
    tokens: NO_TOKENS
  };
  const found = (text: string, page = 2): ExtractedRequirement => ({ doc: 1, page, section: 'Scope', text, quote: `"${text}"`, priority: 'must', outOfScope: false });
  const aMatch = (over: Partial<RequirementMatch> = {}): RequirementMatch => ({
    kind: 'catalog',
    solutionIds: ['SSO-1'],
    confidence: 'high',
    reason: 'Covered',
    remainder: '',
    area: '',
    integrations: '',
    approved: false,
    ...over
  });

  /** A tender with three requirements read from its first range. */
  const withTender = (): AppState =>
    run(
      workspace(),
      { type: 'createTender', id: 'TND-1', input },
      { type: 'rangeDone', id: 'TND-1', key: '1:1-20', found: [found('Single sign-on'), found('Grade export', 9), found('Hardware for labs', 4)], tokens: { input: 100, output: 50 } }
    );
  const tender = (state: AppState): Tender => {
    const one = state.tenders.find((candidate) => candidate.id === 'TND-1');
    if (!one) throw new Error('no tender');
    return one;
  };
  const reqIds = (state: AppState): string[] => tender(state).reqs.map((req) => req.id);

  it('creates a tender on its platform with its extraction planned, without opening anything', () => {
    const state = run(workspace(), { type: 'createTender', id: 'TND-1', input });
    expect(tender(state).ranges.map((range) => range.key)).toEqual(['1:1-20', '1:21-30']);
    expect(tender(state).stage).toBe('requirements');
    expect(state.openTender).toBeNull();
    /* the same id twice is a double click, not a second tender */
    expect(run(state, { type: 'createTender', id: 'TND-1', input }).tenders).toHaveLength(1);
  });

  it('adds what a range found, marks the range done and counts its tokens', () => {
    const state = withTender();
    expect(reqIds(state)).toEqual(['R-01', 'R-03', 'R-02']);
    expect(tender(state).ranges[0]).toMatchObject({ status: 'done', found: 3 });
    expect(tender(state).tokens).toMatchObject({ input: 100, output: 50 });
  });

  it('ignores a second answer for a range that is already done', () => {
    /* a slow duplicate call must not add the same requirements twice */
    const state = withTender();
    expect(run(state, { type: 'rangeDone', id: 'TND-1', key: '1:1-20', found: [found('Something new')] })).toBe(state);
  });

  it('marks a failed range with its reason, and puts it back in the queue on retry', () => {
    const failed = run(withTender(), { type: 'rangeFailed', id: 'TND-1', key: '1:21-30', error: 'Rate limited', tokens: { input: 10 } });
    expect(tender(failed).ranges[1]).toMatchObject({ status: 'failed', error: 'Rate limited' });
    expect(tender(failed).tokens.input).toBe(110);
    const retried = run(failed, { type: 'retryRange', id: 'TND-1', key: '1:21-30' });
    expect(tender(retried).ranges[1]).toEqual({ key: '1:21-30', doc: 1, from: 21, to: 30, status: 'pending' });
  });

  it('splits a range one call could not finish, and gives up with a reason at a single page', () => {
    const split = run(withTender(), { type: 'splitRange', id: 'TND-1', key: '1:21-30' });
    expect(tender(split).ranges.map((range) => range.key)).toEqual(['1:1-20', '1:21-25', '1:26-30']);

    const narrow = run(workspace(), { type: 'createTender', id: 'TND-1', input: { ...input, docs: [{ ...doc, pages: 1 }] } }, { type: 'splitRange', id: 'TND-1', key: '1:1-1' });
    expect(tender(narrow).ranges[0]).toMatchObject({ status: 'failed' });
    expect(tender(narrow).ranges[0]?.error).toContain('by hand');
  });

  it('leaves out what the fit step skipped, and reads it when a person asks', () => {
    const outline = [
      { doc: 1, title: 'Scope', from: 1, to: 24 },
      { doc: 1, title: 'Pricing forms', from: 25, to: 30, skip: true }
    ];
    const created = run(workspace(), { type: 'createTender', id: 'TND-1', input: { ...input, outline } });
    /* 25 is the margin page; 26 to 30 are not read */
    expect(tender(created).ranges.map((range) => range.key)).toEqual(['1:1-20', '1:21-25']);

    const asked = run(created, { type: 'readSection', id: 'TND-1', index: 1 });
    expect(tender(asked).outline[1]).toEqual({ doc: 1, title: 'Pricing forms', from: 25, to: 30 });
    expect(tender(asked).ranges.slice(2)).toEqual([{ key: '1:26-30', doc: 1, from: 26, to: 30, status: 'pending' }]);
    /* asking twice, or for a section that is read already, queues nothing: each call is paid for */
    expect(run(asked, { type: 'readSection', id: 'TND-1', index: 1 })).toBe(asked);
    expect(run(created, { type: 'readSection', id: 'TND-1', index: 0 })).toBe(created);
    expect(run(created, { type: 'readSection', id: 'TND-1', index: 7 })).toBe(created);
  });

  it('approves, removes and restores requirements in bulk', () => {
    const approved = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01', 'R-02'], status: 'approved' });
    expect(tender(approved).reqs.filter((req) => req.status === 'approved').map((req) => req.id)).toEqual(['R-01', 'R-02']);
    const removed = run(approved, { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-03'], status: 'removed' });
    expect(tender(removed).reqs.find((req) => req.id === 'R-03')?.status).toBe('removed');
    /* nothing to change is not an edit */
    expect(run(removed, { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-03'], status: 'removed' })).toBe(removed);
  });

  it('adds a requirement a person wrote as already approved, and ignores a blank one', () => {
    const state = run(withTender(), { type: 'addRequirement', id: 'TND-1', input: { text: '  Offline mobile access ', section: 'Mobile', priority: 'should' } });
    const added = tender(state).reqs.find((req) => req.text === 'Offline mobile access');
    expect(added).toMatchObject({ id: 'R-04', status: 'approved', edited: true, doc: 0, page: 0, quote: '' });
    /* added by hand, so it sorts after everything read from the documents */
    expect(reqIds(state).at(-1)).toBe('R-04');
    expect(run(state, { type: 'addRequirement', id: 'TND-1', input: { text: '   ', section: '', priority: 'must' } })).toBe(state);
  });

  it('drops the match of a requirement whose wording or scope changes, but not for a priority flip', () => {
    const matched = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01'], status: 'approved' }, { type: 'setMatches', id: 'TND-1', matches: { 'R-01': aMatch() } });
    const flipped = run(matched, { type: 'editRequirement', id: 'TND-1', reqId: 'R-01', patch: { priority: 'should' } });
    expect(tender(flipped).reqs[0]?.match).toBeDefined();
    expect(tender(flipped).reqs[0]?.edited).toBe(true);

    const reworded = run(matched, { type: 'editRequirement', id: 'TND-1', reqId: 'R-01', patch: { text: 'Single sign-on for staff only' } });
    expect(tender(reworded).reqs[0]?.match).toBeUndefined();
    const rescoped = run(matched, { type: 'editRequirement', id: 'TND-1', reqId: 'R-01', patch: { outOfScope: true } });
    expect(tender(rescoped).reqs[0]?.match).toBeUndefined();
  });

  it('merges requirements into the first one, keeping every quote', () => {
    const state = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-02'], status: 'approved' }, { type: 'combineRequirements', id: 'TND-1', reqIds: ['R-02', 'R-01'] });
    expect(reqIds(state)).toEqual(['R-01', 'R-03']);
    const merged = tender(state).reqs[0];
    expect(merged?.text).toBe('Single sign-on Grade export');
    expect(merged?.quote).toBe('"Single sign-on" / "Grade export"');
    /* one of them was approved, so the merged requirement is */
    expect(merged?.status).toBe('approved');
    expect(run(state, { type: 'combineRequirements', id: 'TND-1', reqIds: ['R-01'] })).toBe(state);
  });

  it('splits a requirement by copying it next to itself, with no match and a fresh id', () => {
    const matched = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01'], status: 'approved' }, { type: 'setMatches', id: 'TND-1', matches: { 'R-01': aMatch() } });
    const state = run(matched, { type: 'duplicateRequirement', id: 'TND-1', reqId: 'R-01' });
    expect(reqIds(state)).toEqual(['R-01', 'R-04', 'R-03', 'R-02']);
    expect(tender(state).reqs[1]).toMatchObject({ text: 'Single sign-on', status: 'proposed', edited: true });
    expect(tender(state).reqs[1]?.match).toBeUndefined();
  });

  it('only matches approved requirements, so one removed while matching ran stays unmatched', () => {
    const state = run(
      withTender(),
      { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01'], status: 'approved' },
      { type: 'setMatches', id: 'TND-1', matches: { 'R-01': aMatch(), 'R-02': aMatch() }, tokens: { output: 5 } }
    );
    expect(tender(state).reqs.find((req) => req.id === 'R-01')?.match).toBeDefined();
    expect(tender(state).reqs.find((req) => req.id === 'R-02')?.match).toBeUndefined();
    expect(tender(state).tokens.output).toBe(55);
  });

  it('records a person changing a match, but not a person accepting it', () => {
    const matched = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01'], status: 'approved' }, { type: 'setMatches', id: 'TND-1', matches: { 'R-01': aMatch() } });
    const accepted = run(matched, { type: 'approveMatches', id: 'TND-1', reqIds: ['R-01'], approved: true });
    expect(tender(accepted).reqs[0]?.match).toMatchObject({ approved: true });
    expect(tender(accepted).reqs[0]?.match?.edited).toBeFalsy();

    const changed = run(accepted, { type: 'editMatch', id: 'TND-1', reqId: 'R-01', patch: { kind: 'partial', remainder: 'SCIM' } });
    expect(tender(changed).reqs[0]?.match).toMatchObject({ kind: 'partial', remainder: 'SCIM', edited: true, approved: true });

    const reworded = run(accepted, { type: 'editMatch', id: 'TND-1', reqId: 'R-01', patch: { draft: { title: 'Better title' } } });
    expect(tender(reworded).reqs[0]?.match?.edited).toBeFalsy();
  });

  it('lets a person set a match by hand where the AI has none', () => {
    const state = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-03'], status: 'approved' }, { type: 'editMatch', id: 'TND-1', reqId: 'R-03', patch: { kind: 'out' } });
    expect(tender(state).reqs.find((req) => req.id === 'R-03')?.match).toMatchObject({ kind: 'out', edited: true, approved: false, reason: 'Set by hand.' });
  });

  it('clears matches so they can be asked for again', () => {
    const matched = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01'], status: 'approved' }, { type: 'setMatches', id: 'TND-1', matches: { 'R-01': aMatch() } });
    const cleared = run(matched, { type: 'clearMatches', id: 'TND-1', reqIds: ['R-01'] });
    expect(tender(cleared).reqs[0]?.match).toBeUndefined();
    expect(run(cleared, { type: 'clearMatches', id: 'TND-1', reqIds: ['R-01'] })).toBe(cleared);
  });

  it('creates the estimation with the accepted solutions picked, on the tender platform, and leaves it closed', () => {
    const state = run(withTender(), { type: 'applyTender', id: 'TND-1', input: { name: 'Acme deal', client: 'Acme Academy', tag: 'Active', due: '2026-11-30' }, solutionIds: ['SSO-1', 'AS-1'] });
    const created = state.estimations.find((one) => one.name === 'Acme deal');
    expect(created?.snap.sel).toEqual({ 'SSO-1': true, 'AS-1': true });
    expect(created?.plat).toBe('openedx');
    expect(tender(state).estId).toBe(created?.id);
    /* the desk requests are the second confirmation, so nothing navigates away yet */
    expect(state.openEstimation).toBeNull();
    /* applying twice does not make a second deal */
    expect(run(state, { type: 'applyTender', id: 'TND-1', input: { name: 'Again', client: '', tag: 'Active', due: '' }, solutionIds: [] })).toBe(state);
  });

  it('sends desk requests once, attached to the estimation, and never twice for one requirement', () => {
    const applied = run(withTender(), { type: 'applyTender', id: 'TND-1', input: { name: 'Acme deal', client: 'Acme Academy', tag: 'Active', due: '' }, solutionIds: [] });
    const draft = (reqId: string): DeskDraft => ({ reqId, kind: 'custom', title: `Custom ${reqId}`, details: 'Details', area: 'Assessment', integrations: '', source: '', skip: false, sent: false });
    const contact = { name: 'Sara', email: 'sara@edly.io', org: 'Edly' };

    const sent = run(applied, { type: 'sendTenderRequests', id: 'TND-1', drafts: [draft('R-01'), draft('R-02')], contact });
    const made = sent.requests.filter((one) => one.tender === 'TND-1');
    expect(made.map((one) => one.tenderReq)).toEqual(['R-01', 'R-02']);
    expect(made[0]?.estId).toBe(tender(applied).estId);
    expect(made[0]?.est).toBeUndefined();
    expect(tender(sent).stage).toBe('done');
    expect(tender(sent).sentAt).not.toBe('');

    /* the screen offers R-01 again after a back-and-forth: the reducer still refuses it */
    const again = run(sent, { type: 'sendTenderRequests', id: 'TND-1', drafts: [draft('R-01'), draft('R-03')], contact });
    expect(again.requests.filter((one) => one.tender === 'TND-1').map((one) => one.tenderReq)).toEqual(['R-01', 'R-02', 'R-03']);
    expect(sentRequirementIds(again, 'TND-1')).toEqual(new Set(['R-01', 'R-02', 'R-03']));
  });

  it('sends nothing before the estimation exists', () => {
    const state = withTender();
    expect(run(state, { type: 'sendTenderRequests', id: 'TND-1', drafts: [], contact: { name: '', email: '', org: '' } })).toBe(state);
  });

  it('lets the tender be applied again when its estimation is deleted', () => {
    const applied = run(withTender(), { type: 'applyTender', id: 'TND-1', input: { name: 'Acme deal', client: '', tag: 'Active', due: '' }, solutionIds: [] }, { type: 'patchTender', id: 'TND-1', patch: { stage: 'done' } });
    const state = run(applied, { type: 'deleteEstimation', id: tender(applied).estId });
    expect(tender(state)).toMatchObject({ estId: '', sentAt: '', stage: 'apply' });
  });

  it('forgets the file ids that were deleted at Anthropic', () => {
    const state = run(withTender(), { type: 'forgetTenderFiles', id: 'TND-1', fileIds: ['file_1'] });
    expect(tender(state).docs[0]?.fileId).toBe('');
    expect(run(state, { type: 'forgetTenderFiles', id: 'TND-1', fileIds: ['file_1'] })).toBe(state);
  });

  it('closes a tender that is deleted while open', () => {
    const open = { ...withTender(), openTender: 'TND-1' };
    const state = run(open, { type: 'deleteTender', id: 'TND-1' });
    expect(state.tenders).toEqual([]);
    expect(state.openTender).toBeNull();
  });

  it('closes the tender when an estimation opens, the platform changes or someone signs out', () => {
    const open = { ...withTender(), estimations: [estimation('EST-1')], openTender: 'TND-1' };
    expect(run(open, { type: 'openEstimation', id: 'EST-1' }).openTender).toBeNull();
    expect(run(open, { type: 'createEstimation', input: { name: 'New', client: '', tag: 'Active', due: '' } }).openTender).toBeNull();
    expect(run(open, { type: 'choosePlatform', practice: 'edtech', platform: 'moodle' }).openTender).toBeNull();
    expect(run(open, { type: 'signOut' }).openTender).toBeNull();
    expect(run(open, { type: 'signIn', user: 'admin', role: 'sales' }).openTender).toBeNull();
  });

  it('does not let a late match reply replace a match a person set while it was out', () => {
    /* found in review: the person set R-01 by hand while matching ran, and the reply put the AI's back */
    const asked = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01', 'R-02'], status: 'approved' });
    const texts = { 'R-01': 'Single sign-on', 'R-02': 'Grade export' };
    const byHand = run(asked, { type: 'editMatch', id: 'TND-1', reqId: 'R-01', patch: { kind: 'out' } });
    const late = run(byHand, { type: 'setMatches', id: 'TND-1', matches: { 'R-01': aMatch(), 'R-02': aMatch() }, texts });
    expect(tender(late).reqs.find((req) => req.id === 'R-01')?.match).toMatchObject({ kind: 'out', edited: true });
    /* the one nobody touched still takes the answer */
    expect(tender(late).reqs.find((req) => req.id === 'R-02')?.match?.kind).toBe('catalog');
  });

  it('drops a match made for wording that has since changed', () => {
    const asked = run(withTender(), { type: 'setRequirementStatus', id: 'TND-1', reqIds: ['R-01'], status: 'approved' });
    const reworded = run(asked, { type: 'editRequirement', id: 'TND-1', reqId: 'R-01', patch: { text: 'Single sign-on for staff only' } });
    const late = run(reworded, { type: 'setMatches', id: 'TND-1', matches: { 'R-01': aMatch() }, texts: { 'R-01': 'Single sign-on' } });
    /* left unmatched, so the match step offers to ask again about the new wording */
    expect(tender(late).reqs.find((req) => req.id === 'R-01')?.match).toBeUndefined();
  });

  it('claims ranges for a tab, and never claims one that is finished or failed', () => {
    const failed = run(withTender(), { type: 'rangeFailed', id: 'TND-1', key: '1:21-30', error: 'x' });
    expect(run(failed, { type: 'claimRanges', id: 'TND-1', keys: ['1:1-20', '1:21-30'], claim: { at: 5, by: 'tab-a' } })).toBe(failed);

    const fresh = run(workspace(), { type: 'createTender', id: 'TND-1', input });
    const claimed = run(fresh, { type: 'claimRanges', id: 'TND-1', keys: ['1:21-30'], claim: { at: 5, by: 'tab-a' } });
    expect(tender(claimed).ranges[1]).toMatchObject({ status: 'running', startedAt: 5, by: 'tab-a' });
    expect(tender(claimed).ranges[0]?.status).toBe('pending');
    /* the answer finishes a claimed range as it does a pending one */
    const done = run(claimed, { type: 'rangeDone', id: 'TND-1', key: '1:21-30', found: [found('Offline mobile', 22)] });
    expect(tender(done).ranges[1]).toEqual({ key: '1:21-30', doc: 1, from: 21, to: 30, status: 'done', found: 1 });
  });

  it('hands a retried or split range straight to the tab that asked, so no other tab sees it unclaimed', () => {
    const failed = run(withTender(), { type: 'rangeFailed', id: 'TND-1', key: '1:21-30', error: 'Rate limited' });
    const retried = run(failed, { type: 'retryRange', id: 'TND-1', key: '1:21-30', claim: { at: 7, by: 'tab-a' } });
    expect(tender(retried).ranges[1]).toEqual({ key: '1:21-30', doc: 1, from: 21, to: 30, status: 'running', startedAt: 7, by: 'tab-a' });

    const split = run(withTender(), { type: 'splitRange', id: 'TND-1', key: '1:21-30', claim: { at: 8, by: 'tab-a' } });
    expect(tender(split).ranges.slice(1)).toEqual([
      { key: '1:21-25', doc: 1, from: 21, to: 25, status: 'running', startedAt: 8, by: 'tab-a' },
      { key: '1:26-30', doc: 1, from: 26, to: 30, status: 'running', startedAt: 8, by: 'tab-a' }
    ]);
  });

  it('keeps tenders to their platform and persists them with the rest', () => {
    const state = { ...withTender(), tenders: [...withTender().tenders, { ...tender(withTender()), id: 'TND-2', plat: 'moodle', slug: 'elsewhere' }] };
    expect(platformTenders(state).map((one) => one.id)).toEqual(['TND-1']);
    expect(findTender(state, 'acme-academy-tender')?.id).toBe('TND-1');
    expect(findTender(state, 'tnd-1')?.id).toBe('TND-1');
    expect(findTender(state, 'elsewhere')).toBeNull();
    expect(findTender(state, '  ')).toBeNull();
    expect(openTenderRecord({ ...state, openTender: 'TND-1' })?.id).toBe('TND-1');
    expect(toPersisted(state).tenders).toHaveLength(2);
  });
});

/* ------------------------------------------------------------ imports */

const row = (n: number, over: Partial<EstimateRow> = {}): EstimateRow => ({
  row: n + 1,
  sourceId: '',
  name: `Estimate ${n}`,
  desc: '',
  first: 10 * n,
  repeat: null,
  client: 'Nordic University',
  bundleId: '',
  area: '',
  category: '',
  subCategory: '',
  form: '',
  deploy: '',
  integrations: '',
  account: '',
  notes: '',
  estBy: '',
  estAt: '',
  ...over
});

const onScreen = [
  { id: 'B01', name: 'Commerce & Monetization' },
  { id: 'B15', name: 'Platform Engineering & Integrations' }
];

describe('importing estimates from a workbook', () => {
  const imported = (state: AppState, rows: EstimateRow[], file = 'nordic.xlsx'): AppState =>
    reducer(state, { type: 'importEstimates', rows, file, catalogBundles: onScreen });

  it('adds each row as an estimate on the platform in play, marked with the file it came from', () => {
    const next = imported(workspace({ platform: 'moodle' }), [row(1), row(2)]);

    expect(next.solutions.map((one) => one.id)).toEqual(['CS-01', 'CS-02']);
    expect(next.solutions[0]).toMatchObject({ plat: 'moodle', imported: 'nordic.xlsx', client: 'Nordic University', first: 10, direct: false, from: '' });
  });

  it('prices a blank repeat at the first-delivery hours, as the desk does', () => {
    const next = imported(workspace(), [row(3), row(4, { repeat: 12 })]);
    expect(next.solutions.map((one) => one.repeat)).toEqual([30, 12]);
  });

  it('updates an earlier import instead of adding the same estimate twice', () => {
    const once = imported(workspace(), [row(1, { sourceId: 'NU-1' }), row(2)]);
    const twice = imported(once, [row(1, { sourceId: 'NU-1', first: 99 }), row(2, { first: 7 })]);

    /* the ids stay, so a deal that selected CS-01 still has it selected, at the new hours */
    expect(twice.solutions.map((one) => [one.id, one.first])).toEqual([
      ['CS-01', 99],
      ['CS-02', 7]
    ]);
  });

  it('never overwrites an estimate the desk priced from a request, even with the same name', () => {
    const desk = run(workspace(), { type: 'addSolution', input: { ...submission, name: 'Estimate 1', desc: '', first: 20, repeat: 6 } });
    const next = imported(desk, [row(1, { client: '' })]);

    expect(next.solutions).toHaveLength(2);
    expect(next.solutions[0]).toMatchObject({ id: 'CS-01', first: 20, direct: true });
    expect(next.solutions[1]).toMatchObject({ id: 'CS-02', imported: 'nordic.xlsx' });
  });

  it('files a row by its Bundle ID, then by its Area, and makes a bundle for an Area nobody has', () => {
    const next = imported(workspace(), [
      row(1, { bundleId: 'b15' }),
      row(2, { area: 'commerce & monetization' }),
      row(3, { area: 'Mobile Apps' }),
      row(4, { area: 'mobile apps' })
    ]);

    /* the new bundle continues the catalog's B numbers: B15 is the last on screen */
    expect(next.solutions.map((one) => one.bundleId)).toEqual(['B15', 'B01', 'B16', 'B16']);
    expect(next.bundles).toEqual([expect.objectContaining({ id: 'B16', name: 'Mobile Apps', plat: 'openedx', imported: 'nordic.xlsx' })]);
  });

  it('puts a row with no bundle and no area in Unassigned, for the desk to file', () => {
    const next = imported(workspace(), [row(1)]);
    expect(next.solutions[0]?.bundleId).toBe('CX');
    expect(next.bundles).toHaveLength(0);
  });

  it('keeps the desk\'s filing when the same row comes in again without a bundle', () => {
    const filed = run(imported(workspace(), [row(1)]), { type: 'moveSolutions', ids: ['CS-01'], bundleId: 'B15' });
    const again = imported(filed, [row(1, { first: 11 })]);

    expect(again.solutions[0]).toMatchObject({ bundleId: 'B15', first: 11 });
  });

  it('saves only what the review approved, where the person put it', () => {
    const review = setRow(
      setGroup(setGroup(EMPTY_REVIEW, toNew('Mobile Apps'), { status: 'approved', name: 'Mobile Learning' }), TO_UNASSIGNED, { status: 'approved', to: toBundle('B15') }),
      '3',
      { skip: true }
    );
    const next = reducer(workspace(), {
      type: 'importEstimates',
      rows: [row(1, { area: 'Mobile Apps' }), row(2, { area: 'Mobile Apps' }), row(3), row(4, { area: 'Gamification' })],
      file: 'nordic.xlsx',
      catalogBundles: onScreen,
      review
    });

    /* sheet row 3 (Estimate 2) was left out, the unassigned one was sent to B15, and Gamification
       was never approved, so neither it nor its bundle is saved */
    expect(next.solutions.map((one) => [one.name, one.bundleId])).toEqual([
      ['Estimate 1', 'B16'],
      ['Estimate 3', 'B15']
    ]);
    expect(next.bundles.map((one) => one.name)).toEqual(['Mobile Learning']);
  });

  it('changes nothing when the review has approved nothing yet', () => {
    const state = workspace();
    expect(reducer(state, { type: 'importEstimates', rows: [row(1)], file: 'nordic.xlsx', catalogBundles: onScreen, review: EMPTY_REVIEW })).toBe(state);
  });

  it('does nothing for an empty import', () => {
    const state = workspace();
    expect(imported(state, [])).toBe(state);
  });
});

describe('undoing an import', () => {
  const state = run(
    workspace({ bundles: [{ id: 'CB-01', plat: 'openedx', name: 'Compliance', pitch: '', offerWhen: '', pairsWith: null, at: '' }] }),
    { type: 'importEstimates', rows: [row(1, { area: 'Mobile Apps' }), row(2)], file: 'nordic.xlsx', catalogBundles: onScreen },
    { type: 'importEstimates', rows: [row(3, { client: 'Acme Academy' })], file: 'acme.xlsx', catalogBundles: onScreen },
    { type: 'toggleSolution', id: 'CS-01' },
    { type: 'toggleSolution', id: 'CS-03' }
  );

  it('removes only that workbook\'s estimates and the bundles its Area column made', () => {
    const next = reducer(state, { type: 'removeImport', file: 'nordic.xlsx' });

    expect(next.solutions.map((one) => one.id)).toEqual(['CS-03']);
    /* the bundle the desk made by hand is not the import's to remove */
    expect(next.bundles.map((one) => one.id)).toEqual(['CB-01']);
  });

  it('takes its estimates out of the open selection, like removing one does', () => {
    const next = reducer(state, { type: 'removeImport', file: 'nordic.xlsx' });
    expect(next.draft.sel).toEqual({ 'CS-03': true });
  });

  it('keeps a bundle the import made once the desk has filed other work in it', () => {
    const desk = reducer(state, { type: 'addSolution', input: { ...submission, bundleId: 'B16', name: 'Push notifications', desc: '', first: 12, repeat: 4 } });
    const next = reducer(desk, { type: 'removeImport', file: 'nordic.xlsx' });

    /* CB-01 is a bundle made before the B numbering, and sits alongside the import's B16 */
    expect(next.bundles.map((one) => one.id)).toEqual(['CB-01', 'B16']);
  });

  it('leaves another platform\'s import of the same file alone', () => {
    const moodle = reducer(workspace({ platform: 'moodle' }), { type: 'importEstimates', rows: [row(1)], file: 'nordic.xlsx', catalogBundles: [] });
    const both = { ...state, solutions: [...state.solutions, ...moodle.solutions.map((one) => ({ ...one, id: 'CS-09' }))] };
    const next = reducer(both, { type: 'removeImport', file: 'nordic.xlsx' });

    expect(next.solutions.map((one) => [one.id, one.plat])).toEqual([
      ['CS-03', 'openedx'],
      ['CS-09', 'moodle']
    ]);
  });

  it('does nothing for a file it never imported', () => {
    expect(reducer(state, { type: 'removeImport', file: 'nothing.xlsx' })).toBe(state);
  });
});

describe('filing estimates under a bundle', () => {
  const state = reducer(workspace(), { type: 'importEstimates', rows: [row(1), row(2)], file: 'nordic.xlsx', catalogBundles: onScreen });

  it('moves the named estimates and nothing else', () => {
    const next = reducer(state, { type: 'moveSolutions', ids: ['CS-02'], bundleId: 'B01' });
    expect(next.solutions.map((one) => one.bundleId)).toEqual(['CX', 'B01']);
  });

  it('refuses a move to no bundle at all', () => {
    expect(reducer(state, { type: 'moveSolutions', ids: ['CS-01'], bundleId: '' })).toBe(state);
  });
});

describe('where the catalog came from after a bundles workbook', () => {
  const file = { name: 'Mobile bundles.xlsx', hash: 'h-new' };

  it('starts the record again from the file when the catalog is replaced', () => {
    expect(sourceAfterImport({ source: 'auto', name: 'https://edly.example/catalog-source.xlsx', hash: 'h-served' }, file, 'replace', '2026-09-27')).toEqual({
      source: 'file',
      name: 'Mobile bundles.xlsx',
      hash: 'h-new',
      at: '2026-09-27'
    });
  });

  it('lists an added file beside what the catalog was loaded from, rather than claiming the whole catalog came from it', () => {
    const added = sourceAfterImport({ source: 'auto', name: 'https://edly.example/catalog-source.xlsx', hash: 'h-served' }, file, 'add', '2026-09-27');
    const again = sourceAfterImport(added, { name: 'Analytics.xlsx', hash: 'h-3' }, 'add', '2026-09-28');

    expect(added).toMatchObject({ source: 'file', name: 'catalog-source.xlsx', added: ['Mobile bundles.xlsx'] });
    /* the served sheet's hash stays, so the "newer sheet" dot only lights when that sheet changes */
    expect(again).toMatchObject({ hash: 'h-served', added: ['Mobile bundles.xlsx', 'Analytics.xlsx'] });
    expect(catalogSourceLabel(workspace({ loadedCatalogs: { openedx: { meta: { title: '', subtitle: '', compiled: '', totals: { features: 0, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 }, notes: [] }, bundles: [] } }, catalogSource: again }))).toBe(
      'loaded from catalog-source.xlsx, plus Mobile bundles.xlsx, Analytics.xlsx'
    );
  });

  it('treats adding to nothing as loading the file', () => {
    expect(sourceAfterImport(null, file, 'add', '2026-09-27')).toEqual({ source: 'file', name: 'Mobile bundles.xlsx', hash: 'h-new', at: '2026-09-27' });
  });

  it('describes the base of this platform, not the one the workspace last loaded', () => {
    /* catalogSource is kept once per workspace, so on Moodle it can describe the Open edX sheet */
    const moodle = workspace({ platform: 'moodle', catalogSource: { source: 'auto', name: 'catalog-source.xlsx' } });
    expect(baseSourceOf(moodle)).toEqual({ source: 'file', name: 'the benchmark set' });
    expect(baseSourceOf(workspace({ platform: 'nonesuch' }))).toBeNull();
  });
});

describe('an imported catalog stays pinned', () => {
  const meta = { title: 'Mine', subtitle: '', compiled: '', totals: { features: 0, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 }, notes: [] };
  const imported: Catalog = { meta: { ...meta, loaded: { name: 'catalog-source.xlsx', hash: 'h-served', at: '2026-09-27', added: ['Accessibility.xlsx'] } }, bundles: [] };
  const served: Catalog = { meta, bundles: [] };

  it('through the platform choice every reload makes, so the served sheet does not replace it', () => {
    /* A reload starts with no platform and a deep link chooses one, which clears the workspace's
       catalog source. The pin used to live only there, so an imported catalog was replaced by the
       served sheet on every visit. */
    const reloaded = reducer(workspace({ platform: '', loadedCatalogs: { openedx: imported }, catalogSource: { source: 'file', name: 'catalog-source.xlsx' } }), {
      type: 'choosePlatform',
      practice: 'edtech',
      platform: 'openedx'
    });

    expect(catalogPin(reloaded.loadedCatalogs, reloaded.catalogSource, 'openedx')).toEqual({ pinned: true, hash: 'h-served' });
    expect(catalogSourceLabel(reloaded)).toBe('loaded from catalog-source.xlsx, plus Accessibility.xlsx');
    expect(baseSourceOf(reloaded)).toMatchObject({ source: 'file', name: 'catalog-source.xlsx', added: ['Accessibility.xlsx'] });
  });

  it('and through a visit to another platform', () => {
    const away = run(
      workspace({ loadedCatalogs: { openedx: imported } }),
      { type: 'choosePlatform', practice: 'edtech', platform: 'moodle' },
      { type: 'choosePlatform', practice: 'edtech', platform: 'openedx' }
    );
    expect(catalogPin(away.loadedCatalogs, away.catalogSource, 'openedx').pinned).toBe(true);
  });

  it('while a catalog the app read from the served sheet is not', () => {
    expect(catalogPin({ openedx: served }, { source: 'auto', name: 'catalog-source.xlsx', hash: 'h1' }, 'openedx')).toEqual({ pinned: false, hash: 'h1' });
    expect(catalogPin({}, null, 'openedx')).toEqual({ pinned: false });
  });

  it('keeps honouring the pins recorded before the catalog carried its own', () => {
    expect(catalogPin({ openedx: served }, { source: 'file', name: 'old.xlsx', hash: 'h-old' }, 'openedx')).toEqual({ pinned: true, hash: 'h-old' });
    expect(catalogPin({}, { source: 'builtin' }, 'openedx').pinned).toBe(true);
  });
});
