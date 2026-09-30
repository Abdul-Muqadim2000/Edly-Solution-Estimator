import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Catalog, EstimateResult, Estimation, PersistedState, Schedule } from '@/types';
import { INITIAL_STATE, reducer, catalogAdditions, catalogPin, catalogReady, effectiveDisplay, hubEstimations, openRequests, platformTotals, SERVED_CATALOG_FILE, storedOpenEstimation, toPersisted, type Action, type AppState, type DisplayPrefs } from '@/state/reducer';
import { changedSlices, readStorage, removeStorage, stableSlices, STORAGE_KEYS, writeStorage } from '@/state/keys';
import { useSync, type SyncApi } from '@/state/useSync';
import { useRouting, type RouterApi } from '@/state/useRouting';
import { benchmarkCatalog, findPlatform, isLiveCatalog } from '@/data/practices';
import { composeCatalog } from '@/domain/catalog';
import { calcEstimate } from '@/domain/estimate';
import { schedule as buildSchedule } from '@/domain/planner';
import { readSheetPrefs } from '@/domain/taskBreakdown';
import { fetchCatalog } from '@/lib/catalogSheet';
import { fingerprint } from '@/lib/xlsx';
import { withSlugs } from '@/lib/format';

/**
 * One provider holds the workspace: reducer state, persistence, server sync, and the derived
 * values every screen needs (the catalog in play, the current estimate, the delivery plan).
 *
 * Derived values are memoised here rather than recomputed per component, because the estimate
 * and the schedule are the two things nearly every screen reads.
 */

/* Resolved against the page, so it works at a sub-path as well as at the domain root.
   On Vercel, public/catalog-source.xlsx is served next to index.html. */
const CATALOG_URL = new URL(SERVED_CATALOG_FILE, document.baseURI).toString();
const CATALOG_RETRIES = 3;

export interface AppContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
  sync: SyncApi;
  /** The URL, as a value, plus the two ways to change it. Screens never touch `window.location`. */
  router: RouterApi;
  /** The catalog for the platform in play, desk additions folded in. */
  catalog: Catalog;
  /** The same catalog before desk additions: what a bundles workbook is added to or replaces. */
  baseCatalog: Catalog;
  /** The open estimation's numbers. */
  estimate: EstimateResult;
  /** The open estimation's delivery plan. */
  plan: Schedule;
  display: DisplayPrefs;
  /** Drop a hand-loaded catalog and go back to the shipped one. */
  resetCatalog: () => void;
  /** Re-read the sheet served beside the app, replacing whatever is in play. */
  reloadCatalog: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/* A brand-new workspace used to be given a "General estimation" to work in, and every browser that
   opened one empty wrote its own, so stores collected several. The hub now always has the demo
   estimation (`domain/demo.ts`), which the reducer adds on the first hydrate and nothing saves. */

