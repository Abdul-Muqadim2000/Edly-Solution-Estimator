import type { AddedBundle, AddedSolution, Bundle, Catalog, Solution } from '@/types';

/**
 * Catalog composition.
 *
 * The catalog a platform shows is its base (the master sheet for Open edX, a benchmark set
 * otherwise) plus anything the estimation desk added for that platform. Desk additions are
 * tagged `Estimation`: scoped and priced, not yet engineered — so nobody sells them as shipped.
 */

export const CX_BUNDLE_ID = 'CX';

/** A desk-added solution as a catalog row. */
export function toSolution(added: AddedSolution): Solution {
  const notes = [added.limits, added.note ? `Estimator note: ${added.note}` : null].filter(Boolean).join(' · ');
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
      name: 'Estimated solutions',
      pitch:
        'Scoped and priced at the estimation desk but not yet engineered. Reusable for the next client at the same estimate — sell them with a build-time caveat, not as shipped features.',
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
