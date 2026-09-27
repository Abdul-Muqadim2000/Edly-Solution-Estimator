import type { AddedBundle, AddedSolution } from '@/types';
import { CX_BUNDLE_ID, nameKey, UNASSIGNED_NAME } from '@/domain/catalog';
import { nextId } from '@/lib/format';

/**
 * What importing an estimates workbook would do, and then does.
 *
 * The preview and the import run this same function, so what a person approves is exactly what
 * lands. It is pure: the workbook has already been read and checked (`src/lib/catalogImport.ts`),
 * and the rows arrive here as plain objects.
 *
 * Three rules shape it:
 *   - An estimate imported before is updated, never duplicated. It is recognised by its Estimate
 *     ID, or, when the sheet has none, by its Feature and Estimated for together. Only imported
 *     estimates are matched: one the desk priced from a request belongs to that request.
 *   - A row is filed under the bundle its Bundle ID names, else the bundle its Area names, else a
 *     new bundle named after its Area. With neither, it goes to Unassigned for the desk to file.
 *   - Re-importing a row that names no bundle keeps the bundle it already has, so the desk's
 *     filing is not undone by the next import.
 */

/** One row of an estimates workbook, read and checked. */
export interface EstimateRow {
  /** Row number in the sheet, from 1, so a message can point at it. */
  row: number;
  sourceId: string;
  name: string;
  desc: string;
  first: number;
  /** Blank in the sheet means the same as the first delivery. */
  repeat: number | null;
  client: string;
  bundleId: string;
  area: string;
  category: string;
  subCategory: string;
  form: string;
  deploy: string;
  integrations: string;
  account: string;
  limits: string;
  note: string;
  estBy: string;
  /** ISO date, blank when the sheet gives none. */
  estAt: string;
}

export interface EstimateImportInput {
  rows: readonly EstimateRow[];
  /** The workbook's file name. It labels the estimates, and removing the import removes by it. */
  file: string;
  platform: string;
  /** The bundles in the catalog in play, which rows are filed under by id or by name. */
  catalogBundles: readonly { id: string; name: string }[];
  solutions: readonly AddedSolution[];
  bundles: readonly AddedBundle[];
  today: string;
}

export interface EstimateImportPlan {
  /** Every added solution after the import, all platforms. */
  solutions: AddedSolution[];
  /** Every custom bundle after the import, all platforms. */
  bundles: AddedBundle[];
  added: AddedSolution[];
  updated: AddedSolution[];
  newBundles: { id: string; name: string; count: number }[];
  /** Estimates left in Unassigned for the desk to file. */
  unassigned: number;
  warnings: string[];
}

const key = nameKey;

/** An estimate's identity across imports. */
export const estimateKey = (sourceId: string, name: string, client: string): string =>
  sourceId.trim() ? `id:${key(sourceId)}` : `name:${key(name)}|${key(client)}`;

const UNASSIGNED_WORDS = new Set([key('Unassigned'), key(UNASSIGNED_NAME)]);

