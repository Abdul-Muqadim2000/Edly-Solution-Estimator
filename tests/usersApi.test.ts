import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from '../api/users';
import { handle as handleState } from '../api/state';
import { EMPTY_STATE, stateToSheets } from '../server/schema';
import {
  hashPassword,
  isAdminRequest,
  publicPeople,
  rowsToUsers,
  USER_COLUMNS,
  USERS_SHEET,
  usersToRows,
  verifyPassword,
  type UserRecord
} from '../server/users';
import { readWorkbook, writeWorkbook, type Workbook } from '../src/lib/xlsx';
import type { EstimateRequest, Estimation, PersistedState } from '../src/types';

/**
 * `/api/users`, driven end to end against a real spreadsheet in a temp directory, the way
 * `tests/api.test.ts` drives `/api/state`.
 *
 * The accounts share one workbook with the work, in a `Users` tab no browser ever holds. So the
 * two things that matter most are asserted against the real file: a save of the work never takes
 * the accounts with it, and a change to the accounts never takes the work. The rest is who may do
 * what, and that no reply and no cell ever carries a password.
 */

let dir: string;
let path: string;
let previous: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'edly-users-'));
  path = join(dir, 'edly-state.xlsx');
  previous = {
    EDLY_STORE: process.env.EDLY_STORE,
    EDLY_STATE_PATH: process.env.EDLY_STATE_PATH,
    EDLY_ADMIN_PASSWORD: process.env.EDLY_ADMIN_PASSWORD
  };
  process.env.EDLY_STORE = 'local';
  process.env.EDLY_STATE_PATH = path;
  delete process.env.EDLY_ADMIN_PASSWORD;
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------ requests */

const basic = (user: string, password: string): string => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const ADMIN = basic('admin', 'admin');

const usersUrl = 'http://localhost/api/users';

const get = (auth?: string): Promise<Response> => handle(new Request(usersUrl, { headers: auth ? { authorization: auth } : {} }));

