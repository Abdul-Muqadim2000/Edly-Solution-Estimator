import type { Bundle, Catalog, Solution } from '@/types';
import { catalogTotals, diffCatalogs, mergeCatalogs, nameKey, withItemTotals, type CatalogDiff, type CatalogMerge } from '@/domain/catalog';
import {
  followGroups,
  LEFT_OUT,
  WAITING,
  type Destination,
  type GroupDecision,
  type GroupKind,
  type ImportReview,
  type ReviewGroup,
  type ReviewRow,
  type ReviewSummary
} from '@/domain/importReview';
import { hours } from '@/lib/format';

/**
 * What a bundles workbook would do to the catalog in play, once a person has reviewed it.
 *
 * Each bundle in the workbook is a group. One the catalog already has, under the same ID and
 * name, updates it. One it does not have is new, and can be renamed or sent into an existing
 * bundle. One whose ID the catalog uses for a different bundle is a clash: the two workbooks
 * numbered their bundles independently, so it goes in as a new bundle under a free ID, or into the
 * bundle of that ID, or is left out, as a person decides. Single solutions can be moved to another
 * bundle or left out.
 *
 * The result is the workbook as reviewed, a catalog of its own. Adding merges it into the catalog
 * in play; replacing makes it the catalog. Both previews are worked out here from the same
 * decisions, so the numbers a person reads are the numbers that land.
 */

export interface BundleImportInput {
  current: Catalog;
  incoming: Catalog;
  review: ImportReview;
}

export interface BundleImportPlan {
  /** The workbook after the review: renamed, renumbered, moved and trimmed. */
  reviewed: Catalog;
  merge: CatalogMerge;
  replace: CatalogDiff;
  review: ReviewSummary;
}

export const toCurrent = (id: string): string => `bundle:${id}`;
export const toIncoming = (id: string): string => `in:${id}`;

/** The first B-number neither catalog uses, handed out in order to the clashes that need one. */
function freeIds(taken: Iterable<string>, count: number): string[] {
  const used = new Set([...taken].map((id) => id.toUpperCase()));
  const out: string[] = [];
  for (let n = 1; n < 1000 && out.length < count; n++) {
    const id = `B${String(n).padStart(2, '0')}`;
    if (!used.has(id)) {
      used.add(id);
      out.push(id);
    }
  }
  return out;
}

