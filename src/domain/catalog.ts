import type { AddedBundle, AddedSolution, Bundle, Catalog, CatalogTotals, Solution } from '@/types';

/**
 * Catalog composition.
 *
 * The catalog a platform shows is its base (the master sheet for Open edX, a benchmark set
 * otherwise) plus anything the estimation desk added for that platform. Desk additions are
 * tagged `Estimation`: scoped and priced, not yet engineered, so nobody sells them as shipped.
 */

/** Where an estimate goes when nobody has said which bundle it belongs to. The desk files it. */
export const CX_BUNDLE_ID = 'CX';
export const UNASSIGNED_NAME = 'Unassigned estimates';

/* ------------------------------------------------------ the two kinds */

/**
 * The two kinds of thing a catalog holds, which sales must never confuse.
 *
 * Bundles are features Edly built for a client before and can deliver again for less, plus the
 * few still in development: their hours are a record. Estimates were priced by the estimation
 * desk, or in a workbook for an earlier client, and have never been built: their hours are a
 * forecast. Benchmark rows on the sample platforms count as bundles, since they stand in for one.
 */
export type CatalogKind = 'bundles' | 'estimates';

export const CATALOG_KINDS: readonly CatalogKind[] = ['bundles', 'estimates'];

export const isCatalogKind = (value: unknown): value is CatalogKind => CATALOG_KINDS.includes(value as CatalogKind);

export const solutionKind = (item: Solution): CatalogKind => (item.status === 'Estimation' ? 'estimates' : 'bundles');

export function kindCounts(catalog: Catalog): Record<'all' | CatalogKind, number> {
  const counts = { all: 0, bundles: 0, estimates: 0 };
  for (const item of allSolutions(catalog)) {
    counts.all += 1;
    counts[solutionKind(item)] += 1;
  }
  return counts;
}

/**
 * The bundles holding one kind, each with only those items, and the ones left empty dropped.
 * `null` keeps everything. A bundle's own totals are left as they were: this is for listing, not
 * for pricing, which always reads the whole catalog.
 */
export function bundlesOfKind(bundles: readonly Bundle[], kind: CatalogKind | null): Bundle[] {
  if (!kind) return [...bundles];
  return bundles
    .map((bundle) => ({ ...bundle, items: bundle.items.filter((item) => solutionKind(item) === kind) }))
    .filter((bundle) => bundle.items.length > 0);
}

/** Where an imported estimate came from, for the catalog row's Reference. Internal: presenting hides it. */
function importedRef(added: AddedSolution): string {
  return (
    `Imported from ${added.imported}` +
    (added.sourceId ? ` (${added.sourceId})` : '') +
    (added.client ? `, estimated for ${added.client}` : '') +
    (added.estAt ? ` on ${added.estAt}` : '') +
    (added.estBy ? ` by ${added.estBy}` : '')
  );
}

/** A desk-added solution as a catalog row. */
export function toSolution(added: AddedSolution): Solution {
  const notes = (added.notes ?? '').trim();
  return {
    id: added.id,
    name: added.name,
    desc: added.desc ?? '',
    form: added.form || 'Custom development',
    status: 'Estimation',
    deploy: added.deploy || null,
    first: added.first,
    repeat: added.repeat ?? added.first,
    build: null,
    saving: null,
    account: added.account || null,
    integrations: added.integrations || null,
    notes: notes || null,
    ref: added.from
      ? `Estimated at the desk — request ${added.from}` +
        (added.estName ? ` (${added.estName})` : '') +
        (added.estAt ? `, ${added.estAt}` : '')
      : added.imported
        ? importedRef(added)
        : null,
    category: added.category || 'Custom',
    subCategory: added.subCategory || null
  };
}

const emptyBundle = (own: AddedBundle): Bundle => ({
  id: own.id,
  name: own.name,
  pitch: own.pitch ?? '',
  offerWhen: own.offerWhen ?? '',
  featureCount: 0,
  buildHrs: null,
  firstHrs: 0,
  repeatHrs: 0,
  saved: null,
  noEstimate: 0,
  inDev: 0,
  accounts: null,
  pairsWith: own.pairsWith ?? null,
  items: [],
  own: true
});

