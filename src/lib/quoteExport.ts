import type { Bundle, CurrencyCode, EstimateRequest, EstimateResult, Estimation, EstimationSnapshot, Schedule } from '@/types';
import type { DisplayPrefs } from '@/state/reducer';
import { writeWorkbook, type BorderEdge, type CellStyle, type SheetCell, type SheetRow, type StyledSheet } from '@/lib/xlsx';
import { FX, hours, hours1, longDate, money, plural, rateLabel } from '@/lib/format';
import { color, sheetColor } from '@/theme';
import {
  sheetColumns,
  sheetHas,
  STATUS_LABEL,
  taskBreakdown,
  type Breakdown,
  type BreakdownLine,
  type LineStatus,
  type SheetColumn,
  type SheetColumnId,
  type SheetContext,
  type SheetPrefs
} from '@/domain/taskBreakdown';
import { teamComposition, type TeamRow } from '@/domain/team';

/**
 * The client-facing estimate, as Edly's branded task-breakdown workbook and as plain text.
 *
 * The workbook follows Edly's own task-breakdown template: an Introduction sheet with the project
 * details and general comments, then the Task Breakdown itself (deliverable, area, component,
 * description, support status, notes), with hours and cost added to it and an optional Delivery
 * Plan drawn from the planner. What it contains is chosen in the builder's Excel sheet panel and
 * nowhere else, so what sales ticks there is exactly what the client receives.
 *
 * The numbers come from `taskBreakdown`, which is checked against `calcEstimate`; this file only
 * lays them out. Colours come from the theme, so the file matches the app it came from.
 */

export interface SheetInput {
  estimation: Pick<Estimation, 'name' | 'client'>;
  /** The live snapshot: the notes, contact and comments sales wrote are read from here. */
  snap: EstimationSnapshot;
  estimate: EstimateResult;
  requests: readonly EstimateRequest[];
  plan: Schedule;
  bundles: readonly Pick<Bundle, 'id' | 'name'>[];
  prefs: SheetPrefs;
  blendBuffer: boolean;
  currency: CurrencyCode;
  platformName: string;
  /** A benchmark catalog, whose hours are not delivery records. */
  sample: boolean;
  /** Date the sheet is prepared, ISO. Today when absent. */
  date?: string;
}

export const SHEET_NAMES = { cover: 'Introduction', breakdown: 'Task Breakdown', team: 'Team Composition', plan: 'Delivery Plan' } as const;

/* ---------------------------------------------------------------- look ---- */

/* Edly's template, face for face: Arial for the title, the bands and the table, Roboto for the
   project details and the table header. An app without Roboto substitutes a sans-serif (see the
   family hint in xlsx.ts). */
const BODY_FONT = 'Arial';
const LABEL_FONT = 'Roboto';
/** Body text size, in points. Row heights are estimated from it. */
const BODY = 10;

const edge = (tone: string, style: BorderEdge['style'] = 'thin'): BorderEdge => ({ style, color: tone });

/** A style with a few properties replaced. Font and alignment merge; a border given replaces the old one. */
const tweak = (base: CellStyle, extra: CellStyle): CellStyle => ({
  ...base,
  ...extra,
  font: { ...base.font, ...extra.font },
  align: { ...base.align, ...extra.align },
  border: extra.border === undefined ? base.border : extra.border
});

const body = { name: BODY_FONT, size: BODY, color: sheetColor.text };

const S = {
  title: { font: { name: BODY_FONT, size: 24, bold: true, color: sheetColor.red }, align: { v: 'center' }, border: { bottom: edge(sheetColor.red) } },
  titleLine: { border: { bottom: edge(sheetColor.red) } },
  label: { font: { name: LABEL_FONT, size: 10, bold: true, color: sheetColor.label }, align: { v: 'center', wrap: true }, border: { bottom: edge(sheetColor.line) } },
  value: { font: { name: LABEL_FONT, size: 10, color: sheetColor.value }, align: { v: 'center' }, border: { bottom: edge(sheetColor.line) } },
  band: { font: { name: BODY_FONT, size: 12, color: sheetColor.white }, fill: sheetColor.red, align: { h: 'center', v: 'center' } },
  head: { font: { name: LABEL_FONT, size: 9, bold: true, color: sheetColor.red }, fill: sheetColor.head, align: { h: 'center', v: 'center', wrap: true } },
  rule: { border: { bottom: edge(sheetColor.rule, 'medium') } },
  deliverable: { font: body, fill: sheetColor.deliverable, align: { h: 'center', v: 'center' } },
  area: { font: body, fill: sheetColor.area, align: { v: 'center', wrap: true } },
  cell: { font: body, align: { v: 'center', wrap: true } },
  center: { font: body, align: { h: 'center', v: 'center', wrap: true } },
  number: { font: body, align: { h: 'right', v: 'center' } },
  unpriced: { font: { ...body, italic: true, color: sheetColor.label }, align: { h: 'right', v: 'center', wrap: true } },
  subtotal: { font: { ...body, bold: true }, fill: sheetColor.head, align: { h: 'right', v: 'center' } },
  totalLabel: { font: body, align: { h: 'right', v: 'center' } },
  grand: { font: { name: BODY_FONT, size: 11, bold: true, color: sheetColor.white }, fill: sheetColor.red, align: { h: 'right', v: 'center' } },
  caption: { font: { name: BODY_FONT, size: 9, color: sheetColor.label }, align: { h: 'right', v: 'center' } },
  note: { font: { name: BODY_FONT, size: 9, color: sheetColor.label }, align: { v: 'center' } },
  term: { font: body, align: { v: 'center', wrap: true } },
  link: { font: { name: BODY_FONT, size: 11, bold: true, underline: true, color: sheetColor.link }, align: { h: 'center', v: 'center' } }
} satisfies Record<string, CellStyle>;

