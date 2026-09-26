import type {
  AddedBundle,
  AddedSolution,
  Auth,
  Catalog,
  CurrencyCode,
  DeskTab,
  EstimateRequest,
  Estimation,
  EstimationSnapshot,
  EstimationTag,
  PersistedState,
  PlanEntry,
  RateRole,
  Role
} from '@/types';
import type { Route } from '@/lib/router';
import { DEFAULT_ROLES } from '@/domain/estimate';
import { nextId, today, uniqueSlug } from '@/lib/format';
import { findPlatform, isLiveCatalog } from '@/data/practices';

/**
 * All workspace state, and the only functions that change it.
 *
 * The reducer is pure and exported, so behaviour can be unit-tested without React. Anything
 * asynchronous — talking to the store, parsing a workbook — happens in the provider.
 */

/** What sales can hide before screen-sharing. */
export interface DisplayPrefs {
  /** Show reuse savings and engineered hours. */
  savings: boolean;
  /** Show internal notes and caveats. */
  notes: boolean;
  /** Show money. */
  money: boolean;
  /** Show the editing controls. */
  controls: boolean;
  /** Fold buffers into the line hours rather than showing them separately. */
  blendBuffer: boolean;
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  savings: true,
  notes: true,
  money: false,
  controls: true,
  blendBuffer: false
};

export const EMPTY_SNAPSHOT: EstimationSnapshot = {
  sel: {},
  buf: {},
  bufPct: 0,
  pm: null,
  qa: null,
  rate: null,
  cur: 'USD',
  roles: null,
  lineRole: {},
  plan: {},
  hpw: 40,
  maxPar: 4,
  planStart: ''
};

export type { DeskTab };

export interface AppState {
  ready: boolean;
  auth: Auth | null;

  practice: string;
  platform: string;
  /** Offered as a shortcut on the picker after signing in. */
  lastPlatform: string;

  estimations: Estimation[];
  requests: EstimateRequest[];
  solutions: AddedSolution[];
  bundles: AddedBundle[];

  openEstimation: string | null;
  /** The open estimation's live snapshot. Committed back on close. */
  draft: EstimationSnapshot;

  display: DisplayPrefs;
  presenting: boolean;

  /** Catalog loaded by hand, per platform id. */
  loadedCatalogs: Record<string, Catalog>;
  /** Set when the catalog sheet could not be read — the UI must say so, not show an empty catalog. */
  catalogError: string | null;
  /** Where the catalog in play came from, for the Catalog panel. */
  catalogSource: { source: 'auto' | 'file' | 'builtin'; name?: string; hash?: string; at?: string; warnings?: string[] } | null;
  /** A sheet is sitting beside the app that differs from the one in play. */
  autoAvail: boolean;

  deskTab: DeskTab;
  /** An estimation opened as a full page at the desk. */
  deskView: string | null;
}

export const INITIAL_STATE: AppState = {
  ready: false,
  auth: null,
  practice: '',
  platform: '',
  lastPlatform: '',
  estimations: [],
  requests: [],
  solutions: [],
  bundles: [],
  openEstimation: null,
  draft: { ...EMPTY_SNAPSHOT },
  display: { ...DEFAULT_DISPLAY },
  presenting: false,
  loadedCatalogs: {},
  catalogError: null,
  catalogSource: null,
  autoAvail: false,
  deskTab: 'queue',
  deskView: null
};

export interface NewEstimationInput {
  name: string;
  client: string;
  tag: EstimationTag;
  due: string;
}

export interface NewRequestInput {
  title: string;
  details: string;
  area: string;
  urgency: string;
  integrations: string;
  name: string;
  email: string;
  org: string;
}

export interface EstimateSubmission {
  hours: number;
  repeatHours?: number;
  bundleId: string;
  form: string;
  deploy: string;
  integrations: string;
  category: string;
  subCategory: string;
  account: string;
  limits: string;
  note: string;
  by: string;
}