const post = (body: unknown, auth?: string): Promise<Response> =>
  handle(
    new Request(usersUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  );

const signIn = (username: string, password: string): Promise<Response> => post({ op: 'signIn', username, password });

const SARA = { op: 'create', username: 'sara', name: 'Sara Khan', role: 'Sales', password: 'sara-pass-1' };
const OMAR = { op: 'create', username: 'omar', name: 'Omar Farooq', role: 'Estimator', password: 'omar-pass-1' };

const create = (over: Record<string, unknown> = {}, auth: string = ADMIN): Promise<Response> => post({ ...SARA, ...over }, auth);

interface Listed {
  username: string;
  name: string;
  role: string;
  created: string;
  updated: string;
  hasPassword: boolean;
}

const listed = async (): Promise<Listed[]> => ((await (await get(ADMIN)).json()) as { users: Listed[] }).users;

const stateGet = (query = ''): Promise<Response> => handleState(new Request(`http://localhost/api/state${query}`));

const statePut = (body: unknown): Promise<Response> =>
  handleState(new Request('http://localhost/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

const fileTabs = async (): Promise<Workbook> => readWorkbook(new Uint8Array(readFileSync(path)));

/* ------------------------------------------------------------ fixtures */

const estimation = (id: string, over: Partial<Estimation> = {}): Estimation => ({
  id,
  plat: 'openedx',
  name: `Deal ${id}`,
  slug: id.toLowerCase(),
  client: 'Acme Academy',
  tag: 'Active',
  due: '2026-11-01',
  at: '2026-09-01',
  up: '2026-09-02',
  total: 120,
  cost: 14400,
  items: 3,
  snap: { sel: { 'OX-1': true }, buf: { 'OX-1': 8 }, bufPct: 10, cur: 'EUR' },
  ...over
});

const request = (id: string, over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id,
  plat: 'openedx',
  estId: 'EST-1',
  estName: 'Deal EST-1',
  client: 'Acme Academy',
  title: 'Custom SSO',
  details: 'Okta, with group sync',
  area: 'Auth',
  urgency: '',
  integrations: 'Okta',
  name: 'Sara',
  email: 'sara@edly.io',
  org: 'Edly',
  at: '2026-09-10',
  ...over
});

const work = (): PersistedState => ({
  ...EMPTY_STATE,
  estimations: [estimation('EST-1', { assigned: [{ user: 'sara', by: 'admin', at: '2026-09-30T09:00:00.000Z' }] })],
  requests: [request('RQ-01', { by: 'sara', stage: 'info', staged: { by: 'omar', at: '2026-09-30T10:00:00.000Z' } })]
});

/* ------------------------------------------------------------ before anyone signs in */

describe('GET /api/users without the admin password', () => {
  it('answers only whether the admin password is still the default one', async () => {
    expect(await (await get()).json()).toEqual({ ok: true, defaultAdmin: true });
  });

  it('lists nobody, even once there are accounts', async () => {
    /* the sign-in screen calls this, so anyone can; what it says must not help them */
    await create();
    expect(await (await get()).json()).toEqual({ ok: true, defaultAdmin: true });
  });

  it('says the default is gone once EDLY_ADMIN_PASSWORD is set, and not when it is set to admin', async () => {
    process.env.EDLY_ADMIN_PASSWORD = 'Nordic-admin-7';
    expect(await (await get()).json()).toEqual({ ok: true, defaultAdmin: false });
    process.env.EDLY_ADMIN_PASSWORD = 'admin';
    expect(await (await get()).json()).toEqual({ ok: true, defaultAdmin: true });
  });

  it('refuses the list to a wrong admin password', async () => {
    const response = await get(basic('admin', 'guess'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'The admin password is wrong.' });
  });
});

/* ------------------------------------------------------------ signing in */

describe('signing in', () => {
  it('lets the admin in with no store at all, and writes nothing', async () => {
    expect(existsSync(path)).toBe(false);
    const response = await signIn('admin', 'admin');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, user: { username: 'admin', name: 'Admin', admin: true } });
    expect(existsSync(path)).toBe(false);
  });

  it('lets the admin in over a store that cannot be read, so they can see what is wrong with it', async () => {
    writeFileSync(path, 'this is not a zip');
    expect((await signIn('@Admin ', 'admin')).status).toBe(200);
    /* anyone else needs the store to be checked against, and says so rather than letting them in */
    expect((await signIn('sara', 'sara-pass-1')).status).toBe(500);
  });

  it('refuses admin/admin once EDLY_ADMIN_PASSWORD is set, and takes the new one', async () => {
    process.env.EDLY_ADMIN_PASSWORD = 'Nordic-admin-7';
    const old = await signIn('admin', 'admin');
    expect(old.status).toBe(401);
    expect(await old.json()).toEqual({ ok: false, error: 'Wrong username or password.' });
    expect((await signIn('admin', 'Nordic-admin-7')).status).toBe(200);
  });

  it('lets a created person in, however the username is typed, with their name and role', async () => {
    expect((await create({ username: '@Sara ', role: 'Estimator' })).status).toBe(200);
    const response = await signIn('SARA', 'sara-pass-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, user: { username: 'sara', name: 'Sara Khan', role: 'estimator' } });
  });

  it('gives a wrong password and an unknown username the same answer', async () => {
    await create();
    const wrongPassword = await signIn('sara', 'sara-pass-2');
    const unknownUser = await signIn('farid', 'sara-pass-1');
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    /* a different answer would tell a stranger which usernames exist */
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
  });

  it('refuses an account typed into the sheet by hand until the admin sets a password', async () => {
    writeFileSync(path, writeWorkbook({ [USERS_SHEET]: [[...USER_COLUMNS], ['farid', 'Farid Anwar', 'Sales', '', '', '']] }));
    expect((await signIn('farid', '')).status).toBe(401);
    expect((await signIn('farid', 'anything-at-all')).status).toBe(401);
    expect((await listed())[0]).toMatchObject({ username: 'farid', hasPassword: false });
  });

  it('takes the admin password with a colon in it, splitting the header at the first one', async () => {
    process.env.EDLY_ADMIN_PASSWORD = 'pa:ss:word';
    expect((await get(basic('admin', 'pa:ss:word'))).status).toBe(200);
  });
});

describe('what /api/users will not serve', () => {
  it('refuses a body that is not a JSON object', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post(null)).status).toBe(400);
  });

  it('refuses an op it does not know, and a method it does not serve', async () => {
    const unknown = await post({ op: 'promote', username: 'sara' }, ADMIN);
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toBe('Unknown op "promote"');
    expect((await handle(new Request(usersUrl, { method: 'DELETE' }))).status).toBe(405);
  });
});