/* The template marks a line's status with an emoji; the sheet colours the word instead. */
const STATUS_INK: Record<LineStatus, string> = {
  prebuilt: color.brandInk,
  development: color.redInk,
  custom: color.amber,
  pending: color.muted,
  benchmark: color.violet
};

const statusStyle = (status: LineStatus): CellStyle => tweak(S.center, { font: { color: STATUS_INK[status] } });

const HOURS_FORMAT = '#,##0.0#';
const DAYS_FORMAT = '#,##0.0';
const DATE_FORMAT = 'm/d/yy';
const moneyFormat = (currency: CurrencyCode, suffix = ''): string =>
  `"${(FX[currency] ?? FX.USD).symbol}"#,##0${suffix ? `"${suffix}"` : ''}`;

/** Every page prints with the brand and a page count. */
const PRINT_FOOTER = '&L&8Edly by Arbisoft  |  edly.io&R&8Page &P of &N';

/* ------------------------------------------------------------ geometry ---- */

/** Width of each column, in Excel's characters. The template's six columns keep its widths. */
const WIDTH: Record<SheetColumnId, number> = {
  deliverable: 17.63,
  item: 7,
  area: 33.75,
  component: 28.13,
  solutionId: 11,
  description: 24.63,
  form: 18,
  status: 14,
  integrations: 20,
  account: 18,
  deploy: 13,
  window: 14,
  notes: 40.25,
  role: 18,
  rate: 12,
  build: 11,
  hours: 10,
  buffer: 10,
  days: 10,
  estimate: 14
};

/** The template's margins: column A on the left, one narrow column after the table. */
const GUTTER_LEFT = 7;
const GUTTER_RIGHT = 5.75;

/** Row heights in points, as the template sets them. */
const ROW = 21;
const SPACER_RULE = 49.5;
const SPACER_SMALL = 11.25;

/**
 * Lines a wrapped value takes in a column, estimated.
 *
 * Excel does not grow a row for wrapped text in a file it did not lay out, and never for merged
 * cells, so a row with a long description opens clipped to one line unless it carries a height.
 * Characters per line is deliberately under what fits: a row a little too tall reads fine, and
 * one too short hides the end of the sentence.
 */
export function textLines(value: string, width: number, size = BODY): number {
  const perLine = Math.max(1, Math.floor((width * 1.05 * BODY) / size));
  return String(value)
    .split('\n')
    .reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
}

/** A row height, in points, that shows every line of the tallest of its cells. */
export function rowHeight(cells: readonly { value: string; width: number; size?: number }[], min = ROW): number {
  const tallest = cells.reduce((most, cell) => {
    const size = cell.size ?? BODY;
    return Math.max(most, textLines(cell.value, cell.width, size) * size * 1.3 + 9);
  }, 0);
  return Math.round(Math.max(min, tallest) * 4) / 4;
}

/** A1 column letter for a 0-based index. */
const col = (index: number): string => {
  let ref = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    ref = String.fromCharCode(65 + remainder) + ref;
    n = Math.floor((n - 1) / 26);
  }
  return ref;
};

/** Builds a sheet row by row, with 1-based row numbers for merges. */
class SheetBuilder {
  readonly rows: SheetRow[] = [];
  readonly merges: string[] = [];

  get next(): number {
    return this.rows.length + 1;
  }

  add(cells: (SheetCell | null)[], h?: number): number {
    this.rows.push(h ? { cells, h } : { cells });
    return this.rows.length;
  }

  gap(h: number): void {
    this.rows.push({ h });
  }

  /** Merge columns `from`..`to` (0-based, column A is 0) across rows `top`..`bottom`, when that is more than one cell. */
  merge(top: number, from: number, bottom: number, to: number): void {
    if (top === bottom && from === to) return;
    this.merges.push(`${col(from)}${top}:${col(to)}${bottom}`);
  }
}

/** A row `span` wide with `style` everywhere, and `cells` placed over it. */
const filled = (span: number, style: CellStyle, cells: Record<number, SheetCell> = {}): SheetCell[] =>
  Array.from({ length: span }, (_, i) => cells[i] ?? { v: '', s: style });

/** A red band across the table with a title in it, as the template heads "General Comments". */
function band(sheet: SheetBuilder, label: string, span: number, first = 1): void {
  const row = sheet.add([...Array.from({ length: first }, () => null), ...filled(span, S.band, { 0: { v: label, s: S.band } })], ROW);
  sheet.merge(row, first, row, first + span - 1);
}

/* ------------------------------------------------------------- content ---- */

const titleOf = (input: SheetInput): string => {
  const who = input.estimation.client.trim() || input.estimation.name.trim();
  return who ? `${who} | Project Task Breakdown` : 'Project Task Breakdown';
};

/** The date the sheet was prepared, as the day number Excel stores a date as. */
const preparedSerial = (input: SheetInput): number => {
  const [y, m, d] = (input.date ?? new Date().toISOString().slice(0, 10)).split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
};

/** A USD amount in the currency the estimate is shown in. */
const inCurrency = (input: SheetInput, amount: number): number => amount * (FX[input.currency] ?? FX.USD).factor;

const twoDp = (n: number): number => Math.round(n * 100) / 100;

const windowLabel = (window: BreakdownLine['window']): string =>
  !window ? '' : window.from === window.to ? `Week ${window.from}` : `Weeks ${window.from} to ${window.to}`;

/** The cover's General Comments when sales has not written any. */
export function defaultComments(input: SheetInput, breakdown: Breakdown): string {
  const columns = new Set(sheetColumns(input.prefs, contextOf(input)).map((column) => column.id));
  const who = input.estimation.client.trim() || 'the client';
  const count = breakdown.deliverables.length;
  const figures =
    columns.has('hours') && columns.has('estimate')
      ? ', with Edly’s estimated hours and cost for each'
      : columns.has('hours')
        ? ', with Edly’s estimated hours for each'
        : columns.has('estimate')
          ? ', with the estimated cost of each'
          : '';
  const overheads = [
    input.estimate.pm > 0 ? `project management (${input.estimate.pm}%)` : '',
    input.estimate.qa > 0 ? `quality assurance (${input.estimate.qa}%)` : ''
  ].filter(Boolean);
  return (
    `This workbook breaks the proposed ${input.platformName || 'platform'} scope for ${who} into ${plural(count, 'deliverable')}, ` +
    `one per solution area, and lists the components in each${figures}.` +
    (overheads.length > 0 && (columns.has('hours') || columns.has('estimate')) ? ` The totals include ${overheads.join(' and ')}.` : '')
  );
}

