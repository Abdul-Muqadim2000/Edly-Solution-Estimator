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
  RequirementMatch,
  RequirementPriority,
  RequirementStatus,
  Role,
  SheetDetails,
  Tender,
  TenderRange,
  TenderRequirement,
  TenderTokens
} from '@/types';
import type { Route } from '@/lib/router';
import { cachedTotals, calcEstimate, DEFAULT_ROLES, type CachedTotals } from '@/domain/estimate';
import {
  addExtracted,
  addTokens,
  newTender,
  sortRequirements,
  splitRange,
  tenderRequests,
  type Claim,
  type DeskContact,
  type DeskDraft,
  type ExtractedRequirement,
  type NewTenderInput
} from '@/domain/tender';
import { DEFAULT_SHEET, readSheetPrefs, type SheetColumnId, type SheetPrefs, type SheetSectionId } from '@/domain/taskBreakdown';
import { planEstimateImport, type EstimateRow } from '@/domain/estimateImport';
import { nextId, today, uniqueSlug } from '@/lib/format';
import { benchmarkCatalog, findPlatform, isLiveCatalog } from '@/data/practices';

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

/** Where the catalog in play came from. */
export interface CatalogSource {
  source: 'auto' | 'file' | 'builtin';
  name?: string;
  hash?: string;
  at?: string;
  warnings?: string[];
  /** Bundles workbooks added on top of `name`, oldest first. */
  added?: string[];
}

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
  tenders: Tender[];

  openEstimation: string | null;
  /** The tender open in its review screen. Never at the same time as an estimation. */
  openTender: string | null;
  /** The open estimation's live snapshot. Committed back on close. */
  draft: EstimationSnapshot;

  display: DisplayPrefs;
  presenting: boolean;
  /** What goes in the downloaded Excel sheet. Separate from what the screen shows. */
  sheet: SheetPrefs;

  /** Catalog loaded by hand, per platform id. */
  loadedCatalogs: Record<string, Catalog>;
  /** Set when the catalog sheet could not be read — the UI must say so, not show an empty catalog. */
  catalogError: string | null;
  /** Where the catalog in play came from, for the Catalog panel. */
  catalogSource: CatalogSource | null;
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
  tenders: [],
  openEstimation: null,
  openTender: null,
  draft: { ...EMPTY_SNAPSHOT },
  display: { ...DEFAULT_DISPLAY },
  presenting: false,
  sheet: DEFAULT_SHEET,
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
  | { type: 'cacheTotals'; totals: Record<string, CachedTotals> }
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
  | { type: 'setSheet'; columns?: Partial<Record<SheetColumnId, boolean>>; sections?: Partial<Record<SheetSectionId, boolean>> }
  | { type: 'resetSheet' }
  | { type: 'setSheetDetails'; patch: Pick<SheetDetails, 'contact' | 'comments'> }
  | { type: 'setLineNote'; id: string; note: string }
  | { type: 'addRequest'; input: NewRequestInput }
  | { type: 'addManualItem'; title: string; hours: number }
  | { type: 'deleteRequest'; id: string }
  | { type: 'submitEstimate'; id: string; submission: EstimateSubmission }
  | { type: 'addSolution'; input: NewSolutionInput }
  | { type: 'removeSolution'; id: string }
  | { type: 'addBundle'; name: string; pitch: string; offerWhen: string }
  | { type: 'removeBundle'; id: string }
  /** `catalogBundles`: the bundles on screen when the person clicked, which rows are filed under. */
  | { type: 'importEstimates'; rows: EstimateRow[]; file: string; catalogBundles: { id: string; name: string }[] }
  | { type: 'removeImport'; file: string }
  | { type: 'moveSolutions'; ids: string[]; bundleId: string }
  | { type: 'setLoadedCatalog'; platform: string; catalog: Catalog | null; source: AppState['catalogSource'] }
  | { type: 'applyRoute'; route: Route }
  | { type: 'setAutoAvail'; available: boolean }
  | { type: 'setCatalogError'; message: string | null }
  /* ---- tenders. The AI only ever proposes; each of these runs because a person clicked. ---- */
  | { type: 'createTender'; id: string; input: NewTenderInput }
  | { type: 'patchTender'; id: string; patch: Partial<Pick<Tender, 'name' | 'client' | 'due' | 'stage'>> }
  | { type: 'deleteTender'; id: string }
  | { type: 'rangeDone'; id: string; key: string; found: ExtractedRequirement[]; tokens?: Partial<TenderTokens> }
  | { type: 'rangeFailed'; id: string; key: string; error: string; tokens?: Partial<TenderTokens> }
  /* `claim`: the tab that asked takes the range in the same step, so no other tab sees it unclaimed */
  | { type: 'retryRange'; id: string; key: string; claim?: Claim }
  | { type: 'splitRange'; id: string; key: string; claim?: Claim }
  | { type: 'addRequirement'; id: string; input: { text: string; section: string; priority: RequirementPriority } }
  | { type: 'editRequirement'; id: string; reqId: string; patch: Partial<Pick<TenderRequirement, 'text' | 'section' | 'priority' | 'outOfScope'>> }
  | { type: 'setRequirementStatus'; id: string; reqIds: string[]; status: RequirementStatus }
  | { type: 'combineRequirements'; id: string; reqIds: string[] }
  | { type: 'duplicateRequirement'; id: string; reqId: string }
  /** `texts`: each requirement's wording when the match was asked for, so a stale answer is dropped */
  | { type: 'setMatches'; id: string; matches: Record<string, RequirementMatch>; texts?: Record<string, string>; tokens?: Partial<TenderTokens> }
  | { type: 'claimRanges'; id: string; keys: string[]; claim: Claim }
  | { type: 'addTenderTokens'; id: string; tokens: Partial<TenderTokens> }
  | { type: 'editMatch'; id: string; reqId: string; patch: Partial<RequirementMatch> }
  | { type: 'approveMatches'; id: string; reqIds: string[]; approved: boolean }
  | { type: 'clearMatches'; id: string; reqIds: string[] }
  | { type: 'applyTender'; id: string; input: NewEstimationInput; solutionIds: string[] }
  | { type: 'sendTenderRequests'; id: string; drafts: DeskDraft[]; contact: DeskContact }
  | { type: 'forgetTenderFiles'; id: string; fileIds: string[] };

