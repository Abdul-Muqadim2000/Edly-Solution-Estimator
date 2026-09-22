import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Role } from '@/types';
import { useApp } from '@/state/AppProvider';
import { color, font, shadow } from '@/theme';
import { Link } from '@/components/ui';
import { useFocus, useHover } from '@/lib/useHover';

/** The demo gate. Real auth belongs in front of the deployment — see README. */

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
          border: `1px solid ${color.rule}`,
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
          ...(focus.on ? { borderColor: color.brand, background: color.surface, boxShadow: `0 0 0 3px ${color.focusRing}` } : null)
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
      onClick={onPick}
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
  const submitHover = useHover();

  const submit = (): void => {
    if (user.trim().toLowerCase() !== 'admin' || password !== 'admin') {
      setError('Invalid credentials — demo sign-in is admin / admin.');
      return;
    }
    setError('');
    dispatch({ type: 'signIn', user: 'admin', role });
  };

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') submit();
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
          <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 42, letterSpacing: -1, color: color.ink, lineHeight: 1 }}>edly</div>
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
            placeholder="admin"
            onChange={(event) => setUser(event.target.value)}
            onKeyDown={onKey}
          />
          <AuthField
            label="Password"
            marginTop={12}
            type="password"
            value={password}
            placeholder="••••••"
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={onKey}
          />

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

          {error ? (
            <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: color.redInk, background: color.redWash, borderRadius: 8, padding: '9px 12px' }}>
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={submit}
            {...submitHover.bind}
            style={{
              width: '100%',
              marginTop: 16,
              border: 'none',
              cursor: 'pointer',
              background: submitHover.on ? color.redDeep : color.red,
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
            Sign in
          </button>

          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11.5, color: color.faint }}>
            Demo credentials: <span style={{ fontFamily: font.mono, color: color.ink }}>admin / admin</span>
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
