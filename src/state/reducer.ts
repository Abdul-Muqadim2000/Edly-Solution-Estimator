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
  EstimationStage,
  EstimationTag,
  PersistedState,
  Person,
  PlanEntry,
  RateRole,
  RequirementMatch,
  RequirementPriority,
  RequirementStatus,
  RequestStage,
  Role,
  SalesLegalCategory,
  SalesLegalItem,
  SheetDetails,
  Tender,
  TenderRange,
  TenderRequirement,
  TenderTerm,
  TenderTokens
} from '@/types';
import type { Route } from '@/lib/router';
import { cachedTotals, calcEstimate, DEFAULT_ROLES, type CachedTotals } from '@/domain/estimate';
import {
  addExtracted,
  addTokens,
  approvedToGoOn,
  canSpend,
  highestId,
  newTender,
  planTermReads,
  sectionRanges,
  serialId,
  splitTermRead,
  sortRequirements,
  splitRange,
  tenderRequests,
  type Claim,
  type DeskContact,
  type DeskDraft,
  type ExtractedRequirement,
  type NewTenderInput
} from '@/domain/tender';
import { addTerms, copiedItems, deletable, handItem, patchItem, salesLegalDrafts, salesLegalItems, type ExtractedTerm, type HandItemInput, type SalesLegalPatch } from '@/domain/salesLegal';
import { DEMO_ID, demoPrefix, isDemoEstimation, isDemoId, isDemoRequest, isDemoSolution, resetDemo, withDemo, withoutDemo } from '@/domain/demo';
import { DEFAULT_SHEET, readSheetPrefs, type SheetColumnId, type SheetPrefs, type SheetSectionId } from '@/domain/taskBreakdown';
import { planEstimateImport, removeImported, type EstimateRow } from '@/domain/estimateImport';
import { nextBundleId } from '@/domain/catalog';
import { isAwaiting, stageOf, stageOnFiling, stageOnSettled } from '@/domain/stages';
import { isAdmin, nextAssignments, sameAssignees } from '@/domain/people';
import type { ImportReview } from '@/domain/importReview';
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
  /**
   * Who can sign in, names and roles only, as the store last listed them. Never persisted and never
   * saved back: the accounts are the admin panel's to change (`/api/users`).
   */
  people: Person[];
  /** The admin panel is showing. It belongs to no platform. */
  adminPanel: boolean;

  practice: string;
  platform: string;
  /** Offered as a shortcut on the picker after signing in. */
  lastPlatform: string;

  estimations: Estimation[];
  requests: EstimateRequest[];
  solutions: AddedSolution[];
  bundles: AddedBundle[];
  tenders: Tender[];
  /** What each deal commits Edly to that is not software, for the sales, account and legal teams. */
  salesLegal: SalesLegalItem[];

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
  /**
   * Every stored row a person deleted in this tab, by id. Held in memory only, and sent with a save
   * that holds nothing, which the server otherwise refuses (see `toPersisted`).
   */
  deleted: string[];
}

export const INITIAL_STATE: AppState = {
  ready: false,
  auth: null,
  people: [],
  adminPanel: false,
  practice: '',
  platform: '',
  lastPlatform: '',
  estimations: [],
  requests: [],
  solutions: [],
  bundles: [],
  tenders: [],
  salesLegal: [],
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
  deskView: null,
  deleted: []
};

