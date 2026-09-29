import type {
  Confidence,
  Estimation,
  RequirementPriority,
  SalesLegalCategory,
  SalesLegalItem,
  SalesLegalStatus,
  Tender,
  TenderTerm,
  TermTopic
} from '@/types';
/* relative, not '@/': the server imports this module, and the function bundler does not read tsconfig paths */
import { list, record, text as str, whole as int } from '../lib/narrow.js';
import { highestId, outOfScopeMatches, serialId, sourceLabel } from './tender.js';

/**
 * Sales, account and legal: what a deal commits Edly to that is not software, as pure functions.
 *
 * A tender's out-of-scope requirements, and its key legal and commercial terms when a person asked
 * for them, are obligations someone still has to meet. Until the estimation is created they live on
 * the tender, where a person sorts, accepts or leaves out each one. Creating the estimation copies
 * them into the estimation's own list, which is the record from then on. None of it is priced, and
 * none of it reaches anything the client receives.
 */

/* ------------------------------------------------------------- vocabulary */

export interface CategoryInfo {
  id: SalesLegalCategory;
  label: string;
  /** What belongs here. The sort call reads the same words, so the screen and the AI agree. */
  hint: string;
}

export const SALES_LEGAL_CATEGORIES: readonly CategoryInfo[] = [
  { id: 'sales', label: 'Sales and commercial', hint: 'pricing, fees, rebates, invoicing and its accuracy, spend and pricing reports, service credits' },
  { id: 'account', label: 'Account management', hint: 'account and contract managers, business reviews, KPI reporting, satisfaction surveys, work plans, outreach and events' },
  {
    id: 'legal',
    label: 'Legal and compliance',
    hint: 'confidentiality, data protection and privacy law, breach notice, records and their retention, public information requests, subcontractor flow-down, codes of conduct, audit rights, data deletion'
  },
  { id: 'people', label: 'People and staffing', hint: 'background checks, training staff must take, rules for staff on site, named representatives, staffing levels' },
  { id: 'certification', label: 'Certification', hint: 'security or compliance certifications the supplier must hold, and evidence of them' }
];

const CATEGORY_IDS: readonly SalesLegalCategory[] = SALES_LEGAL_CATEGORIES.map((one) => one.id);

export const categoryLabel = (category: SalesLegalCategory | ''): string =>
  SALES_LEGAL_CATEGORIES.find((one) => one.id === category)?.label ?? 'Not sorted yet';

export const SALES_LEGAL_STATUSES: readonly { id: SalesLegalStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'handled', label: 'Handled' },
  { id: 'not-ours', label: 'Not for us' }
];

export const statusLabel = (status: SalesLegalStatus): string => SALES_LEGAL_STATUSES.find((one) => one.id === status)?.label ?? 'Open';

/** The teams an item can go to. A person's name works as well; these are only the quick picks. */
export const OWNERS: readonly string[] = ['Sales', 'Account', 'Legal', 'Delivery'];

export const TERM_TOPICS: readonly { id: TermTopic; label: string; category: SalesLegalCategory }[] = [
  { id: 'insurance', label: 'Insurance', category: 'legal' },
  { id: 'liability', label: 'Liability', category: 'legal' },
  { id: 'indemnity', label: 'Indemnity', category: 'legal' },
  { id: 'payment', label: 'Payment and invoicing', category: 'sales' },
  { id: 'ip', label: 'Intellectual property', category: 'legal' },
  { id: 'warranty', label: 'Warranties', category: 'legal' },
  { id: 'termination', label: 'Termination and exit', category: 'legal' },
  { id: 'renewal', label: 'Term and renewal', category: 'legal' },
  { id: 'service-credits', label: 'Service credits', category: 'sales' },
  { id: 'law', label: 'Governing law and disputes', category: 'legal' },
  { id: 'other', label: 'Other terms', category: 'legal' }
];

const TOPIC_IDS: readonly TermTopic[] = TERM_TOPICS.map((one) => one.id);

export const topicLabel = (topic: TermTopic): string => TERM_TOPICS.find((one) => one.id === topic)?.label ?? 'Other terms';

