import { describe, expect, it } from 'vitest';
import {
  ALL_BUNDLES,
  basePath,
  deepLinkReady,
  exactly,
  formatRoute,
  homeOf,
  LANDING,
  platformTrail,
  parseRoute,
  readAddress,
  routeHref,
  sameRoute,
  usesHash,
  withoutSearch,
  type Route
} from '../src/lib/router';
import { slugify, uniqueSlug, withSlugs } from '../src/lib/format';
import { INITIAL_STATE, reducer, type Action, type AppState } from '../src/state/reducer';
import { routeOfState } from '../src/state/useRouting';
import type { Estimation, Tender } from '../src/types';

/**
 * The router is pure string work, which is the point: a broken link is invisible until someone
 * pastes one into a meeting, so it is tested here rather than clicked.
 */

const address = (pathname: string, search = '', hash = ''): { pathname: string; search: string; hash: string } => ({
  pathname,
  search,
  hash
});

describe('parseRoute', () => {
  it('reads the root as asking for nothing in particular', () => {
    expect(parseRoute('/')).toEqual({ screen: 'root' });
    expect(parseRoute('')).toEqual({ screen: 'root' });
  });

  it('reads the picker, with or without a practice', () => {
    expect(parseRoute('/practices')).toEqual({ screen: 'practices' });
    expect(parseRoute('/practices/edtech')).toEqual({ screen: 'practices', practice: 'edtech' });
  });

  it('reads the hub and the builder', () => {
    expect(parseRoute('/p/openedx')).toEqual({ screen: 'hub', platform: 'openedx' });
    expect(parseRoute('/p/openedx/e/acme-academy')).toEqual({
      screen: 'builder',
      platform: 'openedx',
      estimation: 'acme-academy'
    });
  });

  it('reads a bundle, the planner and a search off a builder link', () => {
    expect(parseRoute('/p/openedx/e/acme-academy/b/B03?q=sso&plan=1')).toEqual({
      screen: 'builder',
      platform: 'openedx',
      estimation: 'acme-academy',
      bundle: 'B03',
      q: 'sso',
      plan: true
    });
  });

  it('reads the desk, its tabs and an estimation page', () => {
    expect(parseRoute('/p/openedx/desk')).toEqual({ screen: 'desk', platform: 'openedx', tab: 'queue' });
    expect(parseRoute('/p/openedx/desk/add')).toEqual({ screen: 'desk', platform: 'openedx', tab: 'add' });
    expect(parseRoute('/p/openedx/desk/e/acme-academy')).toEqual({
      screen: 'desk',
      platform: 'openedx',
      estimation: 'acme-academy',
      tab: 'estimations'
    });
  });

  it('falls back to the root rather than throwing on a mangled link', () => {
    /* a truncated paste, or a hand-edited URL with a stray percent */
    expect(parseRoute('/p')).toEqual({ screen: 'root' });
    expect(parseRoute('/nonsense/deep/path')).toEqual({ screen: 'root' });
    expect(parseRoute('/p/openedx/e/%E0%A4%A')).toMatchObject({ screen: 'builder', platform: 'openedx' });
  });

  it('reads the bundles-or-estimates filter off a builder link', () => {
    expect(parseRoute('/p/openedx/e/acme-academy/b/all?kind=estimates')).toMatchObject({ bundle: 'all', kind: 'estimates' });
    expect(parseRoute('/p/openedx/e/acme-academy?kind=bundles').kind).toBe('bundles');
  });

  it('drops a filter it does not know, rather than filtering the catalog down to nothing', () => {
    expect(parseRoute('/p/openedx/e/acme-academy?kind=everything')).toEqual({ screen: 'builder', platform: 'openedx', estimation: 'acme-academy' });
  });

  it('ignores an unknown desk tab instead of showing a blank one', () => {
    expect(parseRoute('/p/openedx/desk/nope')).toEqual({ screen: 'desk', platform: 'openedx', tab: 'queue' });
  });
});

