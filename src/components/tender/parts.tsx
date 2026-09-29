import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Confidence, MatchKind, RequirementPriority } from '@/types';
import { color, font, radius } from '@/theme';
import { useHover } from '@/lib/useHover';
import { Chip, Field, TextArea } from '@/components/ui';

/** Small pieces the tender screens share. Colours come from theme.ts like everywhere else. */

export const KIND_LABEL: Record<MatchKind, string> = {
  catalog: 'In the catalog',
  partial: 'Partly in the catalog',
  custom: 'Custom, to the desk',
  out: 'Out of scope'
};

const KIND_TONE: Record<MatchKind, { bg: string; co: string }> = {
  catalog: { bg: color.brandWashDeep, co: color.brandInk },
  partial: { bg: color.violetWash, co: color.violet },
  custom: { bg: color.amberWash, co: color.amberInk },
  out: { bg: color.surfaceMuted, co: color.muted }
};

export function KindChip({ kind }: { kind: MatchKind }): JSX.Element {
  return (
    <Chip bg={KIND_TONE[kind].bg} co={KIND_TONE[kind].co}>
      {KIND_LABEL[kind]}
    </Chip>
  );
}

const CONFIDENCE_TONE: Record<Confidence, { bg: string; co: string }> = {
  high: { bg: color.brandWash, co: color.brandInk },
  medium: { bg: color.amberWash, co: color.amberInk },
  low: { bg: color.redWash, co: color.redInk }
};

export function ConfidenceChip({ value }: { value: Confidence }): JSX.Element {
  return (
    <Chip bg={CONFIDENCE_TONE[value].bg} co={CONFIDENCE_TONE[value].co} title="How sure the AI is. Check low ones against the catalog.">
      {value} confidence
    </Chip>
  );
}

/** Must or should, and a click flips it: tenders mislabel these often enough that it has to be quick. */
export function PriorityToggle({ value, onChange }: { value: RequirementPriority; onChange?: (value: RequirementPriority) => void }): JSX.Element {
  const h = useHover();
  const must = value === 'must';
  const style = {
    border: 'none',
    borderRadius: radius.pill,
    padding: '3px 10px',
    fontSize: 10.5,
    fontWeight: 700,
    fontFamily: font.body,
    background: must ? color.redWash : color.surfaceMuted,
    color: must ? color.redInk : color.muted,
    whiteSpace: 'nowrap' as const
  };
  if (!onChange) return <span style={style}>{must ? 'Must' : 'Should'}</span>;
  return (
    <button
      type="button"
      title={must ? 'Mandatory in the tender. Click if it is only desirable.' : 'Desirable in the tender. Click if it is mandatory.'}
      onClick={() => onChange(must ? 'should' : 'must')}
      {...h.bind}
      style={{ ...style, cursor: 'pointer', boxShadow: h.on ? `inset 0 0 0 1px ${must ? color.redEdge : color.ghost}` : 'none' }}
    >
      {must ? 'Must' : 'Should'}
    </button>
  );
}

/** A quiet text button, for the secondary actions on a row. */
export function TextButton({ children, onClick, tone = color.muted, title, disabled }: { children: ReactNode; onClick: () => void; tone?: string; title?: string; disabled?: boolean }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      {...h.bind}
      style={{
        border: 'none',
        background: 'transparent',
        padding: '2px 0',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: font.body,
        color: h.on && !disabled ? color.brandDeep : tone,
        textDecoration: h.on && !disabled ? 'underline' : 'none',
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </button>
  );
}

/** The filter pills above a list. Same look as the hub's. */
export function FilterPill({ children, on, onClick }: { children: ReactNode; on: boolean; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      {...h.bind}
      style={{
        border: `1px solid ${on ? color.brand : color.rule}`,
        cursor: 'pointer',
        borderRadius: radius.pill,
        padding: '6px 13px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: font.body,
        background: on ? color.brandWash : color.surface,
        color: on ? color.brandDeep : h.on ? color.ink : color.muted,
        whiteSpace: 'nowrap',
        transition: 'color 120ms ease, border-color 120ms ease'
      }}
    >
      {children}
    </button>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }): JSX.Element {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      style={{ width: 16, height: 16, margin: 0, accentColor: color.brand, cursor: 'pointer', flex: '0 0 auto' }}
    />
  );
}

/**
 * The tender's own wording, behind a toggle so a long list stays scannable. `label` replaces the
 * toggle's words, for a row that shows where the item came from on a line of its own.
 */