function hydrateFromStorage(): Partial<AppState> {
  const platform = readStorage<{ practice?: string; plat?: string } | null>(STORAGE_KEYS.platform, null);
  const workspace = readStorage<{ display?: DisplayPrefs; sheet?: unknown } | null>(STORAGE_KEYS.workspace, null);
  const stored = readStorage<Estimation[]>(STORAGE_KEYS.estimations, []);
  return {
    auth: readStorage(STORAGE_KEYS.auth, null),
    /* signing in always lands on the picker; the last platform is only a shortcut */
    lastPlatform: platform?.plat && findPlatform(platform.plat) ? platform.plat : '',
    /* records saved before slugs existed get one here, so every deal has a URL from the first
       render — `routeOfState` would otherwise fall back to the raw id in the address bar */
    estimations: withSlugs(stored),
    requests: readStorage(STORAGE_KEYS.requests, []),
    solutions: readStorage(STORAGE_KEYS.solutions, []),
    bundles: readStorage(STORAGE_KEYS.bundles, []),
    tenders: readStorage(STORAGE_KEYS.tenders, []),
    salesLegal: readStorage(STORAGE_KEYS.salesLegal, []),
    loadedCatalogs: readStorage(STORAGE_KEYS.loadedCatalogs, {}),
    catalogSource: readStorage(STORAGE_KEYS.catalogSource, null),
    display: workspace?.display ?? INITIAL_STATE.display,
    presenting: false,
    sheet: readSheetPrefs(workspace?.sheet),
    ready: true
  };
}

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const sheetCatalog = useRef<Map<string, Catalog>>(new Map());
  const catalogRequested = useRef(false);

  /* What this tab last wrote to browser storage, or last took from it, per key. */
  const written = useRef<Record<string, unknown>>({});

  /* Boot from storage once. What was just read is already in storage, so it counts as written:
     writing it straight back could only overwrite something a sibling tab saved in the meantime,
     which is how a tab opening mid-extraction put a failed range back to "claimed". Estimations
     are the exception when slugs were filled in, because then the written copy really is new. */
  useEffect(() => {
    const payload = hydrateFromStorage();
    const stored = readStorage<Estimation[]>(STORAGE_KEYS.estimations, []);
    Object.assign(written.current, {
      [STORAGE_KEYS.requests]: payload.requests,
      [STORAGE_KEYS.solutions]: payload.solutions,
      [STORAGE_KEYS.bundles]: payload.bundles,
      [STORAGE_KEYS.tenders]: payload.tenders,
      [STORAGE_KEYS.salesLegal]: payload.salesLegal,
      [STORAGE_KEYS.loadedCatalogs]: payload.loadedCatalogs,
      [STORAGE_KEYS.catalogSource]: payload.catalogSource,
      ...(stored.every((one) => one.slug) ? { [STORAGE_KEYS.estimations]: payload.estimations } : {})
    });
    dispatch({ type: 'hydrate', payload });
  }, []);

  /* Another tab in the same browser — sales in one, the desk in the other — is the workflow this
     tool was built around, so its writes land here at once rather than waiting for a sync poll.
     The estimation being edited here is never overwritten: its own draft is the newer copy. */
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (!event.key || event.newValue === null) return;
      const parse = <T,>(): T | null => {
        try {
          return JSON.parse(event.newValue as string) as T;
        } catch {
          return null;
        }
      };
      /* A slice taken from another tab is already in storage, so it counts as written here. Writing
         it back echoed it over anything newer the other tab had written since, and that tab then
         took the older copy: a retried range went back to "claimed" and was read a second time. */
      const adopt = <T,>(value: T): T => {
        written.current[event.key as string] = value;
        return value;
      };
      if (event.key === STORAGE_KEYS.requests) {
        const requests = parse<AppState['requests']>();
        if (Array.isArray(requests)) dispatch({ type: 'hydrate', payload: { requests: adopt(requests) } });
      } else if (event.key === STORAGE_KEYS.estimations) {
        const incoming = parse<AppState['estimations']>();
        if (Array.isArray(incoming)) dispatch({ type: 'mergeEstimations', estimations: incoming });
      } else if (event.key === STORAGE_KEYS.solutions) {
        const solutions = parse<AppState['solutions']>();
        if (Array.isArray(solutions)) dispatch({ type: 'hydrate', payload: { solutions: adopt(solutions) } });
      } else if (event.key === STORAGE_KEYS.bundles) {
        const bundles = parse<AppState['bundles']>();
        if (Array.isArray(bundles)) dispatch({ type: 'hydrate', payload: { bundles: adopt(bundles) } });
      } else if (event.key === STORAGE_KEYS.tenders) {
        const tenders = parse<AppState['tenders']>();
        if (Array.isArray(tenders)) dispatch({ type: 'hydrate', payload: { tenders: adopt(tenders) } });
      } else if (event.key === STORAGE_KEYS.salesLegal) {
        /* the legal team closing an item in one tab shows in the builder open in the other */
        const salesLegal = parse<AppState['salesLegal']>();
        if (Array.isArray(salesLegal)) dispatch({ type: 'hydrate', payload: { salesLegal: adopt(salesLegal) } });
      } else if (event.key === STORAGE_KEYS.loadedCatalogs) {
        const loadedCatalogs = parse<AppState['loadedCatalogs']>();
        if (loadedCatalogs) dispatch({ type: 'hydrate', payload: { loadedCatalogs: adopt(loadedCatalogs) } });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /* Persist the slices the app owns, but only the ones this tab changed: see `changedSlices` for
     the two-tab bug that rewriting all of them caused. They are written without the demo, which
     lives in memory only, and taking it out makes a new array every time; `stableSlices` keeps the
     last one written when its records are the same, or every slice would count as changed. */
  useEffect(() => {
    if (!state.ready) return;
    const data = toPersisted(state);
    const slices = stableSlices(written.current, {
      [STORAGE_KEYS.estimations]: data.estimations,
      [STORAGE_KEYS.requests]: data.requests,
      [STORAGE_KEYS.solutions]: data.solutions,
      [STORAGE_KEYS.bundles]: data.bundles,
      [STORAGE_KEYS.tenders]: data.tenders,
      [STORAGE_KEYS.salesLegal]: data.salesLegal,
      [STORAGE_KEYS.loadedCatalogs]: state.loadedCatalogs,
      [STORAGE_KEYS.catalogSource]: state.catalogSource
    });
    for (const key of changedSlices(written.current, slices)) writeStorage(key, slices[key]);
    written.current = slices;
    writeStorage(STORAGE_KEYS.workspace, { display: state.display, sheet: state.sheet });
    writeStorage(STORAGE_KEYS.openEstimation, storedOpenEstimation(state));
    if (state.platform) writeStorage(STORAGE_KEYS.platform, { practice: state.practice, plat: state.platform });
    if (state.auth) writeStorage(STORAGE_KEYS.auth, state.auth);
    else removeStorage(STORAGE_KEYS.auth);
  }, [state]);

  /* The Open edX catalog comes from the served sheet.
     There is no bundled fallback for it, so a failure has to be reported rather than
     swallowed — an empty catalog with no explanation is the worst outcome for a salesperson.

     A sheet the user loaded by hand is pinned: the served copy is then only checked, never
     applied, and a difference raises the dot on the Catalog button instead of silently
     replacing their file under them. */
  const readServedCatalog = useCallback(async (force: boolean): Promise<void> => {
    const result = await fetchCatalog(CATALOG_URL);
    sheetCatalog.current.set('openedx', result.catalog);
    dispatch({
      type: 'setLoadedCatalog',
      platform: 'openedx',
      catalog: result.catalog,
      source: { source: 'auto', name: CATALOG_URL, hash: result.hash, at: new Date().toISOString().slice(0, 10), warnings: result.warnings }
    });
    if (force) dispatch({ type: 'setAutoAvail', available: false });
  }, []);

  useEffect(() => {
    if (!isLiveCatalog(state.platform) || catalogRequested.current) return;
    catalogRequested.current = true;

    const { pinned, hash: pinnedHash } = catalogPin(
      readStorage<AppState['loadedCatalogs']>(STORAGE_KEYS.loadedCatalogs, {}),
      readStorage<AppState['catalogSource']>(STORAGE_KEYS.catalogSource, null),
      state.platform
    );

    let cancelled = false;

    if (pinned) {
      /* only look, so the dot can appear; never replace what they chose */
      void fetch(CATALOG_URL, { cache: 'no-store' })
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .then((buffer) => {
          if (cancelled || !buffer) return;
          if (fingerprint(buffer) !== pinnedHash) dispatch({ type: 'setAutoAvail', available: true });
        })
        .catch(() => {
          /* offline is not an error worth interrupting a meeting for */
        });
      return () => {
        cancelled = true;
      };
    }

    const attempt = async (tries: number): Promise<void> => {
      try {
        await readServedCatalog(false);
      } catch (error) {
        if (cancelled) return;
        if (tries > 1) {
          setTimeout(() => void attempt(tries - 1), (CATALOG_RETRIES - tries + 1) * 1200);
          return;
        }
        dispatch({
          type: 'setCatalogError',
          message: `Could not read the solution catalog from ${CATALOG_URL} — ${(error as Error).message}. Nothing can be estimated until it loads; check that catalog-source.xlsx is deployed, or set EDLY_CATALOG_URL.`
        });
      }
    };
    void attempt(CATALOG_RETRIES);
    return () => {
      cancelled = true;
    };
  }, [state.platform, readServedCatalog]);

  /* what the store is sent: everything but the demo */
  const persisted = useMemo<PersistedState>(() => toPersisted(state), [state]);

  /* What the store sends goes into this tab's memory, not back into browser storage. Storage is
     the working copy every tab in this browser shares, and it is newer than the store for anything
     edited in the last save or two. Echoing the store's copy into it rolled a sibling tab back: a
     tab opened while another was creating an estimation read the store just before that save
     landed, wrote the older copy, and the other tab adopted it. The other tabs read the store
     themselves on their own schedule. */
  const onHydrate = useCallback((incoming: PersistedState) => {
    const payload = {
      /* the server already backfills, but a hand-edited sheet can still arrive with a gap */
      estimations: withSlugs(incoming.estimations),
      requests: incoming.requests,
      solutions: incoming.solutions,
      bundles: incoming.bundles,
      tenders: withSlugs(incoming.tenders ?? []),
      salesLegal: incoming.salesLegal ?? [],
      loadedCatalogs: readStorage<AppState['loadedCatalogs']>(STORAGE_KEYS.loadedCatalogs, {})
    };
    Object.assign(written.current, {
      [STORAGE_KEYS.estimations]: payload.estimations,
      [STORAGE_KEYS.requests]: payload.requests,
      [STORAGE_KEYS.solutions]: payload.solutions,
      [STORAGE_KEYS.bundles]: payload.bundles,
      [STORAGE_KEYS.tenders]: payload.tenders,
      [STORAGE_KEYS.salesLegal]: payload.salesLegal,
      [STORAGE_KEYS.loadedCatalogs]: payload.loadedCatalogs
    });
    dispatch({ type: 'hydrate', payload });
  }, []);

  const sync = useSync({ snapshot: persisted, onHydrate, enabled: state.ready });

  /* A deep link can name an estimation this browser has not read yet, so the router waits on the
     store before deciding the link is dead. `hydrated` is true once a read has succeeded. */
  const router = useRouting(state, dispatch, sync.status.hydrated);

  /* ---- derived: catalog, estimate, plan ---- */

  const baseCatalog = useMemo<Catalog>(() => {
    const platform = state.platform || 'openedx';
    return (
      state.loadedCatalogs[platform] ??
      benchmarkCatalog(platform) ?? {
        meta: {
          title: findPlatform(platform)?.platform.name ?? 'Catalog',
          subtitle: 'No catalog yet. Add solutions at the estimation desk, or import a workbook.',
          compiled: '',
          totals: { features: 0, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 },
          notes: []
        },
        bundles: []
      }
    );
  }, [state.platform, state.loadedCatalogs]);

  /* the demo's estimates join it only while the demo is open */
  const added = useMemo(() => catalogAdditions(state.solutions, state.openEstimation), [state.solutions, state.openEstimation]);
  const catalog = useMemo<Catalog>(
    () => composeCatalog({ base: baseCatalog, platform: state.platform || 'openedx', added, ownBundles: state.bundles }),
    [baseCatalog, state.platform, added, state.bundles]
  );

  /* Each deal caches its totals for the hub's "hours in play" and the sheet's readable columns,
     and this is the one place that keeps them in step with what its card shows. It waits for a
     real catalog, because pricing against the empty stand-in would write zeros. `cacheTotals`
     hands back the same state when nothing moved, so this settles after one pass. */
  useEffect(() => {
    if (!catalogReady(state)) return;
    dispatch({ type: 'cacheTotals', totals: platformTotals(state, catalog) });
  }, [state, catalog]);

  const requests = useMemo(() => openRequests(state), [state]);

  const estimate = useMemo<EstimateResult>(() => calcEstimate(catalog, state.draft, requests), [catalog, state.draft, requests]);

  const display = useMemo(() => effectiveDisplay(state), [state]);

  const plan = useMemo<Schedule>(
    () => buildSchedule(estimate, requests, state.draft, { blendBuffer: display.blendBuffer }),
    [estimate, requests, state.draft, display.blendBuffer]
  );

  const reloadCatalog = useCallback(async (): Promise<void> => {
    await readServedCatalog(true);
  }, [readServedCatalog]);

  const resetCatalog = useCallback(() => {
    dispatch({
      type: 'setLoadedCatalog',
      platform: state.platform || 'openedx',
      catalog: null,
      source: { source: 'builtin', at: new Date().toISOString().slice(0, 10) }
    });
  }, [state.platform]);

  const value = useMemo<AppContextValue>(
    () => ({ state, dispatch, sync, router, catalog, baseCatalog, estimate, plan, display, resetCatalog, reloadCatalog }),
    [state, sync, router, catalog, baseCatalog, estimate, plan, display, resetCatalog, reloadCatalog]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

/** Estimations for the platform in play: the demo first, then the most recently updated. */
export function usePlatformEstimations(): AppState['estimations'] {
  const { state } = useApp();
  return useMemo(() => hubEstimations(state), [state]);
}
