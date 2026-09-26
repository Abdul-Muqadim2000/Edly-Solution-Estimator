/**
 * The domain, typed once.
 *
 * Two families of type live here:
 *   - catalog types  — what Edly can sell (parsed from a spreadsheet, or shipped as a benchmark)
 *   - workspace types — what a salesperson produces (estimations, requests, plans)
 *
 * Everything persisted is JSON-serialisable: the store writes it to a spreadsheet.
 */

/* ------------------------------------------------------------------ catalog */

/** A solution's lifecycle. `Estimation` is scoped-and-priced work that is not built yet. */
export type SolutionStatus = 'Production' | 'In Development' | 'Estimation' | 'Sample';

export interface Solution {
  id: string;
  name: string;
  desc: string;
  /** How it is delivered — "Integration · Out-of-the-box", "Custom development", … */
  form: string | null;
  status: SolutionStatus;
  /** Standard deployment time as written in the sheet ("2–3 days"). */
  deploy: string | null;
  /** Hours to deliver it the first time for a client. `null` = not estimated. */
  first: number | null;
  /** Hours to repeat it for the next client. */
  repeat: number | null;
  /** Hours already spent engineering it. `null` for anything not yet built. */
  build: number | null;
  /** Fraction saved by reuse, 0–1. */
  saving: number | null;
  /** Third-party account the client must hold (Stripe, Zoom, …). */
  account: string | null;
  integrations: string | null;
  notes: string | null;
  ref: string | null;
  category: string | null;
  subCategory: string | null;
}

export interface Bundle {
  id: string;
  name: string;
  pitch: string;
  offerWhen: string;
  featureCount: number;
  solutionIds?: string | null;
  buildHrs: number | null;
  firstHrs: number | null;
  repeatHrs: number | null;
  saved: number | null;
  noEstimate: number;
  inDev: number;
  accounts: string | null;
  pairsWith: string | null;
  price?: string | null;
  items: Solution[];
  /** True for a bundle created in-app rather than read from the sheet. */
  own?: boolean;
}

export interface CatalogTotals {
  features: number;
  buildHrs: number | null;
  firstHrs: number | null;
  repeatHrs: number | null;
  saved: number | null;
  noEstimate: number;
  inDev: number;
}

export interface CatalogMeta {
  title: string;
  subtitle: string;
  compiled: string;
  totals: CatalogTotals;
  notes: string[];
  /** Benchmark data rather than delivery records. Drives the "Sample" labelling. */
  sample?: boolean;
}

export interface Catalog {
  meta: CatalogMeta;
  bundles: Bundle[];
}

/* ---------------------------------------------------- practices & platforms */

export interface Platform {
  id: string;
  name: string;
  /** True only for the platform whose catalog comes from the master sheet. */
  live?: boolean;
  note?: string;
  catalog?: Catalog;
}

export interface Practice {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  platforms: Platform[];
}

export interface PlatformRef {
  practice: Practice;
  platform: Platform;
}

/* ------------------------------------------------------------------- people */

export type Role = 'sales' | 'estimator';

export interface Auth {
  user: string;
  role: Role;
  at: number;
}

/** Which of the estimation desk's three tabs is showing. Lives here because the URL names it too. */
export type DeskTab = 'queue' | 'estimations' | 'add';

/** A line on the rate card. Hours are billed at the rate of the role assigned to them. */
export interface RateRole {
  id: string;
  name: string;
  /** USD per hour. Display currency is applied at render time. */
  rate: number;
}

/* --------------------------------------------------------------- estimations */

export type EstimationTag = 'Active' | 'Urgent' | 'On hold' | 'Closed';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'PKR' | 'AED';

/** One task's placement in the delivery plan. */
export interface PlanEntry {
  /** Week offset, in half-week steps. Absent = auto-sequenced. */
  start?: number;
  /** How many people are on it; duration = hours ÷ (people × hoursPerWeek). */
  people?: number;
  /** Position in the auto-sequencing order. */
  order?: number;
  /** Legacy: role was stored here before the rate card became the single source. */
  role?: string | null;
}

/** Everything that makes one estimation's numbers reproducible. */
export interface EstimationSnapshot {
  /** Selected solution ids. */
  sel: Record<string, boolean>;
  /** Per-line risk buffer, in hours. */
  buf: Record<string, number>;
  /** Global risk buffer, percent. */
  bufPct: number;
  pm?: number | null;
  qa?: number | null;
  /** Blended fallback rate, USD/hour. */
  rate?: number | null;
  cur?: CurrencyCode;
  /** Legacy Gantt start overrides. */
  gs?: Record<string, number>;
  /** Team capacity, hours per week (legacy). */
  cap?: number;
  roles?: RateRole[] | null;
  /** Solution or request id → rate-card role id. */
  lineRole?: Record<string, string>;
  pmRole?: string;
  qaRole?: string;
  plan?: Record<string, PlanEntry>;
  /** Productive hours one person contributes per week. */
  hpw?: number;
  /** How many people may work in parallel. */
  maxPar?: number;
  /** Kick-off date, ISO yyyy-mm-dd. */
  planStart?: string;
}