export interface NewEstimationInput {
  name: string;
  client: string;
  tag: EstimationTag;
  due: string;
  /** In progress when not given: a deal made from the hub is opened and worked on straight away. */
  stage?: EstimationStage;
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
  /** Usernames to put on it as it is filed. */
  assign?: string[];
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
  /** Notes / Assumptions, one entry. Blank for none. */
  notes: string;
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
  /** Notes / Assumptions, one entry. Blank for none. */
  notes: string;
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
  | { type: 'signIn'; user: string; role: Role; name?: string }
  /** The store's list of people, from each read. */
  | { type: 'setPeople'; people: Person[] }
  /** Sets who is on a deal or a request. `at` is for tests; the reducer stamps the time otherwise. */
  | { type: 'setAssignees'; ticket: 'deal' | 'request'; id: string; users: string[]; at?: string }
  | { type: 'signOut' }
  | { type: 'choosePlatform'; practice: string; platform: string }
  | { type: 'createEstimation'; input: NewEstimationInput }
  | { type: 'openEstimation'; id: string }
  | { type: 'closeEstimation' }
  | { type: 'deleteEstimation'; id: string }
  | { type: 'patchEstimation'; id: string; patch: Partial<Pick<Estimation, 'tag' | 'stage' | 'due' | 'name' | 'client'>> }
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
  | { type: 'setSheet'; columns?: Partial<Record<SheetColumnId, boolean>>; sections?: Partial<Record<SheetSectionId, boolean>>; catalogNotes?: boolean }
  | { type: 'resetSheet' }
  | { type: 'setSheetDetails'; patch: Pick<SheetDetails, 'contact' | 'comments'> }
  /** `catalogNote` is what the line prints with no entry of its own; typing it back removes the entry. */
  | { type: 'setLineNote'; id: string; note: string; catalogNote?: string }
  | { type: 'addRequest'; input: NewRequestInput }
  | { type: 'addManualItem'; title: string; hours: number }
  | { type: 'deleteRequest'; id: string }
  | { type: 'setRequestStage'; id: string; stage: RequestStage }
  | { type: 'submitEstimate'; id: string; submission: EstimateSubmission }
  | { type: 'addSolution'; input: NewSolutionInput }
  | { type: 'removeSolution'; id: string }
  | { type: 'setSolutionNotes'; id: string; notes: string }
  | { type: 'addBundle'; name: string; pitch: string; offerWhen: string; catalogBundleIds: readonly string[] }
  | { type: 'removeBundle'; id: string }
  /** `catalogBundles`: the bundles on screen when the person clicked, which rows are filed under.
      `review`: what the person approved, renamed and moved; without one, everything as proposed. */
  | { type: 'importEstimates'; rows: EstimateRow[]; file: string; catalogBundles: { id: string; name: string }[]; review?: ImportReview }
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
  /** `index`: the section's place in the tender's outline, which never changes after creation */
  | { type: 'readSection'; id: string; index: number }
  | { type: 'addRequirement'; id: string; input: { text: string; section: string; priority: RequirementPriority } }
  | { type: 'editRequirement'; id: string; reqId: string; patch: Partial<Pick<TenderRequirement, 'text' | 'section' | 'priority' | 'outOfScope'>> }
  | { type: 'setRequirementStatus'; id: string; reqIds: string[]; status: RequirementStatus }
  | { type: 'combineRequirements'; id: string; reqIds: string[] }
  | { type: 'duplicateRequirement'; id: string; reqId: string }
  /** `texts`: each requirement's wording when the match was asked for, so a stale answer is dropped */
  | { type: 'setMatches'; id: string; matches: Record<string, RequirementMatch>; texts?: Record<string, string>; tokens?: Partial<TenderTokens> }
  | { type: 'claimRanges'; id: string; keys: string[]; claim: Claim }
  | { type: 'addTenderTokens'; id: string; tokens: Partial<TenderTokens> }
  /** A person saw the tender reach its AI limit and agreed to spend another step on it. */
  | { type: 'allowMoreAi'; id: string }
  | { type: 'editMatch'; id: string; reqId: string; patch: Partial<RequirementMatch> }
  | { type: 'approveMatches'; id: string; reqIds: string[]; approved: boolean }
  | { type: 'clearMatches'; id: string; reqIds: string[] }
  | { type: 'applyTender'; id: string; input: NewEstimationInput; solutionIds: string[] }
  | { type: 'sendTenderRequests'; id: string; drafts: DeskDraft[]; contact: DeskContact }
  | { type: 'forgetTenderFiles'; id: string; fileIds: string[] }
  /* ---- sales, account and legal. The AI proposes categories and terms; a person keeps or changes them. ---- */
  /** The tender's items not on its estimation yet, found or accepted after the estimation was created. */
  | { type: 'addTenderItems'; id: string }
  /** `copies`: also give a team to items already on the estimation with none, because a person asked for the sort */
  | { type: 'setCategories'; id: string; categories: Record<string, SalesLegalCategory>; tokens?: Partial<TenderTokens>; copies?: boolean }
  | { type: 'editTerm'; id: string; termId: string; patch: Partial<Pick<TenderTerm, 'category' | 'skip'>> }
  /** A person asked for the key terms of a tender created without them. */
  | { type: 'readTermsNow'; id: string }
  | { type: 'claimTerms'; id: string; keys: string[]; claim: Claim }
  | { type: 'termsDone'; id: string; key: string; found: ExtractedTerm[]; tokens?: Partial<TenderTokens> }
  | { type: 'termsFailed'; id: string; key: string; error: string; tokens?: Partial<TenderTokens> }
  | { type: 'retryTerms'; id: string; key: string; claim?: Claim }
  | { type: 'splitTerms'; id: string; key: string; claim?: Claim }
  | { type: 'addSalesLegal'; estId: string; input: HandItemInput }
  | { type: 'patchSalesLegal'; ids: string[]; patch: SalesLegalPatch }
  | { type: 'deleteSalesLegal'; id: string }
  /* ---- the demo estimation, which lives in memory only ---- */
  /** Put the demo back as prepared: whatever was tried on it, and anything made inside it, goes. */
  | { type: 'resetDemo' };

const platOf = (state: AppState): string => state.platform || 'openedx';

/**
 * The id the next request takes. Made while the demo is open it is a demo id, so trying the demo
 * never spends a real number or writes a real row. The request modal quotes the same id in its mail.
 */
export const nextRequestId = (state: AppState): string =>
  nextId(state.openEstimation === DEMO_ID ? demoPrefix('RQ') : 'RQ', state.requests, 'id');

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
    stage: input.stage ?? 'progress',
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
 * A deal's stage after a change to its requests. `change` is `stageOnFiling` or `stageOnSettled`
 * with the requests as they are now. The same state when the deal does not move, and `up` stays
 * put when it does, like a recount: the desk pricing a request is not an edit to the deal.
 */
function moveDeal(state: AppState, estId: string, change: (stage: EstimationStage, waiting: number) => EstimationStage): AppState {
  const deal = state.estimations.find((estimation) => estimation.id === estId);
  if (!deal) return state;
  const waiting = state.requests.filter((request) => request.estId === estId && isAwaiting(request)).length;
  const stage = change(stageOf(deal), waiting);
  if (stage === stageOf(deal)) return state;
  return { ...state, estimations: state.estimations.map((estimation) => (estimation.id === estId ? { ...estimation, stage } : estimation)) };
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

/** The unfinished ranges among `keys`, claimed for a tab; null when none of them is left to claim. */
function claimAll(ranges: readonly TenderRange[], keys: readonly string[], claim: Claim): TenderRange[] | null {
  const wanted = new Set(keys);
  const open = (range: TenderRange): boolean => wanted.has(range.key) && range.status !== 'done' && range.status !== 'failed';
  return ranges.some(open) ? ranges.map((range) => (open(range) ? withClaim(range, claim) : range)) : null;
}

/** A range read to the end: done, with what it found, and its claim gone. */
const finished = (range: TenderRange, found: number): TenderRange => ({ key: range.key, doc: range.doc, from: range.from, to: range.to, status: 'done', found });

/** A failed range queued again, claimed for the tab that asked when it may spend. */
const requeued = (range: TenderRange, claim: Claim | undefined): TenderRange => withClaim({ key: range.key, doc: range.doc, from: range.from, to: range.to, status: 'pending' }, claim);

/** Copies what the tender has for the sales, account and legal teams that its estimation does not have yet. */
function withTenderItems(state: AppState, tender: Tender, estimation: Estimation): AppState {
  const made = salesLegalItems(state.salesLegal, tender, salesLegalDrafts(tender, copiedItems(state.salesLegal, tender.id)), estimation, today());
  return made.length > 0 ? { ...state, salesLegal: [...state.salesLegal, ...made] } : state;
}

/** Fields that change what a match says, as opposed to whether it is approved or sent. */
const MATCH_CONTENT: (keyof RequirementMatch)[] = ['kind', 'solutionIds', 'remainder', 'area', 'integrations'];

/**
 * The actions that are a person deleting something. Only these may name rows as deleted: a read that
 * comes back short is not a delete, and taking one for a delete is how a store gets blanked.
 */
const DELETES: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'deleteEstimation',
  'deleteRequest',
  'removeSolution',
  'removeBundle',
  'removeImport',
  'deleteTender',
  'deleteSalesLegal'
]);