describe('formatRoute', () => {
  const cases: Route[] = [
    { screen: 'root' },
    { screen: 'practices' },
    { screen: 'practices', practice: 'edtech' },
    { screen: 'hub', platform: 'openedx' },
    { screen: 'builder', platform: 'openedx', estimation: 'acme-academy' },
    { screen: 'builder', platform: 'openedx', estimation: 'acme-academy', bundle: 'B03' },
    { screen: 'builder', platform: 'openedx', estimation: 'acme-academy', bundle: ALL_BUNDLES, q: 'sso', plan: true },
    { screen: 'builder', platform: 'openedx', estimation: 'acme-academy', bundle: ALL_BUNDLES, kind: 'estimates' },
    { screen: 'builder', platform: 'openedx', estimation: 'acme-academy', bundle: 'B03', q: 'sso', kind: 'bundles', plan: true },
    { screen: 'desk', platform: 'openedx', tab: 'queue' },
    { screen: 'desk', platform: 'openedx', tab: 'add' },
    { screen: 'desk', platform: 'openedx', estimation: 'acme-academy', tab: 'estimations' }
  ];

  it('round-trips every route back through the parser', () => {
    for (const route of cases) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
  });

  it('leaves the default desk tab out of the path', () => {
    expect(formatRoute({ screen: 'desk', platform: 'openedx', tab: 'queue' })).toBe('/p/openedx/desk');
  });

  it('keeps search and the planner off screens that have neither', () => {
    /* emitting them elsewhere would make format and parse disagree, and Back would misbehave */
    expect(formatRoute({ screen: 'hub', platform: 'openedx', q: 'sso', plan: true, kind: 'estimates' })).toBe('/p/openedx');
  });

  it('escapes a slug so a stray slash cannot invent a segment', () => {
    expect(formatRoute({ screen: 'builder', platform: 'openedx', estimation: 'a/b' })).toBe('/p/openedx/e/a%2Fb');
  });

  it('treats only the search box as a replace, so Back still leaves the planner', () => {
    const bundle = '/p/openedx/e/acme/b/B03';
    /* typing replaces: same destination, different filter */
    expect(withoutSearch(`${bundle}?q=sso`)).toBe(withoutSearch(bundle));
    expect(withoutSearch(`${bundle}?q=sso`)).toBe(withoutSearch(`${bundle}?q=gradebook`));
    /* the planner pushes: Back must close it and return you to the bundle, not past it */
    expect(withoutSearch(`${bundle}?plan=1`)).not.toBe(withoutSearch(bundle));
    /* and a planner opened over a search is still a push */
    expect(withoutSearch(`${bundle}?q=sso&plan=1`)).not.toBe(withoutSearch(`${bundle}?q=sso`));
    /* the kind filter is a click, not typing, so Back undoes it */
    expect(withoutSearch(`${bundle}?kind=estimates`)).not.toBe(withoutSearch(bundle));
  });

  it('compares two routes by the URL they produce', () => {
    expect(sameRoute({ screen: 'hub', platform: 'openedx' }, { screen: 'hub', platform: 'openedx' })).toBe(true);
    expect(sameRoute({ screen: 'hub', platform: 'openedx' }, { screen: 'hub', platform: 'moodle' })).toBe(false);
  });
});

