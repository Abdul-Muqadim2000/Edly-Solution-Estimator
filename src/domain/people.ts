import type { Assignment, Auth, Person, Role, TicketEvent } from '../types.js';

/**
 * People and who is on what. Pure, so the rules are tested with plain objects; the server checks
 * passwords (`server/users.ts`), and nothing here ever sees one.
 *
 * A username is fixed once created, like a slug: assignments, the sheet's `assignedTo` column and
 * every read mark point at it, so renaming one would quietly unassign someone. The display name,
 * the role and the password can change.
 */

/** The built-in admin account. Never a created user's name, and the only account that manages users. */
export const ADMIN_USER = 'admin';

/** Whether this session is the built-in admin: the one account that can switch workspace and manage users. */
export const isAdmin = (auth: Pick<Auth, 'user'> | null | undefined): boolean => auth?.user === ADMIN_USER;

/** 2 to 32 lower-case letters, digits, dots, dashes or underscores, starting with a letter or digit. */
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/** A username as typed: "@Muqadim " is `muqadim`. */
export const normalUsername = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();

/** Why this username cannot be created, or null when it can. */
export function usernameProblem(value: string, taken: readonly string[]): string | null {
  const name = normalUsername(value);
  if (!name) return 'Give them a username.';
  if (name === ADMIN_USER) return '"admin" is the built-in admin account.';
  if (!USERNAME.test(name)) return 'Use 2 to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit.';
  if (taken.includes(name)) return `@${name} is already taken.`;
  return null;
}

export const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;

/** Why this password cannot be set, or null when it can. */
export function passwordProblem(value: string): string | null {
  if (value.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (value.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  return null;
}

/** A role as someone typed it into the Users sheet: "Estimator", "estimation desk", "Desk". Anything else is sales. */
export function readRole(value: unknown): Role {
  return /^(estimat|desk)/.test(String(value ?? '').trim().toLowerCase()) ? 'estimator' : 'sales';
}

export const roleLabel = (role: Role): string => (role === 'estimator' ? 'Estimator' : 'Sales');

/**
 * What to call someone in a sentence. The admin is "Admin", a person on the list is their display
 * name, and a username no longer on it (removed, or typed into the sheet by hand) is shown as
 * written, so the ticket still says who it was.
 */
export function personName(people: readonly Person[], username: string): string {
  if (!username) return 'Someone';
  if (username === ADMIN_USER) return 'Admin';
  return people.find((one) => one.username === username)?.name || `@${username}`;
}

/** Two letters for an avatar: first and last word of a name, or the first two letters of a single word. */
export function initials(name: string): string {
  const words = name
    .replace(/^@+/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] ?? '' : '';
  const pair = last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2);
  return pair.toUpperCase() || '?';
}

/**
 * The people an @ is looking for, best first: the exact username, then usernames starting with what
 * was typed, then names with a word starting with it, then anything containing it. Those already on
 * the ticket are left out, so the list only offers someone who can still be added.
 */
export function matchPeople(people: readonly Person[], typed: string, exclude: readonly string[] = [], limit = 8): Person[] {
  const needle = normalUsername(typed);
  const pool = people.filter((one) => !exclude.includes(one.username));
  const byName = (a: Person, b: Person): number => a.name.localeCompare(b.name) || a.username.localeCompare(b.username);
  if (!needle) return [...pool].sort(byName).slice(0, limit);
  const rank = (one: Person): number => {
    const name = one.name.toLowerCase();
    if (one.username === needle) return 0;
    if (one.username.startsWith(needle)) return 1;
    if (name.split(/\s+/).some((word) => word.startsWith(needle))) return 2;
    if (one.username.includes(needle) || name.includes(needle)) return 3;
    return -1;
  };
  return pool
    .map((one) => ({ one, at: rank(one) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at || byName(a.one, b.one))
    .slice(0, limit)
    .map((hit) => hit.one);
}

/**
 * A ticket's people after someone set the list to `users`. Anyone already on it keeps who put them
 * there and when, so re-saving the same list is not a new assignment and raises no notification.
 */
export function nextAssignments(current: readonly Assignment[] | undefined, users: readonly string[], by: string, at: string): Assignment[] {
  const was = new Map((current ?? []).map((one) => [one.user, one] as const));
  const out: Assignment[] = [];
  for (const raw of users) {
    const user = normalUsername(raw);
    if (!user || out.some((one) => one.user === user)) continue;
    out.push(was.get(user) ?? { user, by, at });
  }
  return out;
}

export const assignedUsers = (list: readonly Assignment[] | undefined): string[] => (list ?? []).map((one) => one.user);

/** The same people, in the same order: nothing to change or save. */
export const sameAssignees = (list: readonly Assignment[] | undefined, users: readonly string[]): boolean => {
  const now = assignedUsers(list);
  const next = users.map(normalUsername).filter((user, index, all) => user && all.indexOf(user) === index);
  return now.length === next.length && now.every((user, index) => user === next[index]);
};

/* ------------------------------------------------------------ the sheet */

/** The readable column: "@muqadim, @sara". */
export const assignedLabel = (list: readonly Assignment[] | undefined): string => (list ?? []).map((one) => `@${one.user}`).join(', ');

/** The JSON beside it, holding who assigned each and when. */
export const assignedDetail = (list: readonly Assignment[] | undefined): string => ((list ?? []).length > 0 ? JSON.stringify(list) : '');

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The people on a ticket, as the sheet holds them. The readable column says who, because someone
 * may have typed "@sara" there or taken a name out; the JSON says who assigned each person still
 * named, and when. A name typed by hand has neither.
 *
 * Entries are split on commas, semicolons and new lines. A single word is a username, with or
 * without its @; inside a longer entry only the words that start with @ are, so "Sara Khan" typed
 * there assigns nobody rather than @sara and @khan.
 */
export function readAssigned(column: unknown, detail: unknown): Assignment[] {
  let parsed: unknown = detail;
  if (typeof detail === 'string') {
    try {
      parsed = detail ? JSON.parse(detail) : [];
    } catch {
      parsed = [];
    }
  }
  const known = new Map<string, Assignment>();
  if (Array.isArray(parsed)) {
    for (const item of parsed as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const one = item as Record<string, unknown>;
      const user = normalUsername(one.user);
      if (user && !known.has(user)) known.set(user, { user, by: text(one.by), at: text(one.at) });
    }
  }
  const out: Assignment[] = [];
  for (const entry of String(column ?? '').split(/[,;\n]+/)) {
    const words = entry.trim().split(/\s+/).filter(Boolean);
    const named = words.length === 1 ? words : words.filter((word) => word.startsWith('@'));
    for (const word of named) {
      const user = normalUsername(word);
      if (!USERNAME.test(user) || out.some((one) => one.user === user)) continue;
      out.push(known.get(user) ?? { user, by: '', at: '' });
    }
  }
  return out;
}

/** Who did something and when, from a JSON column. Anything else is no event. */
export function readEvent(value: unknown): TicketEvent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const one = value as Record<string, unknown>;
  const by = normalUsername(one.by);
  const at = text(one.at);
  return by || at ? { by, at } : undefined;
}
