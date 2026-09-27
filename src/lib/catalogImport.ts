import type { Catalog } from '@/types';
import { fingerprint, readWorkbook, writeWorkbook, type CellStyle, type SheetRow, type StyledSheet, type Workbook } from '@/lib/xlsx';
import {
  BUNDLE_ALIASES,
  catalogFromWorkbook,
  cell,
  DASH,
  EXAMPLE_ID,
  findHeader,
  ITEM_ALIASES,
  mapHeaderRow,
  normalise,
  num,
  readStatus,
  SOLUTION_ID,
  text,
  type Aliases
} from '@/lib/catalogSheet';
import { estimateKey, type EstimateRow } from '@/domain/estimateImport';
import { sheetColor } from '@/theme';

/**
 * Importing a workbook into the catalog, strictly.
 *
 * Two kinds of workbook come in, and they must not be mixed up. A bundles workbook lists
 * features Edly has built and delivers again; it is the master sheet's format, and
 * `parseCatalogWorkbook` reads it. An estimates workbook lists work priced for an earlier client
 * and never built, one row each, in the template `estimatesTemplate` writes.
 *
 * The sheet parser is forgiving on purpose, because the served master sheet has to load whatever
 * a person did to it. An import is the other way round: a person is choosing to put a file into
 * the catalog, so anything that would load wrongly is refused with a reason (an error), and
 * anything that loads but not quite as written is said out loud (a warning). Nothing reaches the
 * catalog until a person has read both and clicked.
 */

export type ImportKind = 'bundles' | 'estimates';

export interface ImportIssue {
  /** An error refuses the file. A warning is shown and the rest imports. A note is only news. */
  level: 'error' | 'warning' | 'note';
  text: string;
}

export interface BundlesImport {
  kind: 'bundles';
  issues: ImportIssue[];
  /** Null when an error refused the file. */
  catalog: Catalog | null;
  hash: string;
}

export interface EstimatesImport {
  kind: 'estimates';
  issues: ImportIssue[];
  /** Empty when an error refused the file. */
  rows: EstimateRow[];
}

export type ImportRead = BundlesImport | EstimatesImport;

/** A catalog workbook is well under a megabyte. Anything this size is some other file. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_ESTIMATE_ROWS = 2000;
/** More first-delivery hours than this is money or minutes typed into an hours column. */
export const MAX_HOURS = 10_000;

export const hasErrors = (issues: readonly ImportIssue[]): boolean => issues.some((issue) => issue.level === 'error');

/**
 * A cell that holds a plain number of hours: `40`, `7.5`, `1,250`, `40 h`, `40 hrs`.
 * Not a range, a guess or a note. The sheet parser reads "2-3" as 2; an import says so first.
 */
export function plainHours(value: unknown): number | null {
  const s = String(value ?? '').trim().replace(/,/g, '');
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:h|hr|hrs|hour|hours)?\.?$/i.exec(s);
  return match ? Number(match[1]) : null;
}

/** An ISO date from what a cell holds: `2026-03-01`, or the day number Excel stores a date as. */
export function readDate(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s;
  const serial = Number(s);
  /* 1954 to 2119: wide enough for any real estimate, narrow enough that 64 hours is not a date */
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    return new Date(Math.round((serial - 25_569) * 86_400_000)).toISOString().slice(0, 10);
  }
  return null;
}

const list = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const quoted = (names: readonly string[]): string => list(names.map((name) => `"${name}"`));

/* ------------------------------------------------ the estimates template */

export type EstimateField = Exclude<keyof EstimateRow, 'row'>;

export interface TemplateColumn {
  field: EstimateField;
  /** The header, exactly as the template writes it. */
  label: string;
  need: 'required' | 'recommended' | 'optional';
  help: string;
  example: string;
  /** Other headers accepted for it, already normalised. */
  aliases: string[];
  width: number;
  /** For a recommended column: what is lost without it. */
  without?: string;
}

