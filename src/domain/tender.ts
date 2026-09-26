import type {
  Catalog,
  Confidence,
  DeskDraftEdit,
  EstimateRequest,
  Estimation,
  MatchKind,
  PlatformFit,
  Practice,
  RequirementMatch,
  RequirementPriority,
  Tender,
  TenderDocument,
  TenderRange,
  TenderRequirement,
  TenderSection,
  TenderStage,
  TenderTokens
} from '@/types';
/* relative, not '@/': the server imports this module, and the function bundler does not read tsconfig paths */
import { plural, uniqueSlug } from '../lib/format';
import { list, record, text as str, whole as int } from '../lib/narrow';

/**
 * Tender intake, as pure functions.
 *
 * The AI proposes and people decide, and everything here sits on one side of that line or the
 * other. The `read*` functions narrow what the model returned into shapes the app can trust:
 * a platform or catalog id the app does not have is dropped, never passed on. The rest turns
 * what a person approved into things the app already knows: a selection and desk requests.
 *
 * Hours never come from the model. A matched requirement carries catalog ids, and its hours are
 * read from the catalog when shown, exactly as the builder does.
 */

/* --------------------------------------------------------------- wire types */

/** A tender document as the server needs it to address the file. */
export interface DocRef {
  n: number;
  name: string;
  kind: 'pdf' | 'text';
  fileId: string;
  pages: number;
}

/** One platform, as the fit step describes it to the model. */
export interface PlatformDigest {
  id: string;
  name: string;
  practice: string;
  note: string;
  bundles: string[];
}

/** One catalog solution, as the match step describes it to the model. No hours, on purpose. */
export interface CatalogLine {
  id: string;
  bundle: string;
  bundleName: string;
  name: string;
  category: string;
  status: string;
  desc: string;
}

export interface FitHeader {
  title: string;
  client: string;
  /** Submission deadline, yyyy-mm-dd, or blank when the tender states none. */
  deadline: string;
  summary: string;
}

export interface FitResult {
  fit: PlatformFit;
  header: FitHeader;
  outline: TenderSection[];
  /** Page (or part) count per document number. */
  pages: Record<number, number>;
}

/** A requirement as extracted, before it has an id or a person has looked at it. */
export type ExtractedRequirement = Omit<TenderRequirement, 'id' | 'status' | 'match' | 'edited'>;

/** A requirement as the match step sends it. */
export interface MatchInput {
  id: string;
  text: string;
  section: string;
  priority: RequirementPriority;
}

/**
 * Why an AI call failed, in terms the browser can act on. `truncated` and `timeout` mean the
 * range was too big for one call, so the runner splits it rather than retrying it as it was.
 */
export type AiErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limited'
  | 'too_large'
  | 'bad_request'
  | 'refused'
  | 'truncated'
  | 'timeout'
  | 'no_result'
  | 'upstream';

/* ------------------------------------------------------------- narrowing */

const CONFIDENCE: readonly Confidence[] = ['high', 'medium', 'low'];
const confidence = (value: unknown): Confidence => (CONFIDENCE.includes(value as Confidence) ? (value as Confidence) : 'low');