export function planEstimateImport(input: EstimateImportInput): EstimateImportPlan {
  const { platform, file } = input;
  const warnings: string[] = [];
  const onPlatform = (plat: string | undefined): boolean => (plat || 'openedx') === platform;

  const imported = input.solutions.filter((one) => onPlatform(one.plat) && one.imported);
  const byId = new Map<string, AddedSolution>();
  const byName = new Map<string, AddedSolution>();
  for (const one of imported) {
    if (one.sourceId) byId.set(key(one.sourceId), one);
    byName.set(estimateKey('', one.name, one.client ?? ''), one);
  }

  const bundleById = new Map(input.catalogBundles.map((bundle) => [key(bundle.id), bundle.id]));
  const bundleByName = new Map(input.catalogBundles.map((bundle) => [key(bundle.name), bundle.id]));
  const createdBundles: AddedBundle[] = [];
  const createdCount = new Map<string, number>();

  const fileUnder = (row: EstimateRow): string | null => {
    if (row.bundleId) {
      const found = bundleById.get(key(row.bundleId));
      if (found) return found;
      warnings.push(
        `Row ${row.row} (${row.name}): bundle ${row.bundleId} is not in this catalog, so it is filed ${row.area ? `by its area, ${row.area}` : 'under Unassigned'}.`
      );
    }
    if (row.area) {
      if (UNASSIGNED_WORDS.has(key(row.area))) return CX_BUNDLE_ID;
      const found = bundleByName.get(key(row.area));
      if (found) return found;
      const bundle: AddedBundle = {
        id: nextId('CB', [...input.bundles, ...createdBundles], 'id'),
        plat: platform,
        name: row.area.trim(),
        pitch: 'Priced by the estimation desk, not built yet.',
        offerWhen: '',
        pairsWith: null,
        at: input.today,
        imported: file
      };
      createdBundles.push(bundle);
      bundleByName.set(key(row.area), bundle.id);
      return bundle.id;
    }
    return row.bundleId ? CX_BUNDLE_ID : null;
  };

  const added: AddedSolution[] = [];
  const updated: AddedSolution[] = [];
  const replaced = new Map<string, AddedSolution>();

  for (const row of input.rows) {
    const match = (row.sourceId ? byId.get(key(row.sourceId)) : undefined) ?? (row.sourceId ? undefined : byName.get(estimateKey('', row.name, row.client)));
    const target = fileUnder(row);
    const record: AddedSolution = {
      id: match?.id ?? nextId('CS', [...input.solutions, ...added], 'id'),
      plat: platform,
      bundleId: target ?? match?.bundleId ?? CX_BUNDLE_ID,
      name: row.name,
      desc: row.desc,
      first: row.first,
      repeat: row.repeat ?? row.first,
      form: row.form,
      deploy: row.deploy,
      integrations: row.integrations,
      category: row.category,
      subCategory: row.subCategory,
      account: row.account,
      limits: row.limits,
      note: row.note,
      from: '',
      estAt: row.estAt || match?.estAt || input.today,
      direct: false,
      imported: file
    };
    /* set only when present, so a record reads back from the sheet exactly as it was made */
    if (row.sourceId) record.sourceId = row.sourceId;
    if (row.client) record.client = row.client;
    if (row.estBy) record.estBy = row.estBy;

    if (match) {
      replaced.set(match.id, record);
      updated.push(record);
    } else {
      added.push(record);
    }
    if (record.bundleId !== CX_BUNDLE_ID) createdCount.set(record.bundleId, (createdCount.get(record.bundleId) ?? 0) + 1);
  }

  /* a bundle this import would create but no row ends up in is not created */
  const bundlesMade = createdBundles.filter((bundle) => (createdCount.get(bundle.id) ?? 0) > 0);

  return {
    solutions: [...input.solutions.map((one) => replaced.get(one.id) ?? one), ...added],
    bundles: [...input.bundles, ...bundlesMade],
    added,
    updated,
    newBundles: bundlesMade.map((bundle) => ({ id: bundle.id, name: bundle.name, count: createdCount.get(bundle.id) ?? 0 })),
    unassigned: [...added, ...updated].filter((one) => one.bundleId === CX_BUNDLE_ID).length,
    warnings
  };
}

export interface ImportedFile {
  file: string;
  estimates: number;
  /** Bundles this workbook's Area column created. */
  bundles: number;
  /** The latest estimate date among them. */
  at: string;
}

/** The estimates workbooks imported on a platform, so the desk can see them and undo one. */
export function importedFiles(solutions: readonly AddedSolution[], bundles: readonly AddedBundle[], platform: string): ImportedFile[] {
  const files = new Map<string, ImportedFile>();
  for (const one of solutions) {
    if (!one.imported || (one.plat || 'openedx') !== platform) continue;
    const entry = files.get(one.imported) ?? { file: one.imported, estimates: 0, bundles: 0, at: '' };
    entry.estimates += 1;
    if (one.estAt > entry.at) entry.at = one.estAt;
    files.set(one.imported, entry);
  }
  for (const bundle of bundles) {
    const entry = bundle.imported && (bundle.plat || 'openedx') === platform ? files.get(bundle.imported) : undefined;
    if (entry) entry.bundles += 1;
  }
  return [...files.values()].sort((a, b) => a.file.localeCompare(b.file));
}