export function planBundleImport(input: BundleImportInput): BundleImportPlan {
  const { current, incoming, review } = input;
  const currentById = new Map(current.bundles.map((bundle) => [bundle.id.toUpperCase(), bundle]));
  const currentByName = new Map(current.bundles.map((bundle) => [nameKey(bundle.name), bundle]));
  const incomingByKey = new Map(incoming.bundles.map((bundle) => [toIncoming(bundle.id), bundle]));

  const kindOf = (bundle: Bundle): GroupKind => {
    const same = currentById.get(bundle.id.toUpperCase());
    if (!same) return 'new';
    return nameKey(same.name) === nameKey(bundle.name) ? 'existing' : 'clash';
  };

  const decided = (bundle: Bundle): Required<GroupDecision> => {
    const groupKey = toIncoming(bundle.id);
    const decision = review.groups[groupKey] ?? {};
    const kind = kindOf(bundle);
    return {
      status: decision.status ?? 'pending',
      /* an existing bundle updates itself; a new one or a clash becomes a bundle of its own */
      to: decision.to ?? (kind === 'existing' ? toCurrent(currentById.get(bundle.id.toUpperCase())!.id) : groupKey),
      name: (decision.name ?? bundle.name).trim()
    };
  };

  /* clashes that keep a bundle of their own need an ID nobody uses, in the workbook's order */
  const needIds = incoming.bundles.filter((bundle) => kindOf(bundle) === 'clash' && decided(bundle).to === toIncoming(bundle.id));
  const others = incoming.bundles.filter((bundle) => kindOf(bundle) !== 'clash').map((bundle) => bundle.id);
  const handed = freeIds([...current.bundles.map((bundle) => bundle.id), ...others], needIds.length);
  const idOf = new Map<string, string>();
  for (const bundle of incoming.bundles) idOf.set(toIncoming(bundle.id), bundle.id);
  needIds.forEach((bundle, i) => idOf.set(toIncoming(bundle.id), handed[i] ?? bundle.id));

  /* where a destination finally puts a solution: a bundle of the catalog, one of the workbook's, or nowhere */
  type Landing = { kind: 'current'; id: string } | { kind: 'incoming'; key: string } | { kind: 'none' };
  const land = (destination: string): Landing => {
    const final = followGroups(destination, (at) => {
      const bundle = incomingByKey.get(at);
      if (!bundle) return null;
      const group = decided(bundle);
      return group.status === 'skipped' ? 'none' : group.to;
    });
    if (final === 'none') return { kind: 'none' };
    if (final.startsWith('bundle:')) {
      const found = currentById.get(final.slice(7).toUpperCase());
      return found ? { kind: 'current', id: found.id } : { kind: 'none' };
    }
    return incomingByKey.has(final) ? { kind: 'incoming', key: final } : { kind: 'none' };
  };
  const labelOf = (landing: Landing): string => {
    if (landing.kind === 'none') return LEFT_OUT;
    if (landing.kind === 'current') {
      const bundle = currentById.get(landing.id.toUpperCase());
      return `${landing.id} · ${bundle?.name ?? ''}`;
    }
    const bundle = incomingByKey.get(landing.key)!;
    const id = idOf.get(landing.key) ?? bundle.id;
    const kind = kindOf(bundle);
    return `${kind === 'existing' ? '' : 'New: '}${id} · ${decided(bundle).name}${kind === 'clash' ? ` (renumbered from ${bundle.id})` : ''}`;
  };

  /* ---- the workbook as reviewed ---- */
  const built = new Map<string, { shell: Bundle; items: Solution[] }>();
  const into = (landing: Landing): { shell: Bundle; items: Solution[] } | null => {
    if (landing.kind === 'none') return null;
    if (landing.kind === 'current') {
      const target = currentById.get(landing.id.toUpperCase())!;
      const slot = built.get(target.id) ?? { shell: target, items: [] };
      built.set(target.id, slot);
      return slot;
    }
    const bundle = incomingByKey.get(landing.key)!;
    const id = idOf.get(landing.key) ?? bundle.id;
    const slot = built.get(id) ?? { shell: { ...bundle, id, name: decided(bundle).name || bundle.name }, items: [] };
    built.set(id, slot);
    return slot;
  };

  const reviewRows = new Map<string, ReviewRow[]>();
  let included = 0;
  let leftOut = 0;
  for (const bundle of incoming.bundles) {
    const groupKey = toIncoming(bundle.id);
    const group = decided(bundle);
    /* an existing bundle updating itself keeps the workbook's words over the catalog's */
    if (group.status === 'approved' && kindOf(bundle) === 'existing' && group.to === toCurrent(currentById.get(bundle.id.toUpperCase())!.id)) {
      const target = currentById.get(bundle.id.toUpperCase())!;
      const slot = built.get(target.id) ?? { shell: target, items: [] };
      slot.shell = {
        ...target,
        pitch: bundle.pitch || target.pitch,
        offerWhen: bundle.offerWhen || target.offerWhen,
        pairsWith: bundle.pairsWith ?? target.pairsWith,
        accounts: bundle.accounts ?? target.accounts,
        price: bundle.price ?? target.price
      };
      built.set(target.id, slot);
    }
    for (const item of bundle.items) {
      const rowDecision = review.rows[item.id] ?? {};
      const landing = land(rowDecision.to ?? group.to);
      const out = group.status === 'skipped' || rowDecision.skip === true || landing.kind === 'none';
      reviewRows.set(groupKey, [
        ...(reviewRows.get(groupKey) ?? []),
        {
          key: item.id,
          title: item.name,
          detail: `${item.id} · ${item.status}${item.first === null ? ' · not priced' : ` · ${hours(item.first)} h`}`,
          notes: item.notes ?? '',
          hours: item.first,
          to: rowDecision.to ?? null,
          skip: rowDecision.skip === true,
          lands: out ? LEFT_OUT : group.status !== 'pending' ? labelOf(landing) : rowDecision.to ? `${labelOf(landing)}, once this group is approved` : WAITING
        }
      ]);
      if (out) {
        leftOut += 1;
        continue;
      }
      if (group.status !== 'approved') continue;
      included += 1;
      into(landing)?.items.push(item);
    }
  }

  const bundles = [...built.values()].filter((slot) => slot.items.length > 0).map((slot) => withItemTotals(slot.shell, slot.items));
  const reviewed: Catalog = { meta: { ...incoming.meta, totals: catalogTotals(bundles) }, bundles };

  /* ---- the review, as the screen shows it ---- */
  const destinations: Destination[] = [
    ...current.bundles.map((bundle) => ({ key: toCurrent(bundle.id), label: `${bundle.id} · ${bundle.name}` })),
    ...incoming.bundles
      .filter((bundle) => kindOf(bundle) !== 'existing' && decided(bundle).status !== 'skipped' && decided(bundle).to === toIncoming(bundle.id))
      .map((bundle) => ({ key: toIncoming(bundle.id), label: labelOf({ kind: 'incoming', key: toIncoming(bundle.id) }) }))
  ];
  const groups: ReviewGroup[] = incoming.bundles.map((bundle) => {
    const groupKey = toIncoming(bundle.id);
    const group = decided(bundle);
    const kind = kindOf(bundle);
    const own = group.to === groupKey;
    const renameable = kind !== 'existing' && own;
    const sameName = renameable ? currentByName.get(nameKey(group.name)) : undefined;
    const clashWith = kind === 'clash' ? currentById.get(bundle.id.toUpperCase()) : undefined;
    const rows = reviewRows.get(groupKey) ?? [];
    const notes = [
      clashWith
        ? own
          ? `${bundle.id} in the catalog is "${clashWith.name}", so this one becomes ${idOf.get(groupKey)}.`
          : `${bundle.id} in the catalog is "${clashWith.name}".`
        : '',
      sameName && sameName.id !== idOf.get(groupKey) ? `The catalog already has a bundle called that (${sameName.id}); send these into it above to join them.` : ''
    ].filter(Boolean);
    return {
      key: groupKey,
      kind,
      label: `${bundle.id} · ${bundle.name}`,
      name: renameable ? group.name : bundle.name,
      renameable,
      status: group.status,
      to: group.to,
      lands: group.status === 'skipped' ? LEFT_OUT : labelOf(land(group.to)),
      note: notes.join(' '),
      blocked: renameable && !group.name ? 'Give the bundle a name first.' : '',
      rows,
      hours: rows.reduce((total, row) => total + (row.hours ?? 0), 0)
    };
  });

  return {
    reviewed,
    merge: mergeCatalogs(current, reviewed),
    replace: diffCatalogs(current, reviewed),
    review: {
      groups,
      destinations,
      pending: groups.filter((group) => group.status === 'pending').length,
      included,
      leftOut
    }
  };
}
