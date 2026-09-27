import type { Bundle, EstimateRequest, EstimateResult, EstimationSnapshot, Schedule, Solution } from '@/types';
import { roleLabel } from '@/domain/estimate';

/**
 * The client's task breakdown: an estimate regrouped as deliverables, one per area, each listing
 * the components it contains with their hours, cost, status and assumptions.
 *
 * This is the shape of Edly's own task-breakdown workbook (deliverable, area, component,
 * description, support status, notes), with the numbers the estimate already holds added to it.
 * It is pure so the numbers can be checked against `calcEstimate` in a test: a sheet whose lines
 * do not add up to the total the builder shows is worse than no sheet.
 */

/* ------------------------------------------------------------ what can go in */

/** Every column the sheet can carry, in the order they appear left to right. */
export type SheetColumnId =
  | 'deliverable'
  | 'item'
  | 'area'
  | 'component'
  | 'solutionId'
  | 'description'
  | 'form'
  | 'status'
  | 'integrations'
  | 'account'
  | 'deploy'
  | 'window'
  | 'notes'
  | 'internal'
  | 'role'
  | 'rate'
  | 'build'
  | 'hours'
  | 'buffer'
  | 'days'
  | 'estimate';

export interface SheetColumn {
  id: SheetColumnId;
  /** The header in the sheet. */
  label: string;
  /** What it holds, for the panel that picks columns. */
  sub: string;
  /** One of the columns in Edly's task-breakdown template, or the hours and estimate added to it. */
  core: boolean;
  /** Ticked until someone chooses otherwise. */
  on: boolean;
}

export const SHEET_COLUMNS: readonly SheetColumn[] = [
  { id: 'deliverable', label: 'Deliverable no.', sub: 'One number per area', core: true, on: true },
  { id: 'item', label: 'Item no.', sub: '1.1, 1.2, so a line can be referred to in a call', core: false, on: false },
  { id: 'area', label: 'Area', sub: 'The bundle, or the area a custom item names', core: true, on: true },
  { id: 'component', label: 'Component', sub: 'The solution or custom item. Always included', core: true, on: true },
  { id: 'solutionId', label: 'Solution ID', sub: 'Catalog or request reference', core: false, on: false },
  { id: 'description', label: 'Description', sub: 'What it does', core: true, on: true },
  { id: 'form', label: 'Delivery Type', sub: 'Integration, XBlock, custom plugin', core: false, on: false },
  { id: 'status', label: 'Support Status', sub: 'Pre-built, in development, custom', core: true, on: true },
  { id: 'integrations', label: 'Integrations', sub: 'Third-party systems involved', core: false, on: false },
  { id: 'account', label: 'Client-held Account', sub: 'Stripe, Zoom and the like, held by the client', core: false, on: false },
  { id: 'deploy', label: 'Deployment Time', sub: 'Standard time to deploy it', core: false, on: false },
  { id: 'window', label: 'Delivery Window', sub: 'Weeks in the delivery plan', core: false, on: false },
  { id: 'notes', label: 'Notes/Assumptions', sub: 'Your notes per line, plus caveats', core: true, on: true },
  { id: 'internal', label: 'Internal Notes', sub: 'Catalog and desk notes. For Edly, check before sending', core: false, on: false },
  { id: 'role', label: 'Role', sub: 'Who does it, from the rate card', core: false, on: false },
  { id: 'rate', label: 'Rate', sub: 'Hourly rate of that role', core: false, on: false },
  { id: 'build', label: 'Engineered Hours', sub: 'Hours already spent building it', core: false, on: false },
  { id: 'hours', label: 'Hours', sub: 'Estimated hours per line', core: true, on: true },
  { id: 'buffer', label: 'Risk Buffer (h)', sub: 'Each line’s share of the buffer', core: false, on: false },
  { id: 'days', label: 'Person-days', sub: 'Hours in 8-hour days', core: false, on: false },
  { id: 'estimate', label: 'Estimate', sub: 'Cost per line, in the estimate’s currency', core: true, on: true }
];

