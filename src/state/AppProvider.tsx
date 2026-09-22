import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Catalog, EstimateResult, PersistedState, Schedule } from '@/types';
import { INITIAL_STATE, reducer, commitDraft, effectiveDisplay, openRequests, platformEstimations, type Action, type AppState, type DisplayPrefs } from '@/state/reducer';
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from '@/state/keys';
import { useSync, type SyncApi } from '@/state/useSync';
import { benchmarkCatalog, findPlatform, isLiveCatalog } from '@/data/practices';
import { composeCatalog } from '@/domain/catalog';
import { calcEstimate } from '@/domain/estimate';
import { schedule as buildSchedule } from '@/domain/planner';
import { fetchCatalog, parseCatalogWorkbook } from '@/lib/catalogSheet';
import { fingerprint } from '@/lib/xlsx';

/**
 * One provider holds the workspace: reducer state, persistence, server sync, and the derived
 * values every screen needs (the catalog in play, the current estimate, the delivery plan).
 *
 * Derived values are memoised here rather than recomputed per component, because the estimate
 * and the schedule are the two things nearly every screen reads.
 */

/* Resolved against the page, so it works at a sub-path as well as at the domain root.
   On Vercel, public/catalog-source.xlsx is served next to index.html. */
const CATALOG_URL = new URL('catalog-source.xlsx', document.baseURI).toString();
const CATALOG_RETRIES = 3;

