import type { Bundle, Catalog, CatalogTotals, Solution, SolutionStatus } from '@/types';
import { fingerprint, readWorkbook, type SheetTable, type Workbook } from '@/lib/xlsx';

/**
 * Reads the master "Open edX Solution Bundles" workbook and rebuilds the catalog from it.
 *
 * The sheet is the source of truth, so this is deliberately forgiving: headers are matched
 * case- and punctuation-insensitively, a per-bundle detail sheet wins over the summary, and
 * anything the summary lists under a bundle that has no sheet is still kept (grouped, with a
 * warning) rather than silently dropped.
 */

export interface ImportResult {
  catalog: Catalog;
  warnings: string[];
}

const DASH = /^[—–-]$/;

const text = (value: unknown): string | null => {
  const s = String(value ?? '').trim();
  return !s || DASH.test(s) ? null : s;
};

const num = (value: unknown): number | null => {
  const s = String(value ?? '').trim();
  if (!s || DASH.test(s)) return null;
  const parsed = Number.parseFloat(s.replace(/,/g, '').replace(/[^\d.eE+-]/g, ''));
  return Number.isNaN(parsed) ? null : parsed;
};

const normalise = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

type Aliases = Record<string, string[]>;

const ITEM_ALIASES: Aliases = {
  id: ['solution id', 'id'],
  name: ['feature', 'solution', 'name'],
  desc: ['what it does', 'description'],
  form: ['delivery form', 'form'],
  status: ['status'],
  deploy: ['std deployment time', 'deployment time', 'std deploy'],
  first: ['first delivery hrs', 'first delivery', 'est first reuse'],
  repeat: ['repeat config hrs', 'repeat delivery hrs', 'repeat'],
  build: ['original build hrs', 'build hrs', 'already engineered'],
  saving: ['reuse saving'],
  account: ['3rd party account', 'third party account', 'client held account', 'client accounts'],
  integrations: ['integrations'],
  notes: ['notes limits', 'notes'],
  ref: ['reference'],
  bundleId: ['bundle id'],
  bundle: ['bundle'],
  category: ['category'],
  subCategory: ['sub category']
};

const BUNDLE_ALIASES: Aliases = {
  id: ['bundle id'],
  name: ['bundle'],
  pitch: ['what it delivers', 'elevator pitch', 'pitch'],
  offerWhen: ['offer when'],
  featureCount: ['features'],
  solutionIds: ['solution ids'],
  buildHrs: ['build hrs already engineered', 'build hrs'],
  firstHrs: ['first delivery hrs'],
  repeatHrs: ['repeat delivery hrs'],
  saved: ['effort saved'],
  noEstimate: ['no estimate items'],
  inDev: ['in dev items'],
  accounts: ['client accounts required', 'client accounts'],
  pairsWith: ['pairs well with', 'pairs with'],
  price: ['bundle list price']
};

interface HeaderMap {
  row: number;
  map: Record<string, number>;
}

/**
 * Locate the header row and map field → column index.
 * Exact header matches are claimed first, so "Bundle ID" cannot be stolen by the "Bundle" alias.
 */
function findHeader(table: SheetTable, aliases: Aliases, required: string[]): HeaderMap | null {
  for (let r = 0; r < table.length; r++) {
    const row = table[r];
    if (!row) continue;
    const byName = new Map<string, number>();
    row.forEach((cell, index) => {
      const key = normalise(cell);
      if (key && !byName.has(key)) byName.set(key, index);
    });
    if (byName.size === 0) continue;

    const map: Record<string, number> = {};
    const taken = new Set<number>();
    for (const field of Object.keys(aliases)) {
      for (const alias of aliases[field]!) {
        const index = byName.get(alias);
        if (index !== undefined && !taken.has(index)) {
          map[field] = index;
          taken.add(index);
          break;
        }
      }
    }
    for (const field of Object.keys(aliases)) {
      if (map[field] !== undefined) continue;
      for (const alias of aliases[field]!) {
        const hit = [...byName.entries()].find(([name, index]) => !taken.has(index) && name.startsWith(alias));
        if (hit) {
          map[field] = hit[1];
          taken.add(hit[1]);
          break;
        }
      }
    }
    if (required.every((field) => map[field] !== undefined)) return { row: r, map };
  }
  return null;
}