export type SheetSectionId = 'cover' | 'totals' | 'roles' | 'team' | 'timeline' | 'terms';

export interface SheetSection {
  id: SheetSectionId;
  label: string;
  sub: string;
  on: boolean;
}

export const SHEET_SECTIONS: readonly SheetSection[] = [
  { id: 'cover', label: 'Introduction sheet', sub: 'Project details, general comments, summary', on: true },
  { id: 'totals', label: 'Subtotals and totals', sub: 'Per deliverable, then buffer, PM, QA and total', on: true },
  { id: 'roles', label: 'Cost by role', sub: 'Hours and cost per rate-card role', on: false },
  { id: 'team', label: 'Team composition sheet', sub: 'Role, seniority, people and hours, from Rates and the plan', on: true },
  { id: 'timeline', label: 'Delivery plan sheet', sub: 'The planner’s weeks, as a chart', on: true },
  { id: 'terms', label: 'Terms and caveats', sub: 'Scope, accounts, unpriced items', on: true }
];

/** What sales has chosen to put in the sheet. Kept with the display settings, per browser and in the store. */
export interface SheetPrefs {
  columns: Record<SheetColumnId, boolean>;
  sections: Record<SheetSectionId, boolean>;
}

export const DEFAULT_SHEET: SheetPrefs = {
  columns: Object.fromEntries(SHEET_COLUMNS.map((column) => [column.id, column.on])) as Record<SheetColumnId, boolean>,
  sections: Object.fromEntries(SHEET_SECTIONS.map((section) => [section.id, section.on])) as Record<SheetSectionId, boolean>
};

/**
 * Stored choices, whatever shape they arrive in.
 *
 * A column added after someone saved their choices is absent from what they saved, and gets its
 * default rather than reading as unticked. Component is always on: a sheet without it lists
 * numbers against nothing.
 */
export function readSheetPrefs(raw: unknown): SheetPrefs {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const stored = record(raw);
  const columns = record(stored.columns);
  const sections = record(stored.sections);
  const pick = (bag: Record<string, unknown>, key: string, fallback: boolean): boolean =>
    typeof bag[key] === 'boolean' ? (bag[key] as boolean) : fallback;

  return {
    columns: Object.fromEntries(
      SHEET_COLUMNS.map((column) => [column.id, column.id === 'component' ? true : pick(columns, column.id, column.on)])
    ) as Record<SheetColumnId, boolean>,
    sections: Object.fromEntries(SHEET_SECTIONS.map((section) => [section.id, pick(sections, section.id, section.on)])) as Record<
      SheetSectionId,
      boolean
    >
  };
}

export interface SheetContext {
  /** Buffers are folded into the line hours on screen, so they are in the sheet too. */
  blendBuffer: boolean;
  /** Tasks in the delivery plan. */
  planned: number;
  /** Line hours given a rate-card role. */
  assigned: number;
}

/**
 * Why a ticked option would not appear, keyed by column or section. An option missing here
 * appears when ticked. The panel shows the reason beside the box, so nothing vanishes silently.
 */
export function sheetBlockers(prefs: SheetPrefs, context: SheetContext): Partial<Record<SheetColumnId | SheetSectionId, string>> {
  const blocked: Partial<Record<SheetColumnId | SheetSectionId, string>> = {};
  if (context.blendBuffer) blocked.buffer = 'Buffers are blended into Hours (Display settings)';
  if (!prefs.columns.hours && !prefs.columns.estimate) blocked.totals = 'Needs the Hours or Estimate column';
  if (!prefs.columns.estimate) blocked.roles = 'Needs the Estimate column';
  if (context.planned === 0) blocked.timeline = 'Nothing is scheduled yet';
  /* with nobody assigned, the sheet would be one "Unassigned" row */
  if (!(context.assigned > 0)) blocked.team = 'Assign roles to lines in Rates first';
  return blocked;
}

/** The columns the sheet will carry, in order. */
export function sheetColumns(prefs: SheetPrefs, context: SheetContext): SheetColumn[] {
  const blocked = sheetBlockers(prefs, context);
  return SHEET_COLUMNS.filter((column) => prefs.columns[column.id] && !blocked[column.id]);
}