/** The estimates template, column by column. The reader, the template and the in-app help all come from this. */
export const ESTIMATE_COLUMNS: readonly TemplateColumn[] = [
  {
    field: 'sourceId',
    label: 'Estimate ID',
    need: 'optional',
    help: 'Your own reference for the row. Import the file again and the row with the same ID is updated, not added twice.',
    example: 'NU-014',
    aliases: ['estimate id', 'estimate ref'],
    width: 13
  },
  {
    field: 'name',
    label: 'Feature',
    need: 'required',
    help: 'The name of the piece of work, as sales will see it in the catalog.',
    example: 'Blue-green deployment pipeline',
    aliases: ['feature', 'feature name'],
    width: 34
  },
  {
    field: 'desc',
    label: 'What it does',
    need: 'recommended',
    help: 'One line a salesperson can read to a client.',
    example: 'Releases a new version with no downtime, and rolls back in one step.',
    aliases: ['what it does', 'description'],
    width: 48,
    without: 'the estimates will have no description for sales to read out'
  },
  {
    field: 'first',
    label: 'First-delivery hrs',
    need: 'required',
    help: 'Hours to deliver it the first time. A plain number: 40, not "40-60" or "about 40". A row without hours is not an estimate yet and is skipped.',
    example: '64',
    aliases: ['first delivery hrs', 'first delivery hours', 'first delivery', 'estimated hours', 'hours'],
    width: 17
  },
  {
    field: 'repeat',
    label: 'Repeat hrs',
    need: 'optional',
    help: 'Hours to deliver it again for the next client. Blank means the same as the first delivery.',
    example: '16',
    aliases: ['repeat hrs', 'repeat delivery hrs', 'repeat config hrs', 'repeat'],
    width: 12
  },
  {
    field: 'client',
    label: 'Estimated for',
    need: 'recommended',
    help: 'The client it was estimated for. Internal only: it is hidden while presenting to a client.',
    example: 'Nordic University',
    aliases: ['estimated for', 'client'],
    width: 22,
    without: 'nobody will be able to tell which client each estimate was made for'
  },
  {
    field: 'bundleId',
    label: 'Bundle ID',
    need: 'optional',
    help: 'A bundle already in the catalog, such as B15. When given, it wins over Area.',
    example: 'B15',
    aliases: ['bundle id'],
    width: 11
  },
  {
    field: 'area',
    label: 'Area',
    need: 'optional',
    help: 'The bundle it belongs under, by name. A name the catalog does not have becomes a new bundle. Leave Area and Bundle ID blank and it goes to Unassigned, for the estimation desk to file.',
    example: 'Deployment & Infrastructure',
    aliases: ['area', 'bundle'],
    width: 26
  },
  { field: 'category', label: 'Category', need: 'optional', help: 'For search and grouping.', example: 'Infrastructure', aliases: ['category'], width: 16 },
  { field: 'subCategory', label: 'Sub category', need: 'optional', help: 'For search and grouping.', example: 'Custom', aliases: ['sub category'], width: 14 },
  {
    field: 'form',
    label: 'Delivery form',
    need: 'optional',
    help: 'Custom development, Plugin / extension, Service integration and so on. Blank reads as Custom development.',
    example: 'Custom development',
    aliases: ['delivery form'],
    width: 20
  },
  { field: 'deploy', label: 'Std deployment time', need: 'optional', help: 'How long it takes to deploy.', example: '1 week', aliases: ['std deployment time', 'deployment time'], width: 16 },
  { field: 'integrations', label: 'Integrations', need: 'optional', help: 'Third-party systems it touches.', example: 'GitHub Actions, AWS', aliases: ['integrations'], width: 20 },
  {
    field: 'account',
    label: '3rd-party account',
    need: 'optional',
    help: 'An account the client must hold, such as Stripe or Zoom.',
    example: 'AWS',
    aliases: ['3rd party account', 'third party account', 'client held account'],
    width: 16
  },
  {
    field: 'limits',
    label: 'Notes & limits',
    need: 'optional',
    help: 'Scope boundaries the next client must know. Shown in the catalog.',
    example: 'Single region only.',
    aliases: ['notes limits', 'notes and limits', 'limits'],
    width: 30
  },
  {
    field: 'note',
    label: 'Assumptions',
    need: 'optional',
    help: 'Assumptions and exclusions, shown to sales as the estimator note.',
    example: 'Assumes the client already runs on AWS.',
    aliases: ['assumptions', 'notes assumptions', 'note to sales'],
    width: 30
  },
  { field: 'estBy', label: 'Estimated by', need: 'optional', help: 'Who priced it.', example: 'Estimation desk', aliases: ['estimated by'], width: 16 },
  {
    field: 'estAt',
    label: 'Estimated on',
    need: 'optional',
    help: 'When it was priced, as a date or written 2026-03-01. Blank means the day it is imported.',
    example: '2026-03-01',
    aliases: ['estimated on', 'date'],
    width: 14
  }
];

const ESTIMATE_ALIASES: Aliases = Object.fromEntries(ESTIMATE_COLUMNS.map((column) => [column.field, column.aliases]));
const REQUIRED = ESTIMATE_COLUMNS.filter((column) => column.need === 'required');

/* ------------------------------------------------------ what a file is */

export type WorkbookShape = 'bundles' | 'estimates' | 'breakdown' | 'unknown';

const BUNDLE_SHEET = /^\s*(B\d{1,3})\b/i;

/**
 * Which kind of workbook this is, from its sheets and headers, before anything is read from it.
 * A client task breakdown is named apart because it is the file people most often reach for: it
 * is what the builder downloads, and it looks like an estimate.
 */
export function workbookShape(workbook: Workbook): WorkbookShape {
  const names = Object.keys(workbook);
  if (names.some((name) => normalise(name) === 'task breakdown')) return 'breakdown';
  const bundleSheets =
    names.some((name) => normalise(name).includes('all component') || normalise(name).includes('bundle catalog')) ||
    names.some((name) => BUNDLE_SHEET.test(name) && findHeader(workbook[name]!, ITEM_ALIASES, ['id', 'name']) !== null);
  if (bundleSheets) return 'bundles';
  const estimates =
    names.some((name) => normalise(name) === 'estimates') ||
    names.some((name) => findHeader(workbook[name]!, ESTIMATE_ALIASES, ['name', 'first']) !== null);
  return estimates ? 'estimates' : 'unknown';
}