/** Scope, pricing and caveat lines for the foot of the breakdown. */
export function sheetTerms(input: SheetInput, breakdown: Breakdown): string[] {
  const { estimate, plan, currency } = input;
  const context = contextOf(input);
  const columns = new Set(sheetColumns(input.prefs, context).map((column) => column.id));
  const priced = columns.has('estimate') || columns.has('rate') || sheetHas(input.prefs, context, 'roles');
  const terms: string[] = [];

  terms.push(
    estimate.pm > 0 || estimate.qa > 0
      ? 'Hours are Edly’s engineering estimates for the components listed; the totals add the project management and QA shown.'
      : 'Engineering hours only: project management, QA and support are quoted separately unless included above.'
  );
  if (estimate.bufH > 0) {
    terms.push(
      input.blendBuffer
        ? `Each line includes its share of a risk buffer${estimate.bufPct > 0 ? ` (${estimate.bufPct}%)` : ''}.`
        : 'The risk buffer is listed on its own line in the totals.'
    );
  }
  if (priced) {
    terms.push(
      (estimate.assignedH > 0
        ? `Priced by role, at ${money(estimate.effRate, currency)}/h blended across the rate card.`
        : `Priced at ${rateLabel(estimate.rate, currency)}.`) +
        (currency !== 'USD' ? ` Amounts in ${currency} use an indicative exchange rate.` : '')
    );
  }
  const { unpriced, inDevelopment } = breakdown.totals;
  if (unpriced > 0) terms.push(`${plural(unpriced, 'item')} ${unpriced === 1 ? 'is' : 'are'} not yet estimated and not included in the totals.`);
  if (inDevelopment > 0) {
    terms.push(
      inDevelopment === 1
        ? '1 item is still in development, so its delivery date is to be confirmed.'
        : `${inDevelopment} items are still in development, so their delivery dates are to be confirmed.`
    );
  }
  const accounts = new Set(estimate.accts);
  for (const request of input.requests) if (request.catAccount) accounts.add(request.catAccount);
  if (accounts.size > 0) terms.push(`Client-held accounts needed: ${[...accounts].join(', ')}. Third-party vendor fees are payable by the client.`);
  if (input.sample) terms.push('Hours for this platform are industry benchmarks, not Edly delivery records.');
  if (sheetHas(input.prefs, context, 'timeline')) {
    terms.push(`The delivery plan assumes ${plan.hpw} productive hours per person per week, with up to ${plan.cap} ${plan.cap === 1 ? 'person' : 'people'} working at once.`);
  }
  if (/open edx/i.test(input.platformName)) terms.push('Open edX® is a registered trademark of edX Inc.');
  return terms;
}

const contextOf = (input: SheetInput): SheetContext => ({
  blendBuffer: input.blendBuffer,
  planned: input.plan.tasks.length,
  assigned: input.estimate.assignedH
});

/** The deliverables and totals the sheet will show, as the Excel sheet panel lists them too. */
export const sheetBreakdown = (input: SheetInput): Breakdown =>
  taskBreakdown({
    estimate: input.estimate,
    requests: input.requests,
    plan: input.plan,
    snap: input.snap,
    bundles: input.bundles,
    blendBuffer: input.blendBuffer,
    /* with its own column the account would be said twice on the same row */
    accountNote: !sheetColumns(input.prefs, contextOf(input)).some((column) => column.id === 'account'),
    catalogNotes: input.prefs.catalogNotes
  });

/* ------------------------------------------------------- shared pieces ---- */

/** Characters a detail label needs, so "ORGANIZATION NAME" is not cut off by a narrow column. */
const LABEL_WIDTH = 16;
/** Characters the project title needs beside its label before it runs into the next one. */
const VALUE_WIDTH = 30;

interface DetailLayout {
  /** Last column of the left label; the left value runs from the next one to `rightStart - 1`. */
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
  heights: [number, number];
}

/**
 * Where the project details sit over a table's columns: label in the first column, its value
 * beside it, the second label near the middle and its value, right-aligned, to the end. That is
 * the template exactly when a sheet has its six columns. A label takes a neighbour when its own
 * column is too narrow for it, and a sheet too narrow for two pairs gets null and stacks them.
 */
export function detailLayout(widths: readonly number[]): DetailLayout | null {
  const span = widths.length;
  const sum = (from: number, to: number): number => widths.slice(from, to + 1).reduce((total, w) => total + w, 0);
  const half = Math.floor(span / 2);
  let leftEnd = 0;
  while (sum(0, leftEnd) < LABEL_WIDTH && leftEnd + 1 < half - 1) leftEnd += 1;
  /* The second label starts at the middle and takes neighbours until it fits: from the left while
     the title beside the first label still has room, else from the right, so its value keeps the
     columns at the end. Then it moves right while the title is still squeezed. */
  let rightStart = half;
  let rightEnd = half;
  while (sum(rightStart, rightEnd) < LABEL_WIDTH) {
    if (sum(leftEnd + 1, rightStart - 2) >= VALUE_WIDTH) rightStart -= 1;
    else if (rightEnd + 1 < span - 1) rightEnd += 1;
    else break;
  }
  while (sum(leftEnd + 1, rightStart - 1) < VALUE_WIDTH && rightEnd + 1 < span - 1) {
    rightStart += 1;
    rightEnd = Math.max(rightEnd, rightStart);
  }
  if (rightStart <= leftEnd + 1 || rightEnd >= span - 1) return null;
  return { leftEnd, rightStart, rightEnd, heights: [ROW, ROW] };
}