/** A term's topic as the sheet hands it back: its label or its id, in any case. Undefined for anything else. */
export function readTopic(value: unknown): TermTopic | undefined {
  const key = String(value ?? '').toLowerCase().replace(/[^a-z]+/g, '');
  if (!key) return undefined;
  return TERM_TOPICS.find((one) => one.id.replace(/[^a-z]+/g, '') === key || one.label.toLowerCase().replace(/[^a-z]+/g, '') === key)?.id;
}

/* ------------------------------------------------ reading the sheet back */

/* letters only, lower case: "Not for us", "not-ours" and "NOT OURS" all read the same */
const squash = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '');

/**
 * A category as a person may have typed it into the sheet: its label, its id, or the label's first
 * word ("Legal"), in any case. '' for anything else, which the screen lists as not sorted yet.
 */
export function readCategory(value: unknown): SalesLegalCategory | '' {
  const key = squash(value);
  if (!key) return '';
  const found = SALES_LEGAL_CATEGORIES.find((one) => {
    const first = squash(one.label.split(' ')[0]);
    return squash(one.label) === key || squash(one.id) === key || (first !== '' && key.startsWith(first));
  });
  return found?.id ?? '';
}

/**
 * A status as a person may have typed it into the sheet. Anything unreadable is Open: an item nobody
 * can place is one somebody still has to look at.
 */
