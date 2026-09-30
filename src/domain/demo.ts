import type {
  AddedSolution,
  EstimateRequest,
  Estimation,
  EstimationSnapshot,
  PersistedState,
  PlanEntry,
  RateRole,
  RequirementPriority,
  SalesLegalCategory,
  SalesLegalItem,
  SalesLegalStatus,
  TermTopic
} from '@/types';

/**
 * The demo estimation: one finished Open edX deal, built into the app so that everyone who opens
 * Quotient has a worked example of every part of it. Solutions from most bundles, each billed at a
 * role on a rate card with seniority; custom work the estimation desk has priced, which also shows
 * as estimates in the catalog; buffers, overheads and a delivery plan that fills the team sheet;
 * the words on the client's Excel sheet; and the items the sales, account and legal teams own.
 *
 * It is never saved, and that is the point of it. The user chose on 2026-09-30 to have it built in
 * rather than stored: a stored demo is shared by everyone, drifts as people try things on it, and
 * puts invented hours into the Requests and EstimatedSolutions sheets, where a real deal could
 * quote them. So its records live in memory beside the real ones, `withoutDemo` takes them out
 * wherever data leaves for storage, and a reload or Reset puts back the prepared version.
 *
 * Its solutions are picked by id from the master sheet (public/catalog-source.xlsx), and hours are
 * always read from the catalog in play, never from here. The custom work's hours are the desk's,
 * as a priced request's always are. Dates are counted from today, so its deadline never passes.
 */

export const DEMO_ID = 'EST-DEMO';
export const DEMO_SLUG = 'demo-global-certification-academy';
const DEMO_PLATFORM = 'openedx';
const DEMO_NAME = 'Global Certification Academy';
const DEMO_CLIENT = 'Aldercrest Institute';

/* The id is the only mark a demo record carries, so it has to be one no real record can have:
   estimations are EST-<base36, lower case>, and requests, estimates and items are numbered. */
const DEMO_ID_PATTERN = /^(EST|RQ|CS|SL)-DEMO(-\d+)?$/;

export const isDemoId = (id: unknown): boolean => typeof id === 'string' && DEMO_ID_PATTERN.test(id);

export const isDemoEstimation = (one: Pick<Estimation, 'id'>): boolean => isDemoId(one.id);

/** A request of the demo's, including one someone made while trying it out. */
export const isDemoRequest = (one: Pick<EstimateRequest, 'id' | 'estId'>): boolean => isDemoId(one.id) || one.estId === DEMO_ID;

/** An estimate the desk made from a demo request, in the demo or since. */
export const isDemoSolution = (one: Pick<AddedSolution, 'id' | 'from'>): boolean => isDemoId(one.id) || isDemoId(one.from);

export const isDemoItem = (one: Pick<SalesLegalItem, 'id' | 'estId'>): boolean => isDemoId(one.id) || one.estId === DEMO_ID;

/**
 * The prefix for a record made while trying the demo: a request asked for in it, the estimate the
 * desk prices from one, a sales and legal item added to it. `RQ-DEMO-07` can never meet a real
 * `RQ-07`, and `nextId` for real records does not count it.
 */
export const demoPrefix = (prefix: 'RQ' | 'CS' | 'SL'): string => `${prefix}-DEMO`;

/** The collections the demo has records in. The app's state and the persisted state both have them. */
export interface DemoCollections {
  estimations: Estimation[];
  requests: EstimateRequest[];
  solutions: AddedSolution[];
  salesLegal: SalesLegalItem[];
}

/* ------------------------------------------------------------------ dates */