const platOf = (state: AppState): string => state.platform || 'openedx';

/**
 * The open estimation, with the live draft folded in.
 *
 * Every transition that stops a deal being open has to fold its draft in first. Persistence
 * writes `commitDraft(state)`, and once nothing is open that is the list as it stood when the
 * deal was opened, so skipping this puts the old snapshot back over everything done since.
 *
 * The cached totals are not worked out here, because the reducer has no catalog to price
 * against; the provider keeps them current through `cacheTotals`.
 */
export function commitDraft(state: AppState): Estimation[] {
  if (!state.openEstimation) return state.estimations;
  return state.estimations.map((estimation) =>
    estimation.id === state.openEstimation ? { ...estimation, up: today(), snap: state.draft } : estimation
  );
}

/** A new estimation on the platform in play, with a slug unique there. Not opened. */
function buildEstimation(state: AppState, input: NewEstimationInput, sel: Record<string, boolean> = {}): Estimation {
  const id = `EST-${Date.now().toString(36)}`;
  const stamp = today();
  const plat = platOf(state);
  return {
    id,
    plat,
    name: input.name,
    /* unique within the platform only, because that is the scope a URL carries */
    slug: uniqueSlug(
      input.name,
      state.estimations.filter((one) => (one.plat || 'openedx') === plat).map((one) => one.slug),
      id
    ),
    client: input.client,
    tag: input.tag,
    due: input.due,
    at: stamp,
    up: stamp,
    total: 0,
    cost: 0,
    items: 0,
    snap: { ...EMPTY_SNAPSHOT, sel, roles: [...DEFAULT_ROLES] }
  };
}

/**
 * One tender changed. `change` hands back the same object when there is nothing to do, and then
 * so does this, so a stale reply for a tender that has moved on is not an edit.
 */