const KINDS: readonly MatchKind[] = ['catalog', 'partial', 'custom', 'out'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The fit step's answer, narrowed.
 *
 * A recommended platform the app does not have is no recommendation at all, so the best named
 * alternative takes its place and the confidence drops to low. Page counts of converted text
 * were counted in the browser, which knows better than the model, so only PDF counts are taken.
 */
export function readFit(input: unknown, platformIds: readonly string[], docs: readonly Pick<DocRef, 'n' | 'kind' | 'pages'>[]): FitResult {
  const raw = record(input);
  const known = new Set(platformIds);

  const named = list(raw.alternatives)
    .map(record)
    .map((entry) => ({ platform: str(entry.platform, 60), reason: str(entry.reason, 400) }))
    .filter((entry) => known.has(entry.platform));

  let platform = str(raw.platform, 60);
  let sure = confidence(raw.confidence);
  if (!known.has(platform)) {
    platform = named[0]?.platform ?? '';
    sure = 'low';
  }

  const listed = new Set([platform]);
  const alternatives = named
    .filter((entry) => {
      if (listed.has(entry.platform)) return false;
      listed.add(entry.platform);
      return true;
    })
    .slice(0, 3);

  const elsewhere = list(raw.elsewhere)
    .map(record)
    .map((entry) => ({ platform: str(entry.platform, 60), what: str(entry.what, 400) }))
    .filter((entry) => known.has(entry.platform) && entry.platform !== platform && entry.what)
    .slice(0, 4);

  const pages: Record<number, number> = {};
  for (const doc of docs) pages[doc.n] = doc.kind === 'text' ? doc.pages : 0;
  for (const entry of list(raw.documents).map(record)) {
    const doc = docs.find((one) => one.n === int(entry.doc));
    if (doc?.kind === 'pdf') pages[doc.n] = int(entry.pages);
  }

  const outline = list(raw.outline)
    .map(record)
    .map((entry) => ({ doc: int(entry.doc), title: str(entry.title, 160), from: int(entry.from), to: int(entry.to) }))
    .filter((section) => section.title && section.from >= 1 && docs.some((doc) => doc.n === section.doc))
    .map((section) => {
      const last = pages[section.doc] || Number.POSITIVE_INFINITY;
      const from = Math.min(section.from, last);
      return { ...section, from, to: Math.min(Math.max(section.to, from), last) };
    })
    .slice(0, 200);

  const deadline = str(raw.deadline, 10);

  return {
    fit: {
      platform,
      confidence: sure,
      reasons: list(raw.reasons)
        .map((reason) => str(reason, 400))
        .filter(Boolean)
        .slice(0, 6),
      alternatives,
      elsewhere
    },
    header: {
      title: str(raw.title, 160),
      client: str(raw.client, 160),
      deadline: ISO_DATE.test(deadline) ? deadline : '',
      summary: str(raw.summary, 1200)
    },
    outline,
    pages
  };
}

/**
 * One range's requirements, narrowed. An unreadable priority reads as `must`: in a tender,
 * treating an obligation as optional is the expensive mistake, and a person reviews it anyway.
 */
export function readRequirements(input: unknown, range: Pick<TenderRange, 'doc'>, docPages: number): ExtractedRequirement[] {
  const found: ExtractedRequirement[] = [];
  for (const entry of list(record(input).requirements).map(record)) {
    const text = str(entry.text, 800);
    if (!text) continue;
    const page = int(entry.page);
    found.push({
      doc: range.doc,
      /* a page outside the document is a misreading, not a location */
      page: page >= 1 && (docPages === 0 || page <= docPages) ? page : 0,
      section: str(entry.section, 160),
      text,
      quote: str(entry.quote, 600),
      priority: entry.priority === 'should' ? 'should' : 'must',
      outOfScope: entry.outOfScope === true
    });
  }
  return found;
}

/**
 * The match step's answer, narrowed against the catalog it was given.
 *
 * Ids the catalog does not have are dropped. If that leaves a catalog or partial match with no
 * solution at all, nothing verifiable is left of it, so it becomes custom and goes to the desk.
 */
export function readMatches(
  input: unknown,
  requirementIds: readonly string[],
  catalogIds: ReadonlySet<string>,
  bundleIds: ReadonlySet<string>
): Record<string, RequirementMatch> {
  const wanted = new Set(requirementIds);
  const matches: Record<string, RequirementMatch> = {};

  for (const entry of list(record(input).matches).map(record)) {
    const id = str(entry.id, 40);
    if (!wanted.has(id) || matches[id]) continue;

    let kind: MatchKind = KINDS.includes(entry.kind as MatchKind) ? (entry.kind as MatchKind) : 'custom';
    const solutionIds = [...new Set(list(entry.solutionIds).map((value) => str(value, 80)))].filter((value) => catalogIds.has(value));
    let sure = confidence(entry.confidence);
    let reason = str(entry.reason, 500);

    if ((kind === 'catalog' || kind === 'partial') && solutionIds.length === 0) {
      kind = 'custom';
      sure = 'low';
      reason = reason ? `${reason} The catalog ids it named do not exist, so this goes to the desk.` : 'No catalog solution could be confirmed.';
    }

    const covered = kind === 'catalog' || kind === 'partial';
    const toDesk = kind === 'custom' || kind === 'partial';
    const area = str(entry.area, 60);
    matches[id] = {
      kind,
      solutionIds: covered ? solutionIds : [],
      confidence: sure,
      reason,
      remainder: kind === 'partial' ? str(entry.remainder, 600) : '',
      area: toDesk && bundleIds.has(area) ? area : '',
      integrations: toDesk ? str(entry.integrations, 300) : '',
      approved: false
    };
  }
  return matches;
}

/* ---------------------------------------------------------------- ranges */

/** Pages per extraction call. Small enough to finish well inside a function's time limit. */
export const RANGE_PAGES = 20;

/**
 * The extraction calls a tender needs: each document cut into ranges of at most `span` pages.
 *
 * A range ends just before a section starts when one starts in its last third, so a section is
 * usually read whole by one call rather than split across two.
 */
export function planRanges(docs: readonly Pick<TenderDocument, 'n' | 'pages'>[], outline: readonly TenderSection[], span = RANGE_PAGES): TenderRange[] {
  const ranges: TenderRange[] = [];
  for (const doc of docs) {
    if (doc.pages <= 0) {
      ranges.push({ key: `${doc.n}:1-end`, doc: doc.n, from: 1, to: 0, status: 'pending' });
      continue;
    }
    const starts = outline.filter((section) => section.doc === doc.n).map((section) => section.from);
    let from = 1;
    /* bounded, like the planner's packing loop: a bad page count must not spin forever */
    for (let guard = 0; from <= doc.pages && guard < 5000; guard++) {
      let to = Math.min(doc.pages, from + span - 1);
      if (to < doc.pages) {
        const floor = from + Math.floor((span * 2) / 3);
        const cut = starts.filter((start) => start > floor && start <= to).sort((a, b) => b - a)[0];
        if (cut !== undefined) to = cut - 1;
      }
      ranges.push({ key: `${doc.n}:${from}-${to}`, doc: doc.n, from, to, status: 'pending' });
      from = to + 1;
    }
  }
  return ranges;
}

const pendingRange = (doc: number, from: number, to: number): TenderRange => ({
  key: `${doc}:${from}-${to === 0 ? 'end' : to}`,
  doc,
  from,
  to,
  status: 'pending'
});

/**
 * A range cut in two, for when one call could not finish it. Null for a single page.
 *
 * A range whose end is unknown (a document nobody counted) cannot be halved, so the first
 * `RANGE_PAGES` pages are peeled off and the rest stays open-ended. Refusing to split it left the
 * whole document stuck, with an error that blamed a single page.
 */
export function splitRange(range: TenderRange): [TenderRange, TenderRange] | null {
  if (range.to === 0) return [pendingRange(range.doc, range.from, range.from + RANGE_PAGES - 1), pendingRange(range.doc, range.from + RANGE_PAGES, 0)];
  if (range.to - range.from < 1) return null;
  const middle = range.from + Math.floor((range.to - range.from) / 2);
  return [pendingRange(range.doc, range.from, middle), pendingRange(range.doc, middle + 1, range.to)];
}

/**
 * How long a claim on a range holds. A tab marks a range `running` before it calls the AI, so
 * another tab (or another browser, once the store syncs) leaves it alone. A claim older than the
 * longest call a function can make, plus a margin, belongs to a tab that went away mid-call.
 */
export const STALE_CLAIM_MS = 6 * 60_000;

/** A live claim held by another tab: leave that range alone. */
const heldElsewhere = (range: TenderRange, tab: string, now: number): boolean =>
  range.status === 'running' && range.by !== tab && typeof range.startedAt === 'number' && now - range.startedAt < STALE_CLAIM_MS;

/**
 * Which ranges this tab should start now: pending ones, ones it claimed but has not started (a
 * Retry or a split claims for the tab that asked), and ones whose claim went stale. Ranges in
 * flight here and ranges claimed by other tabs count towards `limit`, and neither starts twice.
 */
export function rangesToRun(ranges: readonly TenderRange[], inFlight: ReadonlySet<string>, limit: number, now: number, tab: string): string[] {
  const busy = ranges.filter((range) => inFlight.has(range.key) || heldElsewhere(range, tab, now)).length;
  const room = Math.max(0, limit - busy);
  return ranges
    .filter((range) => !inFlight.has(range.key) && (range.status === 'pending' || (range.status === 'running' && !heldElsewhere(range, tab, now))))
    .slice(0, room)
    .map((range) => range.key);
}

/** When the earliest claim held by another tab goes stale, so a waiting tab knows when to look again. */
export function nextStaleAt(ranges: readonly TenderRange[], now: number, tab: string): number | null {
  const times = ranges.filter((range) => heldElsewhere(range, tab, now)).map((range) => (range.startedAt ?? now) + STALE_CLAIM_MS);
  return times.length > 0 ? Math.min(...times) : null;
}

/** A claim, as the reducer stamps it on a range. */
export interface Claim {
  at: number;
  by: string;
}

/* ---------------------------------------------------------- requirements */

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const number = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/**
 * The highest number in use in an `R-01` style series, found in one pass. Ids continue from the
 * highest, never from the count, so deleting a record cannot reissue its id (as `nextId` does,
 * but without rescanning the whole list for every id handed out).
 */
export function highestId(prefix: string, ids: Iterable<string>): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const id of ids) {
    const found = pattern.exec(id)?.[1];
    if (found) max = Math.max(max, Number(found));
  }
  return max;
}