/** Whether a section will be in the sheet. */
export function sheetHas(prefs: SheetPrefs, context: SheetContext, section: SheetSectionId): boolean {
  return prefs.sections[section] && !sheetBlockers(prefs, context)[section];
}

/* -------------------------------------------------------------- the lines */

/** Where a line stands, in the words the client sees. */
export type LineStatus = 'prebuilt' | 'development' | 'custom' | 'pending' | 'benchmark';

export const STATUS_LABEL: Record<LineStatus, string> = {
  prebuilt: 'Pre-built',
  development: 'In development',
  custom: 'Custom',
  pending: 'To be estimated',
  benchmark: 'Benchmark'
};

export interface BreakdownLine {
  /** Solution or request id: what notes, roles and the plan are keyed by. */
  key: string;
  kind: 'solution' | 'request';
  /** "2.3" is the third line of deliverable 2. */
  item: string;
  component: string;
  description: string;
  status: LineStatus;
  /** What the client should know about it, sales' own words first. */
  notes: string[];
  /** Catalog notes and the desk's pricing note. Written for Edly, not for the client. */
  internal: string[];
  /** Null when nobody has priced it, which is not the same as zero. */
  hours: number | null;
  /** The line's share of the risk buffer when buffers are listed apart; 0 when they are blended. */
  buffer: number;
  /** USD for `hours`, at the line's rate. Null when unpriced. */
  cost: number | null;
  /** USD for `buffer`. */
  bufferCost: number;
  /** Rate-card role, or '' when the line bills at the blended rate. */
  role: string;
  /** USD per hour. */
  rate: number;
  /** Weeks in the delivery plan, from 1 and inclusive. Null when it is not scheduled. */
  window: { from: number; to: number } | null;
  form: string;
  integrations: string;
  account: string;
  deploy: string;
  build: number | null;
}

export interface Deliverable {
  n: number;
  area: string;
  /** Blank for an area no bundle in the catalog has. */
  bundleId: string;
  lines: BreakdownLine[];
  hours: number;
  buffer: number;
  cost: number;
  bufferCost: number;
}

export interface BreakdownTotals {
  /** Hours on the lines. */
  hours: number;
  /** Risk buffer listed apart from the lines; 0 when blended into them. */
  buffer: number;
  pm: number;
  qa: number;
  /** Everything: the grand total the builder shows. */
  total: number;
  cost: number;
  bufferCost: number;
  pmCost: number;
  qaCost: number;
  totalCost: number;
  days: number;
  /** Lines nobody has priced, left out of every total. */
  unpriced: number;
  inDevelopment: number;
  lines: number;
}

export interface Breakdown {
  deliverables: Deliverable[];
  totals: BreakdownTotals;
}

export interface BreakdownInput {
  estimate: EstimateResult;
  /** The open estimation's custom requests. */
  requests: readonly EstimateRequest[];
  plan: Schedule;
  /** The live snapshot: buffers, roles and the notes sales wrote per line. */
  snap: EstimationSnapshot;
  /** Every bundle in the catalog, so custom work lands in the area it names. */
  bundles: readonly Pick<Bundle, 'id' | 'name'>[];
  blendBuffer: boolean;
  /** Say in the notes which account a line needs. Off when the account has a column of its own. */
  accountNote?: boolean;
}

const CUSTOM_AREA = 'Custom development';