function withTender(state: AppState, id: string, change: (tender: Tender) => Tender): AppState {
  let changed = false;
  const tenders = state.tenders.map((tender) => {
    if (tender.id !== id) return tender;
    const next = change(tender);
    if (next === tender) return tender;
    changed = true;
    return { ...next, up: today() };
  });
  return changed ? { ...state, tenders } : state;
}

/** One requirement changed, inside `withTender`. */
const withRequirement = (tender: Tender, reqId: string, change: (req: TenderRequirement) => TenderRequirement): Tender =>
  tender.reqs.some((req) => req.id === reqId) ? { ...tender, reqs: tender.reqs.map((req) => (req.id === reqId ? change(req) : req)) } : tender;

/** A match a person set by hand, for a requirement the AI has not matched. */
const handMatch = (): RequirementMatch => ({
  kind: 'custom',
  solutionIds: [],
  confidence: 'high',
  reason: 'Set by hand.',
  remainder: '',
  area: '',
  integrations: '',
  approved: false,
  edited: true
});

/** A range, taken by a tab: `running`, stamped with when and by whom. Without a claim, left as it is. */
const withClaim = (range: TenderRange, claim: Claim | undefined): TenderRange =>
  claim ? { ...range, status: 'running', startedAt: claim.at, by: claim.by } : range;

