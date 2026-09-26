import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, AppState } from '@/state/reducer';
import { openEstimationRecord } from '@/state/reducer';
import { basePath, formatRoute, parseRoute, readAddress, routeHref, withoutSearch, type Route } from '@/lib/router';

/**
 * The address bar and the reducer, kept in step.
 *
 * The direction matters, and it is the one ARCHITECTURE.md always said this would be: **state
 * drives the screen, and the URL is a projection of state.** A URL is read in exactly three
 * places — on boot, on Back/Forward, and when something calls `navigate` — and each of those
 * turns into a single `applyRoute` action. Nothing else in the app reads `window.location`.
 *
 * Two problems this has to solve, both of which bite immediately without the handling below:
 *
 *  1. **A shared link arrives before the data does.** Someone opens an estimation link in a
 *     browser that has never run the app. `localStorage` is empty and the spreadsheet has not
 *     answered yet, so the estimation does not exist to route to. The deep link is therefore held
 *     and retried until the list contains it, or until the store has answered and we know it
 *     never will, at which point the route falls back to the hub rather than a blank screen. If
 *     the store never answers at all, `DEEP_LINK_GRACE_MS` stops that becoming a permanent wait.
 *
 *  2. **Typing must not fill the history, but the planner must.** Every keystroke in the catalog
 *     search changes the route; pushing each one would make Back useless and trip the browser's
 *     history-call throttle. So a change to the search alone replaces. Everything else pushes —
 *     comparing whole query strings instead would let opening the planner swallow the bundle's
 *     entry, and one Back would then drop you two screens.
 */

/** The parts of a route that are not reducer state: they belong to the open builder only. */
interface ViewParts {
  bundle?: string;
  plan?: boolean;
  q?: string;
}

export interface RouterApi {
  /** Where the app is now, as a value. */
  route: Route;
  /** Go somewhere. The patch is merged over the current route. */
  navigate: (patch: Partial<Route>) => void;
  /** A full, shareable href — what "Copy link" puts on the clipboard. */
  href: (patch?: Partial<Route>) => string;
}

const viewOf = (route: Route): ViewParts => {
  const parts: ViewParts = {};
  if (route.bundle) parts.bundle = route.bundle;
  if (route.plan) parts.plan = true;
  if (route.q) parts.q = route.q;
  return parts;
};

/** The route a given state is already showing. The projection, before view parts are folded in. */
export function routeOfState(state: AppState): Route {
  if (!state.auth) return { screen: 'root' };
  if (!state.platform) return state.practice ? { screen: 'practices', practice: state.practice } : { screen: 'practices' };

  if (state.auth.role === 'estimator') {
    const viewed = state.deskView ? state.estimations.find((one) => one.id === state.deskView) : null;
    if (viewed) return { screen: 'desk', platform: state.platform, estimation: viewed.slug || viewed.id, tab: 'estimations' };
    return { screen: 'desk', platform: state.platform, tab: state.deskTab };
  }

  const open = openEstimationRecord(state);
  if (open) return { screen: 'builder', platform: state.platform, estimation: open.slug || open.id };
  return { screen: 'hub', platform: state.platform };
}

/**
 * Whether a route's estimation is present yet. Scoped by the route's own platform, because the
 * reducer has not switched to it at the point this is asked.
 */
function resolves(state: AppState, want: Route): boolean {
  if (!want.estimation) return true;
  const plat = want.platform || state.platform || 'openedx';
  const key = want.estimation.toLowerCase();
  return state.estimations.some(
    (one) => (one.plat || 'openedx') === plat && ((one.slug ?? '').toLowerCase() === key || one.id.toLowerCase() === key)
  );
}

/**
 * How long a deep link waits for the spreadsheet before giving up on it.
 *
 * If the store is unreachable, `storeSettled` never turns true, and a link naming an estimation
 * this browser has not seen would otherwise hold forever — the address bar saying one thing and
 * the screen showing another. After this, the route is applied anyway and falls back to the hub.
 */
const DEEP_LINK_GRACE_MS = 8000;