describe('the browser side', () => {
  it('finds the mount point, with or without a sub-path', () => {
    expect(basePath('https://estimator.edly.io/')).toBe('/');
    expect(basePath('https://estimator.edly.io/index.html')).toBe('/');
    expect(basePath('https://example.com/tools/estimator/')).toBe('/tools/estimator/');
  });

  it('routes in the hash only where a rewrite cannot exist', () => {
    expect(usesHash('/')).toBe(false);
    expect(usesHash('/index.html')).toBe(false);
    expect(usesHash('/p/openedx/e/acme')).toBe(false);
    /* the no-toolchain runners in VERIFY.md, served by a plain static server */
    expect(usesHash('/public/verify-app.html')).toBe(true);
  });

  it('reads the current url under a sub-path', () => {
    expect(readAddress(address('/tools/estimator/p/openedx', '?q=sso'), '/tools/estimator/')).toBe('/p/openedx?q=sso');
    expect(readAddress(address('/p/openedx'), '/')).toBe('/p/openedx');
  });

  it('reads the current url out of the hash when that is where it lives', () => {
    expect(readAddress(address('/public/verify-app.html', '', '#/p/openedx/e/acme'), '/')).toBe('/p/openedx/e/acme');
    /* a bare anchor is not a route */
    expect(readAddress(address('/public/verify-app.html', '', '#top'), '/')).toBe('/');
  });

  it('builds a shareable href in both modes', () => {
    const route: Route = { screen: 'builder', platform: 'openedx', estimation: 'acme-academy' };
    expect(routeHref(route, address('/p/openedx'), '/', 'https://estimator.edly.io')).toBe(
      'https://estimator.edly.io/p/openedx/e/acme-academy'
    );
    expect(routeHref(route, address('/tools/app/'), '/tools/app/', 'https://x.io')).toBe(
      'https://x.io/tools/app/p/openedx/e/acme-academy'
    );
    expect(routeHref(route, address('/public/verify-app.html'), '/', '')).toBe(
      '/public/verify-app.html#/p/openedx/e/acme-academy'
    );
  });
});

