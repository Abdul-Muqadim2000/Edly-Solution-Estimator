import { useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@/types';
import { useApp } from '@/state/AppProvider';
import { changeAccount, listAccounts, type AccountChange, type AccountRow } from '@/api/client';
import { normalUsername, passwordProblem, roleLabel, usernameProblem } from '@/domain/people';
import { homeOf, LANDING } from '@/lib/router';
import { color, font, radius } from '@/theme';
import { Banner, Button, Field, Row, Select, Spacer } from '@/components/ui';
import { AppHeader } from '@/components/AppHeader';
import { BackTo } from '@/components/Nav';
import { Avatar } from '@/components/people';

/**
 * The admin panel: who can sign in, as what, with which password. Behind the admin password, which
 * the server checks on every change (`/api/users`). The password is held in this page's memory
 * only, never in browser storage: a reload asks for it again. Signing in as admin hands it over,
 * so the panel opens straight away after that.
 */

let heldPassword = '';

/** Called by the sign-in screen after the admin signs in, so the panel does not ask twice. */
export function rememberAdminPassword(password: string): void {
  heldPassword = password;
}

export function forgetAdminPassword(): void {
  heldPassword = '';
}

const ROLES: { value: Role; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'estimator', label: 'Estimator' }
];

function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section style={{ marginTop: 18, background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '18px 20px' }}>
      <div style={{ fontFamily: font.display, fontSize: 15.5, fontWeight: 600, color: color.ink }}>{title}</div>
      {sub ? <div style={{ fontSize: 12, color: color.faint, lineHeight: 1.55, marginTop: 3 }}>{sub}</div> : null}
      {children}
    </section>
  );
}

export function AdminPanel(): JSX.Element {
  const { state, dispatch } = useApp();
  const [password, setPassword] = useState(heldPassword);
  const [typed, setTyped] = useState('');
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const back = state.platform && state.auth ? homeOf(state.auth.role, state.platform) : LANDING;

  const load = async (candidate: string): Promise<void> => {
    setBusy(true);
    try {
      const users = await listAccounts(candidate);
      heldPassword = candidate;
      setPassword(candidate);
      setRows(users);
      setError('');
    } catch (failure) {
      heldPassword = '';
      setPassword('');
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (heldPassword) void load(heldPassword);
  }, []);

  /** One change, then the list as the server now holds it; every picker in this tab hears about it at once. */
  const change = async (next: AccountChange): Promise<boolean> => {
    setBusy(true);
    try {
      const answer = await changeAccount(password, next);
      setRows(answer.users);
      dispatch({ type: 'setPeople', people: answer.people });
      setError('');
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: color.page }}>
      <AppHeader sticky />
      <main style={{ maxWidth: 940, margin: '0 auto', padding: '30px 24px 90px' }}>
        <BackTo to={back}>← Back to the workspace</BackTo>
        <h1 style={{ fontFamily: font.display, fontSize: 26, fontWeight: 700, letterSpacing: -0.4, margin: '14px 0 0' }}>Users</h1>
        <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.6, marginTop: 4, maxWidth: 640 }}>
          Who can sign in to Quotient, and which workspace they work in. Sales sees the estimations; an estimator sees the desk. Anyone here can be
          assigned to a deal or a desk request with an @.
        </div>

        {error ? (
          <div style={{ marginTop: 16 }}>
            <Banner tone="bad">{error}</Banner>
          </div>
        ) : null}

        {!password || !rows ? (
          <Section title="Admin password" sub="Enter it to see and change the users. It is kept in this page only, so a reload asks again.">
            <Row gap={10} align="flex-end" style={{ marginTop: 14 }}>
              <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
                <Field label="Password" type="password" value={typed} onChange={setTyped} onEnter={() => void load(typed)} placeholder="Admin password" />
              </div>
              <Button tone="primary" disabled={busy || !typed} onClick={() => void load(typed)}>
                {busy ? 'Checking…' : 'Unlock'}
              </Button>
            </Row>
          </Section>
        ) : (
          <>
            <NewUser taken={rows.map((one) => one.username)} busy={busy} onCreate={(input) => change({ op: 'create', ...input })} />
            <Section
              title={`People · ${rows.length}`}
              sub="A username never changes, because assignments point at it. The name, the role and the password can."
            >
              <div style={{ marginTop: 12 }}>
                <BuiltInAdmin />
                {rows.map((row) => (
                  <UserRow key={row.username} row={row} busy={busy} onChange={change} />
                ))}
                {rows.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: color.faint, padding: '14px 4px' }}>Nobody yet. Add the first person above.</div>
                ) : null}
              </div>
            </Section>
            <div style={{ fontSize: 11.5, color: color.faint, lineHeight: 1.6, marginTop: 16, maxWidth: 720 }}>
              Passwords are stored as salted hashes in the Users tab of the store, never as typed. The store itself is still open to anyone
              who has its address, so put Vercel Authentication or an SSO proxy in front before real client numbers go in.
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function BuiltInAdmin(): JSX.Element {
  return (
    <Row gap={12} wrap={false} style={{ padding: '10px 4px', borderBottom: `1px solid ${color.hairlineSoft}` }}>
      <Avatar username="admin" people={[]} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: color.ink }}>Admin</div>
        <div style={{ fontSize: 11.5, color: color.faint }}>@admin · built in · manages users and can switch between sales and the desk</div>
      </div>
      <span style={{ fontSize: 11, color: color.faint, textAlign: 'right', maxWidth: 260 }}>Its password is set on the server (EDLY_ADMIN_PASSWORD), admin when unset</span>
    </Row>
  );
}

