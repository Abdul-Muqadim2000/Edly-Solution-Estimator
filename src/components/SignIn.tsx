import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Role } from '@/types';
import { useApp } from '@/state/AppProvider';
import { signInAccount, usesDefaultAdmin } from '@/api/client';
import { ADMIN_USER, normalUsername } from '@/domain/people';
import { rememberAdminPassword } from '@/components/AdminPanel';
import { color, font, shadow } from '@/theme';
import { Link } from '@/components/ui';
import { useFocus, useHover } from '@/lib/useHover';
import { pressable } from '@/lib/pressable';
import { QuotientLogo } from '@/components/Brand';

/**
 * Sign-in. The server checks the password (`/api/users`) and answers with who it belongs to; each
 * account's role decides its workspace. The built-in admin still picks one, which is why the role
 * tiles appear only when the username is `admin`.
 *
 * This keeps people out of the app, not out of the API: `/api/state` checks nobody. Real auth belongs
 * in front of the deployment; see CLAUDE.md, Known limits.
 */

const authLabel: CSSProperties = {
  display: 'block',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: color.muted
};

function AuthField({
  label,
  marginTop,
  ...input
}: { label: string; marginTop: number } & React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const focus = useFocus();
  return (
    <label style={{ ...authLabel, marginTop }}>
      {label}
      <input
        {...input}
        {...focus.bind}
        style={{
          marginTop: 5,
          width: '100%',
          /* longhand, because focus changes only the colour: React warns when a rerender drops a
             longhand that overrode a shorthand, and the border can then render stale */
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: focus.on ? color.brand : color.rule,
          borderRadius: 9,
          padding: '11px 12px',
          fontSize: 14,
          fontFamily: font.body,
          fontWeight: 400,
          letterSpacing: 'normal',
          textTransform: 'none',
          color: color.ink,
          background: color.fieldBg,
          outline: 'none',
          boxSizing: 'border-box',
          ...(focus.on ? { background: color.surface, boxShadow: `0 0 0 3px ${color.focusRing}` } : null)
        }}
      />
    </label>
  );
}

/** Role tile: a square tick box, the role name, then the blurb underneath. */
function RoleCard({ on, onPick, title, blurb }: { on: boolean; onPick: () => void; title: string; blurb: ReactNode }): JSX.Element {
  const edge = on ? color.brand : color.rule;
  return (
    <div
      {...pressable(onPick)}
      style={{ cursor: 'pointer', border: `1.5px solid ${edge}`, background: on ? color.brandWash : color.surface, borderRadius: 12, padding: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div
          style={{
            width: 17,
            height: 17,
            flex: '0 0 17px',
            borderRadius: 5,
            border: `1.5px solid ${edge}`,
            background: on ? color.brand : color.surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <span style={{ color: color.onSolid, fontSize: 10, fontWeight: 700, lineHeight: 1, opacity: on ? 1 : 0 }}>✓</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: color.ink }}>{title}</span>
      </div>
      <div style={{ fontSize: 11, color: color.muted, lineHeight: 1.5, marginTop: 6 }}>{blurb}</div>
    </div>
  );
}

export function SignIn(): JSX.Element {
  const { dispatch } = useApp();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('sales');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /* the admin's password is shown only while it is still the one everybody knows */
  const [demoHint, setDemoHint] = useState(false);
  const submitHover = useHover();
  const admin = normalUsername(user) === ADMIN_USER;

  useEffect(() => {
    let live = true;
    void usesDefaultAdmin().then((answer) => {
      if (live) setDemoHint(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (!user.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      const account = await signInAccount(user, password);
      setError('');
      if (account.admin) {
        rememberAdminPassword(password);
        dispatch({ type: 'signIn', user: ADMIN_USER, role, name: 'Admin' });
      } else {
        dispatch({ type: 'signIn', user: account.username, role: account.role ?? 'sales', name: account.name });
      }
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') void submit();
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: color.brandWash,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px 20px'
      }}
    >
      <div style={{ width: '100%', maxWidth: 432 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <QuotientLogo height={40} style={{ margin: '0 auto' }} />
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 2.2, textTransform: 'uppercase', color: color.brandDeep, marginTop: 8 }}>
            Solutions Workspace · by Arbisoft
          </div>
        </div>

        <div
          style={{
            background: color.surface,
            border: `1px solid ${color.brandEdgeSoft}`,
            borderRadius: 18,
            padding: 26,
            boxShadow: shadow.auth
          }}
        >
          <div style={{ fontFamily: font.display, fontSize: 19, fontWeight: 600 }}>Sign in</div>
          <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55, marginTop: 3 }}>
            Internal tool for bundle quotes, delivery timelines and custom estimates.
          </div>

          <AuthField
            label="Username"
            marginTop={16}
            value={user}
            placeholder="your username"
            autoComplete="username"
            onChange={(event) => setUser(event.target.value)}
            onKeyDown={onKey}
          />
          <AuthField
            label="Password"
            marginTop={12}
            type="password"
            value={password}
            placeholder="••••••"
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={onKey}
          />

          {/* everyone else's account says which workspace is theirs */}
          {admin ? (
            <>
          <div style={{ ...authLabel, marginTop: 16 }}>Sign in as</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
            <RoleCard
              on={role === 'sales'}
              onPick={() => setRole('sales')}
              title="Sales person"
              blurb="Build bundles, quotes & timelines; send custom work for estimation."
            />
            <RoleCard
              on={role === 'estimator'}
              onPick={() => setRole('estimator')}
              title="Estimator"
              blurb="Receive submitted requests and return estimated hours to sales."
            />
          </div>
            </>
          ) : null}

          {error ? (
            <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: color.redInk, background: color.redWash, borderRadius: 8, padding: '9px 12px' }}>
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            {...submitHover.bind}
            style={{
              width: '100%',
              marginTop: 16,
              border: 'none',
              cursor: busy ? 'progress' : 'pointer',
              background: submitHover.on && !busy ? color.redDeep : color.red,
              opacity: busy ? 0.75 : 1,
              color: color.onSolid,
              borderRadius: 10,
              padding: 13,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: font.body,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              transition: 'background 120ms ease'
            }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11.5, color: color.faint, lineHeight: 1.55 }}>
            {demoHint ? (
              <>
                Admin: <span style={{ fontFamily: font.mono, color: color.ink }}>admin / admin</span>. It adds everyone else in the admin panel.
              </>
            ) : (
              'Your admin gives you a username and password.'
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: color.faint }}>
          Open edX® is a registered trademark of edX Inc. ·{' '}
          <Link href="https://edly.io/" style={{ color: color.brandDeep }} hover={{ textDecoration: 'underline' }}>
            edly.io
          </Link>
        </div>
      </div>
    </div>
  );
}
