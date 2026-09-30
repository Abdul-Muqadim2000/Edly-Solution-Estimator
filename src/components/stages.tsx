import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ESTIMATION_STAGES, readBoardView, stageStep, type BoardView, type StageInfo } from '@/domain/stages';
import type { EstimationStage } from '@/types';
import { color, font, radius, shadow, stageStyle } from '@/theme';
import { readStorage, writeStorage } from '@/state/keys';
import { useFocus, useHover } from '@/lib/useHover';

/**
 * The pieces every stage is shown with: a dot, a chip, the six-step track, the menu that moves a
 * deal or a request, and the Cards / Board switch. The words and the order come from
 * domain/stages.ts and the colours from `stageStyle`, so the hub, the board, the builder and the
 * desk cannot disagree about where something stands.
 */

export function StageDot({ stage, size = 8 }: { stage: string; size?: number }): JSX.Element {
  return <span aria-hidden="true" style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius.pill, background: stageStyle(stage).dot }} />;
}

/** A stage as a label only, where it cannot be changed. */
export function StageChip({ stage, label, size = 'md', title }: { stage: string; label: string; size?: 'sm' | 'md'; title?: string }): JSX.Element {
  const style = stageStyle(stage);
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: style.bg,
        color: style.co,
        borderRadius: radius.pill,
        padding: size === 'sm' ? '3px 9px' : '4px 11px',
        fontSize: size === 'sm' ? 10.5 : 11,
        fontWeight: 700,
        whiteSpace: 'nowrap'
      }}
    >
      <StageDot stage={stage} size={6} />
      {label}
    </span>
  );
}