function NewUser({
  taken,
  busy,
  onCreate
}: {
  taken: string[];
  busy: boolean;
  onCreate: (input: { username: string; name: string; role: Role; password: string }) => Promise<boolean>;
}): JSX.Element {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [edited, setEdited] = useState(false);
  const [role, setRole] = useState<Role>('sales');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [added, setAdded] = useState('');

  /* the username follows the name until someone types one: "Sara Khan" offers sara.khan */
  const suggested = normalUsername(name).replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '').slice(0, 32);
  const shown = edited ? username : suggested;

  const submit = async (): Promise<void> => {
    const handle = normalUsername(shown);
    const wrong = (name.trim() ? null : 'Give them a name.') ?? usernameProblem(handle, taken) ?? passwordProblem(password);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setProblem('');
    if (await onCreate({ username: handle, name: name.trim(), role, password })) {
      setAdded(`${name.trim()} can now sign in as ${handle}.`);
      setName('');
      setUsername('');
      setEdited(false);
      setPassword('');
      setRole('sales');
    }
  };

  return (
    <Section title="Add someone" sub="No email is needed. Tell them their username and password yourself.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 14, alignItems: 'end' }}>
        <Field label="Name" value={name} onChange={setName} placeholder="Their full name" />
        <Field
          label="Username"
          value={shown}
          onChange={(value) => {
            setEdited(true);
            setUsername(value);
          }}
          placeholder="first.last"
          hint="What they sign in with, and what an @ finds. It never changes."
          mono
        />
        <Select label="Role" value={role} options={ROLES} onChange={setRole} />
        <Field label="Password" type="password" value={password} onChange={setPassword} onEnter={() => void submit()} placeholder="At least 6 characters" />
      </div>
      <Row gap={10} style={{ marginTop: 12 }}>
        {problem ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{problem}</span> : null}
        {!problem && added ? <span style={{ fontSize: 12, fontWeight: 600, color: color.brandInk }}>{added}</span> : null}
        <Spacer />
        <Button tone="primary" disabled={busy} onClick={() => void submit()}>
          Add user
        </Button>
      </Row>
    </Section>
  );
}

function UserRow({ row, busy, onChange }: { row: AccountRow; busy: boolean; onChange: (change: AccountChange) => Promise<boolean> }): JSX.Element {
  const { state } = useApp();
  const [editing, setEditing] = useState<'' | 'name' | 'password'>('');
  const [name, setName] = useState(row.name);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [confirm, setConfirm] = useState(false);
  const me = state.auth?.user === row.username;

  const save = async (): Promise<void> => {
    if (editing === 'name') {
      if (!name.trim()) return setProblem('Give them a name.');
      if (await onChange({ op: 'update', username: row.username, name: name.trim() })) setEditing('');
      return;
    }
    const wrong = passwordProblem(password);
    if (wrong) return setProblem(wrong);
    if (await onChange({ op: 'update', username: row.username, password })) {
      setPassword('');
      setEditing('');
    }
  };

  return (
    <div style={{ padding: '11px 4px', borderBottom: `1px solid ${color.hairlineSoft}` }}>
      <Row gap={12} wrap={false}>
        <Avatar username={row.username} people={state.people} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.name}
            {me ? <span style={{ fontSize: 11, fontWeight: 600, color: color.faint }}> · you</span> : null}
          </div>
          <div style={{ fontFamily: font.mono, fontSize: 11.5, color: color.faint }}>
            @{row.username}
            {row.hasPassword ? '' : ' · no password yet, so cannot sign in'}
            {row.created ? ` · added ${row.created}` : ''}
          </div>
        </div>
        <Select
          value={row.role}
          options={ROLES}
          hint={`${roleLabel(row.role)}. Changing it moves them to the other workspace on their next read of the store`}
          onChange={(role) => void onChange({ op: 'update', username: row.username, role })}
          style={{ width: 'auto', padding: '6px 8px', fontSize: 12, borderRadius: 8 }}
        />
        <Button size="sm" tone="ghost" onClick={() => { setProblem(''); setName(row.name); setEditing(editing === 'name' ? '' : 'name'); }}>
          Rename
        </Button>
        <Button size="sm" tone="ghost" onClick={() => { setProblem(''); setEditing(editing === 'password' ? '' : 'password'); }}>
          {row.hasPassword ? 'Reset password' : 'Set password'}
        </Button>
        <Button
          size="sm"
          tone={confirm ? 'danger' : 'ghost'}
          disabled={busy}
          title={confirm ? 'Click again to remove them. Their name stays on tickets they were on.' : 'Remove this user'}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              window.setTimeout(() => setConfirm(false), 4000);
              return;
            }
            void onChange({ op: 'remove', username: row.username });
          }}
        >
          {confirm ? 'Remove?' : 'Remove'}
        </Button>
      </Row>
      {editing ? (
        <Row gap={10} align="flex-end" style={{ marginTop: 10, paddingLeft: 44 }}>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            {editing === 'name' ? (
              <Field label="Name" value={name} onChange={setName} onEnter={() => void save()} />
            ) : (
              <Field label="New password" type="password" value={password} onChange={setPassword} onEnter={() => void save()} placeholder="At least 6 characters" />
            )}
          </div>
          <Button tone="brand" size="sm" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
          <Button tone="ghost" size="sm" onClick={() => setEditing('')}>
            Cancel
          </Button>
          {problem ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{problem}</span> : null}
        </Row>
      ) : null}
    </div>
  );
}