/** Project title, organisation, contact and date. `first` is the sheet column the table starts in. */
function detailRows(sheet: SheetBuilder, input: SheetInput, widths: readonly number[], layout: DetailLayout | null, first = 1): void {
  const span = widths.length;
  const date: SheetCell = { n: preparedSerial(input), s: tweak(S.value, { numFmt: DATE_FORMAT, align: { h: 'right' } }) };
  const pairs: [string, SheetCell][] = [
    ['PROJECT TITLE', { v: input.estimation.name, s: S.value }],
    ['ORGANIZATION NAME', { v: input.estimation.client, s: tweak(S.value, { align: { h: 'right' } }) }],
    ['CONTACT POINT', { v: input.snap.sheet?.contact ?? '', s: S.value }],
    ['DATE', date]
  ];
  const lead = (): SheetCell[] => Array.from({ length: first }, () => null);

  if (layout) {
    const { leftEnd, rightStart, rightEnd } = layout;
    for (let p = 0; p < pairs.length; p += 2) {
      const [leftLabel, leftValue] = pairs[p]!;
      const [rightLabel, rightValue] = pairs[p + 1]!;
      const cells: SheetCell[] = lead();
      for (let i = 0; i < span; i++) {
        if (i === 0) cells.push({ v: leftLabel, s: S.label });
        else if (i === leftEnd + 1) cells.push(leftValue);
        else if (i === rightStart) cells.push({ v: rightLabel, s: S.label });
        else if (i === rightEnd + 1) cells.push(rightValue);
        else cells.push({ v: '', s: i <= leftEnd || (i >= rightStart && i <= rightEnd) ? S.label : S.value });
      }
      const row = sheet.add(cells, layout.heights[p / 2]);
      sheet.merge(row, first, row, first + leftEnd);
      sheet.merge(row, first + leftEnd + 1, row, first + rightStart - 1);
      sheet.merge(row, first + rightStart, row, first + rightEnd);
      sheet.merge(row, first + rightEnd + 1, row, first + span - 1);
    }
    return;
  }

  let end = 0;
  let width = widths[0] ?? 0;
  while (width < LABEL_WIDTH && end + 1 < span - 1) width += widths[++end] ?? 0;
  for (const [label, value] of pairs) {
    const cells: SheetCell[] = lead();
    for (let i = 0; i < span; i++) cells.push(i === 0 ? { v: label, s: S.label } : i === end + 1 ? value : { v: '', s: i <= end ? S.label : S.value });
    const row = sheet.add(cells, ROW);
    sheet.merge(row, first, row, first + end);
    sheet.merge(row, first + end + 1, row, first + span - 1);
  }
}

/**
 * The top of every table sheet, row for row as the template has it: a blank row, the title with a
 * thin red line under it, a blank row, the project details, two blank rows, the red band, the
 * header, a tall row closed by a strong line, and a blank row before the table. The title is not
 * merged, so on a narrow sheet it runs on over the empty cells beside it instead of being cut off.
 *
 * Returns the header's row number. `after` replaces the blank row before the table.
 */
function sheetTop(sheet: SheetBuilder, input: SheetInput, widths: readonly number[], labels: readonly string[], after?: string): number {
  const span = widths.length;
  sheet.gap(ROW);
  sheet.add([null, { v: titleOf(input), s: S.title }, ...filled(span - 1, S.titleLine)], 36);
  sheet.gap(ROW);
  detailRows(sheet, input, widths, detailLayout(widths));
  sheet.gap(ROW);
  sheet.gap(ROW);
  sheet.add([null, ...filled(span, { fill: sheetColor.red })], ROW);
  const head = sheet.add(
    [null, ...labels.map((label): SheetCell => ({ v: label, s: S.head }))],
    rowHeight(labels.map((label, i) => ({ value: label, width: widths[i] ?? 10, size: 9 })))
  );
  sheet.add([null, ...filled(span, S.rule)], SPACER_RULE);
  if (after) {
    const row = sheet.add([null, { v: after, s: S.note }], ROW);
    sheet.merge(row, 1, row, span);
  } else {
    sheet.gap(ROW);
  }
  return head;
}

const tableSheet = (widths: readonly number[], head: number): Omit<StyledSheet, 'rows' | 'merges'> => ({
  widths: [GUTTER_LEFT, ...widths, GUTTER_RIGHT],
  tab: sheetColor.tab,
  gridlines: false,
  print: { landscape: true, fitWidth: true, repeatRows: [head, head], footer: PRINT_FOOTER }
});

/* ------------------------------------------------------ the breakdown ---- */

const SUMMABLE: ReadonlySet<SheetColumnId> = new Set(['build', 'hours', 'buffer', 'days', 'estimate']);

