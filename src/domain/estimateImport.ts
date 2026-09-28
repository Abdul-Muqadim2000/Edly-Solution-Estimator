import type { AddedBundle, AddedSolution } from '@/types';
import { CX_BUNDLE_ID, nameKey, nextBundleId, UNASSIGNED_NAME } from '@/domain/catalog';
import {
  followGroups,
  LEFT_OUT,
  WAITING,
  type Destination,
  type GroupDecision,
  type GroupKind,
  type GroupStatus,
  type ImportReview,
  type ReviewGroup,
  type ReviewRow,
  type ReviewSummary
} from '@/domain/importReview';
import { hours, nextId } from '@/lib/format';

/**
 * What importing an estimates workbook would do, and then does.
 *
 * The preview, the review and the import run this same function, so what a person approves is
 * exactly what lands. It is pure: the workbook has already been read and checked
 * (`src/lib/catalogImport.ts`), and the rows arrive here as plain objects.
 *
 * The file proposes, a person decides:
 *   - The file puts a row under the bundle its Bundle ID names, else the bundle its Area names,
 *     else a new bundle named after its Area, else Unassigned. Re-importing a row that names no
 *     bundle keeps the bundle it already has, so the desk's filing is not undone.
 *   - Those proposals are the review's groups. Each is approved or left out, can be sent to
 *     another bundle, and a new one can be renamed; a single row can be moved or left out. Rows
 *     in a group still pending are not imported. Without a review, everything is approved as
 *     proposed, which is what the reducer tests and older callers rely on.
 *   - An estimate imported before is updated, never duplicated. It is recognised by its Estimate
 *     ID, or, when the sheet has none, by its Feature and Estimated for together. Only imported
 *     estimates are matched: one the desk priced from a request belongs to that request.
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
  /** Notes / Assumptions, one entry. Blank when the row has none. */
  notes: string;
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
  /** What a person decided. Absent means every group approved as the file proposes. */
  review?: ImportReview;
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
  review: ReviewSummary;
}

const key = nameKey;

/** An estimate's identity across imports. */
export const estimateKey = (sourceId: string, name: string, client: string): string =>
  sourceId.trim() ? `id:${key(sourceId)}` : `name:${key(name)}|${key(client)}`;

const UNASSIGNED_WORDS = new Set([key('Unassigned'), key(UNASSIGNED_NAME)]);

/** Destination keys: a bundle the catalog has, a bundle this file makes, or Unassigned. */
export const toBundle = (id: string): string => `bundle:${id}`;
export const toNew = (area: string): string => `new:${key(area)}`;
export const TO_UNASSIGNED = 'cx';

/** Where a destination key finally puts a row. */
type Landing = { kind: 'bundle'; id: string } | { kind: 'create'; group: string } | { kind: 'cx' };