export interface Estimation {
  id: string;
  /** Platform this estimation belongs to. Estimations never mix platforms. */
  plat: string;
  name: string;
  /**
   * URL name, unique within the platform — what a deep link is built from.
   *
   * Assigned once at creation and never rewritten, so a link pasted into Slack still resolves
   * after the deal is renamed. Lookups accept the id too, for links made before slugs existed.
   */
  slug: string;
  client: string;
  /** Empty on the estimation seeded for a fresh workspace; the hub shows it as Active. */
  tag: EstimationTag | '';
  /** Deadline, ISO yyyy-mm-dd. */
  due: string;
  /** Created, ISO yyyy-mm-dd. */
  at: string;
  /** Last updated, ISO yyyy-mm-dd. */
  up: string;
  /** Cached grand total in hours, for list views. */
  total: number;
  /** Cached cost in USD. */
  cost: number;
  /** Cached count of selected solutions. */
  items: number;
  snap: EstimationSnapshot;
}

/* ------------------------------------------------------------------ requests */

/** A custom-estimate request: sales asks, the desk prices it. */
export interface EstimateRequest {
  id: string;
  plat: string;
  estId: string;
  estName: string;
  client: string;
  title: string;
  details: string;
  area: string;
  urgency: string;
  integrations: string;
  /** Who asked. */
  name: string;
  email: string;
  org: string;
  /** Submitted, ISO yyyy-mm-dd. */
  at: string;
  /** Added by sales as a placeholder rather than submitted for estimation. */
  manual?: boolean;

  /** Hours returned by the desk. Undefined means still pending. */
  est?: number;
  repeatEst?: number;
  estBy?: string;
  estAt?: string;
  estNote?: string;

  /** Catalog entry created when the desk priced it. */
  csId?: string;
  catBundle?: string;
  catForm?: string;
  catDeploy?: string;
  catInteg?: string;
  catCategory?: string;
  catSub?: string;
  catAccount?: string;
  catLimits?: string;

  /** Tender this request was drafted from, and the requirement within it. */
  tender?: string;
  tenderReq?: string;
}

/** A solution added to a catalog by the estimation desk. */
export interface AddedSolution {
  id: string;
  plat: string;
  bundleId: string;
  name: string;
  desc: string;
  first: number;
  repeat: number;
  form: string;
  deploy: string;
  integrations: string;
  category: string;
  subCategory: string;
  account: string;
  limits: string;
  note: string;
  /** Request it came from, empty when entered directly at the desk. */
  from: string;
  estName?: string;
  estAt: string;
  direct?: boolean;
}

/** A bundle category created in-app. */
export interface AddedBundle {
  id: string;
  plat: string;
  name: string;
  pitch: string;
  offerWhen: string;
  pairsWith: string | null;
  at: string;
}

/* ------------------------------------------------------------------- tenders */

/**
 * Where a tender is in its review. The AI proposes at every step; nothing reaches an estimation
 * or the desk until a person approves it at the step that owns it.
 */
export type TenderStage = 'requirements' | 'match' | 'apply' | 'done';

/** A file the tender arrived in, as held at Anthropic for the analysis. */
export interface TenderDocument {
  /** Position in the tender, from 1. The model and the UI both refer to documents by it. */
  n: number;
  name: string;
  /** `pdf` is read page by page; `text` was converted in the browser and carries part markers. */
  kind: 'pdf' | 'text';
  bytes: number;
  /** Pages of a PDF, or parts of converted text. 0 when not yet counted. */
  pages: number;
  /** Files API id. Blank once the file has been deleted at Anthropic. */
  fileId: string;
  /** When Anthropic deletes the file regardless, ISO timestamp. */
  expiresAt: string;
}

/** A heading in a tender document and the pages it spans. */
export interface TenderSection {
  doc: number;
  title: string;
  from: number;
  to: number;
}

export type Confidence = 'high' | 'medium' | 'low';

/** Which platform the tender belongs on, as the AI read it. A person makes the choice. */
export interface PlatformFit {
  platform: string;
  confidence: Confidence;
  reasons: string[];
  alternatives: { platform: string; reason: string }[];
  /** Substantial parts of the tender that belong on another platform. */
  elsewhere: { platform: string; what: string }[];
}

/** One slice of one document, extracted in one call so no call outlives a function's time limit. */
export interface TenderRange {
  key: string;
  doc: number;
  from: number;
  /** Last page, inclusive. 0 means to the end, for a document whose length is unknown. */
  to: number;
  /** `running` is a claim: some tab is reading it, so no other tab starts the same call. */
  status: 'pending' | 'running' | 'done' | 'failed';
  /** When the claim was made, epoch ms. A stale claim belongs to a tab that went away. */
  startedAt?: number;
  /** Which tab holds the claim. Random per page load, never shown and never meaningful elsewhere. */
  by?: string;
  error?: string;
  /** Requirements this range contributed. */
  found?: number;
}