const cell = (row: string[] | undefined, map: Record<string, number>, field: string): string => {
  const index = map[field];
  if (index === undefined || !row) return '';
  return row[index] ?? '';
};

const STATUSES: SolutionStatus[] = ['Production', 'In Development', 'Estimation', 'Sample'];
const asStatus = (value: string | null): SolutionStatus =>
  STATUSES.includes(value as SolutionStatus) ? (value as SolutionStatus) : 'Production';

function buildSolution(row: string[], map: Record<string, number>, fallback?: Partial<Solution>): Solution | null {
  const id = text(cell(row, map, 'id')) ?? fallback?.id ?? null;
  if (!id) return null;
  const category = text(cell(row, map, 'category')) ?? fallback?.category ?? null;
  const subCategory = text(cell(row, map, 'subCategory')) ?? fallback?.subCategory ?? null;
  let form = text(cell(row, map, 'form')) ?? fallback?.form ?? null;
  if (!form && category) form = subCategory ? `${category} · ${subCategory}` : category;

  const pick = (field: keyof Solution, parse: (v: unknown) => number | null): number | null => {
    const parsed = parse(cell(row, map, field as string));
    if (parsed !== null) return parsed;
    const fromFallback = fallback?.[field];
    return typeof fromFallback === 'number' ? fromFallback : null;
  };

  return {
    id,
    name: text(cell(row, map, 'name')) ?? fallback?.name ?? id,
    desc: text(cell(row, map, 'desc')) ?? fallback?.desc ?? '',
    form,
    status: asStatus(text(cell(row, map, 'status')) ?? fallback?.status ?? null),
    deploy: text(cell(row, map, 'deploy')) ?? fallback?.deploy ?? null,
    first: pick('first', num),
    repeat: pick('repeat', num),
    build: pick('build', num),
    saving: pick('saving', num),
    account: text(cell(row, map, 'account')) ?? fallback?.account ?? null,
    integrations: text(cell(row, map, 'integrations')) ?? fallback?.integrations ?? null,
    notes: text(cell(row, map, 'notes')) ?? fallback?.notes ?? null,
    ref: text(cell(row, map, 'ref')) ?? fallback?.ref ?? null,
    category,
    subCategory
  };
}

interface BundleMeta {
  id: string;
  name: string;
  pitch: string;
  offerWhen: string;
  featureCount: number | null;
  solutionIds: string | null;
  buildHrs: number | null;
  firstHrs: number | null;
  repeatHrs: number | null;
  saved: number | null;
  noEstimate: number | null;
  inDev: number | null;
  accounts: string | null;
  pairsWith: string | null;
  price: string | null;
}