export function planEstimateImport(input: EstimateImportInput): EstimateImportPlan {
  const { platform, file, review } = input;
  const warnings: string[] = [];
  const onPlatform = (plat: string | undefined): boolean => (plat || 'openedx') === platform;

  const imported = input.solutions.filter((one) => onPlatform(one.plat) && one.imported);
  const byId = new Map<string, AddedSolution>();
  const byName = new Map<string, AddedSolution>();
  for (const one of imported) {
    if (one.sourceId) byId.set(key(one.sourceId), one);
    byName.set(estimateKey('', one.name, one.client ?? ''), one);
  }
  const matchOf = (row: EstimateRow): AddedSolution | undefined =>
    row.sourceId ? byId.get(key(row.sourceId)) : byName.get(estimateKey('', row.name, row.client));

  const catalogIds = new Map(input.catalogBundles.map((bundle) => [key(bundle.id), bundle]));
  const catalogNames = new Map(input.catalogBundles.map((bundle) => [key(bundle.name), bundle]));
  const bundleLabel = (id: string): string => {
    const found = catalogIds.get(key(id));
    return found ? `${found.id} · ${found.name}` : id;
  };

  /* ---- what the file proposes: one group per place it sends rows ---- */
  interface Proposal {
    key: string;
    kind: GroupKind;
    label: string;
    rows: EstimateRow[];
  }
  const proposals = new Map<string, Proposal>();
  const proposalOf = new Map<number, string>();
  const propose = (row: EstimateRow, groupKey: string, kind: GroupKind, label: string): void => {
    const existing = proposals.get(groupKey) ?? { key: groupKey, kind, label, rows: [] };
    existing.rows.push(row);
    proposals.set(groupKey, existing);
    proposalOf.set(row.row, groupKey);
  };

  for (const row of input.rows) {
    if (row.bundleId) {
      const found = catalogIds.get(key(row.bundleId));
      if (found) {
        propose(row, toBundle(found.id), 'existing', bundleLabel(found.id));
        continue;
      }
      warnings.push(
        `Row ${row.row} (${row.name}): bundle ${row.bundleId} is not in this catalog, so it is filed ${row.area ? `by its area, ${row.area}` : 'under Unassigned'}.`
      );
    }
    if (row.area && !UNASSIGNED_WORDS.has(key(row.area))) {
      const found = catalogNames.get(key(row.area));
      if (found) propose(row, toBundle(found.id), 'existing', bundleLabel(found.id));
      else propose(row, toNew(row.area), 'new', row.area.trim());
      continue;
    }
    const kept = !row.bundleId && !row.area ? matchOf(row)?.bundleId : undefined;
    if (kept && kept !== CX_BUNDLE_ID && catalogIds.has(key(kept))) propose(row, toBundle(kept), 'existing', bundleLabel(kept));
    else propose(row, TO_UNASSIGNED, 'unassigned', 'Unassigned');
  }

  /* ---- decisions, with the file's proposal where there is none ---- */
  const decided = (groupKey: string): Required<GroupDecision> => {
    const proposal = proposals.get(groupKey);
    const decision = review?.groups[groupKey] ?? {};
    return {
      status: decision.status ?? (review ? 'pending' : 'approved'),
      to: decision.to ?? groupKey,
      name: (decision.name ?? proposal?.label ?? '').trim()
    };
  };

  /* a new group's own bundle, resolved to an existing one when it is named like one */
  const land = (destination: string): Landing => {
    const final = followGroups(destination, (at) => {
      if (!at.startsWith('new:') || !proposals.has(at)) return null;
      const group = decided(at);
      return group.status === 'skipped' ? TO_UNASSIGNED : group.to;
    });
    if (final === TO_UNASSIGNED) return { kind: 'cx' };
    if (final.startsWith('bundle:')) {
      const found = catalogIds.get(key(final.slice(7)));
      return found ? { kind: 'bundle', id: found.id } : { kind: 'cx' };
    }
    if (proposals.has(final)) {
      const named = catalogNames.get(key(decided(final).name));
      return named ? { kind: 'bundle', id: named.id } : { kind: 'create', group: final };
    }
    return { kind: 'cx' };
  };

  /* one bundle per distinct name, however many groups were given it */
  const createdByName = new Map<string, AddedBundle>();
  const createdBundles: AddedBundle[] = [];
  const bundleFor = (groupKey: string): AddedBundle => {
    const name = decided(groupKey).name || proposals.get(groupKey)?.label || 'Imported estimates';
    const found = createdByName.get(key(name));
    if (found) return found;
    const bundle: AddedBundle = {
      id: nextBundleId([...input.catalogBundles, ...input.bundles, ...createdBundles].map((one) => one.id)),
      plat: platform,
      name,
      pitch: 'Priced by the estimation desk, not built yet.',
      offerWhen: '',
      pairsWith: null,
      at: input.today,
      imported: file
    };
    createdByName.set(key(name), bundle);
    createdBundles.push(bundle);
    return bundle;
  };
  const landsLabel = (landing: Landing): string => {
    if (landing.kind === 'cx') return 'Unassigned, for the desk to file';
    if (landing.kind === 'bundle') return bundleLabel(landing.id);
    return `New bundle "${decided(landing.group).name || proposals.get(landing.group)?.label}"`;
  };

  /* ---- the rows that go in, and where ---- */
  const added: AddedSolution[] = [];
  const updated: AddedSolution[] = [];
  const replaced = new Map<string, AddedSolution>();
  const createdCount = new Map<string, number>();
  const reviewRows = new Map<string, ReviewRow[]>();
  let included = 0;
  let leftOut = 0;

  for (const row of input.rows) {
    const groupKey = proposalOf.get(row.row) ?? TO_UNASSIGNED;
    const group = decided(groupKey);
    const rowDecision = review?.rows[String(row.row)] ?? {};
    const match = matchOf(row);
    const landing = land(rowDecision.to ?? group.to);
    const status: GroupStatus = group.status;
    const out = status === 'skipped' || rowDecision.skip === true;
    const detail = `Row ${row.row}${row.client ? ` · ${row.client}` : ''} · ${hours(row.first)} h${match ? ` · updates ${match.id}` : ''}`;
    /* a row moved out of a group still pending says where it is going, and what it waits for */
    const lands = out ? LEFT_OUT : status !== 'pending' ? landsLabel(landing) : rowDecision.to ? `${landsLabel(landing)}, once this group is approved` : WAITING;
    reviewRows.set(groupKey, [
      ...(reviewRows.get(groupKey) ?? []),
      {
        key: String(row.row),
        title: row.name,
        detail,
        /* what it will carry, which on a second import can be the note it already has */
        notes: row.notes || match?.notes || '',
        hours: row.first,
        to: rowDecision.to ?? null,
        skip: rowDecision.skip === true,
        lands
      }
    ]);
    if (out) {
      leftOut += 1;
      continue;
    }
    if (status !== 'approved') continue;
    included += 1;

    const bundleId = landing.kind === 'bundle' ? landing.id : landing.kind === 'create' ? bundleFor(landing.group).id : CX_BUNDLE_ID;
    const record: AddedSolution = {
      id: match?.id ?? nextId('CS', [...input.solutions, ...added], 'id'),
      plat: platform,
      bundleId,
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
      /* The file wins for every field but this one. The desk can reword a note in the app, and a
         file without notes, like the sheets estimates first came from, must not wipe that on a
         second import; so a blank note keeps the one already there. Clearing one is done in the app. */
      notes: row.notes || match?.notes || '',
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
    if (landing.kind === 'create') createdCount.set(bundleId, (createdCount.get(bundleId) ?? 0) + 1);
  }

  /* ---- the review, as the screen shows it ---- */
  const destinations: Destination[] = [
    ...input.catalogBundles.filter((bundle) => bundle.id !== CX_BUNDLE_ID).map((bundle) => ({ key: toBundle(bundle.id), label: `${bundle.id} · ${bundle.name}` })),
    ...[...proposals.values()]
      .filter((proposal) => proposal.kind === 'new' && decided(proposal.key).status !== 'skipped' && decided(proposal.key).to === proposal.key)
      .map((proposal) => ({ key: proposal.key, label: `New: ${decided(proposal.key).name || proposal.label}` })),
    { key: TO_UNASSIGNED, label: 'Unassigned, for the desk to file' }
  ];
  const ownNames = new Map<string, number>();
  for (const proposal of proposals.values()) {
    const group = decided(proposal.key);
    if (proposal.kind === 'new' && group.to === proposal.key && group.status !== 'skipped') ownNames.set(key(group.name), (ownNames.get(key(group.name)) ?? 0) + 1);
  }
  const groups: ReviewGroup[] = [...proposals.values()].map((proposal) => {
    const group = decided(proposal.key);
    const own = group.to === proposal.key;
    const renameable = proposal.kind === 'new' && own;
    const named = renameable ? catalogNames.get(key(group.name)) : undefined;
    const twin = renameable && !named && group.status !== 'skipped' && (ownNames.get(key(group.name)) ?? 0) > 1;
    const rows = reviewRows.get(proposal.key) ?? [];
    return {
      key: proposal.key,
      kind: proposal.kind,
      label: proposal.label,
      name: renameable ? group.name : proposal.label,
      renameable,
      status: group.status,
      to: group.to,
      lands: group.status === 'skipped' ? LEFT_OUT : landsLabel(land(group.to)),
      note: named
        ? `The catalog already has a bundle called that (${named.id}), so these go into it.`
        : twin
          ? 'Another new bundle in this file has the same name, so the two become one bundle.'
          : '',
      blocked: renameable && !group.name ? 'Give the new bundle a name first.' : '',
      rows,
      hours: rows.reduce((total, row) => total + (row.hours ?? 0), 0)
    };
  });

  return {
    solutions: [...input.solutions.map((one) => replaced.get(one.id) ?? one), ...added],
    bundles: [...input.bundles, ...createdBundles],
    added,
    updated,
    newBundles: createdBundles.map((bundle) => ({ id: bundle.id, name: bundle.name, count: createdCount.get(bundle.id) ?? 0 })),
    unassigned: [...added, ...updated].filter((one) => one.bundleId === CX_BUNDLE_ID).length,
    warnings,
    review: {
      groups,
      destinations,
      pending: groups.filter((group) => group.status === 'pending').length,
      included,
      leftOut
    }
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