export const serialId = (prefix: string, n: number): string => `${prefix}-${String(n).padStart(2, '0')}`;

/** Document order: by document, then page, with anything added by hand last. */
export function sortRequirements(reqs: readonly TenderRequirement[]): TenderRequirement[] {
  return [...reqs].sort(
    (a, b) =>
      (a.doc || Number.MAX_SAFE_INTEGER) - (b.doc || Number.MAX_SAFE_INTEGER) ||
      (a.page || Number.MAX_SAFE_INTEGER) - (b.page || Number.MAX_SAFE_INTEGER) ||
      number(a.id) - number(b.id)
  );
}

/**
 * Adds one range's requirements to the tender, skipping any whose wording is already there.
 *
 * Only identical wording counts as a duplicate. Two requirements split out of one compound
 * sentence share a quote, so matching on the quote would silently drop the second of them.
 */
export function addExtracted(existing: readonly TenderRequirement[], incoming: readonly ExtractedRequirement[]): { reqs: TenderRequirement[]; added: number } {
  const seen = new Set(existing.map((req) => normalise(req.text)));
  const reqs = [...existing];
  let last = highestId('R', existing.map((req) => req.id));
  let added = 0;
  for (const found of incoming) {
    const key = normalise(found.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    last += 1;
    reqs.push({ ...found, id: serialId('R', last), status: 'proposed' });
    added += 1;
  }
  return { reqs: sortRequirements(reqs), added };
}

/** Where a requirement came from, as a person reads it: "RFP.pdf, p. 14". */
export function sourceLabel(req: Pick<TenderRequirement, 'doc' | 'page'>, docs: readonly Pick<TenderDocument, 'n' | 'name' | 'kind'>[]): string {
  const doc = docs.find((one) => one.n === req.doc);
  const where = req.page > 0 ? (doc?.kind === 'text' ? `part ${req.page}` : `p. ${req.page}`) : '';
  const name = doc?.name ?? (req.doc > 0 ? `document ${req.doc}` : '');
  return [name, where].filter(Boolean).join(', ') || 'added by hand';
}

/** A range as a person reads it: "RFP.pdf, pages 1 to 20". */
export function rangeLabel(range: Pick<TenderRange, 'doc' | 'from' | 'to'>, docs: readonly Pick<TenderDocument, 'n' | 'name' | 'kind'>[]): string {
  const doc = docs.find((one) => one.n === range.doc);
  const name = doc?.name ?? `document ${range.doc}`;
  const unit = doc?.kind === 'text' ? 'parts' : 'pages';
  if (range.to === 0) return range.from <= 1 ? `${name}, whole document` : `${name}, ${unit} ${range.from} to the end`;
  return range.from === range.to ? `${name}, ${unit === 'parts' ? 'part' : 'page'} ${range.from}` : `${name}, ${unit} ${range.from} to ${range.to}`;
}

/* ---------------------------------------------------------------- matching */

/** Approved requirements the AI has not matched yet. Out-of-scope ones are settled without it. */
export function needsMatching(tender: Pick<Tender, 'reqs'>): MatchInput[] {
  return tender.reqs
    .filter((req) => req.status === 'approved' && !req.outOfScope && !req.match)
    .map((req) => ({ id: req.id, text: req.text, section: req.section, priority: req.priority }));
}

/** Requirements marked out of scope at extraction need no AI to be matched as out of scope. */
export function outOfScopeMatches(tender: Pick<Tender, 'reqs'>): Record<string, RequirementMatch> {
  const matches: Record<string, RequirementMatch> = {};
  for (const req of tender.reqs) {
    if (req.status !== 'approved' || !req.outOfScope || req.match) continue;
    matches[req.id] = {
      kind: 'out',
      solutionIds: [],
      confidence: 'high',
      reason: 'Marked out of scope when the requirement was extracted.',
      remainder: '',
      area: '',
      integrations: '',
      approved: false
    };
  }
  return matches;
}

/** Match calls of at most `size` requirements each, so no call outlives the function. */
export function matchBatches<T>(items: readonly T[], size = 40): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size));
  return batches;
}

