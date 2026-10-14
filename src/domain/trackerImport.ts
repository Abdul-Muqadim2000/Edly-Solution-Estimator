import type { Catalog, CatalogDetail } from '@/types';
import type { SheetTable, Workbook } from '@/lib/xlsx';
import { EXAMPLE_ID, findHeader, normalise, num, text, type Aliases } from '@/lib/catalogSheet';
import { readYesNo } from '@/domain/catalogDetails';

/**
 * Reading the reusable features tracker into internal details of catalog solutions.
 *
 * The tracker is the team's own sheet (one row per feature: who it was built for, who to ask, where
 * the code is). Its rows are matched to the catalog by Solution ID when the sheet has that column,
 * otherwise by the feature's name, which is how the catalog was first made from it. Nothing is
 * stored here: this works out what an import would bring, and a person applies it.
 */

/** Header names as the tracker writes them, normalised (lower case, punctuation as spaces). Exact names first. */
export const TRACKER_ALIASES: Aliases = {
  solutionId: ['solution id'],
  name: ['feature module name', 'feature name', 'feature', 'module name'],
  builtFor: ['originally built for client', 'originally built for', 'built for'],
  contact: ['person of contact', 'point of contact', 'contact'],
  team: ['owner team', 'owner', 'team'],
  source: ['github url', 'github', 'source code', 'repository'],
  plugin: ['already a plugin'],
  mixed: ['mixed with other features'],
  reuseCount: ['reuse count so far', 'reuse count'],
  dependencies: ['dependencies'],
  implementation: ['implementation description', 'implementation'],
  keywords: ['tender keywords', 'match keywords', 'keywords'],
  convert: ['hours to convert to plugin b', 'hours to convert to plugin'],
  config: ['hours for custom config per reuse c', 'hours for custom config per reuse'],
  firstReuse: ['est hours first reuse b c', 'est hours first reuse']
};

/** The columns that make a sheet the tracker rather than a catalog: at least one must be there. */
const INTERNAL: readonly (keyof CatalogDetail)[] = ['builtFor', 'contact', 'team', 'source', 'plugin', 'mixed', 'reuseCount', 'dependencies', 'implementation', 'keywords'];

export interface TrackerPlan {
  sheet: string;
  /** The detail fields this workbook has a column for. A field it lacks keeps what is stored. */
  columns: (keyof CatalogDetail)[];
  /** Matched rows, ready to store. */
  details: Partial<CatalogDetail>[];
  matched: { row: number; name: string; solutionId: string }[];
  unmatched: { row: number; name: string; why: string }[];
  /** Things worth a look that do not stop the import, such as hours that do not add up. */
  warnings: string[];
}

const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
const hours = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, ''));

/**
 * What importing this workbook would store for `plat`, or why it cannot be read. The sheet read is
 * the first whose header row names the feature and at least one internal column, so a Summary or
 * Instructions sheet beside it is passed over.
 */
