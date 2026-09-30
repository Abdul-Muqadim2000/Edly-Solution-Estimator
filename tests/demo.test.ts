import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Catalog, PersistedState, Solution } from '../src/types';
import { parseCatalogWorkbook } from '../src/lib/catalogSheet';
import { allSolutions, composeCatalog, solutionKind } from '../src/domain/catalog';
import { calcEstimate, ownedCatalogIds, roleLabel } from '../src/domain/estimate';
import { schedule } from '../src/domain/planner';
import { teamComposition } from '../src/domain/team';
import { DEFAULT_SHEET, sheetBlockers, taskBreakdown } from '../src/domain/taskBreakdown';
import {
  DEMO_ID,
  DEMO_SLUG,
  demoPart,
  demoRecords,
  isDemoEstimation,
  isDemoId,
  isDemoItem,
  isDemoRequest,
  isDemoSolution,
  mondayFrom,
  resetDemo,
  shiftDay,
  withDemo,
  withoutDemo
} from '../src/domain/demo';
import { today } from '../src/lib/format';

/**
 * The demo estimation is the example everyone learns the tool from, so it is checked the way a
 * person would look at it: priced against the master sheet we ship, then planned, staffed and laid
 * out as the client's Excel sheet, through the same functions the screens use. A number here that
 * does not add up is one a newcomer would copy.
 *
 * It must also never be stored. Those rules are the second half of this file; the reducer's own
 * cases are in tests/reducer.test.ts.
 */

const TODAY = today();
let master: Catalog;

beforeAll(async () => {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../public/catalog-source.xlsx', import.meta.url))));
  master = (await parseCatalogWorkbook(bytes)).catalog;
});

/** The demo as the builder shows it: its estimates in the catalog, priced, planned and staffed. */
function built(on = TODAY) {
  const demo = demoRecords(on);
  const estimation = demo.estimations[0]!;
  const catalog = composeCatalog({ base: master, platform: 'openedx', added: demo.solutions, ownBundles: [] });
  const estimate = calcEstimate(catalog, estimation.snap, demo.requests);
  const plan = schedule(estimate, demo.requests, estimation.snap);
  return { demo, estimation, catalog, estimate, plan, team: teamComposition(estimate, estimation.snap, plan) };
}

const byId = (catalog: Catalog): Map<string, Solution> => new Map(allSolutions(catalog).map((item) => [item.id, item]));

/* ------------------------------------------------------ the deal itself */