const NOT_XLSX =
  'This file could not be opened as an Excel workbook. Save it from Excel as .xlsx (not .xls, .csv or a password-protected file) and try again.';

const BREAKDOWN =
  'This is a client task breakdown, the sheet the builder downloads for one client. It cannot be imported. Copy its custom lines, with their hours, into the estimates template.';

const NOT_BUNDLES =
  'This is not a bundles workbook. It needs an All Components sheet, or one sheet per bundle named B01, B02 and so on, with Solution ID, Feature and First-delivery hrs columns. Download the bundles template to see the layout.';

const ESTIMATES_AS_BUNDLES =
  'This is an estimates sheet: it has Feature and First-delivery hrs columns but no All Components sheet and no bundle sheets named B01, B02 and so on. Import it under Estimates.';

const NOT_ESTIMATES =
  'This is not an estimates sheet. It needs a sheet named Estimates with Feature and First-delivery hrs columns. Download the estimates template and copy the rows into it.';

const BUNDLES_AS_ESTIMATES =
  'This is a bundles workbook: it has the All Components, Bundle Catalog or B01, B02 sheets that built features are listed on. Import it under Bundles.';

/** Read a workbook a person picked, as the kind they said it is. Never throws. */
export async function readImport(input: ArrayBuffer | Uint8Array, kind: ImportKind): Promise<ImportRead> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const refuse = (message: string): ImportRead =>
    kind === 'bundles'
      ? { kind, issues: [{ level: 'error', text: message }], catalog: null, hash: '' }
      : { kind, issues: [{ level: 'error', text: message }], rows: [] };

  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return refuse(`This file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. A catalog workbook is far smaller, so check it is the right file.`);
  }
  let workbook: Workbook;
  try {
    workbook = await readWorkbook(bytes);
  } catch {
    return refuse(NOT_XLSX);
  }
  if (Object.keys(workbook).length === 0) return refuse(NOT_XLSX);

  const shape = workbookShape(workbook);
  if (shape === 'breakdown') return refuse(BREAKDOWN);

  if (kind === 'bundles') {
    if (shape === 'estimates') return refuse(ESTIMATES_AS_BUNDLES);
    if (shape === 'unknown') return refuse(NOT_BUNDLES);
    const issues = checkBundles(workbook);
    if (hasErrors(issues)) return { kind, issues, catalog: null, hash: '' };
    try {
      /* the parser's own warnings are left out: checkBundles has already said each of them, row by row */
      return { kind, issues, catalog: catalogFromWorkbook(workbook).catalog, hash: fingerprint(bytes) };
    } catch (problem) {
      return { kind, issues: [...issues, { level: 'error', text: (problem as Error).message }], catalog: null, hash: '' };
    }
  }

  if (shape === 'bundles') return refuse(BUNDLES_AS_ESTIMATES);
  if (shape === 'unknown') return refuse(NOT_ESTIMATES);
  const { rows, issues } = readEstimates(workbook);
  return { kind, issues, rows: hasErrors(issues) ? [] : rows };
}

/* ------------------------------------------------------ bundles, checked */

const RECOMMENDED_ITEM: readonly { field: string; label: string; without: string }[] = [
  { field: 'desc', label: 'What it does', without: 'solutions will have no description' },
  { field: 'status', label: 'Status', without: 'every solution will read as Production' },
  { field: 'repeat', label: 'Repeat config hrs', without: 'repeat deliveries will have no hours' },
  { field: 'build', label: 'Original build hrs', without: 'engineered hours and reuse savings will be missing' }
];

const HOUR_FIELDS: readonly [string, string][] = [
  ['first', 'First-delivery hrs'],
  ['repeat', 'Repeat config hrs'],
  ['build', 'Original build hrs']
];

const blank = (row: readonly string[] | undefined): boolean => !row || row.every((value) => !String(value ?? '').trim());

/**
 * Everything that would make a bundles workbook load differently from how it reads.
 *
 * The rules follow what the parser does with the same sheets: All Components is the canonical
 * list and needs a Bundle ID and hours; a B01-style sheet wins over it for the rows it lists, and
 * needs hours of its own only when there is no All Components to fall back on.
 */