export function readStatus(value: unknown): SalesLegalStatus {
  const key = squash(value);
  if (key === 'handled' || key === 'done' || key === 'closed') return 'handled';
  if (key === 'notforus' || key === 'notours' || key === 'na' || key === 'notapplicable') return 'not-ours';
  return 'open';
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
/** Excel counts days from 30 December 1899, and the reader hands a date typed in Excel back as that count. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const pad = (n: number): string => String(n).padStart(2, '0');

function isoDay(year: number, month: number, day: number): string {
  const at = new Date(Date.UTC(year, month - 1, day));
  /* 2026-02-31 rolls into March; a date that rolls is not the date the person meant */
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return '';
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * A due date, as yyyy-mm-dd, from however the sheet hands it back. The app writes yyyy-mm-dd, but a
 * person editing the sheet types a date, and Excel keeps that as a day count while Google Sheets
 * hands back what it displays. A slashed date is read month first, Google Sheets' default, unless
 * the first number cannot be a month. '' for anything that is not a date.
 */
export function readDay(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const iso = ISO_DAY.exec(raw);
  if (iso) return isoDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const at = new Date(EXCEL_EPOCH + Math.floor(Number(raw)) * 86_400_000);
    return isoDay(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
  }
  const slashed = SLASHED.exec(raw);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    const year = Number(slashed[3]);
    return first > 12 ? isoDay(year, second, first) : isoDay(year, first, second);
  }
  /* "12 Oct 2026", "October 12, 2026": no number in them can be misread, so the parser is safe here */
  if (!/[a-z]/i.test(raw)) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return isoDay(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

/* ------------------------------------------------------ before the estimation */

/** One item as the tender offers it, before and after the estimation exists. */
export interface SalesLegalDraft {
  /** The requirement (R-14) or term (T-03) it is. */
  key: string;
  kind: 'obligation' | 'term';
  category: SalesLegalCategory | '';
  text: string;
  quote: string;
  source: string;
  /** The heading it sits under in the tender. */
  section: string;
  priority: RequirementPriority;
  /** For an obligation, why it is out of scope, as the matcher put it. */
  reason: string;
  /** How sure the matcher was that it is not software work. Terms have none. */
  confidence?: Confidence;
  /** For a term, what it is about. */
  topic?: TermTopic;
  /** An obligation's match was accepted by a person, as every match must be to reach the estimation. A term needs no acceptance. */
  accepted: boolean;
  /** A person left it out of the estimation's list. */
  skip: boolean;
  /** It is on the estimation's list already. */
  copied: boolean;
}

/**
 * Everything a tender has for the sales, account and legal teams: each approved requirement matched
 * as out of scope, then each key term read for the legal team. `copied` holds the ones already on
 * the estimation's list (`copiedItems`), so they are never offered twice.
 */
export function salesLegalDrafts(tender: Pick<Tender, 'reqs' | 'docs' | 'terms'>, copied: ReadonlySet<string> = new Set()): SalesLegalDraft[] {
  const drafts: SalesLegalDraft[] = [];
  for (const req of tender.reqs) {
    const match = req.match;
    if (req.status !== 'approved' || match?.kind !== 'out') continue;
    drafts.push({
      key: req.id,
      kind: 'obligation',
      category: match.category ?? '',
      text: req.text,
      quote: req.quote,
      source: sourceLabel(req, tender.docs),
      section: req.section,
      priority: req.priority,
      reason: match.reason,
      confidence: match.confidence,
      accepted: match.approved,
      skip: Boolean(match.skip),
      copied: copied.has(req.id)
    });
  }
  for (const term of tender.terms ?? []) {
    drafts.push({
      key: term.id,
      kind: 'term',
      category: term.category,
      text: term.text,
      quote: term.quote,
      source: sourceLabel(term, tender.docs),
      section: '',
      /* a contract term binds whoever signs it */
      priority: 'must',
      reason: '',
      topic: term.topic,
      accepted: true,
      skip: Boolean(term.skip),
      copied: copied.has(term.id)
    });
  }
  return drafts;
}

/** Whether a draft is copied the next time the estimation takes the tender's items. */
export const goesWithEstimation = (draft: Pick<SalesLegalDraft, 'accepted' | 'skip' | 'copied'>): boolean => draft.accepted && !draft.skip && !draft.copied;

/** The requirements and terms of a tender already on an estimation's list, so copying twice cannot duplicate one. */
export function copiedItems(items: readonly Pick<SalesLegalItem, 'tender' | 'tenderItem'>[], tenderId: string): Set<string> {
  return new Set(items.filter((item) => item.tender === tenderId && item.tenderItem).map((item) => item.tenderItem));
}

/**
 * The records the estimation takes from its tender: every draft accepted, kept in and not yet copied,
 * numbered after the items that exist. The reducer and the apply step's count call this on the same
 * state, so the number a person reads is the number stored.
 */
export function salesLegalItems(
  existing: readonly Pick<SalesLegalItem, 'id'>[],
  tender: Pick<Tender, 'id' | 'plat'>,
  drafts: readonly SalesLegalDraft[],
  estimation: Pick<Estimation, 'id'>,
  stamp: string
): SalesLegalItem[] {
  let last = highestId('SL', existing.map((item) => item.id));
  return drafts.filter(goesWithEstimation).map((draft): SalesLegalItem => {
    last += 1;
    return {
      id: serialId('SL', last),
      plat: tender.plat,
      estId: estimation.id,
      tender: tender.id,
      tenderItem: draft.key,
      category: draft.category,
      kind: draft.kind,
      text: draft.text,
      quote: draft.quote,
      source: draft.source,
      /* everything the match step showed, so the teams see why it is theirs without the tender */
      section: draft.section,
      reason: draft.reason,
      ...(draft.topic ? { topic: draft.topic } : {}),
      priority: draft.priority,
      owner: '',
      status: 'open',
      due: '',
      note: '',
      at: stamp,
      up: stamp
    };
  });
}

/* ------------------------------------------------------- on the estimation */

/** Longest note kept. A note is a line for a colleague, and a cell holds far more, but not endlessly more. */
export const NOTE_MAX = 4000;
const TEXT_MAX = 800;
const OWNER_MAX = 80;

export interface HandItemInput {
  text: string;
  category: SalesLegalCategory | '';
  owner: string;
  due: string;
  note: string;
  priority: RequirementPriority;
}

/** An item a person typed in, on any estimation. Null when there is nothing to it. */
export function handItem(
  existing: readonly Pick<SalesLegalItem, 'id'>[],
  input: HandItemInput,
  estimation: Pick<Estimation, 'id' | 'plat'>,
  stamp: string
): SalesLegalItem | null {
  const text = input.text.trim().slice(0, TEXT_MAX);
  if (!text) return null;
  return {
    id: serialId('SL', highestId('SL', existing.map((item) => item.id)) + 1),
    plat: estimation.plat || 'openedx',
    estId: estimation.id,
    tender: '',
    tenderItem: '',
    category: CATEGORY_IDS.includes(input.category as SalesLegalCategory) ? input.category : '',
    kind: 'obligation',
    text,
    quote: '',
    source: '',
    section: '',
    reason: '',
    priority: input.priority === 'should' ? 'should' : 'must',
    owner: input.owner.trim().slice(0, OWNER_MAX),
    status: 'open',
    due: readDay(input.due),
    note: input.note.trim().slice(0, NOTE_MAX),
    at: stamp,
    up: stamp
  };
}

/** What a person may change on an item. Where it came from stays as it was copied. */
export type SalesLegalPatch = Partial<Pick<SalesLegalItem, 'owner' | 'status' | 'due' | 'note' | 'category' | 'text' | 'priority'>>;

/**
 * An item with a person's change applied, or the same object when nothing changed, so a field left
 * without typing is not an edit. The text of an item from a tender is the tender's and stays.
 */
export function patchItem(item: SalesLegalItem, patch: SalesLegalPatch, stamp: string): SalesLegalItem {
  const next: SalesLegalItem = { ...item };
  if (patch.owner !== undefined) next.owner = patch.owner.trim().slice(0, OWNER_MAX);
  if (patch.note !== undefined) next.note = patch.note.trim().slice(0, NOTE_MAX);
  if (patch.due !== undefined) next.due = readDay(patch.due);
  if (patch.status !== undefined && SALES_LEGAL_STATUSES.some((one) => one.id === patch.status)) next.status = patch.status;
  if (patch.category !== undefined && (patch.category === '' || CATEGORY_IDS.includes(patch.category))) next.category = patch.category;
  if (patch.priority !== undefined) next.priority = patch.priority === 'should' ? 'should' : 'must';
  if (patch.text !== undefined && !item.tender && patch.text.trim()) next.text = patch.text.trim().slice(0, TEXT_MAX);
  const same = (Object.keys(next) as (keyof SalesLegalItem)[]).every((key) => next[key] === item[key]);
  return same ? item : { ...next, up: stamp };
}

export interface SalesLegalCounts {
  total: number;
  open: number;
  handled: number;
  notOurs: number;
  /** No category yet. */
  unsorted: number;
  /** Open and past its due date. */
  overdue: number;
}

export function salesLegalCounts(items: readonly Pick<SalesLegalItem, 'status' | 'category' | 'due'>[], day: string): SalesLegalCounts {
  const counts: SalesLegalCounts = { total: items.length, open: 0, handled: 0, notOurs: 0, unsorted: 0, overdue: 0 };
  for (const item of items) {
    if (item.status === 'open') counts.open += 1;
    else if (item.status === 'handled') counts.handled += 1;
    else counts.notOurs += 1;
    if (!item.category) counts.unsorted += 1;
    if (item.status === 'open' && item.due && item.due < day) counts.overdue += 1;
  }
  return counts;
}

/** Open items per estimation, counted in one pass, for a list of deals that each show their count. */
export function openByEstimation(items: readonly Pick<SalesLegalItem, 'estId' | 'status'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) if (item.status === 'open') counts.set(item.estId, (counts.get(item.estId) ?? 0) + 1);
  return counts;
}

/**
 * Whether a person may delete an item. One typed by hand, yes. One from a tender that still exists
 * is marked Not for us instead: deleted, the tender would offer it to the estimation again as new.
 * Once its tender is gone nothing can offer it again, so it may go.
 */
export const deletable = (item: Pick<SalesLegalItem, 'tender'>, tenderIds: ReadonlySet<string>): boolean => !item.tender || !tenderIds.has(item.tender);

/** Items by category, in the order the categories are listed, with anything not sorted yet last. Empty groups are left out. */
export function byCategory<T extends { category: SalesLegalCategory | '' }>(items: readonly T[]): { category: SalesLegalCategory | ''; label: string; items: T[] }[] {
  const order: (SalesLegalCategory | '')[] = [...CATEGORY_IDS, ''];
  return order
    .map((category) => ({ category, label: categoryLabel(category), items: items.filter((item) => (CATEGORY_IDS.includes(item.category as SalesLegalCategory) ? item.category : '') === category) }))
    .filter((group) => group.items.length > 0);
}

/* ------------------------------------------------------------- the sort call */

/** An item as the sort call describes it: its words and why it is out of scope. No documents, no catalog. */
export interface SortInput {
  id: string;
  text: string;
  section: string;
  reason: string;
}

/**
 * Out-of-scope requirements nobody has put in a team yet, as the sort call sends them. The ones
 * flagged at extraction count too, as `outOfScopeMatches` will settle them without the AI.
 *
 * `copies` says what to do about one already copied to the estimation, where it is the record.
 * `skip` leaves every copy out: the sort that follows matching runs with no click, and the AI does
 * not write to an estimation on its own. `unsorted` takes a copy that has no team, because a person
 * pressed Sort them; a team a person chose there is never asked about.
 */
export function needsSorting(
  tender: Pick<Tender, 'id' | 'reqs'>,
  items: readonly Pick<SalesLegalItem, 'tender' | 'tenderItem' | 'category'>[] = [],
  copies: 'skip' | 'unsorted' = 'skip'
): SortInput[] {
  const settled = outOfScopeMatches(tender);
  const mine = items.filter((item) => item.tender === tender.id);
  const leave = new Set((copies === 'skip' ? mine : mine.filter((item) => item.category)).map((item) => item.tenderItem));
  return tender.reqs.flatMap((req) => {
    const match = req.match ?? settled[req.id];
    const copy = mine.find((item) => item.tenderItem === req.id);
    /* a copy with no team counts as unsorted whatever the tender's match says, so a click can fill it in */
    const sorted = copy ? Boolean(copy.category) : Boolean(match?.category);
    if (req.status !== 'approved' || match?.kind !== 'out' || sorted || leave.has(req.id)) return [];
    return [{ id: req.id, text: req.text, section: req.section, reason: match.reason }];
  });
}

/**
 * The sort call's answer, narrowed: an id that was not asked about, or a category that is not one of
 * the five, is dropped rather than guessed at, and the first answer for an id is the one kept.
 */
export function readCategories(input: unknown, ids: readonly string[]): Record<string, SalesLegalCategory> {
  const wanted = new Set(ids);
  const categories: Record<string, SalesLegalCategory> = {};
  for (const entry of list(record(input).items).map(record)) {
    const id = str(entry.id, 40);
    const category = CATEGORY_IDS.find((one) => one === entry.category);
    if (!wanted.has(id) || categories[id] || !category) continue;
    categories[id] = category;
  }
  return categories;
}

/* ------------------------------------------------------------ the terms call */

/** A term as read, before it has an id. */
export type ExtractedTerm = Omit<TenderTerm, 'id' | 'skip'>;

/**
 * One document's key terms, narrowed. The team a term goes to follows from what it is about
 * (payment and service credits to sales, the rest to legal), so the model is not asked for both.
 */
export function readTerms(input: unknown, doc: number, docPages: number): ExtractedTerm[] {
  const found: ExtractedTerm[] = [];
  for (const entry of list(record(input).terms).map(record)) {
    const text = str(entry.text, 600);
    if (!text) continue;
    const topic = TOPIC_IDS.find((one) => one === entry.topic) ?? 'other';
    const page = int(entry.page);
    const ref = str(entry.ref, 80);
    found.push({
      doc,
      page: page >= 1 && (docPages === 0 || page <= docPages) ? page : 0,
      topic,
      text,
      quote: str(entry.quote, 600),
      category: TERM_TOPICS.find((one) => one.id === topic)?.category ?? 'legal',
      ...(ref ? { ref } : {})
    });
  }
  return found;
}

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Adds one document's terms, skipping any whose wording is already there, numbered after the highest `T-` id. */
export function addTerms(existing: readonly TenderTerm[], found: readonly ExtractedTerm[]): { terms: TenderTerm[]; added: number } {
  const seen = new Set(existing.map((term) => normalise(term.text)));
  const terms = [...existing];
  let last = highestId('T', existing.map((term) => term.id));
  let added = 0;
  for (const one of found) {
    const key = normalise(one.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    last += 1;
    terms.push({ ...one, id: serialId('T', last) });
    added += 1;
  }
  return { terms, added };
}