const sum = (items: readonly Solution[], key: 'first' | 'repeat'): number =>
  items.reduce((total, item) => total + (item[key] ?? 0), 0);

export interface ComposeInput {
  base: Catalog;
  platform: string;
  added: readonly AddedSolution[];
  ownBundles: readonly AddedBundle[];
}

/** Base catalog + this platform's desk additions and custom bundle categories. */
export function composeCatalog({ base, platform, added, ownBundles }: ComposeInput): Catalog {
  const mine = added.filter((a) => (a.plat || 'openedx') === platform);
  const myBundles = ownBundles.filter((b) => (b.plat || 'openedx') === platform);
  if (mine.length === 0 && myBundles.length === 0) return base;

  const shell: Bundle[] = [...base.bundles, ...myBundles.map(emptyBundle)];

  const bundles: Bundle[] = shell.map((bundle) => {
    const extra = mine.filter((a) => a.bundleId === bundle.id).map(toSolution);
    if (extra.length === 0) return bundle;
    const items = [...bundle.items, ...extra];
    return {
      ...bundle,
      items,
      featureCount: items.length,
      firstHrs: (bundle.own ? 0 : bundle.firstHrs ?? 0) + sum(extra, 'first'),
      repeatHrs: (bundle.own ? 0 : bundle.repeatHrs ?? 0) + sum(extra, 'repeat')
    };
  });

  /* additions whose bundle no longer exists are grouped rather than dropped */
  const orphans = mine.filter((a) => !shell.some((b) => b.id === a.bundleId)).map(toSolution);
  if (orphans.length > 0) {
    bundles.push({
      id: CX_BUNDLE_ID,
      name: UNASSIGNED_NAME,
      pitch:
        'Priced by the estimation desk but not built yet, and not filed under a bundle. The desk files each one where it belongs. Sell them with a build-time caveat, not as shipped features.',
      offerWhen: 'Bespoke scope',
      featureCount: orphans.length,
      buildHrs: null,
      firstHrs: sum(orphans, 'first'),
      repeatHrs: sum(orphans, 'repeat'),
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items: orphans
    });
  }

  return { meta: base.meta, bundles };
}

/** Every solution in a catalog, flattened. */
export function allSolutions(catalog: Catalog): Solution[] {
  return catalog.bundles.flatMap((b) => b.items);
}

/** Distinct category values already in use — the autocomplete source at the desk. */
export function categories(catalog: Catalog): string[] {
  const seen = new Set<string>();
  for (const item of allSolutions(catalog)) if (item.category) seen.add(item.category);
  const out = [...seen].sort();
  if (!seen.has('Custom')) out.push('Custom');
  return out;
}

export function subCategories(catalog: Catalog): string[] {
  const seen = new Set<string>();
  for (const item of allSolutions(catalog)) if (item.subCategory) seen.add(item.subCategory);
  return [...seen].sort();
}

/**
 * Where a newly estimated item belongs. Matched on the category sales tagged, so an
 * assessment item lands in the assessment bundle instead of a generic bucket.
 */
export function guessBundle(catalog: Catalog, hint: string | undefined | null): string {
  const want = String(hint ?? '').toLowerCase().trim();
  if (!want) return CX_BUNDLE_ID;
  let best: string | null = null;
  let bestScore = 0;
  for (const bundle of catalog.bundles) {
    if (bundle.id === CX_BUNDLE_ID) continue;
    let score = 0;
    for (const item of bundle.items) {
      const haystack = `${item.category ?? ''} ${item.subCategory ?? ''} ${item.form ?? ''}`.toLowerCase();
      if (haystack.includes(want)) score += 1;
    }
    if (bundle.name.toLowerCase().includes(want)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = bundle.id;
    }
  }
  return best ?? CX_BUNDLE_ID;
}

export interface CatalogDiffEntry {
  id: string;
  name: string;
  bundle: string;
}

export interface CatalogChange extends CatalogDiffEntry {
  fields: string[];
  from: Solution;
  to: Solution;
}