function lineCell(column: SheetColumn, line: BreakdownLine, input: SheetInput): SheetCell {
  switch (column.id) {
    case 'item':
      return { v: line.item, s: S.center };
    case 'component':
      return { v: line.component, s: S.cell };
    case 'solutionId':
      return { v: line.key, s: S.center };
    case 'description':
      return { v: line.description, s: S.cell };
    case 'form':
      return { v: line.form, s: S.cell };
    case 'status':
      return { v: STATUS_LABEL[line.status], s: statusStyle(line.status) };
    case 'integrations':
      return { v: line.integrations, s: S.cell };
    case 'account':
      return { v: line.account, s: S.cell };
    case 'deploy':
      return { v: line.deploy, s: S.center };
    case 'window':
      return { v: windowLabel(line.window), s: S.center };
    case 'notes':
      return { v: line.notes.join('\n'), s: S.cell };
    case 'role':
      return { v: line.role || 'Blended', s: S.cell };
    case 'rate':
      return { n: twoDp(inCurrency(input, line.rate)), s: tweak(S.number, { numFmt: moneyFormat(input.currency, '/h') }) };
    case 'build':
      return line.build === null ? { v: '', s: S.number } : { n: line.build, s: tweak(S.number, { numFmt: HOURS_FORMAT }) };
    case 'hours':
      /* "0" in an hours column reads as free work: the client has to see that nobody priced it */
      return line.hours === null
        ? { v: line.kind === 'request' ? 'To be estimated' : 'Not estimated', s: S.unpriced }
        : { n: twoDp(line.hours), s: tweak(S.number, { numFmt: HOURS_FORMAT }) };
    case 'buffer':
      return line.buffer > 0 ? { n: twoDp(line.buffer), s: tweak(S.number, { numFmt: HOURS_FORMAT }) } : { v: '', s: S.number };
    case 'days':
      return line.hours === null ? { v: '', s: S.number } : { n: twoDp(line.hours / 8), s: tweak(S.number, { numFmt: DAYS_FORMAT }) };
    case 'estimate':
      return line.cost === null
        ? { v: '—', s: tweak(S.unpriced, { font: { italic: false } }) }
        : { n: twoDp(inCurrency(input, line.cost)), s: tweak(S.number, { numFmt: moneyFormat(input.currency) }) };
    default:
      return { v: '', s: S.cell };
  }
}

/** The height a line needs for its tallest wrapped cell. */
function lineHeight(columns: readonly SheetColumn[], line: BreakdownLine): number {
  const wrapped: { value: string; width: number; size?: number }[] = [];
  for (const column of columns) {
    const value =
      column.id === 'component'
        ? line.component
        : column.id === 'description'
          ? line.description
          : column.id === 'notes'
            ? line.notes.join('\n')
            : column.id === 'form' || column.id === 'integrations' || column.id === 'account'
              ? line[column.id]
              : '';
    if (value) wrapped.push({ value, width: WIDTH[column.id] });
  }
  return rowHeight(wrapped);
}

interface TotalLine {
  label: string;
  hours: number | null;
  cost: number | null;
  style: 'plain' | 'grand';
}

function breakdownSheet(input: SheetInput, breakdown: Breakdown): StyledSheet {
  const context = contextOf(input);
  const columns = sheetColumns(input.prefs, context);
  const span = columns.length;
  const widths = columns.map((column) => WIDTH[column.id]);
  const at = (id: SheetColumnId): number => columns.findIndex((column) => column.id === id) + 1;
  const firstSum = columns.findIndex((column) => SUMMABLE.has(column.id));
  /* labels for subtotals and totals sit right-aligned just before the first figure */
  const labelTo = firstSum > 0 ? firstSum : span;
  const sheet = new SheetBuilder();

  const head = sheetTop(
    sheet,
    input,
    widths,
    columns.map((column) =>
      column.id === 'estimate' ? `Estimate (${input.currency})` : column.id === 'rate' ? `Rate (${input.currency}/h)` : column.label
    )
  );

  const figures = (sums: Partial<Record<SheetColumnId, number | null>>, style: CellStyle, labelText: string): SheetCell[] => {
    const cells: SheetCell[] = [null];
    columns.forEach((column, index) => {
      if (index === 0) {
        cells.push({ v: labelText, s: style });
        return;
      }
      const value = sums[column.id];
      if (value === undefined || value === null || index < labelTo) {
        cells.push({ v: '', s: style });
        return;
      }
      const format = column.id === 'estimate' ? moneyFormat(input.currency) : column.id === 'days' ? DAYS_FORMAT : HOURS_FORMAT;
      cells.push({ n: twoDp(value), s: tweak(style, { numFmt: format }) });
    });
    return cells;
  };

  for (const deliverable of breakdown.deliverables) {
    const top = sheet.next;
    deliverable.lines.forEach((line, index) => {
      const cells: SheetCell[] = [null];
      for (const column of columns) {
        if (column.id === 'deliverable') cells.push(index === 0 ? { n: deliverable.n, s: S.deliverable } : { v: '', s: S.deliverable });
        else if (column.id === 'area') cells.push(index === 0 ? { v: deliverable.area, s: S.area } : { v: '', s: S.area });
        else cells.push(lineCell(column, line, input));
      }
      sheet.add(cells, lineHeight(columns, line));
    });
    const bottom = sheet.next - 1;
    if (at('deliverable') > 0) sheet.merge(top, at('deliverable'), bottom, at('deliverable'));
    if (at('area') > 0) sheet.merge(top, at('area'), bottom, at('area'));

    /* one line needs no subtotal, and nor does an area nobody has priced yet: "0.0, $0" reads as free */
    const priced = deliverable.lines.some((line) => line.hours !== null);
    if (sheetHas(input.prefs, context, 'totals') && firstSum >= 0 && deliverable.lines.length > 1 && priced) {
      const row = sheet.add(
        figures(
          {
            build: deliverable.lines.reduce((sum, line) => sum + (line.build ?? 0), 0) || null,
            hours: deliverable.hours,
            buffer: deliverable.buffer || null,
            days: deliverable.hours / 8,
            estimate: inCurrency(input, deliverable.cost)
          },
          S.subtotal,
          `Subtotal, ${deliverable.area}`
        ),
        ROW
      );
      sheet.merge(row, 1, row, labelTo);
    }
    /* the template leaves a blank row between deliverables */
    sheet.gap(ROW);
  }

  const { totals } = breakdown;
  if (sheetHas(input.prefs, context, 'totals')) {
    const lines: TotalLine[] = [{ label: 'Components', hours: totals.hours, cost: totals.cost, style: 'plain' }];
    if (totals.buffer > 0) {
      lines.push({
        label: `Risk buffer${input.estimate.bufPct > 0 ? ` (incl. ${input.estimate.bufPct}%)` : ''}`,
        hours: totals.buffer,
        cost: totals.bufferCost,
        style: 'plain'
      });
    }
    if (totals.pm > 0) lines.push({ label: `Project management (${input.estimate.pm}%)`, hours: totals.pm, cost: totals.pmCost, style: 'plain' });
    if (totals.qa > 0) lines.push({ label: `Quality assurance (${input.estimate.qa}%)`, hours: totals.qa, cost: totals.qaCost, style: 'plain' });
    /* with nothing added on top, the components line would only repeat the total */
    if (lines.length === 1) lines.pop();
    lines.push({ label: 'Total', hours: totals.total, cost: totals.totalCost, style: 'grand' });

    for (const line of lines) {
      const style = line.style === 'grand' ? S.grand : S.totalLabel;
      const cells = figures(
        { hours: line.hours, days: line.hours === null ? null : line.hours / 8, estimate: line.cost === null ? null : inCurrency(input, line.cost) },
        style,
        line.label
      );
      const row = sheet.add(cells, line.style === 'grand' ? 24 : ROW);
      sheet.merge(row, 1, row, labelTo);
    }
    if (at('hours') > 0) {
      const row = sheet.add([null, { v: `About ${hours1(totals.days)} person-days, at 8 hours a day`, s: S.caption }], 18);
      sheet.merge(row, 1, row, span);
    }
  }

  if (sheetHas(input.prefs, context, 'roles') && input.estimate.roleRows.length > 0) {
    sheet.gap(ROW);
    band(sheet, 'Cost by Role', span);
    sheet.gap(SPACER_SMALL);
    for (const role of input.estimate.roleRows) {
      const cells = figures(
        { hours: role.hrs, days: role.hrs / 8, estimate: inCurrency(input, role.cost) },
        S.totalLabel,
        `${role.name}, ${money(role.rate, input.currency)}/h`
      );
      const row = sheet.add(cells, ROW);
      sheet.merge(row, 1, row, labelTo);
    }
  }

  if (sheetHas(input.prefs, context, 'terms')) {
    sheet.gap(ROW);
    band(sheet, 'Terms and Caveats', span);
    sheet.gap(SPACER_SMALL);
    const width = widths.reduce((sum, w) => sum + w, 0);
    for (const term of sheetTerms(input, breakdown)) {
      const row = sheet.add([null, { v: term, s: S.term }], rowHeight([{ value: term, width }], 18));
      sheet.merge(row, 1, row, span);
    }
  }

  return { rows: sheet.rows, merges: sheet.merges, ...tableSheet(widths, head) };
}

