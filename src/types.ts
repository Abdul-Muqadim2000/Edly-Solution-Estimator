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

/* --------------------------------------------------------------- persistence */

/** The shape the spreadsheet stores and /api/state exchanges. */
export interface PersistedState {
  estimations: Estimation[];
  requests: EstimateRequest[];
  solutions: AddedSolution[];
  bundles: AddedBundle[];
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
