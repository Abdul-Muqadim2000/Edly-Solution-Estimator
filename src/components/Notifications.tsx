import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/AppProvider';
import { markSeen, noticeAction, noticesFor, readSeen, seenStorageKey, unreadNotices, type Notice } from '@/domain/notifications';
import { readStorage, writeStorage } from '@/state/keys';
import { findPlatform } from '@/data/practices';
import { ago } from '@/lib/format';
import { exactly, noticeRoute } from '@/lib/router';
import { pressable } from '@/lib/pressable';
import { color, font, radius } from '@/theme';
import { useHover } from '@/lib/useHover';
import { useRowHover } from '@/components/ui';
import { Floating } from '@/components/Floating';
import { Avatar } from '@/components/people';

/**
 * The bell in every signed-in header. What it lists is worked out from the records
 * (`noticesFor`), so it is as fresh as this tab's last read of the store; opening it reads again,
 * so a notification sent a moment ago shows without waiting for the 45-second poll.
 *
 * Read marks live in this browser, per person (`seenStorageKey`), and are never saved to the store:
 * see the note in domain/notifications.ts. Another tab in the same browser hears about a mark
 * through the storage event, so the count agrees across tabs.
 */

function useSeen(user: string): [string[], (keys: string[]) => void] {
  const key = seenStorageKey(user);
  const [seen, setSeen] = useState<string[]>(() => readSeen(readStorage<unknown>(key, [])));

  useEffect(() => {
    setSeen(readSeen(readStorage<unknown>(key, [])));
    const onStorage = (event: StorageEvent): void => {
      if (event.key === key) setSeen(readSeen(readStorage<unknown>(key, [])));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  const mark = useCallback(
    (keys: string[]) => {
      setSeen((was) => {
        const next = markSeen(was, keys);
        writeStorage(key, next);
        return next;
      });
    },
    [key]
  );
  return [seen, mark];
}

function BellIcon(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <path
        d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5l1.5-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 20.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function NotificationBell(): JSX.Element | null {
  const { state, router, sync } = useApp();
  const user = state.auth?.user ?? '';
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hover = useHover();
  const [seen, mark] = useSeen(user);

  const notices = useMemo(() => noticesFor(user, { estimations: state.estimations, requests: state.requests }), [user, state.estimations, state.requests]);
  const unread = useMemo(() => unreadNotices(notices, seen), [notices, seen]);
  const unreadKeys = useMemo(() => new Set(unread.map((notice) => notice.key)), [unread]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  /* client-facing: a notification names other deals and clients */
  if (!state.auth || state.presenting) return null;

  const openNotice = (notice: Notice): void => {
    mark([notice.key]);
    setOpen(false);
    const deal = state.estimations.find((one) => one.id === notice.estId);
    router.navigate(exactly(noticeRoute(notice.plat || state.platform, deal ? deal.slug || deal.id : null, state.auth?.role ?? 'sales')));
  };

  const count = unread.length;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        title={count > 0 ? `${count} unread` : 'Notifications'}
        onClick={() => {
          if (!open) sync.reload();
          setOpen((was) => !was);
        }}
        {...hover.bind}
        style={{
          position: 'relative',
          width: 34,
          height: 34,
          flex: '0 0 34px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          borderRadius: '50%',
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: open || hover.on ? color.chevron : color.rule,
          background: open ? color.surfaceMuted : color.surface,
          color: count > 0 ? color.ink : color.muted,
          padding: 0,
          transition: 'border-color 120ms ease, background 120ms ease'
        }}
      >
        <BellIcon />
        {count > 0 ? (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -4,
              right: -5,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              boxSizing: 'border-box',
              borderRadius: radius.pill,
              background: color.red,
              color: color.onSolid,
              fontSize: 10.5,
              fontWeight: 700,
              fontFamily: font.body,
              lineHeight: '18px',
              textAlign: 'center',
              boxShadow: `0 0 0 2px ${color.surface}`
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <Floating anchor={button} onClose={close} width={380} align="right" label="Notifications">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 10px', borderBottom: `1px solid ${color.hairlineSoft}` }}>
            <span style={{ fontFamily: font.display, fontSize: 14.5, fontWeight: 600, color: color.ink }}>Notifications</span>
            {count > 0 ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: color.redInk, background: color.redWash, borderRadius: radius.pill, padding: '2px 8px' }}>{count} new</span>
            ) : null}
            <span style={{ flex: 1 }} />
            {count > 0 ? <MarkAll onClick={() => mark(unread.map((notice) => notice.key))} /> : null}
          </div>
          {notices.length === 0 ? (
            <div style={{ padding: '26px 22px 28px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: color.ink }}>Nothing yet</div>
              <div style={{ fontSize: 12, color: color.faint, lineHeight: 1.55, marginTop: 5 }}>
                You are told here when someone assigns you to a deal or a desk request, and when a request you filed or are on gets its hours
                or needs more detail.
              </div>
            </div>
          ) : (
            <div style={{ padding: 6 }}>
              {notices.map((notice) => (
                <NoticeRow key={notice.key} notice={notice} unread={unreadKeys.has(notice.key)} onOpen={() => openNotice(notice)} />
              ))}
            </div>
          )}
        </Floating>
      ) : null}
    </>
  );
}

function MarkAll({ onClick }: { onClick: () => void }): JSX.Element {
  const hover = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...hover.bind}
      style={{
        border: 'none',
        cursor: 'pointer',
        background: hover.on ? color.brandWash : 'transparent',
        color: color.brandDeep,
        borderRadius: radius.sm,
        padding: '4px 8px',
        fontSize: 11.5,
        fontWeight: 700,
        fontFamily: font.body
      }}
    >
      Mark all read
    </button>
  );
}

const KIND_TONE = {
  assigned: color.blue,
  estimated: color.brand,
  info: color.rose
} as const;

function NoticeRow({ notice, unread, onOpen }: { notice: Notice; unread: boolean; onOpen: () => void }): JSX.Element {
  const { state } = useApp();
  const hover = useRowHover({ background: color.surfaceMuted });
  const { who, did } = noticeAction(notice, state.people);
  const subject = notice.ticket === 'request' ? `${notice.id} ${notice.title}` : notice.title;
  const where = notice.ticket === 'request' ? [notice.deal, notice.client].filter(Boolean).join(' · ') : notice.client;
  /* a notice from another platform says which, since opening it switches platform */
  const elsewhere = notice.plat && notice.plat !== state.platform ? findPlatform(notice.plat)?.platform.name ?? notice.plat : '';
  const when = ago(notice.at);

  return (
    <div
      {...pressable(onOpen)}
      {...hover.bind}
      aria-label={`${unread ? 'Unread. ' : ''}${who} ${did} ${subject}`}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 10px 10px 8px',
        borderRadius: radius.md,
        cursor: 'pointer',
        background: unread ? color.brandWashTint : 'transparent',
        transition: 'background 100ms ease',
        ...hover.style
      }}
    >
      <span style={{ width: 7, flex: '0 0 7px', height: 7, borderRadius: '50%', marginTop: 12, background: unread ? color.red : 'transparent' }} aria-hidden="true" />
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        {notice.by ? (
          <Avatar username={notice.by} people={state.people} size={30} />
        ) : (
          /* typed into the sheet by hand, so nobody to show */
          <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: '50%', background: color.surfaceMuted, boxShadow: `0 0 0 2px ${color.surface}` }} />
        )}
        <span
          aria-hidden="true"
          style={{ position: 'absolute', right: -2, bottom: -2, width: 10, height: 10, borderRadius: '50%', background: KIND_TONE[notice.kind], boxShadow: `0 0 0 2px ${color.surface}` }}
        />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, lineHeight: 1.45, color: color.body }}>
          <span style={{ fontWeight: 700, color: color.ink }}>{who}</span> {did} <span style={{ fontWeight: 600, color: color.ink }}>{subject}</span>
        </span>
        <span style={{ display: 'block', fontSize: 11, color: color.faint, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[where, elsewhere, when].filter(Boolean).join(' · ')}
        </span>
      </span>
    </div>
  );
}