/* ------------------------------------------------------------ managing accounts */

describe('managing accounts', () => {
  it('refuses every change without the admin password, and changes nothing', async () => {
    await create();
    const attempts: [Record<string, unknown>, string | undefined][] = [
      [OMAR, undefined],
      [OMAR, basic('admin', 'guess')],
      /* a person's own password is not the admin's, however it is sent */
      [OMAR, basic('sara', 'sara-pass-1')],
      [{ op: 'update', username: 'sara', role: 'estimator' }, basic('sara', 'sara-pass-1')],
      [{ op: 'remove', username: 'sara' }, 'Bearer admin']
    ];
    for (const [body, auth] of attempts) {
      const response = await post(body, auth);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'The admin password is wrong.' });
    }
    expect(await listed()).toEqual([expect.objectContaining({ username: 'sara', role: 'sales' })]);
  });

  it('creates an account and lists it with whether it has a password, never the password or its hash', async () => {
    const response = await create();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; users: Listed[]; people: unknown[] };
    expect(body.users).toEqual([
      { username: 'sara', name: 'Sara Khan', role: 'sales', created: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), updated: expect.any(String), hasPassword: true }
    ]);
    expect(body.people).toEqual([{ username: 'sara', name: 'Sara Khan', role: 'sales' }]);
    expect(await listed()).toEqual(body.users);
  });

  it('refuses a username that is taken, however it is typed', async () => {
    await create();
    const again = await create({ username: '@SARA', name: 'Another Sara' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe('@sara is already taken.');
    expect((await listed()).map((one) => one.name)).toEqual(['Sara Khan']);
  });

  it('refuses admin as a username, so nobody can become the account that manages accounts', async () => {
    const response = await create({ username: 'Admin', password: 'admin-pass-1' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('"admin" is the built-in admin account.');
    expect(await listed()).toEqual([]);
  });

  it('refuses a malformed username, a missing name and a short password, and makes no account', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ username: 'Sara Khan' }, 'Use 2 to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit.'],
      [{ username: '' }, 'Give them a username.'],
      [{ name: '   ' }, 'Give them a name.'],
      [{ name: undefined }, 'Give them a name.'],
      [{ password: 'short' }, 'Use at least 6 characters.'],
      [{ password: undefined }, 'Use at least 6 characters.']
    ];
    for (const [over, error] of cases) {
      const response = await create(over);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe(error);
    }
    expect(await listed()).toEqual([]);
    /* nothing to save, so nothing was written */
    expect(existsSync(path)).toBe(false);
  });

  it('changes a name and a role, and a new password replaces the old one', async () => {
    await create();
    const response = await post({ op: 'update', username: 'sara', name: 'Sara K.', role: 'estimator', password: 'fresh-pass-2' }, ADMIN);
    expect(response.status).toBe(200);
    expect((await signIn('sara', 'sara-pass-1')).status).toBe(401);
    const back = await signIn('sara', 'fresh-pass-2');
    expect(await back.json()).toEqual({ ok: true, user: { username: 'sara', name: 'Sara K.', role: 'estimator' } });
  });

  it('keeps the password when an update sets none, and the role when it names none', async () => {
    await create({ role: 'Estimator' });
    expect((await post({ op: 'update', username: 'sara', name: 'Sara Khan-Ali' }, ADMIN)).status).toBe(200);
    const back = await signIn('sara', 'sara-pass-1');
    expect(await back.json()).toEqual({ ok: true, user: { username: 'sara', name: 'Sara Khan-Ali', role: 'estimator' } });
  });

  it('refuses an update that blanks the name or sets a short password, and leaves the account as it was', async () => {
    await create();
    const blank = await post({ op: 'update', username: 'sara', name: ' ' }, ADMIN);
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as { error: string }).error).toBe('Give them a name.');
    const short = await post({ op: 'update', username: 'sara', password: 'abc' }, ADMIN);
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toBe('Use at least 6 characters.');
    expect((await signIn('sara', 'sara-pass-1')).status).toBe(200);
    expect((await listed())[0]?.name).toBe('Sara Khan');
  });

  it('says who is missing when asked to change or remove someone who is not there', async () => {
    for (const op of ['update', 'remove']) {
      const response = await post({ op, username: '@Farid', name: 'Farid' }, ADMIN);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('There is no @farid.');
    }
  });

  it('removes an account, and that person can no longer sign in', async () => {
    await create();
    await post(OMAR, ADMIN);
    const response = await post({ op: 'remove', username: 'sara' }, ADMIN);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { people: unknown[] }).people).toEqual([{ username: 'omar', name: 'Omar Farooq', role: 'estimator' }]);
    expect((await listed()).map((one) => one.username)).toEqual(['omar']);
    expect((await signIn('sara', 'sara-pass-1')).status).toBe(401);
    expect((await signIn('omar', 'omar-pass-1')).status).toBe(200);
  });

  it('never sends a hash, a password or the word pbkdf2 in any reply', async () => {
    const replies = [
      await create(),
      await post(OMAR, ADMIN),
      await post({ op: 'update', username: 'omar', password: 'omar-pass-2' }, ADMIN),
      await get(ADMIN),
      await signIn('sara', 'sara-pass-1'),
      await post({ op: 'remove', username: 'omar' }, ADMIN),
      await stateGet()
    ];
    for (const response of replies) {
      const text = await response.text();
      expect(text).not.toMatch(/pbkdf2|passwordHash|"hash"/);
      expect(text).not.toMatch(/sara-pass-1|omar-pass-1|omar-pass-2/);
    }
  });
});