export interface NewSolutionInput {
  name: string;
  desc: string;
  first: number;
  repeat: number;
  bundleId: string;
  form: string;
  deploy: string;
  integrations: string;
  category: string;
  subCategory: string;
  account: string;
  limits: string;
  note: string;
}

/**
 * Every transition, and only transitions.
 *
 * There is no `switchRole`, `choosePractice`, `setDeskTab` or `setDeskView` here any more:
 * changing screen goes through `applyRoute`, so the address bar cannot drift out of step with
 * what is on it. Navigate with `router.navigate` from `useApp()`, never by dispatching a screen
 * change directly.
 */
export type Action =
  | { type: 'hydrate'; payload: Partial<AppState> }
  | { type: 'mergeEstimations'; estimations: Estimation[] }
  | { type: 'ready' }
  | { type: 'signIn'; user: string; role: Role }
  | { type: 'signOut' }
  | { type: 'choosePlatform'; practice: string; platform: string }
  | { type: 'createEstimation'; input: NewEstimationInput }
  | { type: 'openEstimation'; id: string }
  | { type: 'closeEstimation' }
  | { type: 'deleteEstimation'; id: string }
  | { type: 'patchEstimation'; id: string; patch: Partial<Pick<Estimation, 'tag' | 'due' | 'name' | 'client'>> }
  | { type: 'toggleSolution'; id: string }
  | { type: 'clearSelection' }
  | { type: 'selectMany'; ids: string[]; selected: boolean }
  | { type: 'patchDraft'; patch: Partial<EstimationSnapshot> }
  | { type: 'setLineBuffer'; id: string; hours: number | null }
  | { type: 'setRoles'; roles: RateRole[] }
  | { type: 'assignRole'; ids: string[]; roleId: string | null }
  | { type: 'patchPlan'; patch: Record<string, PlanEntry> }
  | { type: 'setPlanEntry'; key: string; entry: PlanEntry | null }
  | { type: 'resetPlan' }
  | { type: 'levelPeople'; keys: string[]; people: number }
  | { type: 'setCurrency'; currency: CurrencyCode }
  | { type: 'setDisplay'; patch: Partial<DisplayPrefs> }
  | { type: 'togglePresenting' }
  | { type: 'addRequest'; input: NewRequestInput }
  | { type: 'addManualItem'; title: string; hours: number }
  | { type: 'deleteRequest'; id: string }
  | { type: 'submitEstimate'; id: string; submission: EstimateSubmission }
  | { type: 'addSolution'; input: NewSolutionInput }
  | { type: 'removeSolution'; id: string }
  | { type: 'addBundle'; name: string; pitch: string; offerWhen: string }
  | { type: 'removeBundle'; id: string }
  | { type: 'setLoadedCatalog'; platform: string; catalog: Catalog | null; source: AppState['catalogSource'] }
  | { type: 'applyRoute'; route: Route }
  | { type: 'setAutoAvail'; available: boolean }
  | { type: 'setCatalogError'; message: string | null };

const platOf = (state: AppState): string => state.platform || 'openedx';