export function SourceQuote({ source, quote, label }: { source: string; quote: string; label?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  if (!quote) return label ? <span /> : <span style={{ fontSize: 11.5, color: color.faint }}>{source}</span>;
  return (
    <div style={{ minWidth: 0 }}>
      <TextButton onClick={() => setOpen((value) => !value)} title="What the tender actually says">
        {open ? 'Hide the tender wording' : label ?? `Tender wording, ${source}`}
      </TextButton>
      {open ? (
        <blockquote
          style={{
            margin: '6px 0 0',
            padding: '8px 12px',
            borderLeft: `3px solid ${color.brandEdge}`,
            background: color.brandWashTint,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: color.inkSoft,
            fontStyle: 'italic'
          }}
        >
          “{quote}”
          <div style={{ fontStyle: 'normal', fontSize: 11, color: color.faint, marginTop: 4 }}>{source}</div>
        </blockquote>
      ) : null}
    </div>
  );
}

/** A step in the tender stepper. */
export function StepPill({ n, label, meta, on, done, disabled, onClick }: { n: number; label: string; meta: string; on: boolean; done: boolean; disabled: boolean; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={on ? 'step' : undefined}
      {...h.bind}
      style={{
        flex: '1 1 200px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textAlign: 'left',
        border: `1px solid ${on ? color.brand : h.on && !disabled ? color.ghost : color.hairline}`,
        background: on ? color.brandWash : color.surface,
        borderRadius: radius.lg,
        padding: '12px 16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        fontFamily: font.body,
        transition: 'border-color 120ms ease, background 120ms ease'
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.pill,
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 auto',
          fontFamily: font.display,
          fontSize: 13,
          fontWeight: 700,
          background: done ? color.brand : on ? color.surface : color.surfaceMuted,
          color: done ? color.onSolid : on ? color.brandDeep : color.muted,
          border: on && !done ? `1.5px solid ${color.brand}` : 'none'
        }}
      >
        {done ? '✓' : n}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: font.display, fontSize: 14, fontWeight: 600, color: color.ink }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: color.muted, marginTop: 2 }}>{meta}</span>
      </span>
    </button>
  );
}

/**
 * The tab beside the steps. It is not a step and blocks nothing, so it has a count where a step has
 * its number, and a dashed edge until it is open.
 */
export function TabPill({ label, meta, count, on, onClick }: { label: string; meta: string; count: number; on: boolean; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      {...h.bind}
      style={{
        flex: '1 1 200px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textAlign: 'left',
        borderWidth: 1,
        borderStyle: on ? 'solid' : 'dashed',
        borderColor: on ? color.brand : h.on ? color.ghost : color.dashRule,
        background: on ? color.brandWash : color.surface,
        borderRadius: radius.lg,
        padding: '12px 16px',
        cursor: 'pointer',
        fontFamily: font.body,
        transition: 'border-color 120ms ease, background 120ms ease'
      }}
    >
      <span
        style={{
          minWidth: 28,
          height: 28,
          padding: '0 7px',
          boxSizing: 'border-box',
          borderRadius: radius.pill,
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 auto',
          fontFamily: font.display,
          fontSize: 12.5,
          fontWeight: 700,
          background: count > 0 ? color.amberWash : color.surfaceMuted,
          color: count > 0 ? color.amberInk : color.muted
        }}
      >
        {count}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: font.display, fontSize: 14, fontWeight: 600, color: color.ink }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: color.muted, marginTop: 2 }}>{meta}</span>
      </span>
    </button>
  );
}

/** A thin progress bar. */
export function Progress({ value, total }: { value: number; total: number }): JSX.Element {
  const share = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} style={{ height: 6, background: color.trackSoft, borderRadius: radius.pill, overflow: 'hidden' }}>
      <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: color.brand, transition: 'width 300ms ease' }} />
    </div>
  );
}

/**
 * A field that keeps what is typed to itself and hands it on when the person leaves the field or
 * presses Enter. Dispatching every keystroke would rewrite a whole tender, a few hundred
 * requirements of JSON, into browser storage on every character.
 */
export function DeferredField({
  label,
  value,
  onCommit,
  placeholder,
  multiline,
  list
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** Id of a datalist of suggestions. Single-line fields only. */
  list?: string;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  /* follow the stored value while nobody is typing, so an edit made elsewhere shows here */
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        commit();
      }}
    >
      {multiline ? (
        <TextArea label={label} value={draft} onChange={setDraft} placeholder={placeholder} />
      ) : (
        <Field label={label} value={draft} onChange={setDraft} placeholder={placeholder} onEnter={commit} list={list} />
      )}
    </div>
  );
}

/**
 * A review row's border: a coloured left edge for its status, and a hairline that darkens on
 * hover. Written as longhands on purpose. Mixing the `border` shorthand with a hover
 * `borderColor` made React warn each time the hover ended, and the hover colour also painted
 * over the status edge.
 */
export function rowEdge(hovered: boolean, accent: string): CSSProperties {
  const edge = hovered ? color.ghost : color.hairline;
  return { borderStyle: 'solid', borderWidth: '1px 1px 1px 3px', borderColor: `${edge} ${edge} ${edge} ${accent}` };
}