/** An area a request names that is really "none of the above". */
const isNoArea = (area: string): boolean => !area || /^custom$/i.test(area) || /^something new/i.test(area);

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function taskBreakdown(input: BreakdownInput): Breakdown {
  const { estimate, requests, plan, snap, bundles, blendBuffer } = input;
  const accountNote = input.accountNote ?? true;
  const buf = snap.buf ?? {};
  const lineRole = snap.lineRole ?? {};
  const written = snap.sheet?.notes ?? {};
  const factor = 1 + estimate.bufPct / 100;
  const roleById = new Map(estimate.roles.map((role) => [role.id, role]));
  const taskByKey = new Map(plan.tasks.map((task) => [task.key, task]));

  const bundleOrder = new Map<string, number>();
  const bundleByName = new Map<string, Pick<Bundle, 'id' | 'name'>>();
  bundles.forEach((bundle, index) => {
    bundleOrder.set(bundle.id, index);
    bundleByName.set(bundle.id.toLowerCase(), bundle);
    bundleByName.set(bundle.name.trim().toLowerCase(), bundle);
  });

  const billing = (key: string): { role: string; rate: number } => {
    const role = roleById.get(lineRole[key] ?? '');
    return role ? { role: roleLabel(role), rate: Number(role.rate) } : { role: '', rate: estimate.rate };
  };

  const windowOf = (key: string): BreakdownLine['window'] => {
    const task = taskByKey.get(key);
    if (!task) return null;
    const from = Math.floor(task.start) + 1;
    return { from, to: Math.max(from, Math.ceil(task.start + task.dur)) };
  };

  /**
   * Hours and buffer for one line, split the way the builder splits them. Blended, the line
   * carries its buffer and its share of the percentage; apart, the line is its bare hours and the
   * difference is its buffer. Either way a line bills (base + line buffer) × (1 + %), which is
   * what `calcEstimate` bills it, so the lines always add up to the estimate.
   */
  const split = (base: number | null, lineBuf: number, rate: number): Pick<BreakdownLine, 'hours' | 'buffer' | 'cost' | 'bufferCost'> => {
    const gross = ((base ?? 0) + lineBuf) * factor;
    if (blendBuffer) {
      const hours = base !== null || lineBuf > 0 ? gross : null;
      return { hours, buffer: 0, cost: hours === null ? null : hours * rate, bufferCost: 0 };
    }
    const buffer = gross - (base ?? 0);
    return { hours: base, buffer, cost: base === null ? null : base * rate, bufferCost: buffer * rate };
  };

  const solutionLine = (item: Solution): Omit<BreakdownLine, 'item'> => {
    const lineBuf = Number(buf[item.id]) > 0 ? Number(buf[item.id]) : 0;
    const bill = billing(item.id);
    const status: LineStatus =
      item.status === 'In Development' ? 'development' : item.status === 'Estimation' ? 'custom' : item.status === 'Sample' ? 'benchmark' : 'prebuilt';
    const notes = [written[item.id]?.trim() ?? ''];
    if (status === 'development') notes.push('Still in development, so its delivery date is to be confirmed.');
    if (item.first === null) notes.push('Not yet estimated, so not included in the totals.');
    if (accountNote && item.account) notes.push(`Needs a client-held ${item.account} account. Vendor fees are payable by the client.`);
    return {
      key: item.id,
      kind: 'solution',
      component: item.name,
      description: item.desc ?? '',
      status,
      notes: notes.filter(Boolean),
      internal: item.notes ? [item.notes] : [],
      ...split(item.first, lineBuf, bill.rate),
      ...bill,
      window: windowOf(item.id),
      form: item.form ?? '',
      integrations: item.integrations ?? '',
      account: item.account ?? '',
      deploy: item.deploy && item.deploy !== 'Not recorded' ? item.deploy : '',
      build: item.build
    };
  };

  const requestLine = (request: EstimateRequest): Omit<BreakdownLine, 'item'> => {
    const priced = Number(request.est) > 0;
    const bill = billing(request.id);
    const notes = [written[request.id]?.trim() ?? ''];
    if (!priced) notes.push('Being estimated by Edly, so not yet included in the totals.');
    if (accountNote && request.catAccount) notes.push(`Needs a client-held ${request.catAccount} account. Vendor fees are payable by the client.`);
    /* A tender-drafted request carries the tender's priority, quote and catalog cover after its
       first paragraph, for the desk. The client needs only the first paragraph. A manual item's
       details are a placeholder, not a description. */
    const details = request.manual ? '' : request.tender ? (request.details.split(/\n\s*\n/)[0] ?? '') : request.details;
    return {
      key: request.id,
      kind: 'request',
      component: request.title,
      description: details.trim(),
      status: priced ? 'custom' : 'pending',
      notes: notes.filter(Boolean),
      internal: request.estNote ? [request.estNote] : [],
      ...split(priced ? Number(request.est) : null, 0, bill.rate),
      ...bill,
      window: windowOf(request.id),
      form: request.catForm ?? '',
      integrations: request.integrations ?? '',
      account: request.catAccount ?? '',
      deploy: request.catDeploy ?? '',
      build: null
    };
  };

  /* ---- group by area: catalog bundles in catalog order, then any area only a request names ---- */

  interface Area {
    area: string;
    bundleId: string;
    order: number;
    lines: Omit<BreakdownLine, 'item'>[];
  }
  const areas = new Map<string, Area>();
  const areaFor = (key: string, area: string, bundleId: string, order: number): Area => {
    const found = areas.get(key);
    if (found) return found;
    const made: Area = { area, bundleId, order, lines: [] };
    areas.set(key, made);
    return made;
  };

  for (const group of estimate.groups) {
    const target = areaFor(`b:${group.id}`, group.name, group.id, bundleOrder.get(group.id) ?? bundles.length);
    for (const item of group.items) target.lines.push(solutionLine(item));
  }

  let named = 0;
  for (const request of requests) {
    const area = (request.area ?? '').trim();
    const bundle = bundleByName.get(area.toLowerCase());
    const target = bundle
      ? areaFor(`b:${bundle.id}`, bundle.name, bundle.id, bundleOrder.get(bundle.id) ?? bundles.length)
      : isNoArea(area)
        ? areaFor('custom', CUSTOM_AREA, '', Number.MAX_SAFE_INTEGER)
        : areaFor(`a:${area.toLowerCase()}`, area, '', bundles.length + ++named);
    target.lines.push(requestLine(request));
  }

  const deliverables: Deliverable[] = [...areas.values()]
    .sort((a, b) => a.order - b.order)
    .map((area, index) => {
      const n = index + 1;
      const lines = area.lines.map((line, at) => ({ ...line, item: `${n}.${at + 1}` }));
      return {
        n,
        area: area.area,
        bundleId: area.bundleId,
        lines,
        hours: round2(lines.reduce((sum, line) => sum + (line.hours ?? 0), 0)),
        buffer: round2(lines.reduce((sum, line) => sum + line.buffer, 0)),
        cost: lines.reduce((sum, line) => sum + (line.cost ?? 0), 0),
        bufferCost: lines.reduce((sum, line) => sum + line.bufferCost, 0)
      };
    });

  const overheadCost = (id: string, hours: number): number =>
    estimate.roleRows.find((row) => row.id === id)?.cost ?? hours * estimate.rate;
  const lines = deliverables.flatMap((deliverable) => deliverable.lines);
  const cost = deliverables.reduce((sum, deliverable) => sum + deliverable.cost, 0);
  const bufferCost = deliverables.reduce((sum, deliverable) => sum + deliverable.bufferCost, 0);
  const pmCost = estimate.pmH > 0 ? overheadCost('ov-pm', estimate.pmH) : 0;
  const qaCost = estimate.qaH > 0 ? overheadCost('ov-qa', estimate.qaH) : 0;

  return {
    deliverables,
    totals: {
      hours: round2(lines.reduce((sum, line) => sum + (line.hours ?? 0), 0)),
      buffer: round2(lines.reduce((sum, line) => sum + line.buffer, 0)),
      pm: round2(estimate.pmH),
      qa: round2(estimate.qaH),
      total: round2(estimate.grand),
      cost,
      bufferCost,
      pmCost,
      qaCost,
      totalCost: cost + bufferCost + pmCost + qaCost,
      days: round2(estimate.grand / 8),
      unpriced: lines.filter((line) => line.hours === null).length,
      inDevelopment: lines.filter((line) => line.status === 'development').length,
      lines: lines.length
    }
  };
}