/** The open estimation, with the live draft folded in and its cached totals refreshed. */
export function commitDraft(state: AppState, totals?: { hours: number; cost: number; items: number }): Estimation[] {
  if (!state.openEstimation) return state.estimations;
  return state.estimations.map((estimation) =>
    estimation.id === state.openEstimation
      ? {
          ...estimation,
          up: today(),
          total: totals?.hours ?? estimation.total,
          cost: totals?.cost ?? estimation.cost,
          items: totals?.items ?? estimation.items,
          snap: state.draft
        }
      : estimation
  );
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return { ...state, ...action.payload };

    /* A sibling tab rewrote the list. Anything open here keeps its local copy — the draft in
       this tab is unsaved work, and the other tab could not have known about it. */
    case 'mergeEstimations': {
      if (!state.openEstimation || state.auth?.role === 'estimator') return { ...state, estimations: action.estimations };
      const mine = state.estimations.find((estimation) => estimation.id === state.openEstimation);
      if (!mine) return { ...state, estimations: action.estimations };
      const merged = action.estimations.some((estimation) => estimation.id === state.openEstimation)
        ? action.estimations.map((estimation) => (estimation.id === state.openEstimation ? mine : estimation))
        : [...action.estimations, mine];
      return { ...state, estimations: merged };
    }

    case 'ready':
      return { ...state, ready: true };

    case 'setAutoAvail':
      return { ...state, autoAvail: action.available };

    /* Signing in and out both clear the platform, so you always land on the picker.
       The choice survives as lastPlatform for the one-click shortcut. */
    case 'signIn':
      return {
        ...state,
        auth: { user: action.user, role: action.role, at: Date.now() },
        practice: '',
        platform: '',
        lastPlatform: state.platform || state.lastPlatform,
        openEstimation: null,
        deskView: null
      };

    case 'signOut':
      return {
        ...state,
        auth: null,
        practice: '',
        platform: '',
        lastPlatform: state.platform || state.lastPlatform,
        openEstimation: null,
        deskView: null
      };

    case 'choosePlatform':
      return {
        ...state,
        practice: action.practice,
        platform: action.platform,
        lastPlatform: action.platform,
        openEstimation: null,
        draft: { ...EMPTY_SNAPSHOT },
        deskView: null,
        deskTab: 'queue',
        catalogSource: null
      };

    case 'createEstimation': {
      const id = `EST-${Date.now().toString(36)}`;
      const stamp = today();
      const plat = platOf(state);
      const estimation: Estimation = {
        id,
        plat,
        name: action.input.name,
        /* unique within the platform only, because that is the scope a URL carries */
        slug: uniqueSlug(
          action.input.name,
          state.estimations.filter((one) => (one.plat || 'openedx') === plat).map((one) => one.slug),
          id
        ),
        client: action.input.client,
        tag: action.input.tag,
        due: action.input.due,
        at: stamp,
        up: stamp,
        total: 0,
        cost: 0,
        items: 0,
        snap: { ...EMPTY_SNAPSHOT, roles: [...DEFAULT_ROLES] }
      };
      return {
        ...state,
        estimations: [...commitDraft(state), estimation],
        openEstimation: id,
        draft: estimation.snap
      };
    }

    case 'openEstimation': {
      const target = state.estimations.find((estimation) => estimation.id === action.id);
      if (!target) return state;
      return {
        ...state,
        estimations: commitDraft(state),
        openEstimation: action.id,
        draft: { ...EMPTY_SNAPSHOT, ...target.snap }
      };
    }

    case 'closeEstimation':
      return { ...state, estimations: commitDraft(state), openEstimation: null, draft: { ...EMPTY_SNAPSHOT } };

    case 'deleteEstimation': {
      const estimations = state.estimations.filter((estimation) => estimation.id !== action.id);
      const requests = state.requests.filter((request) => request.estId !== action.id);
      const wasOpen = state.openEstimation === action.id;
      return {
        ...state,
        estimations,
        requests,
        openEstimation: wasOpen ? null : state.openEstimation,
        draft: wasOpen ? { ...EMPTY_SNAPSHOT } : state.draft,
        deskView: state.deskView === action.id ? null : state.deskView
      };
    }

    case 'patchEstimation':
      return {
        ...state,
        estimations: state.estimations.map((estimation) =>
          estimation.id === action.id ? { ...estimation, ...action.patch, up: today() } : estimation
        )
      };

    case 'toggleSolution': {
      const sel = { ...state.draft.sel };
      if (sel[action.id]) delete sel[action.id];
      else sel[action.id] = true;
      return { ...state, draft: { ...state.draft, sel } };
    }

    case 'clearSelection':
      return { ...state, draft: { ...state.draft, sel: {} } };

    case 'selectMany': {
      const sel = { ...state.draft.sel };
      for (const id of action.ids) {
        if (action.selected) sel[id] = true;
        else delete sel[id];
      }
      return { ...state, draft: { ...state.draft, sel } };
    }

    case 'patchDraft':
      return { ...state, draft: { ...state.draft, ...action.patch } };

    case 'setLineBuffer': {
      const buf = { ...(state.draft.buf ?? {}) };
      if (action.hours === null || !(action.hours > 0)) delete buf[action.id];
      else buf[action.id] = action.hours;
      return { ...state, draft: { ...state.draft, buf } };
    }

    case 'setRoles':
      return { ...state, draft: { ...state.draft, roles: action.roles } };

    case 'assignRole': {
      const lineRole = { ...(state.draft.lineRole ?? {}) };
      for (const id of action.ids) {
        if (action.roleId) lineRole[id] = action.roleId;
        else delete lineRole[id];
      }
      return { ...state, draft: { ...state.draft, lineRole } };
    }

    case 'patchPlan': {
      const plan = { ...(state.draft.plan ?? {}) };
      for (const [key, entry] of Object.entries(action.patch)) plan[key] = { ...(plan[key] ?? {}), ...entry };
      return { ...state, draft: { ...state.draft, plan } };
    }

    case 'setPlanEntry': {
      const plan = { ...(state.draft.plan ?? {}) };
      if (action.entry === null) {
        delete plan[action.key];
      } else {
        const merged: PlanEntry = { ...(plan[action.key] ?? {}), ...action.entry };
        for (const key of Object.keys(merged) as (keyof PlanEntry)[]) {
          if (merged[key] === null || merged[key] === undefined) delete merged[key];
        }
        /* an entry with nothing left in it is the same as no entry */
        if (Object.keys(merged).length === 0) delete plan[action.key];
        else plan[action.key] = merged;
      }
      return { ...state, draft: { ...state.draft, plan } };
    }

    case 'resetPlan':
      return { ...state, draft: { ...state.draft, plan: {} } };

    case 'levelPeople': {
      const plan = { ...(state.draft.plan ?? {}) };
      for (const key of action.keys) plan[key] = { ...(plan[key] ?? {}), people: action.people };
      return { ...state, draft: { ...state.draft, plan } };
    }

    case 'setCurrency':
      return { ...state, draft: { ...state.draft, cur: action.currency } };

    case 'setDisplay':
      return { ...state, display: { ...state.display, ...action.patch }, presenting: false };

    case 'togglePresenting':
      return { ...state, presenting: !state.presenting };

    case 'addRequest': {
      const open = state.estimations.find((estimation) => estimation.id === state.openEstimation);
      const request: EstimateRequest = {
        ...action.input,
        id: nextId('RQ', state.requests, 'id'),
        plat: platOf(state),
        estId: state.openEstimation ?? '',
        estName: open?.name ?? '',
        client: open?.client ?? '',
        at: today()
      };
      return { ...state, requests: [...state.requests, request] };
    }

    case 'addManualItem': {
      const open = state.estimations.find((estimation) => estimation.id === state.openEstimation);
      const request: EstimateRequest = {
        id: nextId('RQ', state.requests, 'id'),
        plat: platOf(state),
        estId: state.openEstimation ?? '',
        estName: open?.name ?? '',
        client: open?.client ?? '',
        title: action.title,
        details: 'Manually added custom item',
        area: 'Custom',
        urgency: '',
        integrations: '',
        name: '',
        email: '',
        org: '',
        at: today(),
        manual: true,
        est: action.hours
      };
      return { ...state, requests: [...state.requests, request] };
    }

    case 'deleteRequest':
      return { ...state, requests: state.requests.filter((request) => request.id !== action.id) };

    case 'submitEstimate': {
      const request = state.requests.find((candidate) => candidate.id === action.id);
      if (!request) return state;
      const { submission } = action;
      const catalogId = request.csId || nextId('CS', state.solutions, 'id');
      const stamp = today();

      const updated: EstimateRequest = {
        ...request,
        est: submission.hours,
        repeatEst: submission.repeatHours && submission.repeatHours > 0 ? submission.repeatHours : submission.hours,
        csId: catalogId,
        catBundle: submission.bundleId,
        catForm: submission.form,
        catDeploy: submission.deploy,
        catInteg: submission.integrations,
        catCategory: submission.category,
        catSub: submission.subCategory,
        catAccount: submission.account,
        catLimits: submission.limits,
        estNote: submission.note,
        estBy: submission.by,
        estAt: stamp
      };

      const solution: AddedSolution = {
        id: catalogId,
        plat: request.plat || platOf(state),
        bundleId: submission.bundleId,
        name: request.title,
        desc: request.details,
        first: submission.hours,
        repeat: updated.repeatEst ?? submission.hours,
        form: submission.form,
        deploy: submission.deploy,
        integrations: submission.integrations,
        category: submission.category,
        subCategory: submission.subCategory,
        account: submission.account,
        limits: submission.limits,
        note: submission.note,
        from: request.id,
        estName: request.estName,
        estAt: stamp,
        direct: false
      };

      return {
        ...state,
        requests: state.requests.map((candidate) => (candidate.id === action.id ? updated : candidate)),
        solutions: state.solutions.some((candidate) => candidate.id === catalogId)
          ? state.solutions.map((candidate) => (candidate.id === catalogId ? solution : candidate))
          : [...state.solutions, solution]
      };
    }

    case 'addSolution': {
      const solution: AddedSolution = {
        ...action.input,
        id: nextId('CS', state.solutions, 'id'),
        plat: platOf(state),
        from: '',
        estAt: today(),
        direct: true
      };
      return { ...state, solutions: [...state.solutions, solution] };
    }

    case 'removeSolution': {
      const sel = { ...state.draft.sel };
      delete sel[action.id];
      return {
        ...state,
        solutions: state.solutions.filter((solution) => solution.id !== action.id),
        draft: { ...state.draft, sel }
      };
    }

    case 'addBundle': {
      const bundle: AddedBundle = {
        id: nextId('CB', state.bundles, 'id'),
        plat: platOf(state),
        name: action.name,
        pitch: action.pitch,
        offerWhen: action.offerWhen,
        pairsWith: null,
        at: today()
      };
      return { ...state, bundles: [...state.bundles, bundle] };
    }

    case 'removeBundle':
      return { ...state, bundles: state.bundles.filter((bundle) => bundle.id !== action.id) };

    case 'setCatalogError':
      return { ...state, catalogError: action.message };

    case 'setLoadedCatalog': {
      const loadedCatalogs = { ...state.loadedCatalogs };
      if (action.catalog) loadedCatalogs[action.platform] = action.catalog;
      else delete loadedCatalogs[action.platform];
      return { ...state, loadedCatalogs, catalogSource: action.source, autoAvail: false, catalogError: action.catalog ? null : state.catalogError };
    }

    /**
     * A URL, turned into state. The only place navigation flows this way — everywhere else the
     * address bar follows state. See `state/useRouting.ts` for the bridge.
     *
     * A link is an instruction, so it may switch role: `/p/openedx/desk` opens the desk even if
     * you were last in sales, and an estimation link puts you back in sales. Role is a one-click
     * toggle in the chrome anyway, so honouring the link is less surprising than ignoring it.
     */
    case 'applyRoute': {
      const { route } = action;
      const auth = state.auth;
      if (!auth) return state;

      let next = state;

      /* platform first: choosing one clears the open estimation, which we may be about to set */
      const ref = route.platform ? findPlatform(route.platform) : null;
      if (ref && ref.platform.id !== next.platform) {
        next = reducer(next, { type: 'choosePlatform', practice: ref.practice.id, platform: ref.platform.id });
      }

      if (route.screen === 'practices') {
        const closed = next.openEstimation ? reducer(next, { type: 'closeEstimation' }) : next;
        /* `/practices` with no practice is the "← All practices" link, so an absent one clears the
           choice rather than keeping it — otherwise the back link would appear to do nothing. */
        return { ...closed, practice: route.practice ?? '', platform: '', deskView: null };
      }

      const wanted: Role = route.screen === 'desk' ? 'estimator' : route.screen === 'root' ? auth.role : 'sales';
      if (wanted !== auth.role) next = { ...next, auth: { ...auth, role: wanted } };

      const target = route.estimation ? findEstimation(next, route.estimation) : null;

      /* The desk deliberately leaves the open estimation alone. Which screen shows is decided by
         role, not by `openEstimation`, so a sales person who ducks into the desk and comes back
         lands in the builder they left — the round trip the chrome's ⇄ pill has always offered.
         The URL stays honest either way, because `routeOfState` reads the role first. */
      if (route.screen === 'desk') {
        return { ...next, deskTab: target ? 'estimations' : route.tab ?? 'queue', deskView: target?.id ?? null };
      }

      if (route.screen === 'builder' && target) {
        return next.openEstimation === target.id ? next : reducer(next, { type: 'openEstimation', id: target.id });
      }

      /* the hub, or a link whose estimation has since been deleted — land on the list, not a blank */
      return next.openEstimation ? reducer(next, { type: 'closeEstimation' }) : next;
    }

    default:
      return state;
  }
}

