import type { Assignment, EstimateRequest, Estimation, Person } from '../types.js';
import { isDemoEstimation, isDemoRequest } from './demo.js';
import { assignedUsers, personName } from './people.js';
import { ticketStage } from './stages.js';

/**
 * What the bell shows, worked out from the records rather than stored.
 *
 * Each notification follows from something a ticket already records: an assignment keeps who made
 * it and when, a priced request keeps who returned the hours, a request the desk asked about keeps
 * who asked. So nothing extra is written when something happens, and a ticket from before any of
 * this raises nothing: no notification flood on the first day. A notification lasts while what it
 * says is true; unassign someone and theirs goes.
 *
 * Who is told (agreed 2026-09-30): the people assigned, when they are assigned; and about a request
 * getting its hours or being marked Needs info, whoever filed it, the people on it, and the people
 * on its deal. Never the person who did it.
 *
 * What has been read is kept per person in each browser (`markSeen`), never in the store: a synced
 * read mark would save the whole workbook on every click, and while two people work at once a save
 * like that can undo the other's edit.
 */

export type NoticeKind = 'assigned' | 'estimated' | 'info';

export interface Notice {
  /** The same while the event stands, and new for each new event. Read marks are kept against it. */
  key: string;
  kind: NoticeKind;
  /** Username of whoever did it. Blank when a name was typed into the sheet by hand. */
  by: string;
  /** ISO timestamp. Blank when typed into the sheet by hand. */
  at: string;
  /** A deal, or a desk request. */
  ticket: 'deal' | 'request';
  /** The deal's id or the request's. */
  id: string;
  plat: string;
  /** The deal it is about, or the request's deal: what a click opens. */
  estId: string;
  /** The request's title, or the deal's name. */
  title: string;
  /** The deal's name, for a request. */
  deal: string;
  client: string;
  /** The hours returned, on an `estimated` notice. */
  hours?: number;
}

interface Records {
  estimations: readonly Estimation[];
  requests: readonly EstimateRequest[];
}

const on = (list: readonly Assignment[] | undefined, user: string): boolean => assignedUsers(list).includes(user);

/** Newest first; an event with no time (typed into the sheet) last; the key breaks ties so the order never flickers. */
const newestFirst = (a: Notice, b: Notice): number => (a.at === b.at ? (a.key < b.key ? -1 : 1) : a.at < b.at ? 1 : -1);

export function noticesFor(me: string, records: Records, limit = 60): Notice[] {
  if (!me) return [];
  const deals = new Map(records.estimations.map((one) => [one.id, one] as const));
  const out: Notice[] = [];

  for (const deal of records.estimations) {
    if (isDemoEstimation(deal)) continue;
    const mine = (deal.assigned ?? []).find((one) => one.user === me);
    if (!mine || mine.by === me) continue;
    out.push({
      key: `deal:${deal.id}:assigned:${mine.at}`,
      kind: 'assigned',
      by: mine.by,
      at: mine.at,
      ticket: 'deal',
      id: deal.id,
      plat: deal.plat,
      estId: deal.id,
      title: deal.name,
      deal: deal.name,
      client: deal.client
    });
  }

  for (const request of records.requests) {
    if (isDemoRequest(request)) continue;
    const deal = deals.get(request.estId);
    const base = {
      ticket: 'request' as const,
      id: request.id,
      plat: request.plat,
      estId: request.estId,
      title: request.title,
      deal: deal?.name ?? request.estName,
      client: deal?.client ?? request.client
    };

    const mine = (request.assigned ?? []).find((one) => one.user === me);
    if (mine && mine.by !== me) out.push({ ...base, key: `request:${request.id}:assigned:${mine.at}`, kind: 'assigned', by: mine.by, at: mine.at });

    const watching = request.by === me || on(request.assigned, me) || on(deal?.assigned, me);
    if (!watching) continue;

    const hours = Number(request.est);
    if (hours > 0 && request.priced && request.priced.by !== me) {
      out.push({ ...base, key: `request:${request.id}:estimated:${request.priced.at}`, kind: 'estimated', by: request.priced.by, at: request.priced.at, hours });
    }
    if (ticketStage(request) === 'info' && request.staged && request.staged.by !== me) {
      out.push({ ...base, key: `request:${request.id}:info:${request.staged.at}`, kind: 'info', by: request.staged.by, at: request.staged.at });
    }
  }

  return out.sort(newestFirst).slice(0, limit);
}

/** The sentence a notification reads as, without its subject: "Sara Khan assigned you to". */
export function noticeAction(notice: Notice, people: readonly Person[]): { who: string; did: string } {
  const who = notice.by ? personName(people, notice.by) : '';
  if (notice.kind === 'estimated') return { who: who || 'The desk', did: `returned ${notice.hours} h on` };
  if (notice.kind === 'info') return { who: who || 'The desk', did: 'asked for more detail on' };
  return who ? { who, did: 'assigned you to' } : { who: 'You were', did: 'assigned to' };
}

/* ------------------------------------------------------------ read marks */

/** The browser storage key for one person's read marks. Per person, so two people sharing a laptop keep their own. */
export const seenStorageKey = (user: string): string => `quotient-seen-v1:${user}`;

/** Marks kept per person: enough for months of notifications, and a bound on what storage holds. */
export const SEEN_LIMIT = 400;

/** Read marks as browser storage holds them. Anything else is none. */
export function readSeen(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one !== '') : [];
}

/**
 * `seen` with `keys` added, newest last, the oldest dropped past the limit. Marks are never pruned
 * against what is showing: a read that came back without a notice would otherwise forget it was
 * read, and it would come back unread.
 */
export function markSeen(seen: readonly string[], keys: readonly string[]): string[] {
  const added = keys.filter((key) => key && !seen.includes(key));
  if (added.length === 0) return [...seen];
  const next = [...seen, ...new Set(added)];
  return next.slice(Math.max(0, next.length - SEEN_LIMIT));
}

export const unreadNotices = (notices: readonly Notice[], seen: readonly string[]): Notice[] => {
  const read = new Set(seen);
  return notices.filter((notice) => !read.has(notice.key));
};
