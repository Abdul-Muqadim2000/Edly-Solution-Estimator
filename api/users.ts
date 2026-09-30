import { loadUsers, saveUsers, storeKind } from '../server/store.js';
import { json, universal } from '../server/handler.js';
import {
  defaultAdmin,
  hashPassword,
  isAdminLogin,
  isAdminRequest,
  publicPeople,
  verifyPassword,
  type UserRecord
} from '../server/users.js';
import { ADMIN_USER, normalUsername, passwordProblem, readRole, usernameProblem } from '../src/domain/people.js';
import { today } from '../src/lib/format.js';

/**
 * The accounts.
 *
 * GET  /api/users                      whether the admin password is still the default one
 * GET  /api/users   (admin)            every account, without its hash
 * POST /api/users   { op: 'signIn', username, password }
 * POST /api/users   (admin) { op: 'create', username, name, role, password }
 * POST /api/users   (admin) { op: 'update', username, name?, role?, password? }
 * POST /api/users   (admin) { op: 'remove', username }
 *
 * "(admin)" is `Authorization: Basic base64(admin:<password>)`, checked on every call. A signed-in
 * session is not checked by anything else on the server: `/api/state` stays open (CLAUDE.md,
 * Known limits), so the passwords keep people out of the app, not out of the API.
 */

/**
 * What the admin panel lists: whether there is a hash, never the hash. Each field is named rather
 * than spread, so a field added to the record later is not sent until someone decides it may be.
 */
const listed = (users: readonly UserRecord[]) =>
  users.map((one) => ({ username: one.username, name: one.name, role: one.role, created: one.created, updated: one.updated, hasPassword: Boolean(one.hash) }));

const WRONG = 'Wrong username or password.';

export async function handle(request: Request): Promise<Response> {
  try {
    if (request.method === 'GET') {
      if (!request.headers.get('authorization')) return json({ ok: true, defaultAdmin: defaultAdmin() });
      if (!isAdminRequest(request)) return json({ ok: false, error: 'The admin password is wrong.' }, 401);
      return json({ ok: true, store: storeKind(), users: listed(await loadUsers()) });
    }

    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: 'Body must be a JSON object' }, 400);
    }
    const op = String(body.op ?? '');
    const username = normalUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';

    if (op === 'signIn') {
      /* the admin first, and without the store: it has to get in to see what is wrong with one */
      if (isAdminLogin(username, password)) return json({ ok: true, user: { username: ADMIN_USER, name: 'Admin', admin: true } });
      const account = (await loadUsers()).find((one) => one.username === username);
      /* one answer for a wrong username and a wrong password, and the same work for both */
      const good = await verifyPassword(password, account?.hash ?? '');
      if (!account || !good) return json({ ok: false, error: WRONG }, 401);
      return json({ ok: true, user: { username: account.username, name: account.name, role: account.role } });
    }

    if (op !== 'create' && op !== 'update' && op !== 'remove') return json({ ok: false, error: `Unknown op "${op}"` }, 400);
    if (!isAdminRequest(request)) return json({ ok: false, error: 'The admin password is wrong.' }, 401);

    const users = await loadUsers();
    const at = users.findIndex((one) => one.username === username);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : undefined;

    if (op === 'create') {
      const problem =
        usernameProblem(username, users.map((one) => one.username)) ?? (name ? null : 'Give them a name.') ?? passwordProblem(password);
      if (problem) return json({ ok: false, error: problem }, at >= 0 ? 409 : 400);
      const stamp = today();
      users.push({ username, name: name ?? username, role: readRole(body.role), created: stamp, updated: stamp, hash: await hashPassword(password) });
    } else {
      const account = users[at];
      if (!account) return json({ ok: false, error: `There is no @${username}.` }, 404);
      if (op === 'remove') {
        users.splice(at, 1);
      } else {
        if (name !== undefined && !name) return json({ ok: false, error: 'Give them a name.' }, 400);
        if (password) {
          const problem = passwordProblem(password);
          if (problem) return json({ ok: false, error: problem }, 400);
        }
        users[at] = {
          ...account,
          name: name ?? account.name,
          role: body.role === undefined ? account.role : readRole(body.role),
          hash: password ? await hashPassword(password) : account.hash,
          updated: today()
        };
      }
    }

    await saveUsers(users);
    return json({ ok: true, users: listed(users), people: publicPeople(users) });
  } catch (error) {
    return json({ ok: false, store: storeKind(), error: String((error as Error).message ?? error) }, 500);
  }
}

export default universal(handle);