describe('the demo estimation, against the master sheet we ship', () => {
  it('picks only solutions the master sheet has, from most of its bundles, and every one has hours', () => {
    const { estimation, estimate } = built();
    const picked = Object.keys(estimation.snap.sel);

    /* an id the sheet has dropped would vanish from the demo without a word */
    expect([...estimate.selIds].sort()).toEqual([...picked].sort());
    expect(picked.every((id) => byId(master).has(id))).toBe(true);
    /* wide on purpose: it is the one deal that shows most of the catalog */
    expect(estimate.groups.length).toBeGreaterThanOrEqual(12);
    /* no "not yet estimated" or "in development" caveat in the example everyone copies */
    expect(estimate.noEst).toBe(0);
    expect(estimate.inDev).toBe(0);
    expect(estimate.grand).toBeGreaterThan(0);
    expect(estimate.usd).toBeGreaterThan(0);
  });

  it('comes to a whole number of hours, as a total read out to a client should', () => {
    /* the line buffers are set so the base is 1,500 h against the sheet's figures (see LINES in
       domain/demo.ts); if the master sheet's hours change, set them again rather than drop this */
    const { estimate } = built();
    expect(Number.isInteger(estimate.grand)).toBe(true);
    expect(Number.isInteger(estimate.bufH) && Number.isInteger(estimate.pmH) && Number.isInteger(estimate.qaH)).toBe(true);
  });

  it('bills every hour at a role on its rate card, and nothing at the blended rate', () => {
    const { estimation, estimate } = built();
    const card = new Set((estimation.snap.roles ?? []).map((role) => role.id));

    expect(estimate.unassignedH).toBe(0);
    expect(estimate.roleRows.every((row) => row.assigned)).toBe(true);
    expect(Object.values(estimation.snap.lineRole ?? {}).every((id) => card.has(id))).toBe(true);
    /* overhead bills at the Project Manager's and the QA Engineer's rates, not the blend */
    expect(estimate.roleRows.find((row) => row.id === 'ov-pm')?.name).toBe('PM overhead · Senior Project Manager');
    expect(estimate.roleRows.find((row) => row.id === 'ov-qa')?.name).toBe('QA overhead · Mid-level QA Engineer');
  });

  it('shows what the rate card is for: one role at three levels, and one colour for each role', () => {
    const roles = demoRecords(TODAY).estimations[0]!.snap.roles ?? [];
    const engineers = roles.filter((role) => role.name === 'Engineer').map(roleLabel);

    expect(engineers).toEqual(['Senior Engineer', 'Mid-level Engineer', 'Junior Engineer']);
    /* seven role colours in theme.ts: an eighth role would share a colour with the first */
    expect(roles.length).toBeLessThanOrEqual(7);
    expect(roles.every((role) => role.level && role.rate > 0)).toBe(true);
    expect(new Set(roles.map((role) => role.id)).size).toBe(roles.length);
  });

  it('sends its custom work through the desk: every request priced, with notes written for the client', () => {
    const { demo, estimate } = built();
    const bundles = new Map(master.bundles.map((bundle) => [bundle.name, bundle.id]));
    const estimates = new Map(demo.solutions.map((solution) => [solution.id, solution]));

    expect(demo.requests.length).toBeGreaterThanOrEqual(5);
    expect(estimate.pend).toBe(0);
    expect(estimate.estSum).toBe(demo.requests.reduce((total, request) => total + (request.est ?? 0), 0));
    for (const request of demo.requests) {
      expect(request.estId).toBe(DEMO_ID);
      expect(request.est).toBeGreaterThan(0);
      expect(request.repeatEst).toBeLessThanOrEqual(request.est ?? 0);
      expect(request.estBy).toBeTruthy();
      expect(request.catNotes).toBeTruthy();
      /* the Excel sheet files a request under the bundle its area names */
      expect(bundles.get(request.area)).toBe(request.catBundle);
      /* and the desk's estimate is the same work, reusable, in the same bundle */
      const reusable = estimates.get(request.csId ?? '');
      expect(reusable).toMatchObject({ first: request.est, repeat: request.repeatEst, bundleId: request.catBundle, notes: request.catNotes, from: request.id });
    }
  });

  it('lists the desk’s work as estimates in the catalog, already billed through each request', () => {
    const { demo, estimation, catalog, estimate } = built();
    const owned = ownedCatalogIds(demo.requests);

    for (const solution of demo.solutions) {
      const listed = byId(catalog).get(solution.id);
      expect(listed && solutionKind(listed)).toBe('estimates');
      expect(owned[solution.id]).toBe(solution.from);
    }
    /* ticking one in the catalog must not bill its hours a second time */
    const ticked = { ...estimation.snap, sel: { ...estimation.snap.sel, [demo.solutions[0]!.id]: true } };
    expect(calcEstimate(catalog, ticked, demo.requests).grand).toBe(estimate.grand);
  });

  it('plans every bar inside the team cap, with the risk buffer as contingency at the end', () => {
    const { plan } = built();
    const work = plan.tasks.filter((task) => task.kind !== 'buffer');
    const buffer = plan.tasks.find((task) => task.kind === 'buffer');

    expect(plan.over).toBe(false);
    expect(plan.peak).toBeLessThanOrEqual(plan.cap);
    expect(plan.tasks.every((task) => task.pinned)).toBe(true);
    expect(buffer?.start).toBe(Math.max(...work.map((task) => task.start + task.dur)));
    /* about a quarter's delivery, not a year's */
    expect(plan.end).toBeLessThanOrEqual(12);
    /* the rows read as a cascade, in start order */
    const starts = plan.tasks.map((task) => task.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('staffs its team sheet the way a real team is staffed, one person per lane', () => {
    const { estimate, team } = built();
    const people = Object.fromEntries(team.rows.map((row) => [`${row.level} ${row.role}`, row.people]));

    expect(people).toEqual({
      'Principal Solution Architect': 1,
      'Senior Engineer': 2,
      'Mid-level Engineer': 2,
      'Junior Engineer': 1,
      'Mid-level DevOps Engineer': 1,
      'Mid-level QA Engineer': 1,
      'Senior Project Manager': 1
    });
    expect(team.size).toBe(9);
    expect(team.rows.every((row) => row.roleId !== '')).toBe(true);
    /* the team sheet and the estimate are the same money */
    expect(team.hours).toBeCloseTo(estimate.grand, 6);
    expect(Math.round(team.cost)).toBe(estimate.usd);
  });

  it('fills the client’s Excel sheet, and its lines add up to the total the builder shows', () => {
    const { demo, estimation, catalog, estimate, plan } = built();
    const breakdown = taskBreakdown({ estimate, requests: demo.requests, plan, snap: estimation.snap, bundles: catalog.bundles, blendBuffer: false });
    const blocked = sheetBlockers(DEFAULT_SHEET, { blendBuffer: false, planned: plan.tasks.length, assigned: estimate.assignedH });

    expect(breakdown.totals.total).toBeCloseTo(estimate.grand, 2);
    expect(Math.round(breakdown.totals.totalCost)).toBe(estimate.usd);
    expect(breakdown.totals.unpriced).toBe(0);
    /* the team composition and delivery plan sheets are both in the file by default */
    expect(blocked.team).toBeUndefined();
    expect(blocked.timeline).toBeUndefined();
    expect(estimation.snap.sheet?.contact).toBeTruthy();
    expect(estimation.snap.sheet?.comments).toBeTruthy();
    /* each custom item sits in its bundle's deliverable, not in a catch-all at the end */
    const areaOf = new Map(breakdown.deliverables.flatMap((deliverable) => deliverable.lines.map((line) => [line.key, deliverable.area])));
    for (const request of demo.requests) expect(areaOf.get(request.id)).toBe(request.area);
  });

  it('writes its own line notes only where the catalog has none, so no caveat is lost', () => {
    /* a deal's note replaces the catalog's on the client's sheet, and the catalog's notes are
       caveats like "patched platform build" that the client must still read */
    const notes = demoRecords(TODAY).estimations[0]!.snap.sheet?.notes ?? {};
    expect(Object.keys(notes).length).toBeGreaterThan(0);
    for (const id of Object.keys(notes)) expect(byId(master).get(id)?.notes ?? '').toBe('');
  });

  it('is dated from today, so its deadline is always ahead and its plan starts on a Monday', () => {
    for (const day of [TODAY, '2026-12-31', '2027-02-28', '2026-10-04']) {
      const demo = demoRecords(day);
      const estimation = demo.estimations[0]!;
      const start = estimation.snap.planStart ?? '';

      expect(estimation.due > day).toBe(true);
      expect(estimation.at < day).toBe(true);
      expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1);
      /* the work starts after the proposal is due, never before */
      expect(start > estimation.due).toBe(true);
      for (const request of demo.requests) {
        expect(request.at >= estimation.at && request.at <= (request.estAt ?? '')).toBe(true);
        expect((request.estAt ?? '') <= day).toBe(true);
      }
      for (const item of demo.salesLegal) expect(item.due === '' || item.due > day).toBe(true);
    }
  });

  it('counts days in UTC, so a date never slips across midnight', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(mondayFrom('2026-10-05')).toBe('2026-10-05');
    expect(mondayFrom('2026-10-04')).toBe('2026-10-05');
    expect(mondayFrom('2026-10-06')).toBe('2026-10-12');
  });

  it('lists what it commits Edly to beyond software, for every team', () => {
    const items = demoRecords(TODAY).salesLegal;

    expect(new Set(items.map((item) => item.category))).toEqual(new Set(['sales', 'account', 'legal', 'people', 'certification']));
    expect(items.every((item) => item.estId === DEMO_ID && item.owner && item.text)).toBe(true);
    /* one already handled, so the panel shows both states */
    expect(items.some((item) => item.status === 'handled')).toBe(true);
    expect(items.filter((item) => item.kind === 'term').every((item) => item.topic)).toBe(true);
  });

  it('has a URL of its own that no deal named by a person is likely to take', () => {
    const estimation = demoRecords(TODAY).estimations[0]!;
    expect(estimation.id).toBe(DEMO_ID);
    expect(estimation.slug).toBe(DEMO_SLUG);
    expect(DEMO_SLUG.startsWith('demo-')).toBe(true);
  });
});

/* ------------------------------------------------------ which records are the demo's */

describe('which records are the demo’s', () => {
  it('knows a demo record by its id, and no real id can look like one', () => {
    for (const id of ['EST-DEMO', 'RQ-DEMO-01', 'CS-DEMO-12', 'SL-DEMO-03']) expect(isDemoId(id)).toBe(true);
    /* real ids: estimations are base36 in lower case, the rest are numbered */
    for (const id of ['EST-mujmb0sg', 'EST-demo', 'RQ-01', 'CS-07', 'SL-02', 'RQ-DEMO-x', 'B-DEMO', 'DEMO', '']) expect(isDemoId(id)).toBe(false);
    expect(isDemoId(undefined)).toBe(false);
    expect(isDemoId(null)).toBe(false);
  });

  it('counts a record as the demo’s by what it belongs to as well as by its id', () => {
    expect(isDemoEstimation({ id: DEMO_ID })).toBe(true);
    /* belt and braces: a request or item filed against the demo is the demo's, whatever its id */
    expect(isDemoRequest({ id: 'RQ-05', estId: DEMO_ID })).toBe(true);
    expect(isDemoItem({ id: 'SL-05', estId: DEMO_ID })).toBe(true);
    /* and an estimate the desk priced from a demo request */
    expect(isDemoSolution({ id: 'CS-09', from: 'RQ-DEMO-07' })).toBe(true);
    expect(isDemoRequest({ id: 'RQ-05', estId: 'EST-mujmb0sg' })).toBe(false);
    expect(isDemoSolution({ id: 'CS-09', from: 'RQ-05' })).toBe(false);
  });
});

/* ------------------------------------------------------ in memory, never stored */

const real = (): PersistedState => ({
  estimations: [{ ...demoRecords(TODAY).estimations[0]!, id: 'EST-real1', slug: 'acme-academy', name: 'Acme Academy' }],
  requests: [{ ...demoRecords(TODAY).requests[0]!, id: 'RQ-01', estId: 'EST-real1', csId: 'CS-01' }],
  solutions: [{ ...demoRecords(TODAY).solutions[0]!, id: 'CS-01', from: 'RQ-01' }],
  bundles: [],
  tenders: [],
  salesLegal: [{ ...demoRecords(TODAY).salesLegal[0]!, id: 'SL-01', estId: 'EST-real1' }],
  settings: {}
});

const withTheDemo = (state: PersistedState): PersistedState => {
  const demo = demoRecords(TODAY);
  return {
    ...state,
    estimations: [...state.estimations, ...demo.estimations],
    requests: [...state.requests, ...demo.requests],
    solutions: [...state.solutions, ...demo.solutions],
    salesLegal: [...state.salesLegal, ...demo.salesLegal]
  };
};

describe('keeping the demo in memory and out of storage', () => {
  it('takes every demo record out of what is saved, and nothing else', () => {
    const stored = withoutDemo(withTheDemo(real()));
    expect(stored).toEqual(real());
  });

  it('hands back the very same state when there is no demo in it, so nothing reads as changed', () => {
    const state = real();
    expect(withoutDemo(state)).toBe(state);
  });

  it('adds the prepared demo to a workspace that has none yet', () => {
    const next = withDemo({ ...real(), estimations: [], requests: [], solutions: [], salesLegal: [] }, real(), TODAY);
    expect(demoPart(next)).toEqual(demoRecords(TODAY));
    /* the real records are untouched, and stay first */
    expect(next.estimations[0]?.id).toBe('EST-real1');
  });

  it('puts the demo back into each collection a read replaced, as it stood in memory', () => {
    /* someone is trying the demo out: renamed it and changed a request's hours */
    const before = withTheDemo(real());
    const tried = {
      ...before,
      estimations: before.estimations.map((one) => (isDemoEstimation(one) ? { ...one, name: 'Tried' } : one)),
      requests: before.requests.map((one) => (one.id === 'RQ-DEMO-01' ? { ...one, est: 7 } : one))
    };
    /* a background read brings the store's copy, which never holds the demo */
    const next = withDemo(tried, { ...tried, ...real() }, TODAY);

    expect(next.estimations.find(isDemoEstimation)?.name).toBe('Tried');
    expect(next.requests.find((one) => one.id === 'RQ-DEMO-01')?.est).toBe(7);
    expect(withoutDemo(next)).toEqual(real());
  });

  it('returns the same object when no collection lost the demo', () => {
    const state = withTheDemo(real());
    expect(withDemo(state, state, TODAY)).toBe(state);
  });

  it('does not bring back demo records someone removed while trying it', () => {
    const state = withTheDemo(real());
    const cleared = { ...state, requests: state.requests.filter((one) => !isDemoRequest(one)) };
    const next = withDemo(cleared, { ...cleared, requests: real().requests }, TODAY);
    expect(next.requests.filter(isDemoRequest)).toEqual([]);
  });

  it('resets the demo: what was tried on it and what was made inside it go, and real records stay', () => {
    const state = withTheDemo(real());
    const tried = {
      ...state,
      estimations: state.estimations.map((one) => (isDemoEstimation(one) ? { ...one, name: 'Tried' } : one)),
      requests: [...state.requests, { ...state.requests[1]!, id: 'RQ-DEMO-07', title: 'Made inside the demo' }]
    };
    const reset = resetDemo(tried, TODAY);

    expect(demoPart(reset)).toEqual(demoRecords(TODAY));
    expect(withoutDemo(reset)).toEqual(real());
  });
});
