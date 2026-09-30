import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useHover } from '@/lib/useHover';
import { boardColumns, neighbourColumn, type StageInfo } from '@/domain/stages';
import { color, font, radius, stageStyle } from '@/theme';
import { StageDot } from '@/components/stages';

/**
 * A kanban board: one column per stage, a card per item, moved by dragging, by the card's own stage
 * menu, or from the keyboard with Shift and the arrow keys on a focused card.
 *
 * Only the column changes on a move. The order inside a column is `order`'s (a deal's deadline, a
 * request's age), not where the card was dropped, because nothing stores a hand-made order and a
 * card that sprang back after a reload would read as a lost edit.
 *
 * The board scrolls sideways inside itself; the page never does.
 */
export interface BoardProps<T, K extends string> {
  /** What the board is to a screen reader, and the start of every announcement. */
  label: string;
  columns: readonly StageInfo<K>[];
  items: readonly T[];
  idOf: (item: T) => string;
  nameOf: (item: T) => string;
  columnOf: (item: T) => K;
  order?: (a: T, b: T, column: K) => number;
  /** Columns that show only their first few cards until asked, with how many: the finished ones. */
  collapse?: Partial<Record<K, number>>;
  /** False leaves an item where it is: no drag, no keyboard move. */
  movable?: (item: T) => boolean;
  /** False refuses a drop there. */
  accepts?: (item: T, to: K) => boolean;
  onMove: (item: T, to: K) => void;
  renderCard: (item: T) => ReactNode;
  /** The right of a column's header: "412 h". */
  tally?: (items: T[], column: K) => string;
  /** What an empty column says when nothing is being dragged. */
  emptyText?: string;
}