/* ------------------------------------------------------------ the tab itself */

describe('the Users tab', () => {
  it('holds a salted hash, and never the password', async () => {
    await create();
    const tabs = await fileTabs();
    const [header, row] = tabs[USERS_SHEET] ?? [];
    expect(header).toEqual([...USER_COLUMNS]);
    expect(row?.slice(0, 3)).toEqual(['sara', 'Sara Khan', 'Sales']);
    expect(row?.[5]).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(JSON.stringify(tabs)).not.toContain('sara-pass-1');
  });

  it('salts every hash, so two people with the same password do not share one', async () => {
    await create();
    await post({ ...OMAR, password: 'sara-pass-1' }, ADMIN);
    const [, sara, omar] = (await fileTabs())[USERS_SHEET] ?? [];
    expect(sara?.[5]).toBeTruthy();
    expect(sara?.[5]).not.toBe(omar?.[5]);
  });

  it('reads a tab edited by hand: columns moved, an @ typed, a role in other words, a name left blank', () => {
    const users = rowsToUsers([
      ['passwordHash', 'role', 'username', 'name'],
      ['h1', 'Desk', '@Nadia', 'Nadia Rahman'],
      ['h2', 'account manager', 'farid', ''],
      ['', '', '', ''],
      /* a pasted duplicate cannot take over the account above it */
      ['h3', 'Estimator', 'NADIA', 'Someone else'],
      /* nor can a row claim the built-in admin, or a name that could never be created */
      ['h4', 'Estimator', 'admin', 'Mallory'],
      ['h5', 'Sales', 'two words', 'Two Words']
    ]);
    expect(users).toEqual([
      { username: 'nadia', name: 'Nadia Rahman', role: 'estimator', created: '', updated: '', hash: 'h1' },
      { username: 'farid', name: 'farid', role: 'sales', created: '', updated: '', hash: 'h2' }
    ]);
    expect(rowsToUsers(undefined)).toEqual([]);
  });

  it('writes the role as a word and the hash last, and reads back what it wrote', () => {
    const records: UserRecord[] = [
      { username: 'sara', name: 'Sara Khan', role: 'sales', created: '2026-09-30', updated: '2026-09-30', hash: 'h1' },
      { username: 'omar', name: 'Omar Farooq', role: 'estimator', created: '2026-09-29', updated: '2026-09-30', hash: '' }
    ];
    const rows = usersToRows(records);
    expect(rows[2]).toEqual(['omar', 'Omar Farooq', 'Estimator', '2026-09-29', '2026-09-30', '']);
    expect(rowsToUsers(rows.map((row) => row.map((cell) => String(cell ?? ''))))).toEqual(records);
  });

  it('tells browsers names and roles only, sorted by name', () => {
    const records: UserRecord[] = [
      { username: 'sara', name: 'Sara Khan', role: 'sales', created: '2026-09-30', updated: '2026-09-30', hash: 'h1' },
      { username: 'omar', name: 'Omar Farooq', role: 'estimator', created: '2026-09-29', updated: '2026-09-30', hash: 'h2' }
    ];
    expect(publicPeople(records)).toEqual([
      { username: 'omar', name: 'Omar Farooq', role: 'estimator' },
      { username: 'sara', name: 'Sara Khan', role: 'sales' }
    ]);
  });
});