/* --------------------------------------------------------------- selectors */

export const currentPlatform = (state: AppState): string => platOf(state);

/** Estimations for the platform in play. Platforms never mix. */
export const platformEstimations = (state: AppState): Estimation[] =>
  state.estimations.filter((estimation) => (estimation.plat || 'openedx') === platOf(state));

export const platformRequests = (state: AppState): EstimateRequest[] =>
  state.requests.filter((request) => (request.plat || 'openedx') === platOf(state));

/** Requests belonging to the open estimation. */
export const openRequests = (state: AppState): EstimateRequest[] =>
  state.requests.filter((request) => request.estId === state.openEstimation);

export const requestsFor = (state: AppState, estimationId: string): EstimateRequest[] =>
  state.requests.filter((request) => request.estId === estimationId);

export const openEstimationRecord = (state: AppState): Estimation | null =>
  state.estimations.find((estimation) => estimation.id === state.openEstimation) ?? null;

/**
 * An estimation on the platform in play, by slug.
 *
 * The id is accepted as well, so a link copied before slugs existed still opens the right deal,
 * and so does one someone assembled by hand from a spreadsheet row.
 */
export function findEstimation(state: AppState, slugOrId: string): Estimation | null {
  const key = String(slugOrId ?? '').trim().toLowerCase();
  if (!key) return null;
  const here = platformEstimations(state);
  return here.find((one) => (one.slug ?? '').toLowerCase() === key) ?? here.find((one) => one.id.toLowerCase() === key) ?? null;
}