/** How far along the six stages a deal is: one segment per stage, filled up to the one it is at. */
export function StageTrack({ stage, height = 4, gap = 3, style }: { stage: EstimationStage; height?: number; gap?: number; style?: CSSProperties }): JSX.Element {
  const step = stageStep(stage);
  const fill = stageStyle(stage).dot;
  return (
    <span
      role="img"
      aria-label={`Step ${step} of ${ESTIMATION_STAGES.length}`}
      style={{ display: 'flex', gap, alignItems: 'center', ...style }}
    >
      {ESTIMATION_STAGES.map((one, i) => (
        <span key={one.id} style={{ flex: 1, minWidth: 4, height, borderRadius: height, background: i < step ? fill : color.gridLine, transition: 'background 160ms ease' }} />
      ))}
    </span>
  );
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" style={{ flex: '0 0 9px', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 140ms ease' }}>
      <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MENU_WIDTH = 288;

/**
 * The button that shows where something stands, and the menu that moves it.
 *
 * The menu is drawn in a portal at a fixed position, because the board's columns scroll sideways and
 * would clip it, and because a menu inside a draggable card would drag the card. React still bubbles
 * its events through the card, so every click and key here stops at the menu: a pick must not also
 * open the deal the card links to.
 *
 * `stepper` numbers the items and ticks the ones already passed, which is what "where it stands"
 * looks like for a deal. A stage `refuses` is listed but cannot be picked, with its reason.
 */
export function StagePicker<K extends string>({
  stages,
  value,
  onChange,
  refuses,
  variant = 'chip',
  stepper = false,
  label = 'Stage'
}: {
  stages: readonly StageInfo<K>[];
  value: K;
  onChange: (next: K) => void;
  refuses?: (stage: K) => string | null;
  /**
   * `chip` sits on a card; `header` is the builder's pill, with the track in it; `move` is a quiet
   * "Move" for a board card, whose column already says where it stands.
   */
  variant?: 'chip' | 'header' | 'move';
  stepper?: boolean;
  /** What the button is to a screen reader: "Stage", "Desk status". */
  label?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  /* where the button was when the menu opened; the menu is placed from it once it can be measured */
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number } | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const hover = useHover();
  const current = stages.find((one) => one.id === value) ?? stages[0];
  const style = stageStyle(value);
  const at = Math.max(0, stages.findIndex((one) => one.id === value));

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  const show = (): void => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left });
    setPlace(null);
    setOpen(true);
  };

  /* Measured before it paints: below the button, above it when below runs off the window and above
     does not, and otherwise as low as the window allows. */
  useLayoutEffect(() => {
    if (!open || !anchor || !menu.current) return;
    const height = menu.current.offsetHeight;
    const width = menu.current.offsetWidth;
    const room = window.innerHeight - 8;
    const below = anchor.bottom + 6;
    const above = anchor.top - height - 6;
    const top = below + height <= room ? below : above >= 8 ? above : Math.max(8, room - height);
    setPlace({ top, left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (menu.current?.contains(target) || button.current?.contains(target))) return;
      setOpen(false);
    };
    /* a fixed menu would stay put while the page or a column scrolled away under it */
    const scrolled = (event: Event): void => {
      if (menu.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const resized = (): void => setOpen(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
    };
  }, [open]);

  /* once placed, not before: a menu still hidden for measuring cannot take focus */
  const placed = Boolean(place);
  useEffect(() => {
    if (!open || !placed) return;
    const first = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    /* without preventScroll a focus can scroll the page, which the listener above takes as a reason to close */
    first?.focus({ preventScroll: true });
  }, [open, placed]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const now = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (now + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const header = variant === 'header';
  const quiet = variant === 'move';

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ''}. Change`}
        title={current?.hint}
        {...hover.bind}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close(false);
          else show();
        }}
        onKeyDown={(event) => {
          /* the card around it opens on Enter; this key belongs to the button */
          event.stopPropagation();
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            show();
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: header ? 8 : 6,
          maxWidth: '100%',
          cursor: 'pointer',
          fontFamily: font.body,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          borderRadius: radius.pill,
          borderWidth: header ? 1.5 : 1,
          borderStyle: 'solid',
          borderColor: quiet ? (open || hover.on ? color.rule : 'transparent') : open || hover.on ? style.dot : header ? style.edge : 'transparent',
          background: quiet ? (open || hover.on ? color.surfaceMuted : 'transparent') : header ? (open || hover.on ? style.bg : color.surface) : style.bg,
          color: quiet ? (open || hover.on ? color.ink : color.muted) : style.co,
          padding: header ? '6px 12px' : quiet ? '3px 8px' : '4px 9px 4px 8px',
          fontSize: header ? 12 : 11,
          transition: 'border-color 120ms ease, background 120ms ease'
        }}
      >
        {quiet ? null : <StageDot stage={value} size={header ? 8 : 7} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{quiet ? 'Move' : current?.label}</span>
        {header && stepper ? <StageTrack stage={value as unknown as EstimationStage} height={4} gap={2} style={{ width: 54 }} /> : null}
        <Chevron open={open} />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              data-scroll="1"
              onKeyDown={onMenuKey}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              style={{
                position: 'fixed',
                top: place?.top ?? anchor?.bottom ?? 0,
                left: place?.left ?? anchor?.left ?? 0,
                visibility: place ? 'visible' : 'hidden',
                width: MENU_WIDTH,
                maxWidth: 'calc(100vw - 16px)',
                background: color.surface,
                border: `1px solid ${color.hairline}`,
                borderRadius: radius.lg,
                boxShadow: shadow.pop,
                padding: 8,
                zIndex: 700
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.muted, padding: '4px 8px 6px' }}>
                {stepper ? `${label}: step ${at + 1} of ${stages.length}` : label}
              </div>
              {stages.map((one, i) => {
                const refused = refuses?.(one.id) ?? null;
                return (
                  <MenuItem
                    key={one.id}
                    stage={one}
                    picked={one.id === value}
                    passed={stepper && i < at}
                    number={stepper ? i + 1 : null}
                    last={i === stages.length - 1}
                    refused={refused}
                    onPick={() => {
                      close(true);
                      if (one.id !== value) onChange(one.id);
                    }}
                  />
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function MenuItem<K extends string>({
  stage,
  picked,
  passed,
  number,
  last,
  refused,
  onPick
}: {
  stage: StageInfo<K>;
  picked: boolean;
  passed: boolean;
  number: number | null;
  last: boolean;
  refused: string | null;
  onPick: () => void;
}): JSX.Element {
  const hover = useHover();
  const focus = useFocus();
  const style = stageStyle(stage.id);
  const lit = !refused && (hover.on || focus.on);
  const marker: ReactNode =
    number === null ? (
      <StageDot stage={stage.id} size={9} />
    ) : (
      <span
        aria-hidden="true"
        style={{
          width: 20,
          height: 20,
          flex: '0 0 20px',
          borderRadius: radius.pill,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10.5,
          fontWeight: 700,
          fontFamily: font.mono,
          background: picked ? style.dot : passed ? style.bg : color.surface,
          color: picked ? color.onSolid : passed ? style.co : color.faint,
          border: `1.5px solid ${picked || passed ? style.dot : color.rule}`
        }}
      >
        {passed ? '✓' : number}
      </span>
    );

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={picked}
      disabled={Boolean(refused)}
      title={refused ?? undefined}
      onClick={onPick}
      {...focus.bind}
      {...hover.bind}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        border: 'none',
        cursor: refused ? 'not-allowed' : 'pointer',
        borderRadius: radius.md,
        padding: '8px 8px',
        fontFamily: font.body,
        background: picked ? style.bg : lit ? color.surfaceMuted : 'transparent',
        opacity: refused ? 0.55 : 1,
        transition: 'background 120ms ease'
      }}
    >
      {/* the line joining one step to the next, so the list reads as a track */}
      {number !== null && !last ? (
        <span aria-hidden="true" style={{ position: 'absolute', left: 17, top: 30, bottom: -6, width: 2, background: passed ? style.dot : color.hairline, borderRadius: 2 }} />
      ) : null}
      <span style={{ paddingTop: number === null ? 4 : 0, display: 'inline-flex' }}>{marker}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: picked ? 700 : 600, color: picked ? style.co : color.ink, lineHeight: 1.3 }}>{stage.label}</span>
        <span style={{ display: 'block', fontSize: 11, color: color.faint, lineHeight: 1.4, marginTop: 1 }}>{refused ?? stage.hint}</span>
      </span>
      {picked ? (
        <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 700, color: style.co, paddingTop: 1 }}>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------ cards / board */

function CardsIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 14 14">
      <rect x="1" y="1" width="5.2" height="5.2" rx="1.4" fill="currentColor" />
      <rect x="7.8" y="1" width="5.2" height="5.2" rx="1.4" fill="currentColor" />
      <rect x="1" y="7.8" width="5.2" height="5.2" rx="1.4" fill="currentColor" />
      <rect x="7.8" y="7.8" width="5.2" height="5.2" rx="1.4" fill="currentColor" />
    </svg>
  );
}

function BoardIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 14 14">
      <rect x="1" y="1" width="3.4" height="12" rx="1.2" fill="currentColor" />
      <rect x="5.3" y="1" width="3.4" height="8" rx="1.2" fill="currentColor" />
      <rect x="9.6" y="1" width="3.4" height="10" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function SwitchButton({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: ReactNode; children: string }): JSX.Element {
  const hover = useHover();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      {...hover.bind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: 'none',
        cursor: 'pointer',
        borderRadius: radius.pill,
        padding: '5px 12px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: font.body,
        background: on ? color.brandWash : 'transparent',
        color: on ? color.brandDeep : hover.on ? color.ink : color.muted,
        boxShadow: on ? `inset 0 0 0 1px ${color.brandEdge}` : undefined,
        whiteSpace: 'nowrap',
        transition: 'background 120ms ease, color 120ms ease'
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** Cards or board, as a two-way switch. */
export function ViewSwitch({ view, onChange }: { view: BoardView; onChange: (next: BoardView) => void }): JSX.Element {
  return (
    <div
      role="group"
      aria-label="View"
      style={{ display: 'inline-flex', gap: 2, padding: 3, border: `1px solid ${color.rule}`, borderRadius: radius.pill, background: color.surface }}
    >
      <SwitchButton on={view === 'cards'} onClick={() => onChange('cards')} icon={<CardsIcon />}>
        Cards
      </SwitchButton>
      <SwitchButton on={view === 'board'} onClick={() => onChange('board')} icon={<BoardIcon />}>
        Board
      </SwitchButton>
    </div>
  );
}

/** This browser's choice of view for one list, remembered across visits. Storage that throws leaves the cards. */
export function useStoredView(key: string): [BoardView, (next: BoardView) => void] {
  const [view, setView] = useState<BoardView>(() => readBoardView(readStorage<unknown>(key, 'cards')));
  const choose = useCallback(
    (next: BoardView) => {
      setView(next);
      writeStorage(key, next);
    },
    [key]
  );
  return [view, choose];
}