/** Fields that change what a match says, as opposed to whether it is approved or sent. */
const MATCH_CONTENT: (keyof RequirementMatch)[] = ['kind', 'solutionIds', 'remainder', 'area', 'integrations'];

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
        estimations: commitDraft(state),
        auth: { user: action.user, role: action.role, at: Date.now() },
        practice: '',
        platform: '',
        lastPlatform: state.platform || state.lastPlatform,
        openEstimation: null,
        openTender: null,
        deskView: null
      };

    case 'signOut':
      return {
        ...state,
        estimations: commitDraft(state),
        auth: null,
        practice: '',
        platform: '',
        lastPlatform: state.platform || state.lastPlatform,
        openEstimation: null,
        openTender: null,
        deskView: null
      };

    case 'choosePlatform':
      return {
        ...state,
        estimations: commitDraft(state),
        practice: action.practice,
        platform: action.platform,
        lastPlatform: action.platform,
        openEstimation: null,
        openTender: null,
        draft: { ...EMPTY_SNAPSHOT },
        deskView: null,
        deskTab: 'queue',
        catalogSource: null
      };

    case 'createEstimation': {
      const estimation = buildEstimation(state, action.input);
      return {
        ...state,
        estimations: [...commitDraft(state), estimation],
        openEstimation: estimation.id,
        openTender: null,
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
        openTender: null,
        draft: { ...EMPTY_SNAPSHOT, ...target.snap }
      };
    }

    case 'closeEstimation':
      return { ...state, estimations: commitDraft(state), openEstimation: null, draft: { ...EMPTY_SNAPSHOT } };

    case 'deleteEstimation': {
      const estimations = state.estimations.filter((estimation) => estimation.id !== action.id);
      const requests = state.requests.filter((request) => request.estId !== action.id);
      const wasOpen = state.openEstimation === action.id;
      /* a tender that fed this deal can be applied again; its requests went with the deal */
      const tenders = state.tenders.map((tender) =>
        tender.estId === action.id ? { ...tender, estId: '', sentAt: '', stage: tender.stage === 'done' ? ('apply' as const) : tender.stage } : tender
      );
      return {
        ...state,
        estimations,
        requests,
        tenders,
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

    /* A recount, not an edit: `up` stays put, so a deal does not jump up the hub because the
       desk priced one of its requests or the catalog changed under it. */
    case 'cacheTotals': {
      let changed = false;
      const estimations = state.estimations.map((estimation) => {
        const next = action.totals[estimation.id];
        if (!next || (next.total === estimation.total && next.cost === estimation.cost && next.items === estimation.items)) return estimation;
        changed = true;
        return { ...estimation, ...next };
      });
      /* the same object when nothing moved, or the provider's effect would loop */
      return changed ? { ...state, estimations } : state;
    }

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

    /* unlike setDisplay, this leaves presenting alone: the sheet is not what the client is watching */
    case 'setSheet':
      return {
        ...state,
        sheet: readSheetPrefs({
          columns: { ...state.sheet.columns, ...action.columns },
          sections: { ...state.sheet.sections, ...action.sections }
        })
      };

    case 'resetSheet':
      return { ...state, sheet: DEFAULT_SHEET };

    case 'setSheetDetails': {
      const sheet: SheetDetails = { ...(state.draft.sheet ?? {}) };
      for (const key of ['contact', 'comments'] as const) {
        if (!(key in action.patch)) continue;
        const value = action.patch[key] ?? '';
        if (value.trim()) sheet[key] = value;
        else delete sheet[key];
      }
      return { ...state, draft: { ...state.draft, sheet } };
    }

    case 'setLineNote': {
      const notes = { ...(state.draft.sheet?.notes ?? {}) };
      /* a cleared note is removed, not stored as an empty string the sheet would print */
      if (action.note.trim()) notes[action.id] = action.note;
      else delete notes[action.id];
      return { ...state, draft: { ...state.draft, sheet: { ...(state.draft.sheet ?? {}), notes } } };
    }

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

    case 'importEstimates': {
      if (action.rows.length === 0) return state;
      const plan = planEstimateImport({
        rows: action.rows,
        file: action.file,
        platform: platOf(state),
        catalogBundles: action.catalogBundles,
        solutions: state.solutions,
        bundles: state.bundles,
        today: today()
      });
      return { ...state, solutions: plan.solutions, bundles: plan.bundles };
    }

    /* Undoing an import takes its estimates out of every open selection, like removing one does,
       and the bundles its Area column made, unless the desk has since filed something else there. */
    case 'removeImport': {
      const plat = platOf(state);
      const mine = (one: { plat: string; imported?: string }): boolean => (one.plat || 'openedx') === plat && one.imported === action.file;
      const gone = new Set(state.solutions.filter(mine).map((one) => one.id));
      if (gone.size === 0) return state;
      const solutions = state.solutions.filter((one) => !gone.has(one.id));
      const occupied = new Set(solutions.map((one) => one.bundleId));
      const sel = { ...state.draft.sel };
      for (const id of gone) delete sel[id];
      return {
        ...state,
        solutions,
        bundles: state.bundles.filter((bundle) => !(mine(bundle) && !occupied.has(bundle.id))),
        draft: { ...state.draft, sel }
      };
    }

    case 'moveSolutions': {
      const ids = new Set(action.ids);
      if (!action.bundleId || ids.size === 0) return state;
      return {
        ...state,
        solutions: state.solutions.map((one) => (ids.has(one.id) && one.bundleId !== action.bundleId ? { ...one, bundleId: action.bundleId } : one))
      };
    }

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
        return { ...closed, practice: route.practice ?? '', platform: '', deskView: null, openTender: null };
      }

      const wanted: Role = route.screen === 'desk' ? 'estimator' : route.screen === 'root' ? auth.role : 'sales';
      if (wanted !== auth.role) next = { ...next, auth: { ...auth, role: wanted } };

      const target = route.estimation ? findEstimation(next, route.estimation) : null;

      /* The desk deliberately leaves the open estimation alone. Which screen shows is decided by
         role, not by `openEstimation`, so a sales person who ducks into the desk and comes back
         lands in the builder they left, which is the round trip the chrome's ⇄ pill has always offered.
         The URL stays honest either way, because `routeOfState` reads the role first.

         It does commit the draft, though. The desk reads `estimations`, so without this it shows
         the deal as it was when it was opened: "0 h, 0 solutions" for a deal with three picked. */
      if (route.screen === 'desk') {
        return {
          ...next,
          estimations: commitDraft(next),
          deskTab: target ? 'estimations' : route.tab ?? 'queue',
          deskView: target?.id ?? null
        };
      }

      if (route.screen === 'builder' && target) {
        return next.openEstimation === target.id ? { ...next, openTender: null } : reducer(next, { type: 'openEstimation', id: target.id });
      }

      /* A tender replaces the builder rather than sitting beside it, so the deal that was open is
         committed and closed first, the same as going back to the hub. */
      const tender = route.screen === 'tender' && route.tender ? findTender(next, route.tender) : null;
      if (tender) {
        const closed = next.openEstimation ? reducer(next, { type: 'closeEstimation' }) : next;
        return { ...closed, openTender: tender.id };
      }

      /* the hub, or a link whose estimation or tender has since been deleted: land on the list, not a blank */
      const closed = next.openEstimation ? reducer(next, { type: 'closeEstimation' }) : next;
      return closed.openTender ? { ...closed, openTender: null } : closed;
    }

    /* ------------------------------------------------------------ tenders */

    case 'createTender': {
      if (state.tenders.some((tender) => tender.id === action.id)) return state;
      return { ...state, tenders: [...state.tenders, newTender(action.input, action.id, state.tenders, today())] };
    }

    case 'patchTender':
      return withTender(state, action.id, (tender) => ({ ...tender, ...action.patch }));

    case 'deleteTender':
      return {
        ...state,
        tenders: state.tenders.filter((tender) => tender.id !== action.id),
        openTender: state.openTender === action.id ? null : state.openTender
      };

    case 'rangeDone':
      return withTender(state, action.id, (tender) => {
        if (!tender.ranges.some((range) => range.key === action.key && range.status !== 'done')) return tender;
        const { reqs, added } = addExtracted(tender.reqs, action.found);
        return {
          ...tender,
          reqs,
          tokens: addTokens(tender.tokens, action.tokens),
          ranges: tender.ranges.map((range) =>
            range.key === action.key ? { key: range.key, doc: range.doc, from: range.from, to: range.to, status: 'done' as const, found: added } : range
          )
        };
      });

    case 'rangeFailed':
      return withTender(state, action.id, (tender) => {
        if (!tender.ranges.some((range) => range.key === action.key)) return tender;
        return {
          ...tender,
          tokens: addTokens(tender.tokens, action.tokens),
          ranges: tender.ranges.map((range) => (range.key === action.key ? { ...range, status: 'failed' as const, error: action.error } : range))
        };
      });

    case 'retryRange':
      return withTender(state, action.id, (tender) => {
        if (!tender.ranges.some((range) => range.key === action.key && range.status === 'failed')) return tender;
        return {
          ...tender,
          ranges: tender.ranges.map((range) => (range.key === action.key ? withClaim({ key: range.key, doc: range.doc, from: range.from, to: range.to, status: 'pending' }, action.claim) : range))
        };
      });

    /* One call could not finish the range, so it becomes two. A single page that still cannot
       finish is left failed with the reason, rather than retried forever. */
    case 'splitRange':
      return withTender(state, action.id, (tender) => {
        const index = tender.ranges.findIndex((range) => range.key === action.key);
        const range = tender.ranges[index];
        if (!range) return tender;
        const halves = splitRange(range);
        const ranges = [...tender.ranges];
        if (halves) ranges.splice(index, 1, ...halves.map((half) => withClaim(half, action.claim)));
        else ranges[index] = { ...range, status: 'failed', error: 'Too much on one page to read in one go. Add these requirements by hand.' };
        return { ...tender, ranges };
      });

    case 'addRequirement':
      return withTender(state, action.id, (tender) => {
        const text = action.input.text.trim();
        if (!text) return tender;
        const added: TenderRequirement = {
          id: nextId('R', tender.reqs, 'id'),
          doc: 0,
          page: 0,
          section: action.input.section.trim(),
          text,
          quote: '',
          priority: action.input.priority,
          outOfScope: false,
          /* a person wrote it, so there is nothing to approve */
          status: 'approved',
          edited: true
        };
        return { ...tender, reqs: sortRequirements([...tender.reqs, added]) };
      });

    /* Rewording a requirement, or moving it in or out of scope, makes its match stale, so the
       match is dropped and the match step offers to run it again. */
    case 'editRequirement':
      return withTender(state, action.id, (tender) =>
        withRequirement(tender, action.reqId, (req) => {
          const next: TenderRequirement = { ...req, ...action.patch, edited: true };
          const stale = (action.patch.text !== undefined && action.patch.text !== req.text) || (action.patch.outOfScope !== undefined && action.patch.outOfScope !== req.outOfScope);
          if (stale) delete next.match;
          return next;
        })
      );

    case 'setRequirementStatus':
      return withTender(state, action.id, (tender) => {
        const ids = new Set(action.reqIds);
        if (!tender.reqs.some((req) => ids.has(req.id) && req.status !== action.status)) return tender;
        return { ...tender, reqs: tender.reqs.map((req) => (ids.has(req.id) ? { ...req, status: action.status } : req)) };
      });

    /* The first requirement, in list order, absorbs the others. */
    case 'combineRequirements':
      return withTender(state, action.id, (tender) => {
        const ids = new Set(action.reqIds);
        const picked = tender.reqs.filter((req) => ids.has(req.id));
        const [first, ...rest] = picked;
        if (!first || rest.length === 0) return tender;
        const combined: TenderRequirement = {
          id: first.id,
          doc: first.doc,
          page: first.page,
          section: first.section,
          text: picked.map((req) => req.text).join(' '),
          quote: picked.map((req) => req.quote).filter(Boolean).join(' / '),
          priority: picked.some((req) => req.priority === 'must') ? 'must' : 'should',
          outOfScope: picked.every((req) => req.outOfScope),
          status: picked.some((req) => req.status === 'approved') ? 'approved' : 'proposed',
          edited: true
        };
        const gone = new Set(rest.map((req) => req.id));
        return { ...tender, reqs: tender.reqs.filter((req) => !gone.has(req.id)).map((req) => (req.id === first.id ? combined : req)) };
      });

    /* How a requirement is split: copy it, then reword each half. */
    case 'duplicateRequirement':
      return withTender(state, action.id, (tender) => {
        const source = tender.reqs.find((req) => req.id === action.reqId);
        if (!source) return tender;
        const copy: TenderRequirement = { ...source, id: nextId('R', tender.reqs, 'id'), status: 'proposed', edited: true };
        delete copy.match;
        return { ...tender, reqs: sortRequirements([...tender.reqs, copy]) };
      });

    /* A proposal lands only where nothing has happened since it was asked for: the requirement is
       still approved, still unmatched, and still worded as it was sent. A match a person set by
       hand while the call was out, or one made for wording since changed, would otherwise be
       replaced by the AI's answer to a question nobody is asking any more. */
    case 'setMatches':
      return withTender(state, action.id, (tender) => {
        const reqs = tender.reqs.map((req) => {
          const match = action.matches[req.id];
          const current = req.status === 'approved' && !req.match && (!action.texts || action.texts[req.id] === req.text);
          return match && current ? { ...req, match } : req;
        });
        return { ...tender, reqs, tokens: addTokens(tender.tokens, action.tokens) };
      });

    /* Before a tab calls the AI for a range it claims it, so no other tab starts the same call. */
    case 'claimRanges':
      return withTender(state, action.id, (tender) => {
        const keys = new Set(action.keys);
        if (!tender.ranges.some((range) => keys.has(range.key) && range.status !== 'done' && range.status !== 'failed')) return tender;
        return {
          ...tender,
          ranges: tender.ranges.map((range) =>
            keys.has(range.key) && range.status !== 'done' && range.status !== 'failed' ? withClaim(range, action.claim) : range
          )
        };
      });

    case 'addTenderTokens':
      return withTender(state, action.id, (tender) => ({ ...tender, tokens: addTokens(tender.tokens, action.tokens) }));

    case 'editMatch':
      return withTender(state, action.id, (tender) =>
        withRequirement(tender, action.reqId, (req) => {
          const base = req.match ?? handMatch();
          const edited = base.edited || MATCH_CONTENT.some((key) => key in action.patch);
          return { ...req, match: { ...base, ...action.patch, edited } };
        })
      );

    case 'approveMatches':
      return withTender(state, action.id, (tender) => {
        const ids = new Set(action.reqIds);
        if (!tender.reqs.some((req) => ids.has(req.id) && req.match && req.match.approved !== action.approved)) return tender;
        return {
          ...tender,
          reqs: tender.reqs.map((req) => (ids.has(req.id) && req.match ? { ...req, match: { ...req.match, approved: action.approved } } : req))
        };
      });

    case 'clearMatches':
      return withTender(state, action.id, (tender) => {
        const ids = new Set(action.reqIds);
        if (!tender.reqs.some((req) => ids.has(req.id) && req.match)) return tender;
        return {
          ...tender,
          reqs: tender.reqs.map((req) => {
            if (!ids.has(req.id) || !req.match) return req;
            const next = { ...req };
            delete next.match;
            return next;
          })
        };
      });

    /* The estimation is created with the approved catalog solutions already picked, and left
       closed: the desk requests are the second confirmation, and they attach to it. */
    case 'applyTender': {
      const tender = state.tenders.find((one) => one.id === action.id);
      if (!tender || (tender.estId && state.estimations.some((estimation) => estimation.id === tender.estId))) return state;
      const estimation = buildEstimation(
        { ...state, platform: tender.plat },
        action.input,
        Object.fromEntries(action.solutionIds.map((id) => [id, true]))
      );
      return withTender({ ...state, estimations: [...state.estimations, estimation] }, action.id, (one) => ({ ...one, estId: estimation.id, stage: 'apply' }));
    }

    case 'sendTenderRequests': {
      const tender = state.tenders.find((one) => one.id === action.id);
      const estimation = tender ? state.estimations.find((one) => one.id === tender.estId) : undefined;
      if (!tender || !estimation) return state;
      const sent = sentRequirementIds(state, tender.id);
      const fresh = action.drafts.filter((draft) => !sent.has(draft.reqId));
      const made = tenderRequests(state.requests, tender, fresh, action.contact, estimation, today());
      if (made.length === 0) return state;
      return withTender({ ...state, requests: [...state.requests, ...made] }, action.id, (one) => ({ ...one, sentAt: today(), stage: 'done' }));
    }

    case 'forgetTenderFiles':
      return withTender(state, action.id, (tender) => {
        const gone = new Set(action.fileIds);
        if (!tender.docs.some((doc) => doc.fileId && gone.has(doc.fileId))) return tender;
        return { ...tender, docs: tender.docs.map((doc) => (gone.has(doc.fileId) ? { ...doc, fileId: '' } : doc)) };
      });

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