export async function parseCatalogWorkbook(input: ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const workbook: Workbook = await readWorkbook(input);
  const warnings: string[] = [];
  const sheetNames = Object.keys(workbook);
  if (sheetNames.length === 0) throw new Error('No worksheets found in that workbook.');

  /* ---- All Components: the canonical solution list ---- */
  const allName = sheetNames.find((n) => normalise(n) === 'all components') ?? sheetNames.find((n) => normalise(n).includes('all component'));
  const byId = new Map<string, Solution & { _bundleId?: string | null; _bundleName?: string | null }>();
  const order: string[] = [];

  if (allName) {
    const table = workbook[allName]!;
    const header = findHeader(table, ITEM_ALIASES, ['id', 'name']);
    if (!header) warnings.push('“All Components” has no recognisable header row — bundle sheets used instead.');
    else {
      for (let r = header.row + 1; r < table.length; r++) {
        const row = table[r];
        if (!row) continue;
        const solution = buildSolution(row, header.map);
        if (!solution || !/^[A-Z]{2,}-?\d/i.test(solution.id)) continue;
        byId.set(solution.id, {
          ...solution,
          _bundleId: text(cell(row, header.map, 'bundleId')),
          _bundleName: text(cell(row, header.map, 'bundle'))
        });
        order.push(solution.id);
      }
    }
  } else {
    warnings.push('No “All Components” sheet — bundle sheets used on their own.');
  }

  /* ---- Bundle Catalog: prose and totals ---- */
  const catalogName = sheetNames.find((n) => normalise(n) === 'bundle catalog') ?? sheetNames.find((n) => normalise(n).includes('bundle catalog'));
  const meta = new Map<string, BundleMeta>();
  const bundleOrder: string[] = [];
  let title = '';
  let subtitle = '';
  const notes: string[] = [];
  let totalRow: { row: string[]; map: Record<string, number> } | null = null;

  if (catalogName) {
    const table = workbook[catalogName]!;
    const header = findHeader(table, BUNDLE_ALIASES, ['id', 'name']);
    for (let r = 0; r < (header ? header.row : table.length); r++) {
      const first = table[r]?.[0];
      if (!first) continue;
      if (!title) title = first;
      else if (!subtitle) subtitle = first;
    }
    if (header) {
      for (let r = header.row + 1; r < table.length; r++) {
        const row = table[r];
        if (!row) continue;
        const id = text(cell(row, header.map, 'id'));
        const name = text(cell(row, header.map, 'name'));
        if (!id) {
          if (name && /total/i.test(name)) totalRow = { row, map: header.map };
          continue;
        }
        meta.set(id, {
          id,
          name: name ?? id,
          pitch: text(cell(row, header.map, 'pitch')) ?? '',
          offerWhen: text(cell(row, header.map, 'offerWhen')) ?? '',
          featureCount: num(cell(row, header.map, 'featureCount')),
          solutionIds: text(cell(row, header.map, 'solutionIds')),
          buildHrs: num(cell(row, header.map, 'buildHrs')),
          firstHrs: num(cell(row, header.map, 'firstHrs')),
          repeatHrs: num(cell(row, header.map, 'repeatHrs')),
          saved: num(cell(row, header.map, 'saved')),
          noEstimate: num(cell(row, header.map, 'noEstimate')),
          inDev: num(cell(row, header.map, 'inDev')),
          accounts: text(cell(row, header.map, 'accounts')),
          pairsWith: text(cell(row, header.map, 'pairsWith')),
          price: text(cell(row, header.map, 'price'))
        });
        bundleOrder.push(id);
      }
    } else {
      warnings.push('“Bundle Catalog” has no recognisable header row — bundle descriptions may be missing.');
    }
    for (const row of table) {
      const first = row?.[0]?.trim();
      if (!first || !/^[•*]/.test(first)) continue;
      const note = first.replace(/^[•*]\s*/, '').trim();
      if (/cells are for you to fill in/i.test(note)) continue; /* sheet-authoring instruction */
      notes.push(note);
    }
  } else {
    warnings.push('No “Bundle Catalog” sheet — bundle pitches unavailable.');
  }

  /* ---- per-bundle detail sheets ---- */
  const detail = new Map<string, Solution[]>();
  for (const sheetName of sheetNames) {
    const match = /^\s*(B\d{1,3})\b/i.exec(sheetName);
    if (!match) continue;
    const bundleId = match[1]!.toUpperCase();
    const table = workbook[sheetName]!;
    const header = findHeader(table, ITEM_ALIASES, ['id', 'name']);
    if (!header) {
      warnings.push(`Sheet “${sheetName}” skipped — no header row found.`);
      continue;
    }
    const items: Solution[] = [];
    for (let r = header.row + 1; r < table.length; r++) {
      const row = table[r];
      if (!row) continue;
      const rawId = text(cell(row, header.map, 'id'));
      if (!rawId || /total/i.test(rawId)) continue;
      const solution = buildSolution(row, header.map, byId.get(rawId));
      if (solution) items.push(solution);
    }
    if (items.length > 0) detail.set(bundleId, items);

    if (!meta.has(bundleId)) {
      meta.set(bundleId, {
        id: bundleId,
        name: sheetName.replace(/^\s*B\d{1,3}\s*/i, '').trim() || bundleId,
        pitch: '', offerWhen: '', featureCount: null, solutionIds: null,
        buildHrs: null, firstHrs: null, repeatHrs: null, saved: null,
        noEstimate: null, inDev: null, accounts: null, pairsWith: null, price: null
      });
      bundleOrder.push(bundleId);
    }
    /* pitch / offer / pairs live above the header on the detail sheet */
    const entry = meta.get(bundleId)!;
    for (let r = 0; r < header.row; r++) {
      const line = table[r]?.[0] ?? '';
      const found = /^(Pitch|Offer when the client asks about|Pairs well with)\s*:\s*([\s\S]+)$/i.exec(line);
      if (!found) continue;
      const key = normalise(found[1]);
      const value = found[2]!.trim();
      if (key === 'pitch' && !entry.pitch) entry.pitch = value;
      if (key.startsWith('offer when') && !entry.offerWhen) entry.offerWhen = value;
      if (key.startsWith('pairs well with') && !entry.pairsWith) entry.pairsWith = value;
    }
  }

  /* ---- assemble: detail wins, All Components fills the gaps ---- */
  const used = new Set<string>();
  const bundles: Bundle[] = [];

  for (const bundleId of bundleOrder) {
    const entry = meta.get(bundleId);
    if (!entry) continue;
    const items: Solution[] = [...(detail.get(bundleId) ?? [])];
    for (const item of items) used.add(item.id);
    for (const id of order) {
      if (used.has(id)) continue;
      const candidate = byId.get(id);
      if (!candidate || (candidate._bundleId ?? '').toUpperCase() !== bundleId) continue;
      const { _bundleId: _a, _bundleName: _b, ...solution } = candidate;
      items.push(solution);
      used.add(id);
    }
    if (items.length === 0) continue;

    const recorded = items.filter((it) => it.first !== null && it.build !== null);
    const sumFirst = recorded.reduce((total, it) => total + (it.first ?? 0), 0);
    const sumBuild = recorded.reduce((total, it) => total + (it.build ?? 0), 0);
    /* trust the summary row only while its feature count still matches the rows on the sheet */
    const stale = entry.featureCount !== null && entry.featureCount !== items.length;
    const trust = <T>(value: T | null, computed: T): T => (!stale && value !== null ? value : computed);

    bundles.push({
      id: bundleId,
      name: entry.name,
      pitch: entry.pitch,
      offerWhen: entry.offerWhen,
      featureCount: items.length,
      solutionIds: entry.solutionIds,
      buildHrs: trust(entry.buildHrs, items.some((it) => it.build !== null) ? items.reduce((t, it) => t + (it.build ?? 0), 0) : null),
      firstHrs: trust(entry.firstHrs, items.reduce((t, it) => t + (it.first ?? 0), 0)),
      repeatHrs: trust(entry.repeatHrs, items.reduce((t, it) => t + (it.repeat ?? 0), 0)),
      saved: trust(entry.saved, sumBuild > 0 ? 1 - sumFirst / sumBuild : null),
      noEstimate: trust(entry.noEstimate, items.filter((it) => it.first === null).length),
      inDev: trust(entry.inDev, items.filter((it) => it.status === 'In Development').length),
      accounts: entry.accounts,
      pairsWith: entry.pairsWith,
      price: entry.price,
      items
    });
  }

  /* solutions listed under a bundle with no row or sheet of its own */
  const orphans = order.filter((id) => !used.has(id)).map((id) => byId.get(id)!).filter(Boolean);
  if (orphans.length > 0) {
    const grouped = new Map<string, typeof orphans>();
    for (const orphan of orphans) {
      const key = (orphan._bundleId ?? 'B00').toUpperCase();
      grouped.set(key, [...(grouped.get(key) ?? []), orphan]);
    }
    for (const [key, group] of grouped) {
      const name = group[0]?._bundleName ?? 'Unsorted solutions';
      const items = group.map(({ _bundleId: _a, _bundleName: _b, ...solution }) => solution);
      bundles.push({
        id: key,
        name,
        pitch: 'Added to the master sheet — no bundle sheet written yet.',
        offerWhen: '',
        featureCount: items.length,
        solutionIds: null,
        buildHrs: items.some((it) => it.build !== null) ? items.reduce((t, it) => t + (it.build ?? 0), 0) : null,
        firstHrs: items.reduce((t, it) => t + (it.first ?? 0), 0),
        repeatHrs: items.reduce((t, it) => t + (it.repeat ?? 0), 0),
        saved: null,
        noEstimate: items.filter((it) => it.first === null).length,
        inDev: items.filter((it) => it.status === 'In Development').length,
        accounts: null,
        pairsWith: null,
        items
      });
      warnings.push(
        `${items.length} new solution${items.length === 1 ? '' : 's'} under “${key}” had no bundle sheet — grouped as “${name}”.`
      );
    }
  }

  const every = bundles.flatMap((bundle) => bundle.items);
  if (every.length === 0) throw new Error('No solutions found in that workbook — is it the Open edX Solution Bundles sheet?');

  const recordedAll = every.filter((it) => it.first !== null && it.build !== null);
  const sumFirst = recordedAll.reduce((total, it) => total + (it.first ?? 0), 0);
  const sumBuild = recordedAll.reduce((total, it) => total + (it.build ?? 0), 0);

  const totalFeatures = totalRow ? num(cell(totalRow.row, totalRow.map, 'featureCount')) : null;
  const totalsTrustworthy = totalRow !== null && totalFeatures === every.length;
  const fromTotals = (field: string, computed: number | null): number | null => {
    if (!totalsTrustworthy || !totalRow) return computed;
    const value = num(cell(totalRow.row, totalRow.map, field));
    return value ?? computed;
  };

  const totals: CatalogTotals = {
    features: every.length,
    buildHrs: fromTotals('buildHrs', every.reduce((t, it) => t + (it.build ?? 0), 0)),
    firstHrs: fromTotals('firstHrs', every.reduce((t, it) => t + (it.first ?? 0), 0)),
    repeatHrs: fromTotals('repeatHrs', every.reduce((t, it) => t + (it.repeat ?? 0), 0)),
    saved: fromTotals('saved', sumBuild > 0 ? 1 - sumFirst / sumBuild : null),
    noEstimate: fromTotals('noEstimate', every.filter((it) => it.first === null).length) ?? 0,
    inDev: fromTotals('inDev', every.filter((it) => it.status === 'In Development').length) ?? 0
  };

  const compiled = /compiled\s+([^.]+?)\s+from/i.exec(subtitle)?.[1]?.trim() ?? '';

  return {
    warnings,
    catalog: {
      meta: {
        title: title || 'Edly — Open edX Solution Bundles (Sales Catalog)',
        subtitle: subtitle || `${totals.features} solutions across ${bundles.length} bundles.`,
        compiled,
        totals,
        notes: notes.length > 0 ? notes : ['Imported from the master sales sheet — hours are the delivery team’s recorded engineering estimates.']
      },
      bundles
    }
  };
}

/** Fetch and parse a catalog workbook served alongside the app. */
export async function fetchCatalog(url: string): Promise<ImportResult & { hash: string }> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const result = await parseCatalogWorkbook(buffer);
  return { ...result, hash: fingerprint(buffer) };
}
