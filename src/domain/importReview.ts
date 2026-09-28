/**
 * The review step both imports share: what a file would do, laid out as groups a person decides.
 *
 * A group is a set of rows the file sends to one place: an existing bundle, a bundle the catalog
 * does not have yet, or Unassigned. Each group is approved or left out, can be sent somewhere
 * else, and a new one can be renamed. Inside a group, a single row can be moved or left out.
 * Nothing is imported while a group is still pending.
 *
 * Decisions are kept as a plain object keyed by group and by row, so the preview and the import
 * are worked out by the same pure function from the same decisions, and a test can hold either.
 */

export type GroupStatus = 'pending' | 'approved' | 'skipped';

export type GroupKind =
  /** Rows the file sends to a bundle the catalog already has. */
  | 'existing'
  /** A bundle the catalog does not have. */
  | 'new'
  /** A bundle whose ID the catalog already uses for a different bundle. */
  | 'clash'
  /** Estimates with no Area and no Bundle ID. */
  | 'unassigned';

export interface GroupDecision {
  status?: GroupStatus;
  /** A destination key; absent means where the file puts it. */
  to?: string;
  /** A new bundle's name, when it has been renamed. */
  name?: string;
}

export interface RowDecision {
  /** A destination key; absent means wherever its group goes. */
  to?: string;
  skip?: boolean;
}

export interface ImportReview {
  groups: Record<string, GroupDecision>;
  rows: Record<string, RowDecision>;
}

export const EMPTY_REVIEW: ImportReview = { groups: {}, rows: {} };

export interface ReviewRow {
  key: string;
  title: string;
  detail: string;
  /** The Notes / Assumptions it will carry, so a person reads them before approving. Blank for none. */
  notes: string;
  hours: number | null;
  /** The row's own destination, when moved. */
  to: string | null;
  skip: boolean;
  /** Where it will land, in words: "B15 · Platform Engineering", "Left out". */
  lands: string;
}

export interface ReviewGroup {
  key: string;
  kind: GroupKind;
  /** What the file calls it: "B15 · Platform Engineering", "Mobile Apps". */
  label: string;
  /** The name it will have, for a group that makes its own bundle. */
  name: string;
  renameable: boolean;
  status: GroupStatus;
  to: string;
  /** Where its rows land when not moved, in words. */
  lands: string;
  /** Something to know before approving; blank when there is nothing. */
  note: string;
  /** Why it cannot be approved as it stands; blank when it can. */
  blocked: string;
  rows: ReviewRow[];
  hours: number;
}

export interface Destination {
  key: string;
  label: string;
}

export interface ReviewSummary {
  groups: ReviewGroup[];
  destinations: Destination[];
  /** Groups still waiting for a decision. */
  pending: number;
  /** Rows that will be imported. */
  included: number;
  /** Rows left out, one by one or with their group. */
  leftOut: number;
}

export const LEFT_OUT = 'Left out';
export const WAITING = 'Waiting for its group';

/** One group's decision changed, the rest kept. */
export function setGroup(review: ImportReview, key: string, patch: GroupDecision): ImportReview {
  return { ...review, groups: { ...review.groups, [key]: { ...review.groups[key], ...patch } } };
}

/** One row's decision changed. Moving a row back to its group clears the move rather than storing it. */
export function setRow(review: ImportReview, key: string, patch: RowDecision): ImportReview {
  const next: RowDecision = { ...review.rows[key], ...patch };
  if (!next.to) delete next.to;
  if (!next.skip) delete next.skip;
  const rows = { ...review.rows };
  if (Object.keys(next).length === 0) delete rows[key];
  else rows[key] = next;
  return { ...review, rows };
}

/** Every group still pending approved, except one that cannot be approved as it stands. */
export function approveAll(review: ImportReview, groups: readonly ReviewGroup[]): ImportReview {
  let next = review;
  for (const group of groups) {
    if (group.status === 'pending' && !group.blocked) next = setGroup(next, group.key, { status: 'approved' });
  }
  return next;
}

/** Follow `to` through groups that send their rows on, stopping at a loop rather than spinning. */
export function followGroups(start: string, next: (key: string) => string | null): string {
  const seen = new Set<string>();
  let key = start;
  while (!seen.has(key)) {
    seen.add(key);
    const onward = next(key);
    if (!onward || onward === key) return key;
    key = onward;
  }
  return key;
}