export type RequirementPriority = 'must' | 'should';
export type RequirementStatus = 'proposed' | 'approved' | 'removed';
/** catalog: fully covered. partial: covered in part, remainder to the desk. custom: all to the desk. out: not Edly's work. */
export type MatchKind = 'catalog' | 'partial' | 'custom' | 'out';

/** A draft desk request, as a person reworded it at the apply step. */
export interface DeskDraftEdit {
  title?: string;
  details?: string;
  area?: string;
  integrations?: string;
}

export interface RequirementMatch {
  kind: MatchKind;
  /** Catalog solution ids. Hours are always read from the catalog, never from the AI. */
  solutionIds: string[];
  confidence: Confidence;
  reason: string;
  /** For a partial match: what the catalog does not cover. */
  remainder: string;
  /** Bundle id closest to the work, for the desk request. Blank for something new. */
  area: string;
  integrations: string;
  /** A person accepted it. */
  approved: boolean;
  /** A person changed what the AI proposed. */
  edited?: boolean;
  draft?: DeskDraftEdit;
  /** Leave this one out of the desk requests. */
  skip?: boolean;
}

export interface TenderRequirement {
  id: string;
  doc: number;
  /** Physical page in a PDF, or part in converted text. 0 when unknown. */
  page: number;
  section: string;
  text: string;
  /** The tender's own wording, so the desk and the bid team can check the paraphrase. */
  quote: string;
  priority: RequirementPriority;
  /** Hardware, insurance, contract terms: obligations that are not software delivery. */
  outOfScope: boolean;
  status: RequirementStatus;
  /** Added or reworded by a person. */
  edited?: boolean;
  match?: RequirementMatch;
}

/** Tokens the AI used on this tender, for cost visibility. */
export interface TenderTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Tender {
  id: string;
  /** Platform chosen at the fit step. Tenders never mix platforms, like everything else. */
  plat: string;
  name: string;
  /** URL name, unique within the platform. Assigned once and never rewritten, as for estimations. */
  slug: string;
  client: string;
  /** Submission deadline, ISO yyyy-mm-dd. */
  due: string;
  summary: string;
  at: string;
  up: string;
  stage: TenderStage;
  docs: TenderDocument[];
  fit: PlatformFit | null;
  outline: TenderSection[];
  ranges: TenderRange[];
  reqs: TenderRequirement[];
  /** The estimation created at the apply step. */
  estId: string;
  /** When the desk requests went out, ISO yyyy-mm-dd. */
  sentAt: string;
  tokens: TenderTokens;
}

/* --------------------------------------------------------------- persistence */

/** The shape the spreadsheet stores and /api/state exchanges. */
export interface PersistedState {
  estimations: Estimation[];
  requests: EstimateRequest[];
  solutions: AddedSolution[];
  bundles: AddedBundle[];
  tenders: Tender[];
  /** UI preferences and per-platform loaded catalogs, keyed by storage key. */
  settings: Record<string, unknown>;
}

/* ------------------------------------------------------- computed estimates */

export interface EstimateGroup {
  id: string;
  name: string;
  items: Solution[];
  first: number;
  repeat: number;
}

export interface RoleCostRow {
  id: string;
  name: string;
  rate: number;
  color: string;
  hrs: number;
  cost: number;
  assigned: boolean;
  overhead?: boolean;
}

export interface EstimateResult {
  rate: number;
  pm: number;
  qa: number;
  pmH: number;
  qaH: number;
  /** Hours returned by the desk for custom items. */
  estSum: number;
  /** Custom items still awaiting hours. */
  pend: number;
  itemBufSum: number;
  bufPct: number;
  pctH: number;
  bufH: number;
  selIds: string[];
  groups: EstimateGroup[];
  first: number;
  repeat: number;
  build: number;
  inDev: number;
  noEst: number;
  accts: string[];
  grand: number;
  savedPct: number | null;
  roles: RateRole[];
  roleRows: RoleCostRow[];
  assignedH: number;
  unassignedH: number;
  lineRole: Record<string, string>;
  effRate: number;
  /** Cost in USD, role-aware. */
  usd: number;
  days: number;
  weeks: number;
}

/* -------------------------------------------------------------- the planner */

export type TaskKind = 'sol' | 'custom' | 'buffer' | 'span';

export interface PlanTask {
  key: string;
  name: string;
  group: string;
  kind: TaskKind;
  hrs: number;
  people: number;
  role: (RateRole & { color: string }) | null;
  roleId: string;
  dur: number;
  start: number;
  order: number;
  pinned: boolean;
  span?: boolean;
}

export interface Schedule {
  tasks: PlanTask[];
  /** Tasks plus the PM/QA bars that span the whole delivery. */
  bars: PlanTask[];
  weeks: number;
  end: number;
  peak: number;
  /** People committed per half-week. */
  lane: number[];
  cap: number;
  hpw: number;
  over: boolean;
  people: number;
}
