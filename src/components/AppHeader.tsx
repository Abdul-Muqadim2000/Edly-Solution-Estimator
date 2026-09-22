import { useState, type ReactNode } from 'react';
import { PRACTICES, findPlatform } from '@/data/practices';
import { useApp } from '@/state/AppProvider';
import { color, font, radius, shadow } from '@/theme';
import { Button, Popover, Row, Spacer, useRowHover } from '@/components/ui';
import { useHover } from '@/lib/useHover';

/** The signed-in chrome: brand, platform switcher, role swap, sign out, and the sync pill. */

/** The mono pill that names who is signed in and in which role. */
export function UserChip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      title="Signed in"
      style={{
        fontFamily: font.mono,
        fontSize: 11,
        color: color.muted,
        background: color.surfaceMuted,
        borderRadius: radius.pill,
        padding: '6px 12px',
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </span>
  );
}

/** The outlined pill buttons in every signed-in header. `on` marks an open popover. */
export function HeaderPill({
  children,
  onClick,
  danger,
  on,
  title
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  on?: boolean;
  title?: string;
}): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        border: `1px solid ${h.on ? (danger ? color.red : '#9C9C9C') : color.rule}`,
        cursor: 'pointer',
        borderRadius: radius.pill,
        padding: '7px 14px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: font.body,
        background: danger && h.on ? color.redWash : on ? color.surfaceMuted : color.surface,
        color: danger ? color.redInk : color.ink,
        whiteSpace: 'nowrap',
        transition: 'border-color 120ms ease, background 120ms ease'
      }}
      {...h.bind}
    >
      {children}
    </button>
  );
}

function SwitchRow({ name, live, on, onPick }: { name: string; live: boolean; on: boolean; onPick: () => void }): JSX.Element {
  const hover = useRowHover({ background: color.surfaceMuted });
  return (
    <div
      onClick={onPick}
      {...hover.bind}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        borderRadius: radius.sm,
        padding: '6px 8px',
        marginTop: 2,
        background: on ? color.brandWash : 'transparent',
        transition: 'background 120ms ease',
        ...(on ? {} : hover.style)
      }}
    >
      <span style={{ flex: 1, fontSize: 12.5, color: on ? color.brandDeep : color.inkSoft }}>{name}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: live ? color.brandDeep : color.amber }}>
        {live ? 'Live' : 'Sample'}
      </span>
    </div>
  );
}

export function PlatformSwitcher(): JSX.Element | null {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const current = findPlatform(state.platform);
  if (!current) return null;

  return (
    <div style={{ position: 'relative' }}>
      <Button
        pill
        size="sm"
        title="Switch practice or platform"
        onClick={() => setOpen((value) => !value)}
        style={{ fontWeight: 600, padding: '6px 13px', fontSize: 12 }}
      >
        {current.practice.name} / {current.platform.name} ▾
      </Button>
      {open ? (
        <Popover align="left" width={320}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', color: color.ghost }}>Switch to</div>
          {PRACTICES.map((practice) => (
            <div key={practice.id} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: color.muted }}>{practice.name}</div>
              {practice.platforms.map((platform) => {
                const on = platform.id === state.platform;
                return (
                  <SwitchRow
                    key={platform.id}
                    name={platform.name}
                    live={Boolean(platform.live)}
                    on={on}
                    onPick={() => {
                      dispatch({ type: 'choosePlatform', practice: practice.id, platform: platform.id });
                      setOpen(false);
                    }}
                  />
                );
              })}
            </div>
          ))}
          <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.55, borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 12, paddingTop: 9 }}>
            {state.auth?.role === 'estimator'
              ? 'The desk only shows work for the platform you have open.'
              : 'Estimations, requests and catalog additions stay with their own platform — switching never mixes them.'}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * `sticky` is what separates the two source headers: the picker screens scroll their header
 * away, the hub and the desk pin theirs.
 */
export function AppHeader({ children, sticky }: { children?: ReactNode; sticky?: boolean }): JSX.Element {
  const { state, dispatch } = useApp();
  const role = state.auth?.role;

  return (
    <header
      style={{
        position: sticky ? 'sticky' : undefined,
        top: sticky ? 0 : undefined,
        zIndex: sticky ? 50 : undefined,
        background: color.surface,
        borderBottom: `1px solid ${sticky ? color.hairline : color.hairlineSoft}`,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '10px 14px',
        padding: sticky ? '12px 24px' : '12px 28px'
      }}
    >
      <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 26, letterSpacing: -0.5, lineHeight: 1 }}>edly</div>
      {state.platform ? (
        <>
          <div style={{ width: 1, height: 22, background: color.hairline }} />
          <PlatformSwitcher />
        </>
      ) : null}
      {children}
      <Spacer />
      <UserChip>
        {state.auth?.user ?? ''} · {role === 'estimator' ? 'Estimator' : 'Sales'}
      </UserChip>
      <HeaderPill onClick={() => dispatch({ type: 'switchRole' })}>
        ⇄ {role === 'estimator' ? 'Sales workspace' : 'Estimation desk'}
      </HeaderPill>
      <HeaderPill danger onClick={() => dispatch({ type: 'signOut' })}>
        Logout
      </HeaderPill>
    </header>
  );
}

/** Bottom-left pill that reports what the store is doing. Never silent about a failed write. */
export function SyncPill(): JSX.Element | null {
  const { sync } = useApp();
  const { tone, message } = sync.status;
  if (tone === 'good' && /^saved/.test(message) === false && sync.status.hydrated === false) return null;

  const palette = {
    good: { bg: color.surface, bd: color.hairline, co: color.brandDeep },
    busy: { bg: color.surface, bd: color.hairline, co: color.amber },
    warn: { bg: color.amberWash, bd: color.amberEdge, co: color.amberInk },
    bad: { bg: color.redWash, bd: color.redEdge, co: color.redInk }
  }[tone];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 14,
        left: 14,
        zIndex: 600,
        maxWidth: 'min(360px, 60vw)',
        fontFamily: font.mono,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.45,
        padding: '7px 12px',
        borderRadius: 12,
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        color: palette.co,
        boxShadow: shadow.card,
        pointerEvents: tone === 'warn' || tone === 'bad' ? 'auto' : 'none'
      }}
    >
      <Row gap={8} wrap={false}>
        <span>{message}</span>
        {tone === 'warn' ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ border: 'none', background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          >
            reload
          </button>
        ) : null}
      </Row>
    </div>
  );
}