/* ------------------------------------------------------------ the cover ---- */

/** The template's Introduction columns, A to I: a margin, seven columns, a margin. */
const COVER_WIDTHS = [5.13, 19.5, 12.63, 12.63, 12.63, 13.75, 12.63, 12.63, 6.88];

function coverSheet(input: SheetInput, breakdown: Breakdown, linked: { team: boolean; plan: boolean }): StyledSheet {
  const sheet = new SheetBuilder();
  const last = COVER_WIDTHS.length - 1;
  const title = titleOf(input);
  const titleWidth = COVER_WIDTHS.slice(1).reduce((sum, w) => sum + w, 0);

  sheet.gap(ROW);
  const titleRow = sheet.add([null, { v: title, s: tweak(S.title, { align: { wrap: true }, border: {} }) }], rowHeight([{ value: title, width: titleWidth, size: 24 }], 36));
  sheet.merge(titleRow, 1, titleRow, last);
  /* the template draws its red line as the top edge of the row under the title, B to H */
  sheet.add([null, ...filled(last - 1, { border: { top: edge(sheetColor.red) } })], ROW);
  detailRows(sheet, input, COVER_WIDTHS.slice(1, last), { leftEnd: 0, rightStart: 4, rightEnd: 4, heights: [28.5, ROW] });
  sheet.gap(ROW);
  sheet.gap(ROW);
  band(sheet, 'General Comments', last);
  sheet.gap(SPACER_SMALL);
  const comments = input.snap.sheet?.comments?.trim() || defaultComments(input, breakdown);
  const commentWidth = COVER_WIDTHS.slice(1, last).reduce((sum, w) => sum + w, 0);
  const commentRow = sheet.add([null, { v: comments, s: S.term }], rowHeight([{ value: comments, width: commentWidth }]));
  sheet.merge(commentRow, 1, commentRow, last - 1);
  sheet.gap(ROW);

  const links: [string, string][] = [[`Next Sheet | Project ${SHEET_NAMES.breakdown}  →`, SHEET_NAMES.breakdown]];
  if (linked.team) links.push([`${SHEET_NAMES.team}  →`, SHEET_NAMES.team]);
  if (linked.plan) links.push([`${SHEET_NAMES.plan}  →`, SHEET_NAMES.plan]);
  for (const [label, target] of links) {
    const row = sheet.add([{ v: label, s: S.link, link: `'${target}'!A1` }], ROW);
    sheet.merge(row, 0, row, last);
  }

  return {
    rows: sheet.rows,
    merges: sheet.merges,
    widths: COVER_WIDTHS,
    tab: sheetColor.introTab,
    gridlines: false,
    print: { landscape: true, fitWidth: true, footer: PRINT_FOOTER }
  };
}

/* -------------------------------------------------------- the team ---- */

const CARRIES_LABEL = { pm: 'project management', qa: 'quality assurance' } as const;

/** What a team row's Notes cell says: the overhead it carries, or why it is on the blended rate. */
export function teamNote(row: TeamRow, input: Pick<SheetInput, 'estimate'>): string {
  const carried = row.carries.map((kind) => `${CARRIES_LABEL[kind]} (${kind === 'pm' ? input.estimate.pm : input.estimate.qa}%)`);
  if (!row.roleId) return `Work with no rate-card role, at the blended rate${carried.length > 0 ? `, including ${carried.join(' and ')}` : ''}.`;
  return carried.length > 0 ? `Includes ${carried.join(' and ')} across the delivery.` : '';
}