/** Tenders for the platform in play, newest first. */
export const platformTenders = (state: AppState): Tender[] =>
  state.tenders
    .filter((tender) => (tender.plat || 'openedx') === platOf(state))
    .sort((a, b) => String(b.up).localeCompare(String(a.up)));

export const openTenderRecord = (state: AppState): Tender | null => state.tenders.find((tender) => tender.id === state.openTender) ?? null;

/** A tender on the platform in play, by slug or id, the way `findEstimation` works. */
export function findTender(state: AppState, slugOrId: string): Tender | null {
  const key = String(slugOrId ?? '').trim().toLowerCase();
  if (!key) return null;
  const here = state.tenders.filter((tender) => (tender.plat || 'openedx') === platOf(state));
  return here.find((one) => (one.slug ?? '').toLowerCase() === key) ?? here.find((one) => one.id.toLowerCase() === key) ?? null;
}

/** Requirements of a tender that already have a desk request, so sending twice cannot duplicate one. */
export function sentRequirementIds(state: AppState, tenderId: string): Set<string> {
  return new Set(state.requests.filter((request) => request.tender === tenderId && request.tenderReq).map((request) => request.tenderReq as string));
}

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

const addedLabel = (source: { added?: string[] }): string => (source.added && source.added.length > 0 ? `, plus ${source.added.join(', ')}` : '');