const storedRows = (state: Pick<AppState, 'estimations' | 'requests' | 'solutions' | 'bundles' | 'tenders' | 'salesLegal'>): { id: string }[] => [
  ...state.estimations,
  ...state.requests,
  ...state.solutions,
  ...state.bundles,
  ...state.tenders,
  ...state.salesLegal
];

/** Every row a delete took away, what it took with it included: a deal's requests and its items. The demo's are never stored. */
function noteDeleted(before: AppState, after: AppState): AppState {
  if (after === before) return after;
  const kept = new Set(storedRows(after).map((row) => row.id));
  const gone = storedRows(before)
    .map((row) => row.id)
    .filter((id) => !kept.has(id) && !isDemoId(id));
  if (gone.length === 0) return after;
  return { ...after, deleted: [...new Set([...after.deleted, ...gone])] };
}

export function reducer(state: AppState, action: Action): AppState {
  const next = transition(state, action);
  return DELETES.has(action.type) ? noteDeleted(state, next) : next;
}

function transition(state: AppState, action: Action): AppState {
  switch (action.type) {
    /* Whatever arrives, from browser storage, the store or another tab, holds no demo, because the
       demo is never written anywhere; so it is put back into each collection that arrived. */
    case 'hydrate':
      return withDemo(state, { ...state, ...action.payload }, today());

    /* A sibling tab rewrote the list. Anything open here keeps its local copy — the draft in
       this tab is unsaved work, and the other tab could not have known about it. */
    case 'mergeEstimations': {
      /* the other tab's list never holds the demo, so it is kept from this one; `hydrate` is what adds it */
      const keepDemo = (next: AppState): AppState => (state.estimations.some(isDemoEstimation) ? withDemo(state, next, today()) : next);
      if (!state.openEstimation || state.auth?.role === 'estimator') return keepDemo({ ...state, estimations: action.estimations });
      const mine = state.estimations.find((estimation) => estimation.id === state.openEstimation);
      if (!mine) return keepDemo({ ...state, estimations: action.estimations });
      const merged = action.estimations.some((estimation) => estimation.id === state.openEstimation)
        ? action.estimations.map((estimation) => (estimation.id === state.openEstimation ? mine : estimation))
        : [...action.estimations, mine];
      return keepDemo({ ...state, estimations: merged });
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
        auth: { user: action.user, role: action.role, at: Date.now(), ...(action.name ? { name: action.name } : {}) },
        adminPanel: false,
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
        adminPanel: false,
        practice: '',
        platform: '',
        lastPlatform: state.platform || state.lastPlatform,
        openEstimation: null,
        openTender: null,
        deskView: null
      };

    /* The admin may have changed someone's role or removed them since they signed in. The role
       locks the workspace, so a changed one applies on the next read, and a removed person is
       signed out. Only while the list names anyone: a list that came back empty says nothing
       about who was removed, and signing everyone out on it would be worse than waiting. */
    case 'setPeople': {
      const same = JSON.stringify(state.people) === JSON.stringify(action.people);
      const base = same ? state : { ...state, people: action.people };
      const auth = base.auth;
      if (!auth || isAdmin(auth) || action.people.length === 0) return base;
      const me = action.people.find((one) => one.username === auth.user);
      if (!me) return reducer(base, { type: 'signOut' });
      if (me.role === auth.role && me.name === auth.name) return base;
      const next: AppState = { ...base, auth: { ...auth, role: me.role, name: me.name } };
      /* a new role is a new workspace: its home, not the other workspace's screen */
      if (me.role === auth.role || !next.platform) return next;
      const closed = next.openEstimation ? reducer(next, { type: 'closeEstimation' }) : next;
      return { ...closed, openTender: null, deskView: null, deskTab: 'queue' };
    }

    /* Assigning is not an edit of the deal's numbers, so `up` stays put, as for the automatic stage
       moves. The demo is never saved, so nobody would ever be told: it takes no one. */
    case 'setAssignees': {
      const by = state.auth?.user ?? '';
      const at = action.at ?? new Date().toISOString();
      if (action.ticket === 'deal') {
        const deal = state.estimations.find((one) => one.id === action.id);
        if (!deal || isDemoEstimation(deal) || sameAssignees(deal.assigned, action.users)) return state;
        const assigned = nextAssignments(deal.assigned, action.users, by, at);
        return {
          ...state,
          estimations: state.estimations.map((one) => {
            if (one.id !== action.id) return one;
            const next: Estimation = { ...one, assigned };
            /* no entry rather than an empty one, which is how a deal nobody is on reads back */
            if (assigned.length === 0) delete next.assigned;
            return next;
          })
        };
      }
      const request = state.requests.find((one) => one.id === action.id);
      if (!request || isDemoRequest(request) || sameAssignees(request.assigned, action.users)) return state;
      const assigned = nextAssignments(request.assigned, action.users, by, at);
      return {
        ...state,
        requests: state.requests.map((one) => {
          if (one.id !== action.id) return one;
          const next: EstimateRequest = { ...one, assigned };
          if (assigned.length === 0) delete next.assigned;
          return next;
        })
      };
    }

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
      /* the demo is always there: it is the example people learn the tool from */
      if (isDemoId(action.id)) return state;
      const estimations = state.estimations.filter((estimation) => estimation.id !== action.id);
      const requests = state.requests.filter((request) => request.estId !== action.id);
      /* the deal's own list goes with it; a tender re-applied later copies its items again */
      const salesLegal = state.salesLegal.filter((item) => item.estId !== action.id);
      const wasOpen = state.openEstimation === action.id;
      /* a tender that fed this deal can be applied again; its requests went with the deal */
      const tenders = state.tenders.map((tender) =>
        tender.estId === action.id ? { ...tender, estId: '', sentAt: '', stage: tender.stage === 'done' ? ('apply' as const) : tender.stage } : tender
      );
      return {
        ...state,
        estimations,
        requests,
        salesLegal,
        tenders,
        openEstimation: wasOpen ? null : state.openEstimation,
        draft: wasOpen ? { ...EMPTY_SNAPSHOT } : state.draft,
        deskView: state.deskView === action.id ? null : state.deskView
      };
    }

    case 'patchEstimation': {
      const target = state.estimations.find((estimation) => estimation.id === action.id);
      if (!target) return state;
      /* a card dropped back on its own column, or a menu set to what it shows, is not an edit: the
         deal would otherwise jump to the top of the hub for nothing */
      const unchanged = (Object.keys(action.patch) as (keyof typeof action.patch)[]).every((key) =>
        key === 'stage' ? action.patch.stage === stageOf(target) : action.patch[key] === target[key]
      );
      if (unchanged) return state;
      return {
        ...state,
        estimations: state.estimations.map((estimation) => (estimation.id === action.id ? { ...estimation, ...action.patch, up: today() } : estimation))
      };
    }

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
          sections: { ...state.sheet.sections, ...action.sections },
          catalogNotes: action.catalogNotes ?? state.sheet.catalogNotes
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
      /* An entry is kept only when it differs from what the line prints without one. So text typed
         back to the catalog's removes the entry, and the line follows the catalog again; and
         clearing a line whose catalog has text stores an empty entry, which leaves it off for this
         client, where clearing a line with nothing to fall back on stores nothing. */
      if (action.note.trim() === (action.catalogNote ?? '').trim()) delete notes[action.id];
      else notes[action.id] = action.note.trim() ? action.note : '';
      return { ...state, draft: { ...state.draft, sheet: { ...(state.draft.sheet ?? {}), notes } } };
    }

    case 'addRequest': {
      const open = state.estimations.find((estimation) => estimation.id === state.openEstimation);
      const { assign, ...input } = action.input;
      const request: EstimateRequest = {
        ...input,
        id: nextRequestId(state),
        plat: platOf(state),
        estId: state.openEstimation ?? '',
        estName: open?.name ?? '',
        client: open?.client ?? '',
        at: today()
      };
      const by = state.auth?.user ?? '';
      if (by) request.by = by;
      /* the demo's requests are never saved, so nobody on one would ever be told */
      const assigned = isDemoRequest(request) ? [] : nextAssignments(undefined, assign ?? [], by, new Date().toISOString());
      if (assigned.length > 0) request.assigned = assigned;
      return moveDeal({ ...state, requests: [...state.requests, request] }, request.estId, stageOnFiling);
    }

    case 'addManualItem': {
      const open = state.estimations.find((estimation) => estimation.id === state.openEstimation);
      const request: EstimateRequest = {
        id: nextRequestId(state),
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

    case 'deleteRequest': {
      const gone = state.requests.find((request) => request.id === action.id);
      if (!gone) return state;
      const next = { ...state, requests: state.requests.filter((request) => request.id !== action.id) };
      /* only taking out a request that was still waiting can leave a deal with nothing waiting */
      return isAwaiting(gone) ? moveDeal(next, gone.estId, stageOnSettled) : next;
    }

    /* The desk's own stage for a request, until its hours go back. A priced request is Estimated,
       and moving it would say something its hours contradict, so it stays put. */
    case 'setRequestStage': {
      const target = state.requests.find((request) => request.id === action.id);
      if (!target || Number(target.est) > 0 || (target.stage ?? 'backlog') === action.stage) return state;
      const requests = state.requests.map((request) => {
        if (request.id !== action.id) return request;
        /* who moved it and when, which is what a "needs info" notification says */
        const next: EstimateRequest = { ...request, stage: action.stage, staged: { by: state.auth?.user ?? '', at: new Date().toISOString() } };
        /* no entry rather than a Backlog one, which is how a request nobody has picked up reads back */
        if (action.stage === 'backlog') delete next.stage;
        return next;
      });
      return { ...state, requests };
    }

    case 'submitEstimate': {
      const request = state.requests.find((candidate) => candidate.id === action.id);
      if (!request) return state;
      const { submission } = action;
      /* an estimate priced from a demo request stays in the demo, like the request */
      const catalogId = request.csId || nextId(isDemoRequest(request) ? demoPrefix('CS') : 'CS', state.solutions, 'id');
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
        catNotes: submission.notes,
        estBy: submission.by,
        estAt: stamp,
        /* who returned the hours and when, to the second: what an "estimated" notification says */
        priced: { by: state.auth?.user ?? '', at: new Date().toISOString() }
      };
      /* no entry rather than an empty one, which is how a request with no notes reads back */
      if (!updated.catNotes) delete updated.catNotes;
      /* its hours say where it is now */
      delete updated.stage;

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
        notes: submission.notes,
        from: request.id,
        estName: request.estName,
        estAt: stamp,
        direct: false
      };

      const priced = {
        ...state,
        requests: state.requests.map((candidate) => (candidate.id === action.id ? updated : candidate)),
        solutions: state.solutions.some((candidate) => candidate.id === catalogId)
          ? state.solutions.map((candidate) => (candidate.id === catalogId ? solution : candidate))
          : [...state.solutions, solution]
      };
      /* pricing the last waiting request hands the deal back to sales; updating one already priced does not */
      return isAwaiting(request) ? moveDeal(priced, request.estId, stageOnSettled) : priced;
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

    /* The desk rewording an estimate's note later. The request it was priced from keeps a copy for
       its own line in the sheet, so that copy changes with it. */
    case 'setSolutionNotes': {
      const target = state.solutions.find((solution) => solution.id === action.id);
      const notes = action.notes.trim();
      if (!target || target.notes === notes) return state;
      return {
        ...state,
        solutions: state.solutions.map((solution) => (solution.id === action.id ? { ...solution, notes } : solution)),
        requests: state.requests.map((request) => {
          if (request.csId !== action.id) return request;
          const next: EstimateRequest = { ...request, catNotes: notes };
          if (!notes) delete next.catNotes;
          return next;
        })
      };
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
        id: nextBundleId([...action.catalogBundleIds, ...state.bundles.map((one) => one.id)]),
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
        today: today(),
        review: action.review
      });
      /* a review with groups still pending imports only what was approved; nothing at all is no change */
      if (plan.added.length === 0 && plan.updated.length === 0) return state;
      return { ...state, solutions: plan.solutions, bundles: plan.bundles };
    }

    /* Undoing an import takes its estimates out of every open selection, like removing one does,
       and the bundles its Area column made, unless the desk has since filed something else there. */
    case 'removeImport': {
      const removal = removeImported(state.solutions, state.bundles, platOf(state), action.file);
      if (removal.removed.estimates === 0) return state;
      const kept = new Set(removal.solutions.map((one) => one.id));
      const sel = { ...state.draft.sel };
      for (const one of state.solutions) if (!kept.has(one.id)) delete sel[one.id];
      return { ...state, solutions: removal.solutions, bundles: removal.bundles, draft: { ...state.draft, sel } };
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
     * For the built-in admin a link is an instruction, so it may switch role: `/p/openedx/desk` opens
     * the desk even if the admin was last in sales, and an estimation link puts them back in sales.
     * Everyone else's role locks their workspace (the user's choice, 2026-09-30), so a link into the
     * other one lands on the same deal in their own: a sales person sent a desk link sees the deal
     * in the builder, an estimator sent a deal link sees it on the desk. `inWorkspace` does that.
     */
    case 'applyRoute': {
      const auth = state.auth;
      if (!auth) return state;
      if (action.route.screen === 'admin') return { ...state, estimations: commitDraft(state), adminPanel: true };
      const route = isAdmin(auth) ? action.route : inWorkspace(action.route, auth.role);

      let next: AppState = state.adminPanel ? { ...state, adminPanel: false } : state;

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
          ranges: tender.ranges.map((range) => (range.key === action.key ? finished(range, added) : range))
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

    /* At the limit a Retry or a split queues the part without claiming it: no call will start, and
       a claim would show the part as being read, here and in every other tab, until it went stale. */
    case 'retryRange':
      return withTender(state, action.id, (tender) => {
        if (!tender.ranges.some((range) => range.key === action.key && range.status === 'failed')) return tender;
        const claim = canSpend(tender) ? action.claim : undefined;
        return { ...tender, ranges: tender.ranges.map((range) => (range.key === action.key ? requeued(range, claim) : range)) };
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
        const claim = canSpend(tender) ? action.claim : undefined;
        if (halves) ranges.splice(index, 1, ...halves.map((half) => withClaim(half, claim)));
        else ranges[index] = { ...range, status: 'failed', error: 'Too much on one page to read in one go. Add these requirements by hand.' };
        return { ...tender, ranges };
      });

    /* A person wants a section the AI left out read after all. It is marked read and its pages
       join the queue as pending ranges; the runner picks them up like any other. */
    case 'readSection':
      return withTender(state, action.id, (tender) => {
        const section = tender.outline[action.index];
        if (!section?.skip) return tender;
        return {
          ...tender,
          outline: tender.outline.map((one, index) => (index === action.index ? { doc: one.doc, title: one.title, from: one.from, to: one.to } : one)),
          ranges: [...tender.ranges, ...sectionRanges(tender, section)]
        };
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
        const ranges = claimAll(tender.ranges, action.keys, action.claim);
        return ranges ? { ...tender, ranges } : tender;
      });

    case 'addTenderTokens':
      return withTender(state, action.id, (tender) => ({ ...tender, tokens: addTokens(tender.tokens, action.tokens) }));

    /* refused while there is still room, so a double click agrees to one step, not two */
    case 'allowMoreAi':
      return withTender(state, action.id, (tender) => (canSpend(tender) ? tender : { ...tender, aiApproved: approvedToGoOn(tender) }));

    case 'editMatch':
      return withTender(state, action.id, (tender) =>
        withRequirement(tender, action.reqId, (req) => {
          const base = req.match ?? handMatch();
          const edited = base.edited || MATCH_CONTENT.some((key) => key in action.patch);
          const match: RequirementMatch = { ...base, ...action.patch, edited };
          /* Leaving it out was a choice about where it was going. A new kind sends it somewhere else
             (an item for the legal team turned into custom work goes to the desk), so it is asked again. */
          if (action.patch.kind !== undefined && action.patch.kind !== base.kind && action.patch.skip === undefined) delete match.skip;
          return { ...req, match };
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
      /* the sales, account and legal items go with it, as the apply step says they will */
      const created = withTenderItems({ ...state, estimations: [...state.estimations, estimation] }, tender, estimation);
      return withTender(created, action.id, (one) => ({ ...one, estId: estimation.id, stage: 'apply' }));
    }

    case 'sendTenderRequests': {
      const tender = state.tenders.find((one) => one.id === action.id);
      const estimation = tender ? state.estimations.find((one) => one.id === tender.estId) : undefined;
      if (!tender || !estimation) return state;
      const sent = sentRequirementIds(state, tender.id);
      const fresh = action.drafts.filter((draft) => !sent.has(draft.reqId));
      const made = tenderRequests(state.requests, tender, fresh, action.contact, estimation, today());
      if (made.length === 0) return state;
      const filed = moveDeal({ ...state, requests: [...state.requests, ...made] }, estimation.id, stageOnFiling);
      return withTender(filed, action.id, (one) => ({ ...one, sentAt: today(), stage: 'done' }));
    }

    case 'forgetTenderFiles':
      return withTender(state, action.id, (tender) => {
        const gone = new Set(action.fileIds);
        if (!tender.docs.some((doc) => doc.fileId && gone.has(doc.fileId))) return tender;
        return { ...tender, docs: tender.docs.map((doc) => (gone.has(doc.fileId) ? { ...doc, fileId: '' } : doc)) };
      });

    /* ------------------------------------------ sales, account and legal */

    case 'addTenderItems': {
      const tender = state.tenders.find((one) => one.id === action.id);
      const estimation = tender ? state.estimations.find((one) => one.id === tender.estId) : undefined;
      if (!tender || !estimation) return state;
      return withTenderItems(state, tender, estimation);
    }

    /* The AI's categories land only where nobody has chosen one: a person's choice made while the
       call was out stands, and a requirement no longer out of scope takes none. An item already
       copied to the estimation with no team gets one only when a person pressed Sort them, which is
       how a tender applied before it was sorted still gets its list sorted; the sort that follows
       matching by itself never writes to the estimation. */
    case 'setCategories': {
      const stamp = today();
      let filled = false;
      const salesLegal = state.salesLegal.map((item) => {
        const category = action.categories[item.tenderItem];
        if (!action.copies || item.tender !== action.id || item.category || !category) return item;
        filled = true;
        return { ...item, category, up: stamp };
      });
      return withTender(filled ? { ...state, salesLegal } : state, action.id, (tender) => {
        let sorted = false;
        const reqs = tender.reqs.map((req) => {
          const category = action.categories[req.id];
          if (!category || req.match?.kind !== 'out' || req.match.category) return req;
          sorted = true;
          return { ...req, match: { ...req.match, category } };
        });
        if (!sorted && !action.tokens) return tender;
        return { ...tender, reqs: sorted ? reqs : tender.reqs, tokens: addTokens(tender.tokens, action.tokens) };
      });
    }

    case 'editTerm':
      return withTender(state, action.id, (tender) => {
        const terms = tender.terms ?? [];
        const term = terms.find((one) => one.id === action.termId);
        if (!term) return tender;
        const next: TenderTerm = { ...term, ...(action.patch.category ? { category: action.patch.category } : {}) };
        if (action.patch.skip === true) next.skip = true;
        if (action.patch.skip === false) delete next.skip;
        if (next.category === term.category && next.skip === term.skip) return tender;
        return { ...tender, terms: terms.map((one) => (one.id === term.id ? next : one)) };
      });

    /* The same reads the tick at the start would have queued, for a tender made without it. The runner
       picks them up once the extraction has nothing left to read. */
    case 'readTermsNow':
      return withTender(state, action.id, (tender) => {
        const reads = planTermReads(tender.docs, tender.termReads ?? []);
        if (tender.readTerms && reads.length === 0) return tender;
        return { ...tender, readTerms: true, terms: tender.terms ?? [], termReads: [...(tender.termReads ?? []), ...reads] };
      });

    case 'claimTerms':
      return withTender(state, action.id, (tender) => {
        const termReads = claimAll(tender.termReads ?? [], action.keys, action.claim);
        return termReads ? { ...tender, termReads } : tender;
      });

    case 'termsDone':
      return withTender(state, action.id, (tender) => {
        const reads = tender.termReads ?? [];
        if (!reads.some((read) => read.key === action.key && read.status !== 'done')) return tender;
        const { terms, added } = addTerms(tender.terms ?? [], action.found);
        return {
          ...tender,
          terms,
          tokens: addTokens(tender.tokens, action.tokens),
          termReads: reads.map((read) => (read.key === action.key ? finished(read, added) : read))
        };
      });

    case 'termsFailed':
      return withTender(state, action.id, (tender) => {
        const reads = tender.termReads ?? [];
        if (!reads.some((read) => read.key === action.key)) return tender;
        return {
          ...tender,
          tokens: addTokens(tender.tokens, action.tokens),
          termReads: reads.map((read) => (read.key === action.key ? { ...read, status: 'failed' as const, error: action.error } : read))
        };
      });

    /* One call could not list a document's terms, so its pages are read in two, as a range is. */
    case 'splitTerms':
      return withTender(state, action.id, (tender) => {
        const reads = tender.termReads ?? [];
        const index = reads.findIndex((read) => read.key === action.key);
        const read = reads[index];
        if (!read) return tender;
        const halves = splitTermRead(read);
        const claim = canSpend(tender) ? action.claim : undefined;
        const next = [...reads];
        if (halves) next.splice(index, 1, ...halves.map((half) => withClaim(half, claim)));
        else next[index] = { ...read, status: 'failed', error: 'Too much on one page to list its terms in one go. The legal team can read that page in the tender.' };
        return { ...tender, termReads: next };
      });

    /* at the limit it queues the read without claiming it, as a Retry of a range does */
    case 'retryTerms':
      return withTender(state, action.id, (tender) => {
        const reads = tender.termReads ?? [];
        if (!reads.some((read) => read.key === action.key && read.status === 'failed')) return tender;
        const claim = canSpend(tender) ? action.claim : undefined;
        return { ...tender, termReads: reads.map((read) => (read.key === action.key ? requeued(read, claim) : read)) };
      });

    case 'addSalesLegal': {
      const estimation = state.estimations.find((one) => one.id === action.estId);
      const made = estimation ? handItem(state.salesLegal, action.input, estimation, today()) : null;
      if (!made) return state;
      /* one added to the demo is numbered as the demo's, so it is never written and never takes a real number */
      const item = estimation && isDemoEstimation(estimation) ? { ...made, id: serialId(demoPrefix('SL'), highestId(demoPrefix('SL'), state.salesLegal.map((one) => one.id)) + 1) } : made;
      return { ...state, salesLegal: [...state.salesLegal, item] };
    }

    case 'patchSalesLegal': {
      const ids = new Set(action.ids);
      const stamp = today();
      let changed = false;
      const salesLegal = state.salesLegal.map((item) => {
        if (!ids.has(item.id)) return item;
        const next = patchItem(item, action.patch, stamp);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? { ...state, salesLegal } : state;
    }

    /* An item typed in by hand, or one whose tender is gone. One from a tender that is still there is
       marked Not for us instead: deleted, it would be offered to the estimation again as new. */
    case 'deleteSalesLegal': {
      const target = state.salesLegal.find((item) => item.id === action.id);
      if (!target || !deletable(target, new Set(state.tenders.map((tender) => tender.id)))) return state;
      return { ...state, salesLegal: state.salesLegal.filter((item) => item.id !== action.id) };
    }

    case 'resetDemo': {
      const reset = resetDemo(state, today());
      if (state.openEstimation !== DEMO_ID) return reset;
      const fresh = reset.estimations.find(isDemoEstimation);
      return fresh ? { ...reset, draft: { ...EMPTY_SNAPSHOT, ...fresh.snap } } : reset;
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

/** One estimation's sales, account and legal items, in the order they were added. */
export const salesLegalFor = (state: AppState, estimationId: string): SalesLegalItem[] => state.salesLegal.filter((item) => item.estId === estimationId);

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

/** The master sheet served beside the app. An import added to it records it by this name. */
export const SERVED_CATALOG_FILE = 'catalog-source.xlsx';

/* What `sourceAfterImport` names the base an import was added to when that base was not a file:
   going back to it is what removing the imports does, so it is never listed as one. */
const STANDARD_BASES = new Set([SERVED_CATALOG_FILE, 'the master sheet', 'the benchmark set']);

/**
 * The bundles workbooks merged into this platform's catalog, oldest first, for the import history.
 *
 * Their rows carry no mark of the file they came from, so one cannot be taken out alone; the
 * history offers the standard catalog back instead, which removes all of them. An empty list
 * means the catalog in play is the served sheet or the benchmark set.
 */
export function catalogWorkbooks(state: AppState): { files: string[]; at: string } {
  const base = baseSourceOf(state);
  if (!state.loadedCatalogs[platOf(state)] || base?.source !== 'file') return { files: [], at: '' };
  const loadedFrom = base.name ?? 'your sheet';
  const files = [...(STANDARD_BASES.has(loadedFrom) ? [] : [loadedFrom]), ...(base.added ?? [])];
  return files.length > 0 ? { files, at: base.at ?? '' } : { files: [], at: '' };
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
    /* its cached totals feed nothing (the hub leaves it out of hours in play, and it is never
       saved), and caching them would give the estimations slice a change with nothing to write */
    if (isDemoEstimation(estimation)) continue;
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

/**
 * A route as seen from a workspace its role is locked to: the same deal, on its own side. A sales
 * person's desk link opens the deal in the builder, or the hub; an estimator's deal or tender link
 * opens the deal on the desk, or the queue. Links that are the role's own pass unchanged.
 */
export function inWorkspace(route: Route, role: Role): Route {
  if (route.screen === 'root' || route.screen === 'practices' || route.screen === 'admin') return route;
  const platform = route.platform ? { platform: route.platform } : {};
  if (role === 'estimator') {
    if (route.screen === 'desk') return route;
    return route.screen === 'builder' && route.estimation
      ? { screen: 'desk', ...platform, estimation: route.estimation, tab: 'estimations' }
      : { screen: 'desk', ...platform, tab: 'queue' };
  }
  if (route.screen !== 'desk') return route;
  return route.estimation ? { screen: 'builder', ...platform, estimation: route.estimation } : { screen: 'hub', ...platform };
}

/**
 * Whether the edly.io header, hero and footer show. They are for the client, so they appear only
 * while sales presents a deal in the builder, and every working screen carries Quotient's own
 * header and footer instead. The hub lists every client's deals and the tender screen is
 * internal, so neither shows them even while presenting. The desk keeps the deal open behind it,
 * which is why the role is checked and not only the open estimation.
 */
export function showsSiteChrome(state: AppState): boolean {
  if (!state.presenting || !state.auth || !state.platform) return false;
  /* the same tests App.tsx uses to pick the builder, so the two cannot disagree about the screen */
  return state.auth.role !== 'estimator' && !state.openTender && Boolean(state.openEstimation);
}

/** The slice that belongs in the spreadsheet, and in browser storage: everything but the demo. */
export function toPersisted(state: AppState): PersistedState {
  const persisted = withoutDemo({
    estimations: commitDraft(state),
    requests: state.requests,
    solutions: state.solutions,
    bundles: state.bundles,
    tenders: state.tenders,
    salesLegal: state.salesLegal,
    settings: {},
    /* says this build reads assignments, so a save without one is kept from wiping them */
    knowsPeople: true
  });
  /* a save that holds nothing is refused unless it names what a person deleted; any other save
     goes exactly as it always has */
  if (state.deleted.length === 0 || storedRows(persisted).length > 0) return persisted;
  return { ...persisted, deleted: state.deleted };
}

/**
 * The open estimation as browser storage keeps it. That key is synced to the store's Settings
 * sheet, so the demo's id is never written: opening the demo must not change the store.
 */
export const storedOpenEstimation = (state: Pick<AppState, 'openEstimation'>): string =>
  isDemoId(state.openEstimation) ? '' : state.openEstimation ?? '';

/**
 * The desk's estimates the catalog in play shows. The demo's appear only while the demo is open:
 * their hours were written for the demo, and a real deal must never be able to quote them.
 */
export function catalogAdditions(solutions: AddedSolution[], openEstimation: string | null): AddedSolution[] {
  if (openEstimation === DEMO_ID || !solutions.some(isDemoSolution)) return solutions;
  return solutions.filter((solution) => !isDemoSolution(solution));
}

/** The hub's cards: the demo first, where a newcomer finds it, then the rest, the most recently updated first. */
export function hubEstimations(state: AppState): Estimation[] {
  return platformEstimations(state)
    .slice()
    .sort((a, b) => Number(isDemoEstimation(b)) - Number(isDemoEstimation(a)) || String(b.up).localeCompare(String(a.up)));
}

export interface HubStats {
  /** Deals not closed. */
  open: number;
  /** Their hours, as each caches them. */
  hours: number;
  /** Requests still waiting on the desk. */
  awaiting: number;
}

/** The hub's three figures, which are about real deals, so the demo counts in none of them. */
export function hubStats(state: AppState): HubStats {
  const real = platformEstimations(state).filter((estimation) => !isDemoEstimation(estimation));
  const open = real.filter((estimation) => estimation.tag !== 'Closed');
  const awaiting = real.reduce(
    (total, estimation) => total + requestsFor(state, estimation.id).filter((request) => !request.manual && !(Number(request.est) > 0)).length,
    0
  );
  return { open: open.length, hours: open.reduce((total, estimation) => total + Number(estimation.total ?? 0), 0), awaiting };
}

/**
 * The desk's request queue for one deal, or for all of them when `deal` is blank. `rows` lists the
 * demo's requests after the real ones; `counted` is what the figures above the queue add up, which
 * leaves the demo out unless the desk is looking at the demo itself, and `leftOut` says how many
 * listed requests the figures leave out, so the screen can say so.
 */
export function deskQueue(state: AppState, deal: string): { rows: EstimateRequest[]; counted: EstimateRequest[]; leftOut: number } {
  const all = platformRequests(state).filter((request) => !request.manual && (!deal || request.estId === deal));
  const rows = [...all.filter((request) => !isDemoRequest(request)), ...all.filter(isDemoRequest)];
  const counted = deal === DEMO_ID ? rows : rows.filter((request) => !isDemoRequest(request));
  return { rows, counted, leftOut: rows.length - counted.length };
}