function teamSheet(input: SheetInput): StyledSheet {
  const context = contextOf(input);
  const ticked = new Set(sheetColumns(input.prefs, context).map((column) => column.id));
  /* the same rule as everywhere else: no Estimate in the sheet, no money on this page either */
  const priced = ticked.has('estimate');
  const team = teamComposition(input.estimate, input.snap, input.plan);
  const fixed: [string, number][] = [
    ['Role', 28.13],
    ['Seniority', 14],
    ['People', 10],
    ['On the Project', 17.63],
    ['Hours', 10],
    ...(priced ? ([[`Rate (${input.currency}/h)`, 12], [`Cost (${input.currency})`, 14]] as [string, number][]) : []),
    ['Notes', 40.25]
  ];
  const span = fixed.length;
  const widths = fixed.map(([, width]) => width);
  const sheet = new SheetBuilder();
  const head = sheetTop(sheet, input, widths, fixed.map(([label]) => label));

  for (const row of team.rows) {
    const note = teamNote(row, input);
    const cells: SheetCell[] = [
      null,
      { v: row.role, s: tweak(S.cell, { font: row.roleId ? {} : { italic: true } }) },
      { v: row.level || '—', s: S.center },
      { n: row.people, s: S.center },
      { v: windowLabel(row.weeks) || 'Not scheduled', s: S.center },
      { n: twoDp(row.hours), s: tweak(S.number, { numFmt: HOURS_FORMAT }) }
    ];
    if (priced) {
      cells.push(
        { n: twoDp(inCurrency(input, row.rate)), s: tweak(S.number, { numFmt: moneyFormat(input.currency, '/h') }) },
        { n: twoDp(inCurrency(input, row.cost)), s: tweak(S.number, { numFmt: moneyFormat(input.currency) }) }
      );
    }
    cells.push({ v: note, s: S.cell });
    sheet.add(cells, rowHeight([{ value: note, width: 40.25 }, { value: row.role, width: 28.13 }]));
  }
  sheet.gap(ROW);

  const total: SheetCell[] = [
    null,
    { v: 'Team', s: tweak(S.grand, { align: { h: 'left' } }) },
    { v: '', s: S.grand },
    { n: team.size, s: tweak(S.grand, { align: { h: 'center' } }) },
    { v: team.weeks > 0 ? windowLabel({ from: 1, to: team.weeks }) : '', s: tweak(S.grand, { align: { h: 'center' } }) },
    { n: twoDp(team.hours), s: tweak(S.grand, { numFmt: HOURS_FORMAT }) }
  ];
  if (priced) total.push({ v: '', s: S.grand }, { n: twoDp(inCurrency(input, team.cost)), s: tweak(S.grand, { numFmt: moneyFormat(input.currency) }) });
  total.push({ v: '', s: S.grand });
  sheet.add(total, 24);

  sheet.gap(ROW);
  const width = widths.reduce((sum, w) => sum + w, 0);
  for (const line of [
    'People is the most in each role working at the same time in the delivery plan, so the team is their sum: one person does not fill two rows.',
    'Hours include each line’s share of the risk buffer. Project management and QA run across the whole delivery, with the roles the rate card gives them.'
  ]) {
    const row = sheet.add([null, { v: line, s: S.term }], rowHeight([{ value: line, width }], 18));
    sheet.merge(row, 1, row, span);
  }

  return { rows: sheet.rows, merges: sheet.merges, ...tableSheet(widths, head) };
}

/* ------------------------------------------------------- the delivery plan ---- */

/** Weeks drawn as columns. A longer plan is cut here, and the sheet says so. */
export const PLAN_WEEK_LIMIT = 52;

function planSheet(input: SheetInput, breakdown: Breakdown): StyledSheet {
  const { plan } = input;
  const weeks = Math.min(PLAN_WEEK_LIMIT, Math.max(1, plan.weeks));
  const fixed: [string, number][] = [
    ['Area', 24],
    ['Component', 28.13],
    ['Hours', 9],
    ['People', 8],
    ['Weeks', 8]
  ];
  const span = fixed.length + weeks;
  const widths = [...fixed.map(([, width]) => width), ...Array.from({ length: weeks }, () => 3.6)];
  const sheet = new SheetBuilder();
  const kickOff = input.snap.planStart ? `Kick-off ${longDate(input.snap.planStart)}. ` : '';
  const basis = `${kickOff}${plural(Math.max(1, Math.ceil(plan.end)), 'week')} end to end, up to ${plan.cap} ${plan.cap === 1 ? 'person' : 'people'} at once, ${plan.hpw} productive hours per person per week.`;
  const head = sheetTop(sheet, input, widths, [...fixed.map(([label]) => label), ...Array.from({ length: weeks }, (_, w) => String(w + 1))], basis);

  const tone = { sol: color.brand, custom: color.custom, buffer: color.buffer, span: color.overhead } as const;
  const barRow = (area: SheetCell, name: string, task: Schedule['bars'][number]): void => {
    const cells: SheetCell[] = [
      null,
      area,
      { v: name, s: tweak(S.cell, { font: task.span ? { italic: true } : {} }) },
      { n: twoDp(task.hrs), s: tweak(S.number, { numFmt: HOURS_FORMAT }) },
      { v: task.span ? '' : String(task.people), s: S.center },
      { n: task.dur, s: tweak(S.number, { numFmt: '0.0' }) }
    ];
    for (let w = 0; w < weeks; w++) {
      const runs = task.start < w + 1 && task.start + task.dur > w;
      /* a white edge between weeks, so a bar reads as weeks rather than one block */
      cells.push({ v: '', s: { fill: runs ? tone[task.kind] : w % 2 === 0 ? color.surfaceSoft : sheetColor.white, border: { left: edge(sheetColor.white) } } });
    }
    sheet.add(cells, rowHeight([{ value: name, width: 28.13 }]));
  };

  const taskByKey = new Map(plan.bars.map((task) => [task.key, task]));
  for (const deliverable of breakdown.deliverables) {
    const scheduled = deliverable.lines.filter((line) => taskByKey.has(line.key));
    if (scheduled.length === 0) continue;
    const top = sheet.next;
    scheduled.forEach((line, index) => {
      barRow(index === 0 ? { v: deliverable.area, s: S.area } : { v: '', s: S.area }, line.component, taskByKey.get(line.key)!);
    });
    sheet.merge(top, 1, sheet.next - 1, 1);
  }
  const extra = plan.bars.filter((task) => task.kind === 'buffer' || task.span);
  extra.forEach((task) => barRow({ v: '', s: S.cell }, task.name, task));

  sheet.gap(ROW);
  const legend: [string, string][] = [
    [color.brand, 'Pre-built and catalog work'],
    [color.custom, 'Custom development'],
    [color.buffer, 'Risk buffer'],
    [color.overhead, 'Runs across the delivery (PM, QA)']
  ];
  /* a swatch the size of one week, with its label running on to the right */
  const swatchAt = fixed.length + 1;
  legend.forEach(([fill, label], index) => {
    const cells: SheetCell[] = Array.from({ length: swatchAt }, () => null);
    if (index === 0) cells[swatchAt - 1] = { v: 'Key', s: S.caption };
    cells.push({ v: '', s: { fill, border: { bottom: edge(sheetColor.white, 'medium') } } }, { v: label, s: S.note });
    sheet.add(cells, 16);
  });
  if (plan.weeks > weeks) {
    const row = sheet.add([null, { v: `The plan runs to week ${plan.weeks}; the chart stops at week ${weeks}.`, s: S.note }], 16);
    sheet.merge(row, 1, row, span);
  }

  return { rows: sheet.rows, merges: sheet.merges, ...tableSheet(widths, head) };
}

