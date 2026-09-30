import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Person } from '../src/types.js';
import type { CellValue, SheetTable } from '../src/lib/xlsx.js';
import { ADMIN_USER, normalUsername, readRole, roleLabel, usernameProblem } from '../src/domain/people.js';
import { objects } from './schema.js';

/**
 * The accounts people sign in with, in the store's `Users` tab.
 *
 * Only this file and `api/users.ts` handle a password or its hash. The tab holds a salted PBKDF2
 * hash, never the password, and nothing that reads it sends the hash anywhere: `/api/state` hands
 * browsers `publicPeople`, and a state save never writes this tab (`saveState` in store.ts).
 *
 * The built-in admin is not a row. Its password is `EDLY_ADMIN_PASSWORD`, `admin` when that is
 * unset, so the demo sign-in keeps working on a store with no accounts in it.
 */

export const USERS_SHEET = 'Users';

/* the hash goes last, so the columns a person reads come first when the tab is opened */
export const USER_COLUMNS = ['username', 'name', 'role', 'created', 'updated', 'passwordHash'] as const;

export interface UserRecord extends Person {
  /** ISO yyyy-mm-dd. */
  created: string;
  updated: string;
  /** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, base64. Blank: cannot sign in until the admin sets a password. */
  hash: string;
}

/* ----------------------------------------------------------- the sheet */

export function usersToRows(users: readonly UserRecord[]): CellValue[][] {
  return [[...USER_COLUMNS], ...users.map((one) => [one.username, one.name, roleLabel(one.role), one.created, one.updated, one.hash])];
}

/**
 * Accounts as the tab holds them, read by column name and forgiving, because the tab can be edited
 * by hand: a role typed as "estimator" or "Desk", a username typed with its @. A row whose username
 * could not be created (blank, malformed, `admin`) is skipped, and so is a second row for the same
 * username: the first one is the account, so a pasted duplicate cannot take it over.
 */
export function rowsToUsers(table: SheetTable | undefined): UserRecord[] {
  const out: UserRecord[] = [];
  for (const row of objects(table)) {
    const username = normalUsername(row.username);
    if (usernameProblem(username, out.map((one) => one.username)) !== null) continue;
    out.push({
      username,
      name: String(row.name ?? '').trim() || username,
      role: readRole(row.role),
      created: String(row.created ?? '').trim(),
      updated: String(row.updated ?? '').trim(),
      hash: String(row.passwordHash ?? '').trim()
    });
  }
  return out;
}

/** What every browser is told about the accounts: who they are, never how they sign in. Sorted by name. */
export function publicPeople(users: readonly UserRecord[]): Person[] {
  return users
    .map((one) => ({ username: one.username, name: one.name, role: one.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username));
}

/* ------------------------------------------------------------ passwords */

const derive = promisify(pbkdf2);

/** OWASP's figure for PBKDF2-SHA256 (2023). About 50 ms under Bun, so a sign-in does not feel it. */
export const ITERATIONS = 600_000;
const KEY_BYTES = 32;

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, iterations, KEY_BYTES, 'sha256');
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Stands in for a missing account, so a wrong username takes as long to refuse as a wrong password. */
const DECOY = 'pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** Whether `password` is the one `stored` was made from. A blank or malformed hash matches nothing. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored || DECOY).split('$');
  const [scheme, rounds, salt, hash] = parts;
  const iterations = Number(rounds);
  if (parts.length !== 4 || scheme !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 1 || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  if (expected.length !== KEY_BYTES) return false;
  const key = await derive(password, Buffer.from(salt, 'base64'), iterations, KEY_BYTES, 'sha256');
  return timingSafeEqual(key, expected) && Boolean(stored);
}

/* ------------------------------------------------------------ the admin */

export const adminPassword = (): string => process.env.EDLY_ADMIN_PASSWORD || 'admin';

/** Whether the admin password is still the one everybody knows, so the sign-in screen may say so. */
export const defaultAdmin = (): boolean => !process.env.EDLY_ADMIN_PASSWORD || process.env.EDLY_ADMIN_PASSWORD === 'admin';

/** Compared in constant time, so the answer's timing does not give the password away a letter at a time. */
function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const isAdminLogin = (username: string, password: string): boolean => normalUsername(username) === ADMIN_USER && same(password, adminPassword());

/**
 * Whether a request carries the admin's credentials, as `Authorization: Basic base64(admin:password)`.
 * Every change to the accounts asks for this; the admin panel holds the password in memory only.
 */
export function isAdminRequest(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(match[1] ?? '', 'base64').toString('utf8');
  } catch {
    return false;
  }
  const cut = decoded.indexOf(':');
  return cut > 0 && isAdminLogin(decoded.slice(0, cut), decoded.slice(cut + 1));
}