export interface CatalogDiff {
  added: CatalogDiffEntry[];
  removed: CatalogDiffEntry[];
  changed: CatalogChange[];
  bundlesAdded: string[];
}

const DIFF_FIELDS: (keyof Solution)[] = ['first', 'repeat', 'build', 'status', 'name', 'deploy'];

/** What changed between two catalogs — shown after a sheet import. */
export function diffCatalogs(before: Catalog | null, after: Catalog): CatalogDiff {
  const index = (catalog: Catalog | null): Map<string, { item: Solution; bundle: string }> => {
    const map = new Map<string, { item: Solution; bundle: string }>();
    for (const bundle of catalog?.bundles ?? []) {
      for (const item of bundle.items) map.set(item.id, { item, bundle: bundle.id });
    }
    return map;
  };
  const a = index(before);
  const b = index(after);

  const added: CatalogDiffEntry[] = [];
  const removed: CatalogDiffEntry[] = [];
  const changed: CatalogChange[] = [];

  for (const [id, entry] of b) {
    const prev = a.get(id);
    if (!prev) {
      added.push({ id, name: entry.item.name, bundle: entry.bundle });
      continue;
    }
    const fields: string[] = DIFF_FIELDS.filter((f) => String(prev.item[f] ?? '') !== String(entry.item[f] ?? ''));
    if (prev.bundle !== entry.bundle) fields.push('bundle');
    if (fields.length > 0) {
      changed.push({ id, name: entry.item.name, bundle: entry.bundle, fields: fields.map(String), from: prev.item, to: entry.item });
    }
  }
  for (const [id, entry] of a) {
    if (!b.has(id)) removed.push({ id, name: entry.item.name, bundle: entry.bundle });
  }

  const knownBundles = new Set((before?.bundles ?? []).map((bundle) => bundle.id));
  const bundlesAdded = after.bundles.filter((bundle) => !knownBundles.has(bundle.id)).map((bundle) => `${bundle.id} · ${bundle.name}`);

  return { added, removed, changed, bundlesAdded };
}

/* ---------------------------------------- adding a workbook to a catalog */

/* "Commerce & Monetization" and "commerce and monetization" are one bundle typed twice */
export const nameKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

/** A bundle's figures worked out from its rows, the way the sheet parser does when a summary row is stale. */
export function withItemTotals(bundle: Bundle, items: Solution[]): Bundle {
  const recorded = items.filter((it) => it.first !== null && it.build !== null);
  const sumFirst = recorded.reduce((total, it) => total + (it.first ?? 0), 0);
  const sumBuild = recorded.reduce((total, it) => total + (it.build ?? 0), 0);
  return {
    ...bundle,
    items,
    featureCount: items.length,
    buildHrs: items.some((it) => it.build !== null) ? items.reduce((total, it) => total + (it.build ?? 0), 0) : null,
    firstHrs: items.reduce((total, it) => total + (it.first ?? 0), 0),
    repeatHrs: items.reduce((total, it) => total + (it.repeat ?? 0), 0),
    saved: sumBuild > 0 ? 1 - sumFirst / sumBuild : null,
    noEstimate: items.filter((it) => it.first === null).length,
    inDev: items.filter((it) => it.status === 'In Development').length
  };
}

export function catalogTotals(bundles: readonly Bundle[]): CatalogTotals {
  const every = bundles.flatMap((bundle) => bundle.items);
  const recorded = every.filter((it) => it.first !== null && it.build !== null);
  const sumFirst = recorded.reduce((total, it) => total + (it.first ?? 0), 0);
  const sumBuild = recorded.reduce((total, it) => total + (it.build ?? 0), 0);
  return {
    features: every.length,
    buildHrs: every.reduce((total, it) => total + (it.build ?? 0), 0),
    firstHrs: every.reduce((total, it) => total + (it.first ?? 0), 0),
    repeatHrs: every.reduce((total, it) => total + (it.repeat ?? 0), 0),
    saved: sumBuild > 0 ? 1 - sumFirst / sumBuild : null,
    noEstimate: every.filter((it) => it.first === null).length,
    inDev: every.filter((it) => it.status === 'In Development').length
  };
}