/* ---------------------------------------------------------------- output ---- */

/** Every sheet the workbook will hold, in order. */
export function taskBreakdownSheets(input: SheetInput): Record<string, StyledSheet> {
  const context = contextOf(input);
  const breakdown = sheetBreakdown(input);
  const hasPlan = sheetHas(input.prefs, context, 'timeline');
  const hasTeam = sheetHas(input.prefs, context, 'team');
  const sheets: Record<string, StyledSheet> = {};
  if (sheetHas(input.prefs, context, 'cover')) sheets[SHEET_NAMES.cover] = coverSheet(input, breakdown, { team: hasTeam, plan: hasPlan });
  sheets[SHEET_NAMES.breakdown] = breakdownSheet(input, breakdown);
  if (hasTeam) sheets[SHEET_NAMES.team] = teamSheet(input);
  if (hasPlan) sheets[SHEET_NAMES.plan] = planSheet(input, breakdown);
  return sheets;
}

/** The file name, from the deal and the date: "Edly-Acme-Academy-Task-Breakdown-2026-09-27.xlsx". */
export function sheetFileName(name: string, date: string): string {
  const safe = name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'Estimate';
  return `Edly-${safe}-Task-Breakdown-${date}.xlsx`;
}

/** Triggers a download of the task breakdown as .xlsx. */
export function downloadTaskBreakdown(input: SheetInput): void {
  const bytes = writeWorkbook(taskBreakdownSheets(input));
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sheetFileName(input.estimation.name, input.date ?? new Date().toISOString().slice(0, 10));
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** What the plain-text summary needs. It follows the display settings, as the screen does. */
export interface QuoteInput {
  estimation: Estimation;
  estimate: EstimateResult;
  requests: readonly EstimateRequest[];
  plan: Schedule;
  display: DisplayPrefs;
  currency: CurrencyCode;
  platformName: string;
}

/** The same estimate as plain text, for pasting into an email or a chat. */
export function quoteText(input: QuoteInput): string {
  const { estimation, estimate, requests, plan, display, currency, platformName } = input;
  const factor = display.blendBuffer ? 1 + estimate.bufPct / 100 : 1;
  const lines: string[] = [];

  lines.push(`${platformName} Solution Bundle — Estimate`);
  lines.push(estimation.name + (estimation.client ? ` · ${estimation.client}` : ''));
  lines.push(`Prepared ${longDate()}`, '');

  for (const group of estimate.groups) {
    lines.push(`${group.name} — ${hours(group.first * factor)} h`);
    for (const item of group.items) {
      const buffer = Number(estimation.snap.buf?.[item.id]) || 0;
      lines.push(`  · ${item.name} — ${hours(((item.first ?? 0) + (display.blendBuffer ? buffer : 0)) * factor)} h`);
    }
    lines.push('');
  }

  if (requests.length > 0) {
    lines.push('Custom development');
    for (const request of requests) {
      lines.push(`  · ${request.title} — ${Number(request.est) > 0 ? `${hours(Number(request.est) * factor)} h` : 'awaiting estimate'}`);
    }
    lines.push('');
  }

  if (!display.blendBuffer && estimate.bufH > 0) lines.push(`Risk buffer: +${hours(estimate.bufH)} h`);
  if (estimate.pm > 0) lines.push(`PM overhead (${estimate.pm}%): +${hours(estimate.pmH)} h`);
  if (estimate.qa > 0) lines.push(`QA overhead (${estimate.qa}%): +${hours(estimate.qaH)} h`);

  lines.push(
    `TOTAL: ${hours(estimate.grand)} h ≈ ${hours1(estimate.days)} person-days` +
      (display.money ? ` · ${money(estimate.usd, currency)} @ ${rateLabel(estimate.rate, currency)}` : '')
  );
  lines.push(`Delivery span: ${hours1(plan.end)} weeks at peak ${plural(plan.peak, 'person')}`);

  if (display.savings && estimate.savedPct !== null) {
    lines.push(`Effort saved vs building new: ${estimate.savedPct}%`);
  }
  if (estimate.accts.length > 0) lines.push('', `Client-held accounts required: ${estimate.accts.join(' · ')}`);

  lines.push(
    '',
    'Engineering hours only — add PM, QA and support overhead per delivery standards unless applied above. Third-party vendor fees are payable by the client and are not included.'
  );
  return lines.join('\n');
}