/** The catalog as the match step describes it. One line per solution, first bundle wins. */
export function catalogLines(catalog: Catalog): CatalogLine[] {
  const seen = new Set<string>();
  const lines: CatalogLine[] = [];
  for (const bundle of catalog.bundles) {
    for (const item of bundle.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      lines.push({
        id: item.id,
        bundle: bundle.id,
        bundleName: bundle.name,
        name: item.name,
        category: item.category ?? '',
        status: item.status,
        desc: (item.desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
      });
    }
  }
  return lines;
}

/** Every platform the fit step can recommend, with enough of its catalog to tell them apart. */
export function platformDigest(practices: readonly Practice[], loaded: Readonly<Record<string, Catalog>>): PlatformDigest[] {
  return practices.flatMap((practice) =>
    practice.platforms.map((platform) => {
      const catalog = loaded[platform.id] ?? platform.catalog;
      return {
        id: platform.id,
        name: platform.name,
        practice: practice.name,
        note: platform.note ?? '',
        bundles: (catalog?.bundles ?? []).map((bundle) => (bundle.offerWhen ? `${bundle.name} (${bundle.offerWhen})` : bundle.name)).slice(0, 30)
      };
    })
  );
}

/* ----------------------------------------------------------------- counts */

export interface TenderCounts {
  total: number;
  proposed: number;
  approved: number;
  removed: number;
  /** Approved requirements with a proposed match. */
  matched: number;
  /** Approved requirements whose match a person accepted. */
  reviewed: number;
  /** Accepted matches that send work to the desk: custom, or partial with a remainder. */
  toDesk: number;
  catalog: number;
  partial: number;
  custom: number;
  out: number;
  /** Ranges not read yet: waiting, or being read in some tab. */
  pendingRanges: number;
  failedRanges: number;
}

export function tenderCounts(tender: Pick<Tender, 'reqs' | 'ranges'>): TenderCounts {
  const counts: TenderCounts = {
    total: tender.reqs.length,
    proposed: 0,
    approved: 0,
    removed: 0,
    matched: 0,
    reviewed: 0,
    toDesk: 0,
    catalog: 0,
    partial: 0,
    custom: 0,
    out: 0,
    pendingRanges: tender.ranges.filter((range) => range.status === 'pending' || range.status === 'running').length,
    failedRanges: tender.ranges.filter((range) => range.status === 'failed').length
  };
  for (const req of tender.reqs) {
    counts[req.status] += 1;
    if (req.status !== 'approved' || !req.match) continue;
    counts.matched += 1;
    counts[req.match.kind] += 1;
    if (!req.match.approved) continue;
    counts.reviewed += 1;
    if (req.match.kind === 'custom' || (req.match.kind === 'partial' && req.match.remainder)) counts.toDesk += 1;
  }
  return counts;
}

/** Whether a step has what it needs. A person may always go back to an earlier one. */
export function stageOpen(tender: Pick<Tender, 'reqs' | 'ranges'>, stage: TenderStage): boolean {
  const counts = tenderCounts(tender);
  if (stage === 'requirements') return true;
  if (stage === 'match') return counts.approved > 0;
  return counts.reviewed > 0;
}

export function addTokens(total: TenderTokens, more: Partial<TenderTokens> | null | undefined): TenderTokens {
  return {
    input: total.input + (more?.input ?? 0),
    output: total.output + (more?.output ?? 0),
    cacheRead: total.cacheRead + (more?.cacheRead ?? 0),
    cacheWrite: total.cacheWrite + (more?.cacheWrite ?? 0)
  };
}

export const NO_TOKENS: TenderTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/* ------------------------------------------------------------------ apply */

/** Approved, reviewed catalog and partial matches, as the solution ids to select. */
export function tenderSelection(tender: Pick<Tender, 'reqs'>, catalogIds: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const req of tender.reqs) {
    if (req.status !== 'approved' || !req.match?.approved) continue;
    if (req.match.kind !== 'catalog' && req.match.kind !== 'partial') continue;
    for (const id of req.match.solutionIds) if (catalogIds.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** First-delivery hours of a selection, read from the catalog, and how many have no estimate yet. */
export function catalogHours(ids: readonly string[], catalog: Catalog): { first: number; unpriced: number } {
  const byId = new Map(catalog.bundles.flatMap((bundle) => bundle.items.map((item) => [item.id, item] as const)));
  let first = 0;
  let unpriced = 0;
  for (const id of new Set(ids)) {
    const item = byId.get(id);
    if (!item) continue;
    if (item.first === null) unpriced += 1;
    else first += item.first;
  }
  return { first, unpriced };
}

/** The area a desk request carries when nothing in the catalog is close. */
export const SOMETHING_NEW = 'Something new, not in any bundle';

export interface DeskDraft {
  reqId: string;
  kind: 'custom' | 'partial';
  title: string;
  details: string;
  area: string;
  integrations: string;
  source: string;
  skip: boolean;
  /** A desk request for this requirement already exists. */
  sent: boolean;
}

/** A requirement's first sentence, or its first `max` characters cut at a word. */
export function shortTitle(value: string, max = 90): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(clean)?.[1] ?? clean;
  const base = sentence.replace(/[.!?]$/, '');
  if (base.length <= max) return base;
  const cut = base.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '')}…`;
}

/**
 * What goes to the estimation desk: every approved custom match, and the remainder of every
 * approved partial one. A person's edits at the apply step override the derived wording.
 */
export function deskDrafts(tender: Pick<Tender, 'reqs' | 'docs'>, catalog: Catalog, sent: ReadonlySet<string> = new Set()): DeskDraft[] {
  const bundleName = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle.name]));
  const solutionName = new Map(catalog.bundles.flatMap((bundle) => bundle.items.map((item) => [item.id, item.name] as const)));
  const drafts: DeskDraft[] = [];

  for (const req of tender.reqs) {
    const match = req.match;
    if (req.status !== 'approved' || !match?.approved) continue;
    if (match.kind !== 'custom' && (match.kind !== 'partial' || !match.remainder)) continue;

    const source = sourceLabel(req, tender.docs);
    const lines: string[] = [];
    if (match.kind === 'partial') {
      lines.push(match.remainder, '');
      const covered = match.solutionIds.map((id) => solutionName.get(id) ?? id);
      if (covered.length > 0) lines.push(`The catalog covers the rest: ${covered.join(', ')}.`, '');
      lines.push(`Full requirement: ${req.text}`);
    } else {
      lines.push(req.text);
    }
    lines.push('', `Tender priority: ${req.priority === 'must' ? 'must have' : 'nice to have'}.`);
    if (req.quote) lines.push(`From the tender (${source}): "${req.quote}"`);

    const edit: DeskDraftEdit = match.draft ?? {};
    drafts.push({
      reqId: req.id,
      kind: match.kind,
      title: edit.title ?? shortTitle(match.kind === 'partial' ? match.remainder : req.text),
      details: edit.details ?? lines.join('\n'),
      area: edit.area ?? (bundleName.get(match.area) ?? SOMETHING_NEW),
      integrations: edit.integrations ?? match.integrations,
      source,
      skip: Boolean(match.skip),
      sent: sent.has(req.id)
    });
  }
  return drafts;
}

export interface DeskContact {
  name: string;
  email: string;
  org: string;
}

/**
 * The desk requests a tender sends, numbered after the ones that exist. The reducer and the
 * email both call this with the same state, so the ids the email quotes are the ids stored.
 */
export function tenderRequests(
  existing: readonly EstimateRequest[],
  tender: Pick<Tender, 'id' | 'plat' | 'due'>,
  drafts: readonly DeskDraft[],
  contact: DeskContact,
  estimation: Pick<Estimation, 'id' | 'name' | 'client'>,
  stamp: string
): EstimateRequest[] {
  const made: EstimateRequest[] = [];
  let last = highestId('RQ', existing.map((request) => request.id));
  for (const draft of drafts) {
    if (draft.skip || draft.sent) continue;
    last += 1;
    made.push({
      id: serialId('RQ', last),
      plat: tender.plat,
      estId: estimation.id,
      estName: estimation.name,
      client: estimation.client,
      title: draft.title.trim(),
      details: draft.details.trim(),
      area: draft.area,
      urgency: tender.due ? `Tender due ${tender.due}` : '',
      integrations: draft.integrations.trim(),
      name: contact.name.trim(),
      email: contact.email.trim(),
      org: contact.org.trim(),
      at: stamp,
      tender: tender.id,
      tenderReq: draft.reqId
    });
  }
  return made;
}

/* ------------------------------------------------------------------ create */

export interface NewTenderInput {
  plat: string;
  name: string;
  client: string;
  due: string;
  summary: string;
  docs: TenderDocument[];
  fit: PlatformFit | null;
  outline: TenderSection[];
  tokens: TenderTokens;
}

/** A tender as the fit step leaves it: platform chosen, ranges planned, nothing extracted yet. */
export function newTender(input: NewTenderInput, id: string, existing: readonly Pick<Tender, 'plat' | 'slug'>[], stamp: string): Tender {
  return {
    id,
    plat: input.plat,
    name: input.name || 'Untitled tender',
    slug: uniqueSlug(
      input.name,
      existing.filter((one) => one.plat === input.plat).map((one) => one.slug),
      id
    ),
    client: input.client,
    due: input.due,
    summary: input.summary,
    at: stamp,
    up: stamp,
    stage: 'requirements',
    docs: input.docs,
    fit: input.fit,
    outline: input.outline,
    ranges: planRanges(input.docs, input.outline),
    reqs: [],
    estId: '',
    sentAt: '',
    tokens: input.tokens
  };
}

const thousands = (value: number): string => value.toLocaleString('en-US');

/** What the AI has read and written for a tender. Cached reads are billed at a tenth of the rest. */
export function tokenSummary(tokens: TenderTokens): string {
  const read = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  if (read === 0 && tokens.output === 0) return 'No AI calls yet';
  return `AI read ${thousands(read)} tokens (${thousands(tokens.cacheRead)} from cache) and wrote ${thousands(tokens.output)}`;
}

/** How long a document is, in its own unit: "45 pages", "1 part", or that nobody has counted. */
export function documentLength(doc: Pick<TenderDocument, 'kind' | 'pages'>): string {
  if (doc.pages <= 0) return doc.kind === 'text' ? 'parts not counted' : 'pages not counted';
  return plural(doc.pages, doc.kind === 'text' ? 'part' : 'page');
}

/**
 * Documents still held at Anthropic: uploaded, not deleted, and not past their expiry. A file past
 * its 72 hours is gone whether or not anyone deleted it, and treating it as held only produces a
 * failed call and a screen that says the files are still there.
 */
export function heldDocs<T extends Pick<TenderDocument, 'fileId' | 'expiresAt'>>(docs: readonly T[], now: number): T[] {
  return docs.filter((doc) => Boolean(doc.fileId) && !(doc.expiresAt && Date.parse(doc.expiresAt) <= now));
}