/**
 * Whether the catalog stored for a platform is pinned against the served sheet, and the
 * fingerprint a newer served sheet is compared with.
 *
 * An imported catalog carries its own record (`meta.loaded`), which survives the platform choice
 * a reload makes. A pin in the workspace's source is still honoured for catalogs loaded before
 * that record existed, though the next reload clears it as it always did.
 */
export function catalogPin(stored: Readonly<Record<string, Catalog>>, source: CatalogSource | null, platform: string): { pinned: boolean; hash?: string } {
  const loaded = stored[platform]?.meta.loaded;
  if (loaded) return loaded.hash ? { pinned: true, hash: loaded.hash } : { pinned: true };
  const pinned = source?.source === 'file' || source?.source === 'builtin';
  return source?.hash ? { pinned, hash: source.hash } : { pinned };
}

/** A path or URL's last part: the served sheet is recorded by its URL, and a label wants its name. */
const fileName = (value: string): string => value.split(/[\\/]/).pop() || value;

/**
 * Where the catalog a bundles workbook would be added to came from, for this platform only.
 * `catalogSource` is kept once for the workspace, so on a platform nothing was loaded for it
 * describes some other platform's catalog; the base here is then the benchmark set, or nothing.
 */
export function baseSourceOf(state: AppState): CatalogSource | null {
  const plat = platOf(state);
  const loaded = state.loadedCatalogs[plat]?.meta.loaded;
  if (loaded) return { source: 'file', ...loaded };
  if (state.loadedCatalogs[plat]) return state.catalogSource;
  return benchmarkCatalog(plat) ? { source: 'file', name: 'the benchmark set' } : null;
}