export interface CatalogMerge {
  catalog: Catalog;
  /** Solutions the catalog did not have. */
  added: string[];
  /** Solutions it had, now as the workbook describes them. */
  updated: string[];
  /** Solutions the workbook does not mention, left exactly as they were. */
  kept: number;
  /** "B16 · Mobile Apps", for bundles the catalog did not have. */
  bundlesAdded: string[];
  /** Why the workbook cannot be added. Empty when it can. */
  conflicts: string[];
}

/**
 * A bundles workbook added to the catalog in play, rather than replacing it.
 *
 * A solution id the catalog already has is updated, and moves to the bundle the workbook puts it
 * in. A bundle id already in use by a bundle of another name is refused: the two workbooks
 * numbered their bundles independently, and merging "B03 AI" into "B03 Mobile" would put a
 * client's features under the wrong pitch. Renumbering in the workbook, or replacing the catalog,
 * are the ways out, and the conflict says so.
 */
export function mergeCatalogs(current: Catalog, incoming: Catalog): CatalogMerge {
  const conflicts: string[] = [];
  const currentBundles = new Map(current.bundles.map((bundle) => [bundle.id.toUpperCase(), bundle]));
  const used = new Set(current.bundles.map((bundle) => bundle.id.toUpperCase()));
  const freeId = (): string => {
    for (let n = 1; n < 1000; n++) {
      const id = `B${String(n).padStart(2, '0')}`;
      if (!used.has(id)) return id;
    }
    return 'B999';
  };
  for (const bundle of incoming.bundles) {
    const clash = currentBundles.get(bundle.id.toUpperCase());
    if (clash && !sameName(clash.name, bundle.name)) {
      const suggestion = freeId();
      used.add(suggestion);
      conflicts.push(
        `${bundle.id} is "${clash.name}" in the catalog but "${bundle.name}" in this workbook. Renumber it in the workbook (${suggestion} is free), or replace the catalog instead.`
      );
    }
  }

  const before = new Set(current.bundles.flatMap((bundle) => bundle.items.map((item) => item.id)));
  const incomingIds = new Set(incoming.bundles.flatMap((bundle) => bundle.items.map((item) => item.id)));
  const added = [...incomingIds].filter((id) => !before.has(id));
  const updated = [...incomingIds].filter((id) => before.has(id));
  const kept = before.size - updated.length;
  const bundlesAdded = incoming.bundles
    .filter((bundle) => !currentBundles.has(bundle.id.toUpperCase()))
    .map((bundle) => `${bundle.id} · ${bundle.name}`);

  if (conflicts.length > 0) return { catalog: current, added, updated, kept, bundlesAdded, conflicts };

  const incomingById = new Map(incoming.bundles.map((bundle) => [bundle.id.toUpperCase(), bundle]));
  const merged: Bundle[] = [];
  for (const bundle of current.bundles) {
    const remaining = bundle.items.filter((item) => !incomingIds.has(item.id));
    const update = incomingById.get(bundle.id.toUpperCase());
    if (!update) {
      /* untouched bundles keep their own figures, which may come from a trusted summary row */
      if (remaining.length === bundle.items.length) merged.push(bundle);
      else if (remaining.length > 0) merged.push(withItemTotals(bundle, remaining));
      continue;
    }
    const prose: Bundle = {
      ...bundle,
      pitch: update.pitch || bundle.pitch,
      offerWhen: update.offerWhen || bundle.offerWhen,
      pairsWith: update.pairsWith ?? bundle.pairsWith,
      accounts: update.accounts ?? bundle.accounts,
      price: update.price ?? bundle.price
    };
    merged.push(withItemTotals(prose, [...remaining, ...update.items]));
  }
  for (const bundle of incoming.bundles) {
    if (!currentBundles.has(bundle.id.toUpperCase())) merged.push(bundle);
  }

  const totals = catalogTotals(merged);
  const base = current.bundles.length > 0 ? current.meta : incoming.meta;
  return {
    catalog: {
      meta: { ...base, subtitle: `${totals.features} solutions across ${merged.length} bundles.`, totals },
      bundles: merged
    },
    added,
    updated,
    kept,
    bundlesAdded,
    conflicts
  };
}