export interface AppContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
  sync: SyncApi;
  /** The catalog for the platform in play, desk additions folded in. */
  catalog: Catalog;
  /** The open estimation's numbers. */
  estimate: EstimateResult;
  /** The open estimation's delivery plan. */
  plan: Schedule;
  display: DisplayPrefs;
  /** Load a catalog workbook the user picked. */
  importCatalog: (file: File) => Promise<{ warnings: string[] } | null>;
  /** Drop a hand-loaded catalog and go back to the shipped one. */
  resetCatalog: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function hydrateFromStorage(): Partial<AppState> {
  const platform = readStorage<{ practice?: string; plat?: string } | null>(STORAGE_KEYS.platform, null);
  const workspace = readStorage<{ display?: DisplayPrefs; presenting?: boolean } | null>(STORAGE_KEYS.workspace, null);
  return {
    auth: readStorage(STORAGE_KEYS.auth, null),
    /* signing in always lands on the picker; the last platform is only a shortcut */
    lastPlatform: platform?.plat && findPlatform(platform.plat) ? platform.plat : '',
    estimations: readStorage(STORAGE_KEYS.estimations, []),
    requests: readStorage(STORAGE_KEYS.requests, []),
    solutions: readStorage(STORAGE_KEYS.solutions, []),
    bundles: readStorage(STORAGE_KEYS.bundles, []),
    loadedCatalogs: readStorage(STORAGE_KEYS.loadedCatalogs, {}),
    display: workspace?.display ?? INITIAL_STATE.display,
    presenting: false,
    ready: true
  };
}

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const sheetCatalog = useRef<Map<string, Catalog>>(new Map());
  const catalogRequested = useRef(false);

  /* boot from storage once */
  useEffect(() => {
    dispatch({ type: 'hydrate', payload: hydrateFromStorage() });
  }, []);

  /* persist the slices the app owns */
  useEffect(() => {
    if (!state.ready) return;
    writeStorage(STORAGE_KEYS.estimations, commitDraft(state));
    writeStorage(STORAGE_KEYS.requests, state.requests);
    writeStorage(STORAGE_KEYS.solutions, state.solutions);
    writeStorage(STORAGE_KEYS.bundles, state.bundles);
    writeStorage(STORAGE_KEYS.loadedCatalogs, state.loadedCatalogs);
    writeStorage(STORAGE_KEYS.workspace, { display: state.display });
    writeStorage(STORAGE_KEYS.openEstimation, state.openEstimation ?? '');
    if (state.platform) writeStorage(STORAGE_KEYS.platform, { practice: state.practice, plat: state.platform });
    if (state.auth) writeStorage(STORAGE_KEYS.auth, state.auth);
    else removeStorage(STORAGE_KEYS.auth);
  }, [state]);

  /* The Open edX catalog comes from the served sheet, read once per session.
     There is no bundled fallback for it, so a failure has to be reported rather than
     swallowed — an empty catalog with no explanation is the worst outcome for a salesperson. */
  useEffect(() => {
    if (!isLiveCatalog(state.platform) || catalogRequested.current) return;
    catalogRequested.current = true;

    let cancelled = false;
    const attempt = async (tries: number): Promise<void> => {
      try {
        const result = await fetchCatalog(CATALOG_URL);
        if (cancelled) return;
        sheetCatalog.current.set('openedx', result.catalog);
        dispatch({
          type: 'setLoadedCatalog',
          platform: 'openedx',
          catalog: result.catalog,
          source: { source: 'auto', name: CATALOG_URL, hash: result.hash, at: new Date().toISOString().slice(0, 10), warnings: result.warnings }
        });
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
  }, [state.platform]);

  const persisted = useMemo<PersistedState>(
    () => ({
      estimations: commitDraft(state),
      requests: state.requests,
      solutions: state.solutions,
      bundles: state.bundles,
      settings: {}
    }),
    [state]
  );

  const onHydrate = useCallback((incoming: PersistedState) => {
    dispatch({
      type: 'hydrate',
      payload: {
        estimations: incoming.estimations,
        requests: incoming.requests,
        solutions: incoming.solutions,
        bundles: incoming.bundles,
        loadedCatalogs: readStorage(STORAGE_KEYS.loadedCatalogs, {})
      }
    });
  }, []);

  const sync = useSync({ snapshot: persisted, onHydrate, enabled: state.ready });

  /* ---- derived: catalog, estimate, plan ---- */

  const catalog = useMemo<Catalog>(() => {
    const platform = state.platform || 'openedx';
    const base =
      state.loadedCatalogs[platform] ??
      benchmarkCatalog(platform) ?? {
        meta: {
          title: findPlatform(platform)?.platform.name ?? 'Catalog',
          subtitle: 'No catalog yet — add solutions at the estimation desk, or load a sheet.',
          compiled: '',
          totals: { features: 0, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 },
          notes: []
        },
        bundles: []
      };
    return composeCatalog({ base, platform, added: state.solutions, ownBundles: state.bundles });
  }, [state.platform, state.loadedCatalogs, state.solutions, state.bundles]);

  const requests = useMemo(() => openRequests(state), [state]);

  const estimate = useMemo<EstimateResult>(() => calcEstimate(catalog, state.draft, requests), [catalog, state.draft, requests]);

  const display = useMemo(() => effectiveDisplay(state), [state]);

  const plan = useMemo<Schedule>(
    () => buildSchedule(estimate, requests, state.draft, { blendBuffer: display.blendBuffer }),
    [estimate, requests, state.draft, display.blendBuffer]
  );

  const importCatalog = useCallback(
    async (file: File): Promise<{ warnings: string[] } | null> => {
      const buffer = await file.arrayBuffer();
      const result = await parseCatalogWorkbook(buffer);
      dispatch({
        type: 'setLoadedCatalog',
        platform: state.platform || 'openedx',
        catalog: result.catalog,
        source: { source: 'file', name: file.name, hash: fingerprint(buffer), at: new Date().toISOString().slice(0, 10), warnings: result.warnings }
      });
      return { warnings: result.warnings };
    },
    [state.platform]
  );

  const resetCatalog = useCallback(() => {
    dispatch({
      type: 'setLoadedCatalog',
      platform: state.platform || 'openedx',
      catalog: null,
      source: { source: 'builtin', at: new Date().toISOString().slice(0, 10) }
    });
  }, [state.platform]);

  const value = useMemo<AppContextValue>(
    () => ({ state, dispatch, sync, catalog, estimate, plan, display, importCatalog, resetCatalog }),
    [state, sync, catalog, estimate, plan, display, importCatalog, resetCatalog]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

/** Estimations for the platform in play, newest first. */
export function usePlatformEstimations(): AppState['estimations'] {
  const { state } = useApp();
  return useMemo(
    () => platformEstimations(state).slice().sort((a, b) => String(b.up).localeCompare(String(a.up))),
    [state]
  );
}