/**
 * Where the catalog in play came from, in the phrasing the rail and the catalog panel share.
 */
export function catalogSourceLabel(state: AppState): string {
  const live = isLiveCatalog(state.platform);
  const source = state.catalogSource;
  if (!live) {
    if (state.loadedCatalogs[state.platform]) return `loaded from ${source?.name ?? 'your sheet'}`;
    return `industry benchmark set for ${findPlatform(state.platform)?.platform.name ?? 'this platform'}`;
  }
  if (source?.source === 'file') return `loaded from ${source.name ?? 'your sheet'}`;
  if (source?.source === 'builtin') return 'built-in copy of the master sheet';
  if (source?.source === 'auto') return `live from ${source.name ?? 'the sheet beside the app'}`;
  return 'from the master sales sheet';
}

/** What sales may see right now — presentation mode hides the economics. */
export function effectiveDisplay(state: AppState): DisplayPrefs {
  if (state.presenting) return { savings: false, notes: false, money: false, controls: false, blendBuffer: true };
  return state.display;
}

/** The slice that belongs in the spreadsheet. */
export function toPersisted(state: AppState): PersistedState {
  return {
    estimations: commitDraft(state),
    requests: state.requests,
    solutions: state.solutions,
    bundles: state.bundles,
    settings: {}
  };
}