export function checkBundles(workbook: Workbook): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const error = (message: string): void => void issues.push({ level: 'error', text: message });
  const warn = (message: string): void => void issues.push({ level: 'warning', text: message });
  const note = (message: string): void => void issues.push({ level: 'note', text: message });

  const names = Object.keys(workbook);
  const allName = names.find((name) => normalise(name) === 'all components') ?? names.find((name) => normalise(name).includes('all component'));
  const detailNames = names.filter((name) => BUNDLE_SHEET.test(name));
  const catalogName = names.find((name) => normalise(name) === 'bundle catalog') ?? names.find((name) => normalise(name).includes('bundle catalog'));

  if (!allName && detailNames.length === 0) {
    error(NOT_BUNDLES);
    return issues;
  }

  const present = new Set<string>();
  const onAll = new Map<string, { bundleId: string; row: number }>();
  const onDetail = new Map<string, { sheet: string; bundleId: string; row: number }>();
  const estimates = new Set<string>();
  const noBundle: string[] = [];
  const examples = new Set<string>();

  const scan = (sheet: string, needs: { hours: boolean; bundleId: boolean }): void => {
    const table = workbook[sheet]!;
    const header = findHeader(table, ITEM_ALIASES, ['id', 'name']);
    if (!header) {
      error(`Sheet "${sheet}" has no header row with Solution ID and Feature columns.`);
      return;
    }
    for (const field of Object.keys(header.map)) present.add(field);
    if (needs.hours && header.map.first === undefined) error(`Sheet "${sheet}" has no First-delivery hrs column, so none of its solutions could be priced.`);
    if (needs.bundleId && header.map.bundleId === undefined) error(`Sheet "${sheet}" has no Bundle ID column, so its solutions cannot be placed in their bundles.`);

    const isAll = sheet === allName;
    const sheetBundle = isAll ? '' : (BUNDLE_SHEET.exec(sheet)?.[1] ?? '').toUpperCase();
    for (let r = header.row + 1; r < table.length; r++) {
      const row = table[r];
      if (blank(row)) continue;
      const at = `"${sheet}" row ${r + 1}`;
      const rawId = text(cell(row, header.map, 'id'));
      const name = text(cell(row, header.map, 'name'));
      if (!rawId) {
        /* "Bundle total" rows have a name and no id, and are meant to be skipped */
        if (name && !/total/i.test(name)) warn(`${at}: "${name}" has no Solution ID, so it was skipped.`);
        continue;
      }
      if (/total/i.test(rawId)) continue;
      if (EXAMPLE_ID.test(rawId)) {
        examples.add(rawId.toUpperCase());
        continue;
      }
      if (!SOLUTION_ID.test(rawId)) {
        if (name) warn(`${at}: "${rawId}" is not a solution ID (they look like EDU-001), so the row was skipped.`);
        continue;
      }

      if (isAll) {
        const earlier = onAll.get(rawId);
        if (earlier) error(`${rawId} is listed twice on "${sheet}", rows ${earlier.row} and ${r + 1}. Each solution needs its own ID.`);
        else {
          const bundleId = (text(cell(row, header.map, 'bundleId')) ?? '').toUpperCase();
          onAll.set(rawId, { bundleId, row: r + 1 });
          if (!bundleId && header.map.bundleId !== undefined) noBundle.push(rawId);
        }
      } else {
        const earlier = onDetail.get(rawId);
        if (earlier && earlier.sheet === sheet) error(`${rawId} is listed twice on "${sheet}", rows ${earlier.row} and ${r + 1}. Each solution needs its own ID.`);
        else if (earlier) error(`${rawId} is on both "${earlier.sheet}" and "${sheet}". A solution belongs to one bundle.`);
        else onDetail.set(rawId, { sheet, bundleId: sheetBundle, row: r + 1 });
      }

      for (const [field, label] of HOUR_FIELDS) {
        const raw = String(cell(row, header.map, field) ?? '').trim();
        if (!raw || DASH.test(raw)) continue;
        const read = num(raw);
        if (read !== null && read < 0) error(`${rawId} (${at}): ${label} is negative.`);
        else if (plainHours(raw) === null) {
          warn(`${rawId} (${at}): ${label} "${raw}" is not a plain number of hours, so it reads as ${read === null ? 'not estimated' : `${read} h`}.`);
        }
      }

      const rawStatus = text(cell(row, header.map, 'status'));
      if (rawStatus) {
        const status = readStatus(rawStatus);
        if (!status) warn(`${rawId} (${at}): status "${rawStatus}" is not Production, In Development or Estimation, so it reads as Production.`);
        else if (status === 'Estimation') estimates.add(rawId);
      }
    }
  };

  if (allName) scan(allName, { hours: true, bundleId: true });
  for (const sheet of detailNames) scan(sheet, { hours: !allName, bundleId: false });

  if (onAll.size === 0 && onDetail.size === 0 && !hasErrors(issues)) {
    error(
      examples.size > 0
        ? 'Only the example rows are filled in. Add your solutions under them, or in their place.'
        : 'No solutions found: the sheets have headers but no rows with a Solution ID.'
    );
  } else if (examples.size > 0) {
    note(`The ${examples.size === 1 ? 'example row was' : `${examples.size} example rows were`} left out, as they always are.`);
  }

  for (const column of RECOMMENDED_ITEM) {
    if (!present.has(column.field)) warn(`No sheet has a ${column.label} column, so ${column.without}.`);
  }

  const described = new Set<string>();
  if (catalogName) {
    const table = workbook[catalogName]!;
    const header = findHeader(table, BUNDLE_ALIASES, ['id', 'name']);
    if (!header) warn(`The "${catalogName}" sheet has no header row with Bundle ID and Bundle columns, so bundles will have no pitch unless their own sheets carry one.`);
    else {
      for (let r = header.row + 1; r < table.length; r++) {
        const id = text(cell(table[r], header.map, 'id'));
        if (id && !EXAMPLE_ID.test(id)) described.add(id.toUpperCase());
      }
    }
  } else {
    warn('There is no Bundle Catalog sheet, so bundles will have no pitch or "offer when" text unless their own sheets carry it.');
  }

  for (const [id, home] of onDetail) {
    const listed = onAll.get(id);
    if (listed?.bundleId && listed.bundleId !== home.bundleId) {
      warn(`${id} is on sheet "${home.sheet}" but All Components files it under ${listed.bundleId}. The bundle sheet wins, so it goes in ${home.bundleId}.`);
    }
  }

  const sheetBundles = new Set(detailNames.map((name) => (BUNDLE_SHEET.exec(name)?.[1] ?? '').toUpperCase()));
  const loose = new Map<string, number>();
  for (const [id, listed] of onAll) {
    if (onDetail.has(id) || !listed.bundleId) continue;
    if (!sheetBundles.has(listed.bundleId) && !described.has(listed.bundleId)) loose.set(listed.bundleId, (loose.get(listed.bundleId) ?? 0) + 1);
  }
  for (const [bundleId, count] of loose) {
    warn(`${count === 1 ? '1 solution is' : `${count} solutions are`} filed under ${bundleId}, which has no bundle sheet and no Bundle Catalog row, so ${bundleId} will have no name or pitch of its own.`);
  }
  const unfiled = noBundle.filter((id) => !onDetail.has(id));
  if (unfiled.length > 0) {
    warn(`${list(unfiled.slice(0, 6))}${unfiled.length > 6 ? ` and ${unfiled.length - 6} more` : ''} ${unfiled.length === 1 ? 'has' : 'have'} no Bundle ID, so ${unfiled.length === 1 ? 'it lands' : 'they land'} in "Unsorted solutions".`);
  }
  if (estimates.size > 0) {
    warn(
      `${estimates.size === 1 ? '1 solution has' : `${estimates.size} solutions have`} status Estimation, so ${estimates.size === 1 ? 'it is' : 'they are'} listed as estimates, not bundles. Priced work that was never built usually comes in through the estimates template.`
    );
  }
  return issues;
}