export function readTracker(workbook: Workbook, catalog: Catalog, plat: string, file: string, stamp: string): TrackerPlan | { error: string } {
  let found: { sheet: string; table: SheetTable; row: number; map: Record<string, number> } | null = null;
  for (const [sheet, table] of Object.entries(workbook)) {
    const header = findHeader(table, TRACKER_ALIASES, ['name']);
    if (!header) continue;
    if (!INTERNAL.some((field) => header.map[field] !== undefined)) continue;
    found = { sheet, table, row: header.row, map: header.map };
    break;
  }
  if (!found) {
    return { error: 'No sheet in this workbook names its features and who built them (columns such as "Feature / Module Name" and "Originally Built For").' };
  }

  const { sheet, table, map } = found;
  const columns = (['name', ...INTERNAL] as (keyof CatalogDetail)[]).filter((field) => field === 'name' || map[field] !== undefined);
  const cell = (row: readonly unknown[], field: string): string => (map[field] === undefined ? '' : text(row[map[field]!]) ?? '');
  const number = (row: readonly unknown[], field: string): number | null => (map[field] === undefined ? null : num(row[map[field]!]));

  const solutions = catalog.bundles.flatMap((bundle) => bundle.items);
  const byId = new Map(solutions.map((item) => [item.id.toUpperCase(), item] as const));
  const byName = new Map<string, string[]>();
  for (const item of solutions) {
    const key = normalise(item.name);
    const ids = byName.get(key) ?? [];
    if (!ids.includes(item.id)) byName.set(key, [...ids, item.id]);
  }

  const plan: TrackerPlan = { sheet, columns, details: [], matched: [], unmatched: [], warnings: [] };
  const taken = new Map<string, number>();
  for (let index = found.row + 1; index < table.length; index++) {
    const row = table[index] ?? [];
    const rowNumber = index + 1;
    const name = cell(row, 'name');
    const askedId = cell(row, 'solutionId');
    if (!name && !askedId) continue;
    /* the marker is the id, never the wording: a real feature may be called "Example ..." */
    if (EXAMPLE_ID.test(askedId)) continue;

    let solutionId = '';
    if (askedId) {
      const item = byId.get(askedId.toUpperCase());
      if (!item) {
        plan.unmatched.push({ row: rowNumber, name: name || askedId, why: `The catalog has no solution ${askedId}.` });
        continue;
      }
      solutionId = item.id;
    } else {
      const ids = byName.get(normalise(name)) ?? [];
      if (ids.length === 0) {
        plan.unmatched.push({ row: rowNumber, name, why: 'No catalog solution has this name. Add a Solution ID column to match it by id.' });
        continue;
      }
      if (ids.length > 1) {
        plan.unmatched.push({ row: rowNumber, name, why: `More than one catalog solution has this name (${ids.join(', ')}). Add a Solution ID column to say which.` });
        continue;
      }
      solutionId = ids[0]!;
    }

    const earlier = taken.get(solutionId);
    if (earlier !== undefined) {
      plan.unmatched.push({ row: rowNumber, name, why: `Row ${earlier} already describes ${solutionId}; the first one is kept.` });
      continue;
    }
    taken.set(solutionId, rowNumber);

    const detail: Partial<CatalogDetail> = { plat, solutionId, name: name || solutionId, importedFrom: file, up: stamp };
    if (columns.includes('builtFor')) detail.builtFor = cell(row, 'builtFor');
    if (columns.includes('contact')) detail.contact = cell(row, 'contact');
    if (columns.includes('team')) detail.team = cell(row, 'team');
    if (columns.includes('source')) detail.source = cell(row, 'source');
    if (columns.includes('plugin')) detail.plugin = readYesNo(cell(row, 'plugin'));
    if (columns.includes('mixed')) detail.mixed = readYesNo(cell(row, 'mixed'));
    if (columns.includes('reuseCount')) {
      const count = number(row, 'reuseCount');
      detail.reuseCount = count === null ? null : Math.max(0, Math.round(count));
    }
    if (columns.includes('dependencies')) detail.dependencies = cell(row, 'dependencies');
    if (columns.includes('implementation')) detail.implementation = cell(row, 'implementation');
    if (columns.includes('keywords')) detail.keywords = cell(row, 'keywords');
    plan.details.push(detail);
    plan.matched.push({ row: rowNumber, name: name || solutionId, solutionId });

    /* the tracker's own sums, checked: the catalog's first-delivery hours were copied from them */
    const convert = number(row, 'convert');
    const config = number(row, 'config');
    const firstReuse = number(row, 'firstReuse');
    if (convert !== null && config !== null && firstReuse !== null && !close(firstReuse, convert + config)) {
      const priced = byId.get(solutionId.toUpperCase())?.first;
      plan.warnings.push(
        `${name} (${solutionId}, row ${rowNumber}): first reuse is ${hours(firstReuse)} h, but conversion ${hours(convert)} h plus configuration ${hours(config)} h is ${hours(convert + config)} h.` +
          (priced !== null && priced !== undefined ? ` The catalog prices it at ${hours(priced)} h.` : '')
      );
    }
  }
  if (plan.matched.length === 0 && plan.unmatched.length === 0) return { error: `The ${sheet} sheet has a header row but no features under it.` };
  return plan;
}