/** `iso` moved by whole days, in UTC like `today()`, so a date never slips across midnight. */
export function shiftDay(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The Monday on or after `iso`: a delivery plan starts on one. */
export function mondayFrom(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return shiftDay(iso, (8 - day) % 7);
}

/* -------------------------------------------------------------- the deal */

/*
 * The rate card. Engineer sits on it at three levels because that is what the card is for: a
 * senior and a junior hour are not the same money. Seven roles, one per role colour.
 */
const ROLES: readonly RateRole[] = [
  { id: 'arch', name: 'Solution Architect', level: 'Principal', rate: 70 },
  { id: 'sr', name: 'Engineer', level: 'Senior', rate: 55 },
  { id: 'eng', name: 'Engineer', level: 'Mid-level', rate: 45 },
  { id: 'jr', name: 'Engineer', level: 'Junior', rate: 30 },
  { id: 'devops', name: 'DevOps Engineer', level: 'Mid-level', rate: 50 },
  { id: 'qa', name: 'QA Engineer', level: 'Mid-level', rate: 35 },
  { id: 'pm', name: 'Project Manager', level: 'Senior', rate: 40 }
];

interface Line {
  /** Catalog solution id in the master sheet, or the request id for custom work. */
  id: string;
  role: string;
  /** People on the bar; one when absent. */
  people?: number;
  /** Risk buffer on this line, in hours. Only a catalog line takes one: pricing and the plan read no buffer on a request. */
  buffer?: number;
  /**
   * What this deal's sheet says for the line. It replaces the catalog's own Notes / Assumptions, so
   * it is only written on lines whose catalog note is empty: a caveat such as "patched platform
   * build" must still reach the client.
   */
  note?: string;
}

/**
 * The solutions picked from the master sheet, bundle by bundle, and who does each. The line buffers
 * sit on the riskiest work and come to 81 hours, which puts the base at 1,500 hours against the
 * sheet's figures: 10% buffer, then 10% PM and 12% QA, gives a total of exactly 2,013 hours.
 */
const LINES: readonly Line[] = [
  /* B01 Commerce & Monetization */
  { id: 'EDU-071', role: 'jr', note: 'Card payments for single courses and the annual membership, in US dollars, euros and pounds, through Aldercrest’s own Stripe account.' },
  { id: 'EDU-073', role: 'jr' },
  { id: 'EDU-074', role: 'arch', buffer: 5 },
  /* B02 Localization & Global Delivery */
  { id: 'EDU-083', role: 'eng' },
  { id: 'EDU-025', role: 'jr' },
  { id: 'EDU-031', role: 'jr', note: 'Course drafts machine-translated into Arabic and French. Aldercrest’s reviewers approve each translation before it is published.' },
  /* B03 AI Learning Experience */
  { id: 'EDU-027', role: 'sr', people: 2, buffer: 30 },
  /* B04 Assessment & Credentialing */
  { id: 'EDU-013', role: 'eng', people: 2, buffer: 16 },
  { id: 'EDU-065', role: 'jr' },
  { id: 'EDU-076', role: 'eng' },
  /* B05 Learning Paths & Curriculum */
  { id: 'EDU-075', role: 'eng', note: 'Three certification programs at launch, each a sequence of four to six courses.' },
  /* B06 Interactive Content Pack */
  { id: 'EDU-057', role: 'jr' },
  { id: 'EDU-052', role: 'jr' },
  { id: 'EDU-055', role: 'jr' },
  /* B07 Learner Engagement & Feedback */
  { id: 'EDU-011', role: 'eng', buffer: 8 },
  { id: 'EDU-006', role: 'jr' },
  /* B09 Branding & White-Label */
  { id: 'EDU-005', role: 'eng' },
  { id: 'EDU-039', role: 'jr', note: 'One design for the academy, restyled for each partner site with its own logo and colours.' },
  /* B10 Multisite & SaaS Operations */
  { id: 'EDU-041', role: 'sr', people: 2, buffer: 10 },
  { id: 'EDU-045', role: 'devops', buffer: 12, note: 'Two partner academies at launch, each on its own subdomain.' },
  { id: 'EDU-068', role: 'devops' },
  /* B11 Admin Productivity Suite */
  { id: 'EDU-063', role: 'jr' },
  { id: 'EDU-079', role: 'devops' },
  { id: 'EDU-080', role: 'devops' },
  { id: 'EDU-087', role: 'jr' },
  /* B12 Analytics, Reporting & Growth */
  { id: 'EDU-048', role: 'jr' },
  { id: 'EDU-047', role: 'arch' },
  { id: 'EDU-077', role: 'jr' },
  { id: 'EDU-078', role: 'devops' },
  /* B13 Identity & SSO */
  { id: 'EDU-088', role: 'devops', note: 'Staff sign in with their Aldercrest Microsoft accounts. Learners use email and password, or Azure AD B2C.' },
  /* B14 WordPress Marketing Site */
  { id: 'EDU-085', role: 'devops' },
  { id: 'EDU-086', role: 'devops' },
  /* B15 Platform Engineering & Integrations */
  { id: 'EDU-034', role: 'devops' },
  { id: 'EDU-066', role: 'arch' }
];

interface Custom extends Line {
  title: string;
  details: string;
  /** The bundle it belongs to: its name is the request's area, which is where the Excel sheet lists it. */
  bundleId: string;
  area: string;
  integrations: string;
  /** Hours the desk returned, first delivery and repeat. */
  est: number;
  repeat: number;
  form: string;
  deploy: string;
  category: string;
  subCategory: string;
  account: string;
  /** The desk's Notes / Assumptions, written for the client. */
  notes: string;
  /** Days after the deal was opened that sales asked, and that the desk answered. */
  asked: number;
  priced: number;
}

/** Work the catalog does not cover, which sales sent to the estimation desk and the desk priced. */
const CUSTOM: readonly Custom[] = [
  {
    id: 'RQ-DEMO-01',
    title: 'Salesforce sync for enrolments, completions and certificates',
    details:
      'Keep Aldercrest’s Salesforce records in step with the academy: new enrolments, course completions, grades and issued certificates are written to each learner’s contact record, so account managers can see training status without leaving Salesforce.',
    bundleId: 'B15',
    area: 'Platform Engineering & Integrations',
    integrations: 'Salesforce REST API',
    est: 96,
    repeat: 40,
    form: 'Service integration',
    deploy: '1 to 2 weeks',
    category: 'Integration',
    subCategory: 'Custom Plugin',
    account: 'Salesforce',
    notes:
      'One-way sync from the platform to Salesforce, every 15 minutes. Assumes a Salesforce org with API access and a sandbox to test in. Custom objects, fields and reports in Salesforce are set up by the client’s Salesforce admin from Edly’s field list.',
    role: 'arch',
    asked: 1,
    priced: 4
  },
  {
    id: 'RQ-DEMO-02',
    title: 'Arabic right-to-left learner experience',
    details:
      'Aldercrest launches in English, Arabic and French. Arabic learners need the dashboard, course pages, course player and certificates laid out right to left, with the same branding as the English site.',
    bundleId: 'B09',
    area: 'Branding & White-Label',
    integrations: '',
    est: 64,
    repeat: 24,
    form: 'Theme / branding',
    deploy: '1 week',
    category: 'MFE (Frontend)',
    subCategory: 'Standalone Module',
    account: '',
    notes:
      'Covers the learner dashboard, course about pages, the course player and certificate templates. Course content is authored right to left by the client. Studio stays left to right.',
    role: 'eng',
    asked: 1,
    priced: 4
  },
  {
    id: 'RQ-DEMO-03',
    title: 'Manager dashboard for team progress and certificate expiry',
    details:
      'Line managers at member firms need one page showing their team’s enrolments, progress and grades, and when each certificate expires, with a CSV export for their own reporting.',
    bundleId: 'B12',
    area: 'Analytics, Reporting & Growth',
    integrations: '',
    est: 120,
    repeat: 60,
    form: 'MFE customization',
    deploy: '1 to 2 weeks',
    category: 'Mixed Feature',
    subCategory: 'Custom Plugin',
    account: '',
    notes:
      'Managers see only the learners who report to them. Reporting lines are loaded each night from a CSV the client provides, or from Salesforce once the sync is live. Up to 5,000 learners in one manager’s view.',
    role: 'sr',
    people: 2,
    asked: 2,
    priced: 5
  },
  {
    id: 'RQ-DEMO-04',
    title: 'SCORM package import and completion tracking',
    details:
      'Aldercrest has about 120 SCORM courses from its current LMS. Course authors need to upload a package into a unit and have completion and score recorded in the gradebook.',
    bundleId: 'B06',
    area: 'Interactive Content Pack (XBlocks)',
    integrations: 'SCORM 1.2, SCORM 2004',
    est: 72,
    repeat: 24,
    form: 'Plugin / extension',
    deploy: '3 to 5 days',
    category: 'XBlock',
    subCategory: 'Custom Plugin',
    account: '',
    notes:
      'Supports SCORM 1.2 and SCORM 2004 packages up to 500 MB. Completion and score pass to the gradebook; tracking of each interaction inside a package is not included. A package that calls an external server needs that server to allow the academy’s domain.',
    role: 'eng',
    asked: 2,
    priced: 6
  },
  {
    id: 'RQ-DEMO-05',
    title: 'Certificate expiry and recertification reminders',
    details:
      'Aldercrest’s professional certificates are valid for two years. Learners should be reminded before theirs expires and enrolled in the recertification course automatically.',
    bundleId: 'B04',
    area: 'Assessment & Credentialing',
    integrations: '',
    est: 48,
    repeat: 16,
    form: 'Custom development',
    deploy: '3 to 5 days',
    category: 'Django App',
    subCategory: 'Custom Plugin',
    account: '',
    notes:
      'Validity is set for each program. Reminder emails go 60, 30 and 7 days before a certificate expires, through the platform’s email service. An expired certificate stays on the learner’s record, marked as expired.',
    role: 'eng',
    asked: 3,
    priced: 7
  },
  {
    id: 'RQ-DEMO-06',
    title: 'Migration from the current LMS: learners, transcripts and certificates',
    details:
      'Move about 40,000 learner accounts, their completion history and the certificates already issued from Aldercrest’s current LMS, so every learner keeps their record from the first day.',
    bundleId: 'B15',
    area: 'Platform Engineering & Integrations',
    integrations: 'Current LMS export (CSV or SQL)',
    est: 88,
    repeat: 40,
    form: 'Custom development',
    deploy: '1 to 2 weeks',
    category: 'Other',
    subCategory: 'Standalone Module',
    account: '',
    notes:
      'Works from a CSV or SQL export the client provides in Edly’s template. Includes one trial run and one final run, with a reconciliation report after each. Course content is rebuilt or imported separately and is not part of this item.',
    role: 'arch',
    asked: 3,
    priced: 8
  }
];

/*
 * Where each bar sits in the delivery plan. Every bar is pinned: the team has one lane per person
 * (an architect, two senior and two mid-level engineers, a junior and a DevOps engineer, so never
 * more than seven at once), and each role's work runs through its own lanes in the order it would
 * be built, foundations first and the data migration's final run last. The auto-packer knows only
 * the team cap, and left to itself put five senior engineers on at once. `order` keeps the rows in
 * start order, so the chart reads as a cascade. The risk buffer is contingency at the end.
 */
const PLAN: Readonly<Record<string, PlanEntry>> = {
  'EDU-066': { start: 0, order: 0 },
  'EDU-041': { start: 0, order: 1 },
  'EDU-083': { start: 0, order: 2 },
  'EDU-005': { start: 0, order: 3 },
  'EDU-039': { start: 0, order: 4 },
  'EDU-045': { start: 0, order: 5 },
  'EDU-047': { start: 0.5, order: 6 },
  'EDU-013': { start: 0.5, order: 7 },
  'RQ-DEMO-01': { start: 1, order: 8 },
  'EDU-025': { start: 1, order: 9 },
  'EDU-027': { start: 1.5, order: 10 },
  'EDU-031': { start: 1.5, order: 11 },
  'EDU-071': { start: 2, order: 12 },
  'EDU-068': { start: 2, order: 13 },
  'EDU-073': { start: 2.5, order: 14 },
  'EDU-088': { start: 2.5, order: 15 },
  'EDU-065': { start: 3, order: 16 },
  'EDU-034': { start: 3, order: 17 },
  'EDU-011': { start: 3.5, order: 18 },
  'RQ-DEMO-04': { start: 3.5, order: 19 },
  'EDU-057': { start: 3.5, order: 20 },
  'EDU-079': { start: 3.5, order: 21 },
  'EDU-074': { start: 4, order: 22 },
  'EDU-052': { start: 4, order: 23 },
  'EDU-055': { start: 4.5, order: 24 },
  'EDU-080': { start: 4.5, order: 25 },
  'RQ-DEMO-06': { start: 5, order: 26 },
  'EDU-006': { start: 5, order: 27 },
  'RQ-DEMO-03': { start: 5.5, order: 28 },
  'RQ-DEMO-02': { start: 5.5, order: 29 },
  'EDU-063': { start: 5.5, order: 30 },
  'EDU-078': { start: 5.5, order: 31 },
  'RQ-DEMO-05': { start: 6, order: 32 },
  'EDU-087': { start: 6, order: 33 },
  'EDU-085': { start: 6, order: 34 },
  'EDU-048': { start: 6.5, order: 35 },
  'EDU-086': { start: 6.5, order: 36 },
  'EDU-077': { start: 7, order: 37 },
  'EDU-076': { start: 7.5, order: 38 },
  'EDU-075': { start: 7.5, order: 39 },
  BUF: { start: 8, people: 3, order: 40 }
};

const csIdOf = (requestId: string): string => requestId.replace(/^RQ-/, 'CS-');

interface SalesLegalSeed {
  category: SalesLegalCategory;
  text: string;
  owner: string;
  status: SalesLegalStatus;
  priority: RequirementPriority;
  /** Days from today; null for no date. */
  due: number | null;
  note: string;
  topic?: TermTopic;
}

/** What the deal commits Edly to that is not software. Internal: never on the client's sheet. */
const SALES_LEGAL: readonly SalesLegalSeed[] = [
  {
    category: 'legal',
    text: 'Data processing agreement for learner personal data, naming the AI tutor and translation services as sub-processors.',
    owner: 'Legal',
    status: 'open',
    priority: 'must',
    due: 10,
    note: 'Aldercrest sent its template. Our redlines go back before the contract.'
  },
  {
    category: 'certification',
    text: 'ISO 27001 certificate and a summary of the latest penetration test, to go with the proposal.',
    owner: 'Sales',
    status: 'open',
    priority: 'must',
    due: 5,
    note: ''
  },
  {
    category: 'sales',
    text: 'Confirm the Stripe, PayPal, Salesforce and Azure AD accounts are in Aldercrest’s name before kick-off.',
    owner: 'Sales',
    status: 'handled',
    priority: 'must',
    due: null,
    note: 'Confirmed on the scoping call.'
  },
  {
    category: 'people',
    text: 'Background checks for everyone with access to production learner data.',
    owner: 'Delivery',
    status: 'open',
    priority: 'must',
    due: 14,
    note: ''
  },
  {
    category: 'account',
    text: 'Quarterly business review with Aldercrest’s learning team: enrolments, completions and certificates issued.',
    owner: 'Account',
    status: 'open',
    priority: 'should',
    due: null,
    note: 'The first review is three months after launch.'
  },
  {
    category: 'legal',
    text: 'Uptime of 99.5% a month, with a service credit of 5% of the monthly hosting fee for each 0.5% below it.',
    owner: 'Legal',
    status: 'open',
    priority: 'should',
    due: null,
    note: '',
    topic: 'service-credits'
  }
];

/** The deal's snapshot: what it picked, who does it, how it is buffered and planned, and its sheet. */
function demoSnapshot(today: string): EstimationSnapshot {
  const every = [...LINES, ...CUSTOM];
  const plan: Record<string, PlanEntry> = Object.fromEntries(Object.entries(PLAN).map(([key, entry]) => [key, { ...entry }]));
  for (const line of every) if (line.people && line.people > 1) plan[line.id] = { ...plan[line.id], people: line.people };

  return {
    sel: Object.fromEntries(LINES.map((line) => [line.id, true])),
    buf: Object.fromEntries(LINES.filter((line) => line.buffer).map((line) => [line.id, line.buffer as number])),
    bufPct: 10,
    pm: 10,
    qa: 12,
    rate: 50,
    cur: 'USD',
    roles: ROLES.map((role) => ({ ...role })),
    lineRole: Object.fromEntries(every.map((line) => [line.id, line.role])),
    pmRole: 'pm',
    qaRole: 'qa',
    plan,
    hpw: 36,
    maxPar: 7,
    planStart: mondayFrom(shiftDay(today, 35)),
    sheet: {
      contact: 'Edly sales team, through edly.io/contact-us',
      comments:
        'This workbook sets out the proposed Open edX scope for Aldercrest Institute’s Global Certification Academy. Pre-built solutions are priced from Edly’s delivery records; the six custom items were scoped by Edly’s estimation desk from the requirements Aldercrest shared. Totals include a 10% risk buffer, project management (10%) and quality assurance (12%). Prices are in US dollars and exclude taxes and the third-party accounts listed against each line.',
      notes: Object.fromEntries(every.filter((line) => line.note).map((line) => [line.id, line.note as string]))
    }
  };
}

/** The demo's records, dated from `today`: what a reload or Reset puts back. */
export function demoRecords(today: string): DemoCollections {
  const opened = shiftDay(today, -12);
  const estimation: Estimation = {
    id: DEMO_ID,
    plat: DEMO_PLATFORM,
    name: DEMO_NAME,
    slug: DEMO_SLUG,
    client: DEMO_CLIENT,
    tag: 'Active',
    /* finished and being checked, so the board shows a deal near the end of the line */
    stage: 'review',
    /* the proposal is due in three weeks, and the work starts two weeks after that */
    due: shiftDay(today, 21),
    at: opened,
    up: today,
    total: 0,
    cost: 0,
    items: 0,
    snap: demoSnapshot(today)
  };

  const requests = CUSTOM.map(
    (custom): EstimateRequest => ({
      id: custom.id,
      plat: DEMO_PLATFORM,
      estId: DEMO_ID,
      estName: DEMO_NAME,
      client: DEMO_CLIENT,
      title: custom.title,
      details: custom.details,
      area: custom.area,
      urgency: 'This quarter',
      integrations: custom.integrations,
      name: 'Sales team',
      email: '',
      org: 'Edly',
      at: shiftDay(opened, custom.asked),
      est: custom.est,
      repeatEst: custom.repeat,
      estBy: 'Estimation desk',
      estAt: shiftDay(opened, custom.priced),
      csId: csIdOf(custom.id),
      catBundle: custom.bundleId,
      catForm: custom.form,
      catDeploy: custom.deploy,
      catInteg: custom.integrations,
      catCategory: custom.category,
      catSub: custom.subCategory,
      catAccount: custom.account,
      catNotes: custom.notes
    })
  );

  /* what submitEstimate made when the desk priced each request: an estimate the next deal can reuse */
  const solutions = CUSTOM.map(
    (custom): AddedSolution => ({
      id: csIdOf(custom.id),
      plat: DEMO_PLATFORM,
      bundleId: custom.bundleId,
      name: custom.title,
      desc: custom.details,
      first: custom.est,
      repeat: custom.repeat,
      form: custom.form,
      deploy: custom.deploy,
      integrations: custom.integrations,
      category: custom.category,
      subCategory: custom.subCategory,
      account: custom.account,
      notes: custom.notes,
      from: custom.id,
      estName: DEMO_NAME,
      estAt: shiftDay(opened, custom.priced),
      direct: false
    })
  );

  const salesLegal = SALES_LEGAL.map(
    (seed, index): SalesLegalItem => ({
      id: `SL-DEMO-${String(index + 1).padStart(2, '0')}`,
      plat: DEMO_PLATFORM,
      estId: DEMO_ID,
      tender: '',
      tenderItem: '',
      category: seed.category,
      kind: seed.topic ? 'term' : 'obligation',
      text: seed.text,
      quote: '',
      source: '',
      section: '',
      reason: '',
      ...(seed.topic ? { topic: seed.topic } : {}),
      priority: seed.priority,
      owner: seed.owner,
      status: seed.status,
      due: seed.due === null ? '' : shiftDay(today, seed.due),
      note: seed.note,
      at: shiftDay(opened, 2),
      up: shiftDay(opened, seed.status === 'handled' ? 6 : 2)
    })
  );

  return { estimations: [estimation], requests, solutions, salesLegal };
}

/* ------------------------------------------------ in memory, never stored */

/** The same list when nothing in it is the demo's, so a slice that holds no demo keeps its reference. */
const strip = <T>(list: readonly T[], demo: (one: T) => boolean): T[] => (list.some(demo) ? list.filter((one) => !demo(one)) : (list as T[]));

/** Everything but the demo: what may be written to browser storage or the store. */
export function withoutDemo(state: PersistedState): PersistedState {
  const estimations = strip(state.estimations, isDemoEstimation);
  const requests = strip(state.requests, isDemoRequest);
  const solutions = strip(state.solutions, isDemoSolution);
  const salesLegal = strip(state.salesLegal, isDemoItem);
  if (estimations === state.estimations && requests === state.requests && solutions === state.solutions && salesLegal === state.salesLegal) return state;
  return { ...state, estimations, requests, solutions, salesLegal };
}

/** The demo's records among these, as they stand in memory. */
export function demoPart(state: DemoCollections): DemoCollections {
  return {
    estimations: state.estimations.filter(isDemoEstimation),
    requests: state.requests.filter(isDemoRequest),
    solutions: state.solutions.filter(isDemoSolution),
    salesLegal: state.salesLegal.filter(isDemoItem)
  };
}

/**
 * `next` with the demo in it. A read from the store, from browser storage or from another tab
 * replaces whole collections, and none of those copies holds the demo, so each collection that
 * lost it gets it back: as it stood in `previous` when the demo was already there, which keeps what
 * someone is trying out in it across a background read, and as prepared when it was not.
 */
export function withDemo<S extends DemoCollections>(previous: DemoCollections, next: S, today: string): S {
  const source = previous.estimations.some(isDemoEstimation) ? demoPart(previous) : demoRecords(today);
  const estimations = next.estimations.some(isDemoEstimation) ? next.estimations : [...next.estimations, ...source.estimations];
  const requests = next.requests.some(isDemoRequest) || source.requests.length === 0 ? next.requests : [...next.requests, ...source.requests];
  const solutions = next.solutions.some(isDemoSolution) || source.solutions.length === 0 ? next.solutions : [...next.solutions, ...source.solutions];
  const salesLegal = next.salesLegal.some(isDemoItem) || source.salesLegal.length === 0 ? next.salesLegal : [...next.salesLegal, ...source.salesLegal];
  if (estimations === next.estimations && requests === next.requests && solutions === next.solutions && salesLegal === next.salesLegal) return next;
  return { ...next, estimations, requests, solutions, salesLegal };
}

/** `state` with the demo as prepared: whatever was tried on it, and anything made inside it, gone. */
export function resetDemo<S extends DemoCollections>(state: S, today: string): S {
  const fresh = demoRecords(today);
  return {
    ...state,
    estimations: [...strip(state.estimations, isDemoEstimation), ...fresh.estimations],
    requests: [...strip(state.requests, isDemoRequest), ...fresh.requests],
    solutions: [...strip(state.solutions, isDemoSolution), ...fresh.solutions],
    salesLegal: [...strip(state.salesLegal, isDemoItem), ...fresh.salesLegal]
  };
}