describe('checking a password and the admin header', () => {
  it('matches the password a hash was made from and nothing else', async () => {
    /* the iterations travel inside the hash, so a cheap one checks the same way a real one does */
    const stored = await hashPassword('Nordic-pass-1', 1000);
    expect(await verifyPassword('Nordic-pass-1', stored)).toBe(true);
    expect(await verifyPassword('Nordic-pass-2', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('matches nothing against a blank or malformed hash', async () => {
    const stored = await hashPassword('Nordic-pass-1', 1000);
    const [, rounds, salt, hash] = stored.split('$');
    for (const broken of [
      '',
      'plain-text-password',
      `md5$${rounds}$${salt}$${hash}`,
      `pbkdf2-sha256$abc$${salt}$${hash}`,
      `pbkdf2-sha256$0$${salt}$${hash}`,
      `pbkdf2-sha256$${rounds}$$${hash}`,
      `pbkdf2-sha256$${rounds}$${salt}$c2hvcnQ=`,
      `${stored}$extra`
    ]) {
      expect(await verifyPassword('Nordic-pass-1', broken)).toBe(false);
    }
  });

  it('reads the admin header as Basic base64 of admin and the password', () => {
    const asking = (authorization?: string): boolean => isAdminRequest(new Request(usersUrl, { headers: authorization ? { authorization } : {} }));
    expect(asking(ADMIN)).toBe(true);
    expect(asking(`basic ${Buffer.from('@Admin:admin').toString('base64')}`)).toBe(true);
    expect(asking(undefined)).toBe(false);
    expect(asking(basic('admin', 'admin2'))).toBe(false);
    expect(asking(basic('sara', 'admin'))).toBe(false);
    expect(asking(`Bearer ${Buffer.from('admin:admin').toString('base64')}`)).toBe(false);
    expect(asking(`Basic ${Buffer.from('admin').toString('base64')}`)).toBe(false);
    expect(asking(`Basic ${Buffer.from(':admin').toString('base64')}`)).toBe(false);
    expect(asking('Basic !!!not-base64!!!')).toBe(false);
  });
});

/* ------------------------------------------------------------ accounts and the work */

describe('accounts and the work, in one store', () => {
  it('keeps every account through a save of the work', async () => {
    await create();
    const before = (await fileTabs())[USERS_SHEET];

    /* a browser never holds the accounts, so a save that wrote the tab from what it sent would
       delete every one of them */
    expect((await statePut(work())).status).toBe(200);

    expect((await fileTabs())[USERS_SHEET]).toEqual(before);
    expect((await signIn('sara', 'sara-pass-1')).status).toBe(200);
    expect((await listed()).map((one) => one.username)).toEqual(['sara']);
  });

  it('keeps every account through an empty save over a store holding only accounts', async () => {
    await create();
    /* no rows are stored, so the empty-payload guard lets this through */
    expect((await statePut(EMPTY_STATE)).status).toBe(200);
    expect((await signIn('sara', 'sara-pass-1')).status).toBe(200);
  });

  it('hands browsers the people beside the state, names and roles only', async () => {
    await create();
    await post(OMAR, ADMIN);
    await statePut(work());
    const response = await stateGet();
    const body = (await response.clone().json()) as { people: unknown[]; state: PersistedState & { people?: unknown } };
    expect(body.people).toEqual([
      { username: 'omar', name: 'Omar Farooq', role: 'estimator' },
      { username: 'sara', name: 'Sara Khan', role: 'sales' }
    ]);
    /* beside the state, not in it, so no browser saves it back */
    expect(body.state).not.toHaveProperty('people');
    expect(await response.text()).not.toMatch(/pbkdf2|passwordHash/);
  });

  it('keeps every deal and request when an account is created, changed or removed', async () => {
    await statePut(work());
    const before = ((await (await stateGet()).json()) as { state: PersistedState }).state;
    expect(before.estimations[0]?.assigned).toEqual([{ user: 'sara', by: 'admin', at: '2026-09-30T09:00:00.000Z' }]);

    await create();
    await post(OMAR, ADMIN);
    await post({ op: 'update', username: 'sara', role: 'estimator' }, ADMIN);
    await post({ op: 'remove', username: 'omar' }, ADMIN);

    const after = (await (await stateGet()).json()) as { empty: boolean; state: PersistedState };
    expect(after.empty).toBe(false);
    expect(after.state).toEqual(before);
  });

  it('reads a store holding only accounts as holding no work', async () => {
    /* accounts are not work: calling this store populated would hydrate a browser with nothing
       and discard what it was holding */
    await create();
    const body = (await (await stateGet()).json()) as { empty: boolean; state: PersistedState; people: unknown[] };
    expect(body.empty).toBe(true);
    expect(body.state).toEqual(EMPTY_STATE);
    expect(body.people).toEqual([{ username: 'sara', name: 'Sara Khan', role: 'sales' }]);

    const probe = (await (await stateGet('?probe=1')).json()) as { hasData: boolean };
    expect(probe.hasData).toBe(false);
  });

  it('writes the work sheets beside the Users tab when the first thing stored is an account', async () => {
    await create();
    /* the same seven sheets a save of the work writes, so the file opens like any other */
    expect(Object.keys(await fileTabs()).sort()).toEqual([...Object.keys(stateToSheets(EMPTY_STATE)), USERS_SHEET].sort());
  });

  it('leaves the accounts out of the downloadable workbook', async () => {
    await create();
    await statePut(work());
    const response = await stateGet('?format=xlsx');
    const workbook = await readWorkbook(new Uint8Array(await response.arrayBuffer()));
    expect(workbook.Estimations?.some((row) => row.includes('EST-1'))).toBe(true);
    expect(workbook).not.toHaveProperty(USERS_SHEET);
  });

  it('makes no account from a save that carries people or a Users tab of its own', async () => {
    await create();
    await statePut({
      ...work(),
      people: [{ username: 'mallory', name: 'Mallory', role: 'estimator' }],
      [USERS_SHEET]: [[...USER_COLUMNS], ['mallory', 'Mallory', 'Estimator', '', '', 'pbkdf2-sha256$1$AAAA$AAAA']]
    });
    expect((await listed()).map((one) => one.username)).toEqual(['sara']);
    expect((await signIn('mallory', 'anything')).status).toBe(401);
  });
});