export function useRouting(state: AppState, dispatch: (action: Action) => void, storeSettled: boolean): RouterApi {
  const base = useMemo(() => basePath(typeof document === 'undefined' ? '/' : document.baseURI), []);

  /* View parts are tagged with the estimation they belong to, so opening another deal from the
     hub drops its bundle and search without needing an effect to clear them. */
  const [view, setView] = useState<{ of: string | undefined; parts: ViewParts }>({ of: undefined, parts: {} });

  const booted = useRef(false);
  const pending = useRef<Route | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const writtenUrl = useRef<string | null>(null);
  const routeRef = useRef<Route>({ screen: 'root' });

  const route = useMemo<Route>(() => {
    const shell = routeOfState(state);
    if (shell.screen !== 'builder' || view.of !== shell.estimation) return shell;
    return { ...shell, ...view.parts };
  }, [state, view]);
  routeRef.current = route;

  /* ---- read: boot, then retry until the linked estimation has arrived ---- */

  useEffect(() => {
    if (!state.ready || booted.current || typeof window === 'undefined') return;
    booted.current = true;
    const parsed = parseRoute(readAddress(window.location, base));
    /* "/" asks for nothing in particular — leave the hydrated state alone and let it canonicalise */
    if (parsed.screen !== 'root') pending.current = parsed;
  }, [state.ready, base]);

  useEffect(() => {
    if (!state.ready || !pending.current) return;
    const timer = window.setTimeout(() => setLinkExpired(true), DEEP_LINK_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [state.ready]);

  useEffect(() => {
    const want = pending.current;
    if (!want || !state.ready) return;
    if (!resolves(state, want) && !storeSettled && !linkExpired) return;
    pending.current = null;
    setView({ of: want.estimation, parts: viewOf(want) });
    dispatch({ type: 'applyRoute', route: want });
  }, [state, storeSettled, linkExpired, dispatch]);

  /* ---- read: Back and Forward ---- */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = (): void => {
      const parsed = parseRoute(readAddress(window.location, base));
      /* the browser already moved the address bar; recording it stops the writer bouncing it back */
      writtenUrl.current = formatRoute(parsed);
      pending.current = null;
      setView({ of: parsed.estimation, parts: viewOf(parsed) });
      dispatch({ type: 'applyRoute', route: parsed });
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, [base, dispatch]);

  /* ---- write: the address bar follows state ---- */

  useEffect(() => {
    if (!state.ready || !booted.current || pending.current || typeof window === 'undefined') return;
    const url = formatRoute(route);
    const previous = writtenUrl.current;
    if (url === previous) return;
    writtenUrl.current = url;

    const href = routeHref(route, window.location, base);
    /* The first write only tidies the URL the user arrived on, and a change to the search box is
       a filter rather than a destination — neither deserves a history entry. Everything else,
       the planner included, is somewhere you went, so Back has to bring you back out of it. */
    const searchOnly = previous !== null && withoutSearch(url) === withoutSearch(previous);
    try {
      if (previous === null || searchOnly) window.history.replaceState(null, '', href);
      else window.history.pushState(null, '', href);
    } catch {
      /* a sandboxed frame or a file:// preview refuses history writes. The app is already on the
         right screen — state got there first — so a stale address bar is the whole cost. */
    }
  }, [route, base, state.ready]);

  const navigate = useCallback(
    (patch: Partial<Route>) => {
      pending.current = null;
      const current = routeRef.current;
      const leaving = patch.estimation !== undefined && patch.estimation !== current.estimation;
      const next: Route = leaving
        ? { ...current, bundle: undefined, plan: undefined, q: undefined, ...patch }
        : { ...current, ...patch };
      setView({ of: next.estimation, parts: viewOf(next) });
      dispatch({ type: 'applyRoute', route: next });
    },
    [dispatch]
  );

  const href = useCallback(
    (patch: Partial<Route> = {}): string => {
      if (typeof window === 'undefined') return formatRoute({ ...routeRef.current, ...patch });
      return routeHref({ ...routeRef.current, ...patch }, window.location, base, window.location.origin);
    },
    [base]
  );

  return useMemo<RouterApi>(() => ({ route, navigate, href }), [route, navigate, href]);
}