/**
 * Where the catalog came from after a bundles workbook was imported.
 *
 * Replacing starts the record again from the file. Adding keeps what the catalog was loaded from
 * and lists the file beside it, so the label reads "loaded from the master sheet, plus Mobile.xlsx"
 * instead of claiming the whole catalog came from the last file. Either way the source is a file
 * now, which pins it: the served sheet no longer replaces it on the next visit.
 */
export function sourceAfterImport(
  previous: CatalogSource | null,
  file: { name: string; hash: string },
  mode: 'add' | 'replace',
  at: string
): CatalogSource {
  if (mode === 'replace' || !previous || previous.source === 'builtin') return { source: 'file', name: file.name, hash: file.hash, at };
  return {
    source: 'file',
    name: fileName(previous.name ?? 'the master sheet'),
    /* the hash is what a newer served sheet is detected against, so it stays the base's */
    hash: previous.hash ?? file.hash,
    at,
    added: [...(previous.added ?? []), file.name]
  };
}

/**
 * Where the catalog in play came from, in the phrasing the rail and the catalog panel share.
 */
export function catalogSourceLabel(state: AppState): string {
  const live = isLiveCatalog(state.platform);
  const source = state.catalogSource;
  const loaded = state.loadedCatalogs[state.platform]?.meta.loaded;
  if (loaded) return `loaded from ${loaded.name}${addedLabel(loaded)}`;
  if (!live) {
    if (state.loadedCatalogs[state.platform]) return `loaded from ${source?.name ?? 'your sheet'}${source ? addedLabel(source) : ''}`;
    return `industry benchmark set for ${findPlatform(state.platform)?.platform.name ?? 'this platform'}`;
  }
  if (source?.source === 'file') return `loaded from ${source.name ?? 'your sheet'}${addedLabel(source)}`;
  if (source?.source === 'builtin') return 'built-in copy of the master sheet';
  if (source?.source === 'auto') return `live from ${source.name ?? 'the sheet beside the app'}`;
  return 'from the master sales sheet';
}

/**
 * A real catalog is in play, rather than the empty stand-in shown while the Open edX sheet loads
 * or after it failed to. Deals priced against the stand-in come out at 0 h, and caching that
 * would overwrite real totals every time the sheet was slow.
 */
export function catalogReady(state: AppState): boolean {
  if (!state.platform) return false;
  return Boolean(state.loadedCatalogs[state.platform]) || benchmarkCatalog(state.platform) !== null;
}

/**
 * The totals every deal on the platform in play should cache, priced against `catalog`. The
 * open deal is priced from its live draft, the rest from their committed snapshots, and each
 * one counts the desk's hours for its own requests.
 */
export function platformTotals(state: AppState, catalog: Catalog): Record<string, CachedTotals> {
  const totals: Record<string, CachedTotals> = {};
  for (const estimation of platformEstimations(state)) {
    /* the committed snapshot as it is, which is what the deal's hub card prices */
    const snap = estimation.id === state.openEstimation ? state.draft : estimation.snap;
    totals[estimation.id] = cachedTotals(calcEstimate(catalog, snap, requestsFor(state, estimation.id)));
  }
  return totals;
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
    tenders: state.tenders,
    settings: {}
  };
}