describe('slugs', () => {
  it('makes a name safe for a URL and still readable', () => {
    expect(slugify('Acme Corporate Academy')).toBe('acme-corporate-academy');
    expect(slugify('  Nordic  University — Phase 2! ')).toBe('nordic-university-phase-2');
    expect(slugify('Café Röst')).toBe('cafe-rost');
  });

  it('is empty for a name with no letters or digits, so the caller can fall back', () => {
    expect(slugify('!!! ???')).toBe('');
  });

  it('never ends on a hyphen, even when the cap lands on one', () => {
    const slug = slugify(`${'a'.repeat(59)} tail`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('numbers a collision rather than reusing a URL', () => {
    expect(uniqueSlug('Acme', [], 'EST-1')).toBe('acme');
    expect(uniqueSlug('Acme', ['acme'], 'EST-1')).toBe('acme-2');
    expect(uniqueSlug('Acme', ['acme', 'acme-2'], 'EST-1')).toBe('acme-3');
  });

  it('falls back to the id when a name yields nothing', () => {
    expect(uniqueSlug('!!!', [], 'EST-7')).toBe('est-7');
  });

  it('backfills only what is missing, per platform', () => {
    const rows = [
      { id: 'EST-1', plat: 'openedx', name: 'Acme', slug: 'kept-on-purpose' },
      { id: 'EST-2', plat: 'openedx', name: 'Acme', slug: '' },
      { id: 'EST-3', plat: 'openedx', name: 'Acme', slug: '' },
      { id: 'EST-4', plat: 'moodle', name: 'Acme', slug: '' }
    ];
    const out = withSlugs(rows);
    /* an existing slug is never recomputed — renaming a deal must not break its link */
    expect(out[0]?.slug).toBe('kept-on-purpose');
    expect(out[1]?.slug).toBe('acme');
    expect(out[2]?.slug).toBe('acme-2');
    /* platforms are separate namespaces, exactly as estimations are */
    expect(out[3]?.slug).toBe('acme');
  });
});

/* ------------------------------------------------- the URL, applied to state */

const estimation = (id: string, plat: string, name: string, slug: string): Estimation => ({
  id,
  plat,
  name,
  slug,
  client: '',
  tag: 'Active',
  due: '',
  at: '2026-01-01',
  up: '2026-01-01',
  total: 0,
  cost: 0,
  items: 0,
  snap: { sel: {}, buf: {}, bufPct: 0 }
});

const workspace = (over: Partial<AppState> = {}): AppState => ({
  ...INITIAL_STATE,
  ready: true,
  auth: { user: 'admin', role: 'sales', at: 0 },
  practice: 'edtech',
  platform: 'openedx',
  estimations: [
    estimation('EST-1', 'openedx', 'Acme Academy', 'acme-academy'),
    estimation('EST-2', 'openedx', 'Nordic University', 'nordic-university'),
    estimation('EST-3', 'moodle', 'Elsewhere Entirely', 'elsewhere-entirely')
  ],
  ...over
});

const apply = (state: AppState, url: string): AppState => reducer(state, { type: 'applyRoute', route: parseRoute(url) });
const run = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, state);

describe('getting around', () => {
  it('sends each role to its own home on a platform', () => {
    expect(homeOf('sales', 'openedx')).toEqual({ screen: 'hub', platform: 'openedx' });
    expect(homeOf('estimator', 'openedx')).toEqual({ screen: 'desk', platform: 'openedx' });
  });

  it('keeps an estimator on the desk when they pick a platform', () => {
    /* the picker asked for the hub whoever you were, and a hub route means sales, so an estimator
       who signed in and picked Open edX was switched to sales and never saw the desk */
    const atPicker = workspace({ auth: { user: 'admin', role: 'estimator', at: 0 }, practice: 'edtech', platform: '' });
    expect(apply(atPicker, '/p/openedx').auth?.role).toBe('sales');
    const picked = reducer(atPicker, { type: 'applyRoute', route: homeOf('estimator', 'openedx') });
    expect(picked.auth?.role).toBe('estimator');
    expect(routeOfState(picked).screen).toBe('desk');
  });

  it('lays the trail above the hub as a link to the practice, then the platform you are on', () => {
    const trail = platformTrail('openedx', 'sales');
    expect(trail.map((crumb) => crumb.label)).toEqual(['EdTech / LMS', 'Open edX']);
    expect(trail[0]?.route && formatRoute(trail[0].route)).toBe('/practices/edtech');
    /* the page you are on is text, not a link to itself */
    expect(trail[1]?.route).toBeNull();
  });

  it('links the platform back to its home when there is a page below it', () => {
    const trail = platformTrail('openedx', 'sales', 'Tender');
    expect(trail.map((crumb) => crumb.label)).toEqual(['EdTech / LMS', 'Open edX', 'Tender']);
    expect(trail[1]?.route && formatRoute(trail[1].route)).toBe('/p/openedx');
    expect(trail[2]?.route).toBeNull();
    /* at the desk, the platform's home is the desk */
    const desk = platformTrail('openedx', 'estimator', 'Acme Academy');
    expect(desk[1]?.route && formatRoute(desk[1].route)).toBe('/p/openedx/desk');
  });

  it('draws no trail for a platform it does not know, rather than a broken link', () => {
    expect(platformTrail('nowhere', 'sales')).toEqual([]);
    expect(platformTrail('nowhere', 'sales', 'Tender')).toEqual([{ label: 'Tender', route: null }]);
  });

  it('opens the practice a crumb names, on its list of platforms', () => {
    const route = platformTrail('openedx', 'sales')[0]?.route;
    expect(route).toBeTruthy();
    const next = reducer(workspace({ openEstimation: 'EST-1' }), { type: 'applyRoute', route: route! });
    expect(next.practice).toBe('edtech');
    expect(next.platform).toBe('');
    expect(next.openEstimation).toBeNull();
  });

  it('takes the logo to the landing page, every practice listed, whatever was open', () => {
    expect(formatRoute(LANDING)).toBe('/practices');
    const next = reducer(workspace({ openEstimation: 'EST-1' }), { type: 'applyRoute', route: LANDING });
    expect(next.practice).toBe('');
    expect(next.platform).toBe('');
    expect(routeOfState(next)).toEqual({ screen: 'practices' });
  });

  it('builds a link that carries nothing from the page it sits on', () => {
    /* router.href and navigate merge a patch over the current route, so a "desk" link on a
       deal's desk page would otherwise point at that deal, and a crumb in the builder would keep
       its search */
    const onDealPage: Route = { screen: 'desk', platform: 'openedx', estimation: 'acme-academy', tab: 'estimations' };
    expect(formatRoute({ ...onDealPage, ...exactly(homeOf('estimator', 'openedx')) })).toBe('/p/openedx/desk');
    const inBuilder: Route = { screen: 'builder', platform: 'openedx', estimation: 'acme-academy', bundle: 'B03', q: 'sso', plan: true };
    expect(formatRoute({ ...inBuilder, ...exactly({ screen: 'practices', practice: 'edtech' }) })).toBe('/practices/edtech');
  });
});

describe('a link opened before signing in', () => {
  const held = { signedIn: true, found: true, storeSettled: true, expired: false };

  it('waits for the sign-in, even once the deal has loaded', () => {
    /* applied before it, the reducer refused the link, the sign-in then opened the practice
       picker, and a shared deal link never reached anyone who was not signed in already */
    expect(deepLinkReady({ ...held, signedIn: false })).toBe(false);
    expect(deepLinkReady({ ...held, signedIn: false, expired: true })).toBe(false);
  });

  it('opens once signed in and the deal is here', () => {
    expect(deepLinkReady(held)).toBe(true);
  });

  it('waits past sign-in while the deal has not arrived and the store has not answered', () => {
    expect(deepLinkReady({ ...held, found: false, storeSettled: false })).toBe(false);
  });

  it('stops waiting once the store has answered without it, or the grace period is over', () => {
    expect(deepLinkReady({ ...held, found: false })).toBe(true);
    expect(deepLinkReady({ ...held, found: false, storeSettled: false, expired: true })).toBe(true);
  });

  it('lands on the deal the link names when it is applied after the sign-in', () => {
    const signedOut = workspace({ auth: null, practice: '', platform: '' });
    /* what happened before: the link refused while signed out, then the sign-in */
    expect(apply(signedOut, '/p/openedx/e/nordic-university')).toBe(signedOut);
    const signedIn = reducer(signedOut, { type: 'signIn', user: 'admin', role: 'sales' });
    expect(signedIn.platform).toBe('');
    const opened = apply(signedIn, '/p/openedx/e/nordic-university');
    expect(opened.platform).toBe('openedx');
    expect(opened.openEstimation).toBe('EST-2');
  });
});

describe('applyRoute', () => {
  it('opens the estimation a link names', () => {
    const next = apply(workspace(), '/p/openedx/e/nordic-university');
    expect(next.openEstimation).toBe('EST-2');
  });

  it('resolves a link that carries the id instead of the slug', () => {
    /* links copied before slugs existed, and anything assembled by hand from a spreadsheet row */
    expect(apply(workspace(), '/p/openedx/e/EST-2').openEstimation).toBe('EST-2');
  });

  it('switches to the desk, and back to sales, because a link is an instruction', () => {
    const atDesk = apply(workspace(), '/p/openedx/desk/add');
    expect(atDesk.auth?.role).toBe('estimator');
    expect(atDesk.deskTab).toBe('add');

    const backToSales = apply(atDesk, '/p/openedx/e/acme-academy');
    expect(backToSales.auth?.role).toBe('sales');
    expect(backToSales.openEstimation).toBe('EST-1');
  });

  it('opens a deal on the desk as its estimation page', () => {
    const next = apply(workspace(), '/p/openedx/desk/e/acme-academy');
    expect(next.auth?.role).toBe('estimator');
    expect(next.deskView).toBe('EST-1');
    expect(next.deskTab).toBe('estimations');
  });

  it('leaves the open estimation alone while the desk is showing', () => {
    /* the chrome's role pill has always been a round trip: duck into the desk, come back to the
       deal you were building. Closing it here would quietly break that. */
    const building = apply(workspace(), '/p/openedx/e/acme-academy');
    const atDesk = apply(building, '/p/openedx/desk');
    expect(atDesk.auth?.role).toBe('estimator');
    expect(atDesk.openEstimation).toBe('EST-1');
    /* and the URL still says "desk", because role decides the screen */
    expect(formatRoute(routeOfState(atDesk))).toBe('/p/openedx/desk');

    const back = apply(atDesk, '/p/openedx/e/acme-academy');
    expect(back.auth?.role).toBe('sales');
    expect(back.openEstimation).toBe('EST-1');
  });

  it('shows the desk the deal as it stands, not as it was when it was opened', () => {
    /* the desk reads `estimations`, and the draft only reached it on close, so a deal with three
       solutions picked showed "0 h, 0 solutions" to the estimator in the same tab */
    const building = apply(workspace(), '/p/openedx/e/acme-academy');
    const picked = run(building, { type: 'toggleSolution', id: 'OX-1' }, { type: 'toggleSolution', id: 'OX-2' });
    const atDesk = apply(picked, '/p/openedx/desk/e/acme-academy');

    expect(atDesk.estimations.find((one) => one.id === 'EST-1')?.snap.sel).toEqual({ 'OX-1': true, 'OX-2': true });
    /* and the round trip still holds: the deal stays open with its draft, ready to come back to */
    expect(atDesk.openEstimation).toBe('EST-1');
    expect(atDesk.draft.sel).toEqual({ 'OX-1': true, 'OX-2': true });
  });

  it('commits the open draft when a link moves to another platform', () => {
    const building = apply(workspace(), '/p/openedx/e/acme-academy');
    const edited = reducer(building, { type: 'patchDraft', patch: { bufPct: 20 } });
    const moved = apply(edited, '/p/moodle/e/elsewhere-entirely');

    expect(moved.openEstimation).toBe('EST-3');
    expect(moved.estimations.find((one) => one.id === 'EST-1')?.snap.bufPct).toBe(20);
  });

  it('lands on the hub when the linked estimation has been deleted', () => {
    /* a stale link in someone's Slack history must not leave them on a blank screen */
    const next = apply(workspace(), '/p/openedx/e/deal-that-is-gone');
    expect(next.openEstimation).toBeNull();
    expect(next.platform).toBe('openedx');
  });

  it('will not open an estimation belonging to another platform', () => {
    /* estimations never mix platforms, and neither may a URL */
    const next = apply(workspace(), '/p/openedx/e/elsewhere-entirely');
    expect(next.openEstimation).toBeNull();
  });

  it('follows a link into another platform, closing what was open', () => {
    const open = apply(workspace(), '/p/openedx/e/acme-academy');
    const moved = apply(open, '/p/moodle/e/elsewhere-entirely');
    expect(moved.platform).toBe('moodle');
    expect(moved.openEstimation).toBe('EST-3');
  });

  it('commits the open draft rather than dropping it on the way out', () => {
    const open = apply(workspace(), '/p/openedx/e/acme-academy');
    const edited = reducer(open, { type: 'patchDraft', patch: { bufPct: 15 } });
    const left = apply(edited, '/p/openedx');
    expect(left.openEstimation).toBeNull();
    expect(left.estimations.find((one) => one.id === 'EST-1')?.snap.bufPct).toBe(15);
  });

  it('ignores a link entirely when nobody is signed in', () => {
    const out = workspace({ auth: null });
    expect(apply(out, '/p/openedx/e/acme-academy')).toBe(out);
  });
});

describe('routeOfState', () => {
  it('describes each screen as the URL that would reach it', () => {
    expect(routeOfState(workspace({ auth: null }))).toEqual({ screen: 'root' });
    expect(routeOfState(workspace({ platform: '' }))).toEqual({ screen: 'practices', practice: 'edtech' });
    expect(routeOfState(workspace())).toEqual({ screen: 'hub', platform: 'openedx' });
  });

  it('names an open estimation by its slug, not its id', () => {
    const open = apply(workspace(), '/p/openedx/e/acme-academy');
    expect(routeOfState(open)).toEqual({ screen: 'builder', platform: 'openedx', estimation: 'acme-academy' });
  });

  it('round-trips: a state describes a URL that rebuilds the same state', () => {
    for (const url of ['/p/openedx', '/p/openedx/e/acme-academy', '/p/openedx/desk/add', '/p/openedx/desk/e/acme-academy']) {
      const state = apply(workspace(), url);
      const route = routeOfState(state);
      /* the address bar would show this; following it must not move the app */
      expect(routeOfState(reducer(state, { type: 'applyRoute', route }))).toEqual(route);
      expect(formatRoute(route)).toBe(url);
    }
  });
});

/* ------------------------------------------------------------------ tenders */

describe('tender links', () => {
  const tender = (id: string, plat: string, slug: string): Tender => ({
    id,
    plat,
    name: slug,
    slug,
    client: '',
    due: '',
    summary: '',
    at: '2026-01-01',
    up: '2026-01-01',
    stage: 'requirements',
    docs: [],
    fit: null,
    outline: [],
    ranges: [],
    reqs: [],
    estId: '',
    sentAt: '',
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 },
    aiLimit: 4,
    aiApproved: 0
  });
  const withTenders = (over: Partial<AppState> = {}): AppState =>
    workspace({ tenders: [tender('TND-1', 'openedx', 'acme-lms-tender'), tender('TND-2', 'moodle', 'acme-lms-tender')], ...over });

  it('reads and writes a tender link, and the two agree', () => {
    expect(parseRoute('/p/openedx/t/acme-lms-tender')).toEqual({ screen: 'tender', platform: 'openedx', tender: 'acme-lms-tender' });
    expect(formatRoute({ screen: 'tender', platform: 'openedx', tender: 'acme-lms-tender' })).toBe('/p/openedx/t/acme-lms-tender');
    /* a tender link with no slug is not a tender screen */
    expect(parseRoute('/p/openedx/t')).toEqual({ screen: 'hub', platform: 'openedx' });
    expect(formatRoute({ screen: 'tender', platform: 'openedx' })).toBe('/');
  });

  it('opens the tender a link names, on the link platform, in sales', () => {
    const state = apply(withTenders({ auth: { user: 'admin', role: 'estimator', at: 0 } }), '/p/moodle/t/acme-lms-tender');
    expect(state.platform).toBe('moodle');
    expect(state.openTender).toBe('TND-2');
    expect(state.auth?.role).toBe('sales');
  });

  it('accepts the id as well as the slug, which is what the intake navigates with', () => {
    expect(apply(withTenders(), '/p/openedx/t/TND-1').openTender).toBe('TND-1');
  });

  it('commits and closes the open deal before showing a tender', () => {
    /* the tender replaces the builder, and the draft must not be lost on the way */
    const building = run(apply(withTenders(), '/p/openedx/e/acme-academy'), { type: 'toggleSolution', id: 'OX-9' });
    const state = apply(building, '/p/openedx/t/acme-lms-tender');
    expect(state.openEstimation).toBeNull();
    expect(state.openTender).toBe('TND-1');
    expect(state.estimations.find((one) => one.id === 'EST-1')?.snap.sel).toEqual({ 'OX-9': true });
  });

  it('closes the tender for the builder, the hub and the picker', () => {
    const open = apply(withTenders(), '/p/openedx/t/acme-lms-tender');
    expect(apply(open, '/p/openedx/e/acme-academy').openTender).toBeNull();
    expect(apply(open, '/p/openedx').openTender).toBeNull();
    expect(apply(open, '/practices').openTender).toBeNull();
  });

  it('lands on the hub, not a blank screen, when the tender has been deleted', () => {
    const state = apply(withTenders(), '/p/openedx/t/no-such-tender');
    expect(state.openTender).toBeNull();
    expect(routeOfState(state)).toEqual({ screen: 'hub', platform: 'openedx' });
  });

  it('names an open tender by its slug, and the link rebuilds the same screen', () => {
    const state = apply(withTenders(), '/p/openedx/t/TND-1');
    const route = routeOfState(state);
    expect(route).toEqual({ screen: 'tender', platform: 'openedx', tender: 'acme-lms-tender' });
    expect(routeOfState(reducer(state, { type: 'applyRoute', route }))).toEqual(route);
  });
});