/* ----------------------------------------------------- estimates, read */

/** The rows of an estimates workbook, checked, with every row it could not take said out loud. */
export function readEstimates(workbook: Workbook): { rows: EstimateRow[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const error = (message: string): void => void issues.push({ level: 'error', text: message });
  const warn = (message: string): void => void issues.push({ level: 'warning', text: message });
  const rows: EstimateRow[] = [];

  const names = Object.keys(workbook);
  let sheet = names.find((name) => normalise(name) === 'estimates');
  if (!sheet) {
    const candidates = names.filter((name) => findHeader(workbook[name]!, ESTIMATE_ALIASES, ['name', 'first']) !== null);
    if (candidates.length > 1) {
      error(`Several sheets look like estimates (${quoted(candidates)}). Put the estimates on one sheet named Estimates.`);
      return { rows, issues };
    }
    sheet = candidates[0];
  }
  if (!sheet) {
    error(NOT_ESTIMATES);
    return { rows, issues };
  }

  const table = workbook[sheet]!;
  const header = findHeader(table, ESTIMATE_ALIASES, ['name', 'first']);
  if (!header) {
    /* name what is missing from the row that came closest to being the header */
    let best: Record<string, number> = {};
    for (const row of table.slice(0, 30)) {
      const map = mapHeaderRow(row, ESTIMATE_ALIASES);
      if (Object.keys(map).length > Object.keys(best).length) best = map;
    }
    const missing = REQUIRED.filter((column) => best[column.field] === undefined).map((column) => column.label);
    error(
      `The "${sheet}" sheet has no ${quoted(missing)} column${missing.length === 1 ? '' : 's'}. The headers go in one row, spelled as in the estimates template.`
    );
    return { rows, issues };
  }

  for (const column of ESTIMATE_COLUMNS) {
    if (column.need === 'recommended' && header.map[column.field] === undefined) warn(`There is no ${column.label} column, so ${column.without}.`);
  }
  const mapped = new Set(Object.values(header.map));
  const unknown = (table[header.row] ?? []).map((value, index) => (mapped.has(index) ? '' : String(value ?? '').trim())).filter(Boolean);
  if (unknown.length > 0) warn(`${unknown.length === 1 ? 'A column was' : 'Columns were'} not recognised, so ${unknown.length === 1 ? 'it was' : 'they were'} ignored: ${quoted(unknown)}.`);

  const seen = new Map<string, number>();
  let dataRows = 0;
  let examples = 0;
  for (let r = header.row + 1; r < table.length; r++) {
    const line = table[r];
    if (blank(line)) continue;
    dataRows += 1;
    const at = r + 1;
    const get = (field: EstimateField): string => text(cell(line, header.map, field)) ?? '';
    if (EXAMPLE_ID.test(get('sourceId'))) {
      examples += 1;
      dataRows -= 1;
      continue;
    }
    const name = get('name');
    if (/^(sub)?totals?\b/i.test(name) || (!name && (line ?? []).some((value) => /^(sub)?totals?\b/i.test(String(value ?? '').trim())))) {
      dataRows -= 1;
      continue;
    }
    if (!name) {
      warn(`Row ${at} has no Feature, so it was skipped.`);
      continue;
    }
    const label = `Row ${at} (${name})`;

    const firstRaw = get('first');
    if (!firstRaw) {
      warn(`${label} has no First-delivery hrs, so it is not an estimate yet and was skipped. Send it to the estimation desk to be priced.`);
      continue;
    }
    const first = plainHours(firstRaw);
    if (first === null) {
      warn(`${label}: First-delivery hrs "${firstRaw}" is not a plain number of hours, so the row was skipped.`);
      continue;
    }
    if (first <= 0) {
      warn(`${label}: First-delivery hrs must be more than 0, so the row was skipped.`);
      continue;
    }
    if (first > MAX_HOURS) {
      warn(`${label}: ${first.toLocaleString('en-US')} first-delivery hours is more than ${MAX_HOURS.toLocaleString('en-US')}, which reads like money or minutes, so the row was skipped.`);
      continue;
    }

    let repeat: number | null = null;
    const repeatRaw = get('repeat');
    if (repeatRaw) {
      const read = plainHours(repeatRaw);
      if (read === null || read > MAX_HOURS) warn(`${label}: Repeat hrs "${repeatRaw}" is not a usable number of hours, so the first-delivery hours are used.`);
      else repeat = read;
    }

    const dateRaw = get('estAt');
    const estAt = dateRaw ? readDate(dateRaw) : '';
    if (estAt === null) warn(`${label}: Estimated on "${dateRaw}" is not a date we can read, so the import date is used. Write dates as 2026-03-01.`);

    const record: EstimateRow = {
      row: at,
      sourceId: get('sourceId'),
      name,
      desc: get('desc'),
      first,
      repeat,
      client: get('client'),
      bundleId: get('bundleId'),
      area: get('area'),
      category: get('category'),
      subCategory: get('subCategory'),
      form: get('form'),
      deploy: get('deploy'),
      integrations: get('integrations'),
      account: get('account'),
      limits: get('limits'),
      note: get('note'),
      estBy: get('estBy'),
      estAt: estAt ?? ''
    };
    const identity = estimateKey(record.sourceId, record.name, record.client);
    const earlier = seen.get(identity);
    if (earlier) {
      warn(`${label} repeats row ${earlier} (the same ${record.sourceId ? `Estimate ID, ${record.sourceId}` : 'Feature and Estimated for'}), so it was skipped.`);
      continue;
    }
    seen.set(identity, at);
    rows.push(record);
  }

  if (rows.length > MAX_ESTIMATE_ROWS) {
    error(`The sheet has ${rows.length.toLocaleString('en-US')} estimates. Split it into files of up to ${MAX_ESTIMATE_ROWS.toLocaleString('en-US')} rows.`);
  } else if (rows.length === 0) {
    error(
      dataRows > 0
        ? 'No estimates to import: every row was skipped, for the reasons listed.'
        : examples > 0
          ? 'Only the example rows are filled in. Add your estimates under them, or in their place.'
          : `The "${sheet}" sheet has its headers but no rows under them.`
    );
  } else if (examples > 0) {
    issues.push({
      level: 'note',
      text: `The ${examples === 1 ? 'example row was' : `${examples} example rows were`} left out, as they always are.`
    });
  }
  return { rows, issues };
}

/* ------------------------------------------------------------ templates */

const HEAD: CellStyle = {
  font: { name: 'Arial', size: 10, bold: true, color: sheetColor.red },
  fill: sheetColor.head,
  align: { v: 'center', wrap: true }
};
const HEAD_REQUIRED: CellStyle = { ...HEAD, fill: sheetColor.deliverable };
const TITLE: CellStyle = { font: { name: 'Arial', size: 16, bold: true, color: sheetColor.red } };
const BODY: CellStyle = { font: { name: 'Arial', size: 10 }, align: { v: 'top', wrap: true } };
const STRONG: CellStyle = { font: { name: 'Arial', size: 10, bold: true }, align: { v: 'top', wrap: true } };
/* grey and italic, so an example row never passes for a real one at a glance */
const EXAMPLE: CellStyle = { font: { name: 'Arial', size: 10, italic: true, color: sheetColor.label }, align: { v: 'top', wrap: true } };

const exampleRow = (values: readonly (string | number)[]): SheetRow => ({ cells: values.map((value) => ({ v: value, s: EXAMPLE })) });

/**
 * Three examples, one for each way a row is filed: under a bundle by its Bundle ID, into a new
 * bundle its Area names, and to Unassigned when it has neither. Their Estimate IDs start EXAMPLE, so the
 * import always leaves them out, whether or not anyone deletes them.
 */
const ESTIMATE_EXAMPLES: readonly Partial<Record<EstimateField, string | number>>[] = [
  {
    sourceId: 'EXAMPLE-1',
    name: 'Blue-green deployment pipeline',
    desc: 'Releases a new version with no downtime, and rolls back in one step.',
    first: 64,
    repeat: 16,
    client: 'Acme Academy',
    bundleId: 'B15',
    category: 'Infrastructure',
    subCategory: 'Custom',
    form: 'Custom development',
    deploy: '1 week',
    integrations: 'GitHub Actions, AWS',
    account: 'AWS',
    limits: 'Single region only.',
    note: 'Assumes the client already runs on AWS. Bundle ID B15 files a row like this under Platform Engineering & Integrations in the Open edX catalog.',
    estBy: 'Estimation desk',
    estAt: '2026-03-01'
  },
  {
    sourceId: 'EXAMPLE-2',
    name: 'Push notifications in the mobile app',
    desc: 'Course reminders and announcements pushed to learners’ phones.',
    first: 60,
    repeat: 20,
    client: 'Nordic University',
    area: 'Mobile Apps',
    category: 'Mobile',
    form: 'Plugin / extension',
    deploy: '3 days',
    integrations: 'Firebase',
    account: 'Firebase',
    note: 'An Area the catalog has no bundle for: a row like this gets a new Mobile Apps bundle.',
    estBy: 'Estimation desk',
    estAt: '2026-04-15'
  },
  {
    sourceId: 'EXAMPLE-3',
    name: 'Custom certificate designer',
    desc: 'Admins lay out certificates in the browser.',
    first: 90,
    client: 'Acme Academy',
    category: 'Assessment',
    note: 'No Area or Bundle ID: a row like this goes to Unassigned, and the estimation desk files it.'
  }
];

const headerRow = (labels: readonly { label: string; required?: boolean }[]): SheetRow => ({
  h: 30,
  cells: labels.map((column) => ({ v: column.label, s: column.required ? HEAD_REQUIRED : HEAD }))
});

const helpRows = (lines: readonly string[]): SheetRow[] => lines.map((line) => ({ cells: [{ v: line, s: BODY }] }));

/**
 * The estimates template: the Estimates sheet with its headers and three example rows, and a sheet
 * saying how to fill it in. A template uploaded untouched is refused, because the examples are
 * all it holds, so a made-up estimate can never reach the catalog.
 */
export function estimatesTemplate(): Uint8Array {
  const estimates: StyledSheet = {
    rows: [
      headerRow(ESTIMATE_COLUMNS.map((column) => ({ label: column.label, required: column.need === 'required' }))),
      ...ESTIMATE_EXAMPLES.map((example) => exampleRow(ESTIMATE_COLUMNS.map((column) => example[column.field] ?? '')))
    ],
    widths: ESTIMATE_COLUMNS.map((column) => column.width),
    freezeRows: 1,
    tab: sheetColor.tab
  };
  const help: StyledSheet = {
    rows: [
      { h: 26, cells: [{ v: 'Estimates template: how to fill it in', s: TITLE }] },
      ...helpRows([
        'One row per piece of work that was priced for a client but has not been built. Built features go in the bundles workbook instead.',
        'Keep the sheet named Estimates and keep the headers as they are. Pink headers are required; a row without Feature or First-delivery hrs is skipped.',
        'Hours are plain numbers of hours. Import the same file again and rows are updated, matched by Estimate ID, or by Feature and Estimated for when there is no ID.',
        'Leave Area and Bundle ID blank and the estimate goes to Unassigned, where the estimation desk files it under a bundle.',
        'The grey rows on the Estimates sheet are examples: their Estimate IDs start EXAMPLE, and the import always leaves them out. Delete them or keep them, and add your rows under them.'
      ]),
      { cells: [] },
      headerRow([{ label: 'Column' }, { label: 'Needed' }, { label: 'What to put in it' }, { label: 'Example' }]),
      ...ESTIMATE_COLUMNS.map((column) => ({
        cells: [
          { v: column.label, s: STRONG },
          { v: column.need === 'required' ? 'Required' : column.need === 'recommended' ? 'Recommended' : 'Optional', s: BODY },
          { v: column.help, s: BODY },
          { v: column.example, s: BODY }
        ]
      }))
    ],
    widths: [22, 14, 80, 34],
    gridlines: false,
    tab: sheetColor.introTab
  };
  return writeWorkbook({ Estimates: estimates, 'How to fill this in': help });
}

const BUNDLE_COLUMNS: readonly { label: string; required?: boolean; width: number }[] = [
  { label: 'Bundle ID', required: true, width: 11 },
  { label: 'Bundle', required: true, width: 28 },
  { label: 'What it delivers (elevator pitch)', width: 50 },
  { label: 'Offer when the client asks about…', width: 36 },
  { label: 'Pairs well with', width: 18 }
];

const COMPONENT_COLUMNS: readonly { label: string; required?: boolean; width: number }[] = [
  { label: 'Bundle ID', required: true, width: 11 },
  { label: 'Bundle', width: 26 },
  { label: 'Solution ID', required: true, width: 12 },
  { label: 'Feature', required: true, width: 32 },
  { label: 'Category', width: 16 },
  { label: 'Sub Category', width: 16 },
  { label: 'Status', width: 14 },
  { label: 'What it does', width: 48 },
  { label: 'First-delivery hrs', required: true, width: 16 },
  { label: 'Repeat config hrs', width: 16 },
  { label: 'Original build hrs', width: 16 },
  { label: 'Std deployment time', width: 16 },
  { label: '3rd-party account', width: 16 },
  { label: 'Reference', width: 30 }
];

/**
 * The bundles template: the master sheet's layout with one example bundle. Bundle Catalog carries
 * each bundle's words, All Components every solution. One sheet per bundle, named B01 and so on,
 * is optional and wins over All Components for the rows it lists, as in the master sheet. The
 * example's ids start EXAMPLE, so the import leaves it out, as it does the estimates examples.
 */
export function bundlesTemplate(): Uint8Array {
  const catalog: StyledSheet = {
    rows: [
      { h: 26, cells: [{ v: 'Edly Solution Bundles (Sales Catalog)', s: TITLE }] },
      /* not wrapped, so it runs across the empty cells beside it instead of stacking in column A */
      { cells: [{ v: 'Features built for a client before, grouped into bundles sales can offer again.', s: { font: { name: 'Arial', size: 10 } } }] },
      { cells: [] },
      headerRow(BUNDLE_COLUMNS),
      exampleRow(['EXAMPLE', 'Mobile Apps (example)', 'Your academy in the app stores, with push reminders and offline study.', 'mobile learning · studying offline', 'B09 (branding)'])
    ],
    widths: BUNDLE_COLUMNS.map((column) => column.width),
    tab: sheetColor.tab
  };
  const components: StyledSheet = {
    rows: [
      { h: 26, cells: [{ v: 'All Components', s: TITLE }] },
      { cells: [] },
      headerRow(COMPONENT_COLUMNS),
      exampleRow(['EXAMPLE', 'Mobile Apps (example)', 'EXAMPLE-1', 'Branded mobile app', 'Mobile', 'Custom Plugin', 'Production', 'The Open edX app in the client’s colours, published to both stores.', 40, 10, 320, '2 weeks', 'Apple, Google', '—']),
      exampleRow(['EXAMPLE', 'Mobile Apps (example)', 'EXAMPLE-2', 'Offline downloads', 'Mobile', 'Custom Plugin', 'In Development', 'Learners download units to study offline. Not priced yet, so its hours are blank.', '', '', 200, 'Not recorded', '—', '—'])
    ],
    widths: COMPONENT_COLUMNS.map((column) => column.width),
    freezeRows: 3,
    tab: sheetColor.tab
  };
  const help: StyledSheet = {
    rows: [
      { h: 26, cells: [{ v: 'Bundles template: how to fill it in', s: TITLE }] },
      ...helpRows([
        'For features Edly has built for a client and can deliver again. Work that was priced but never built goes in the estimates template instead.',
        'Bundle Catalog: one row per bundle, with a Bundle ID such as B01 and its name. The pitch and "offer when" text are what sales reads out.',
        'All Components: one row per solution, with its Bundle ID, a Solution ID such as EDU-101 that no other solution uses, the Feature and its First-delivery hrs. Pink headers are required.',
        'Status is Production, or In Development for something not finished. Leave First-delivery hrs blank only for a solution nobody has priced yet: it shows as No estimate.',
        'Optional: one sheet per bundle, named "B01 Commerce" and so on, with the same columns and Pitch:, "Offer when the client asks about:" and "Pairs well with:" lines above the header. It wins over All Components for the rows it lists.',
        'When adding this workbook to a catalog that already has bundles, use Bundle IDs the catalog does not use yet, or the same ID and name as the bundle you are adding to.',
        'The grey rows are an example bundle: its IDs start EXAMPLE, and the import always leaves them out. Delete them or keep them, and add your rows under them.'
      ])
    ],
    widths: [120],
    gridlines: false,
    tab: sheetColor.introTab
  };
  return writeWorkbook({ 'Bundle Catalog': catalog, 'All Components': components, 'How to fill this in': help });
}

/** Save a template the browser wrote. */
export function downloadTemplate(kind: ImportKind): void {
  const bytes = kind === 'bundles' ? bundlesTemplate() : estimatesTemplate();
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = kind === 'bundles' ? 'Edly bundles template.xlsx' : 'Edly estimates template.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