export function Board<T, K extends string>({
  label,
  columns,
  items,
  idOf,
  nameOf,
  columnOf,
  order,
  collapse,
  movable = () => true,
  accepts = () => true,
  onMove,
  renderCard,
  tally,
  emptyText = 'Nothing here'
}: BoardProps<T, K>): JSX.Element {
  const ids = useMemo(() => columns.map((column) => column.id), [columns]);
  const laid = useMemo(() => boardColumns(ids, items, columnOf, order), [ids, items, columnOf, order]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<K | null>(null);
  const [said, setSaid] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<K>>(new Set());
  /* the card moved from the keyboard remounts in its new column, so focus has to follow it there */
  const refocus = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const find = (id: string | null): T | undefined => (id ? items.find((item) => idOf(item) === id) : undefined);
  const labelOf = (id: K): string => columns.find((column) => column.id === id)?.label ?? id;
  const takes = (item: T, to: K): boolean => columnOf(item) !== to && accepts(item, to);

  const move = (item: T, to: K): void => {
    onMove(item, to);
    setSaid(`${nameOf(item)} moved to ${labelOf(to)}`);
  };

  useEffect(() => {
    const id = refocus.current;
    if (!id || !root.current) return;
    refocus.current = null;
    const card = [...root.current.querySelectorAll<HTMLElement>('[data-board-card]')].find((one) => one.dataset.boardCard === id);
    card?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  const endDrag = (): void => {
    setDragging(null);
    setOver(null);
  };

  const onCardKey = (item: T) => (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!event.shiftKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    /* a key in the card's own menu or field is that control's */
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (!movable(item)) return;
    event.preventDefault();
    const to = neighbourColumn(ids, columnOf(item), event.key === 'ArrowLeft' ? -1 : 1, (id) => accepts(item, id));
    if (!to) {
      setSaid(`${nameOf(item)} cannot move further that way`);
      return;
    }
    refocus.current = idOf(item);
    move(item, to);
  };

  return (
    <div ref={root}>
      <div
        role="region"
        aria-label={label}
        data-scroll="1"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 10,
          scrollSnapType: 'x proximity',
          scrollPaddingLeft: 2
        }}
      >
        {laid.map((column) => {
          const info = columns.find((one) => one.id === column.id);
          const cap = collapse?.[column.id];
          const open = expanded.has(column.id);
          const shown = cap !== undefined && !open ? column.items.slice(0, cap) : column.items;
          const hidden = column.items.length - shown.length;
          const tone = stageStyle(column.id);
          const held = find(dragging);
          const target = Boolean(held && takes(held, column.id));
          const lit = target && over === column.id;
          return (
            <section
              key={column.id}
              aria-label={`${info?.label ?? column.id}, ${column.items.length}`}
              onDragOver={(event: DragEvent<HTMLElement>) => {
                if (!target) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (over !== column.id) setOver(column.id);
              }}
              onDragLeave={(event: DragEvent<HTMLElement>) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setOver((now) => (now === column.id ? null : now));
              }}
              onDrop={(event: DragEvent<HTMLElement>) => {
                event.preventDefault();
                const item = find(dragging);
                endDrag();
                if (item && takes(item, column.id)) move(item, column.id);
              }}
              style={{
                /* narrow enough that all six of the hub's columns fit a 1440px screen side by side */
                flex: '1 0 214px',
                minWidth: 214,
                maxWidth: 380,
                scrollSnapAlign: 'start',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 340,
                background: lit ? tone.bg : color.surfaceMuted,
                borderWidth: 1,
                borderStyle: target ? 'dashed' : 'solid',
                borderColor: lit ? tone.dot : target ? tone.edge : color.hairline,
                /* the stage's rule along the top, drawn inside the border: a top border of its own
                   beside the dashed one a drag shows makes React warn on every drag */
                boxShadow: `inset 0 3px 0 ${tone.dot}`,
                borderRadius: radius.lg,
                transition: 'background 120ms ease, border-color 120ms ease'
              }}
            >
              {/* the hint is the header's tooltip: at this width it could only be cut short. The label
                  may take two lines, and every header keeps room for two, so the cards line up. */}
              <header title={info?.hint} style={{ padding: '13px 12px 9px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minHeight: 32 }}>
                  <span style={{ paddingTop: 4, display: 'inline-flex' }}>
                    <StageDot stage={column.id} />
                  </span>
                  <h3 style={{ flex: 1, minWidth: 0, margin: 0, fontFamily: font.body, fontSize: 12.5, lineHeight: '16px', fontWeight: 700, color: color.ink }}>{info?.label}</h3>
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: column.items.length > 0 ? tone.co : color.quiet,
                      background: column.items.length > 0 ? tone.bg : color.surface,
                      borderRadius: radius.pill,
                      padding: '1px 7px'
                    }}
                  >
                    {column.items.length}
                  </span>
                </div>
                <div style={{ fontFamily: font.mono, fontSize: 10.5, color: color.faint, minHeight: 14, marginTop: 2, paddingLeft: 15, whiteSpace: 'nowrap' }}>
                  {tally ? tally(column.items, column.id) : ''}
                </div>
              </header>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 8px 8px', flex: 1 }}>
                {shown.map((item) => {
                  const id = idOf(item);
                  const canMove = movable(item);
                  return (
                    <div
                      key={id}
                      data-board-card={id}
                      draggable={canMove}
                      onDragStart={(event: DragEvent<HTMLDivElement>) => {
                        if (!canMove) return;
                        event.dataTransfer.effectAllowed = 'move';
                        /* Firefox starts no drag without data */
                        event.dataTransfer.setData('text/plain', id);
                        setDragging(id);
                      }}
                      onDragEnd={endDrag}
                      onKeyDown={onCardKey(item)}
                      title={canMove ? 'Drag to another column, or press Shift and an arrow key' : undefined}
                      style={{ opacity: dragging === id ? 0.45 : 1, transition: 'opacity 120ms ease' }}
                    >
                      {renderCard(item)}
                    </div>
                  );
                })}
                {hidden > 0 || (open && cap !== undefined && column.items.length > cap) ? (
                  <MoreButton
                    onClick={() =>
                      setExpanded((now) => {
                        const next = new Set(now);
                        if (next.has(column.id)) next.delete(column.id);
                        else next.add(column.id);
                        return next;
                      })
                    }
                  >
                    {hidden > 0 ? `Show ${hidden} more` : 'Show fewer'}
                  </MoreButton>
                ) : null}
                {column.items.length === 0 ? (
                  <div
                    style={{
                      minHeight: 72,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      border: `1px dashed ${lit ? tone.dot : color.dashRule}`,
                      borderRadius: radius.md,
                      fontSize: 11.5,
                      color: lit ? tone.co : color.quiet,
                      padding: 12
                    }}
                  >
                    {target ? `Drop here to move it to ${info?.label ?? ''}` : emptyText}
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      {/* what a screen reader hears after a move, since the card leaves the column it was read in */}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {said}
      </div>
    </div>
  );
}

function MoreButton({ children, onClick }: { children: string; onClick: () => void }): JSX.Element {
  const hover = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...hover.bind}
      style={{
        border: 'none',
        borderRadius: radius.md,
        background: hover.on ? color.surface : 'transparent',
        color: hover.on ? color.ink : color.muted,
        cursor: 'pointer',
        fontFamily: font.body,
        fontSize: 11.5,
        fontWeight: 600,
        padding: '7px 10px',
        transition: 'background 120ms ease, color 120ms ease'
      }}
    >
      {children}
    </button>
  );
}
