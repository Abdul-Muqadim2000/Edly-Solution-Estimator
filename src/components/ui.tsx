import type { CSSProperties, ReactNode } from 'react';
import { color, font, radius, shadow } from '@/theme';
import { useFocus, useHover, type HoverState } from '@/lib/useHover';

/**
 * The small set of primitives every screen is built from.
 *
 * Styles are inline objects rather than classes: the palette lives in theme.ts, and keeping
 * presentation next to structure has kept this app's look consistent as it grew. If you add a
 * primitive, put its colours in theme.ts first.
 */

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  tone?: Tone;
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  pill?: boolean;
  style?: CSSProperties;
  /** Overrides the tone's default hover. */
  hover?: CSSProperties;
}

const TONES: Record<Tone, CSSProperties> = {
  primary: { background: color.red, color: color.onSolid, border: 'none' },
  secondary: { background: color.surface, color: color.ink, border: `1px solid ${color.rule}` },
  ghost: { background: 'transparent', color: color.muted, border: 'none' },
  danger: { background: color.surface, color: color.redInk, border: `1px solid ${color.rule}` },
  brand: { background: color.brandWash, color: color.brandDeep, border: `1.5px solid ${color.brand}` }
};

/* Hover states, mirroring the source design. Inline styles cannot do `:hover`, so every
   interactive primitive tracks it — see src/lib/useHover.ts. */
const TONE_HOVER: Record<Tone, CSSProperties> = {
  primary: { background: color.redDeep },
  secondary: { borderColor: color.ghost },
  ghost: { background: color.surfaceMuted, color: color.ink },
  danger: { borderColor: color.red, background: color.redWash, color: color.redInk },
  brand: { background: color.brandWashDeep, borderColor: color.brandDeep }
};

export function Button({ children, onClick, tone = 'secondary', size = 'md', disabled, title, pill, style, hover }: ButtonProps): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...h.bind}
      style={{
        ...TONES[tone],
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        borderRadius: pill ? radius.pill : radius.md,
        padding: size === 'sm' ? '6px 12px' : '10px 18px',
        fontSize: size === 'sm' ? 11.5 : 12.5,
        fontWeight: 700,
        fontFamily: font.body,
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
        ...style,
        ...(h.on && !disabled ? { ...TONE_HOVER[tone], ...hover } : null)
      }}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  bg = color.surfaceMuted,
  co = color.muted,
  title
}: {
  children: ReactNode;
  bg?: string;
  co?: string;
  title?: string;
}): JSX.Element {
  return (
    <span
      title={title}
      style={{
        background: bg,
        color: co,
        borderRadius: radius.pill,
        padding: '3px 10px',
        fontSize: 10.5,
        fontWeight: 700,
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  onClick,
  accent,
  border = color.hairline,
  padding = '18px 20px',
  style
}: {
  children: ReactNode;
  onClick?: () => void;
  accent?: string;
  border?: string;
  padding?: string;
  style?: CSSProperties;
}): JSX.Element {
  const h = useHover();
  return (
    <div
      onClick={onClick}
      {...(onClick ? h.bind : {})}
      style={{
        background: color.surface,
        border: `1px solid ${border}`,
        borderRadius: radius.xl,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : undefined,
        boxShadow: onClick ? undefined : shadow.card,
        transition: 'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
        ...style,
        ...(onClick && h.on ? { borderColor: color.brand, boxShadow: shadow.lift, transform: 'translateY(-2px)' } : null)
      }}
    >
      {accent ? <div style={{ height: 3, background: accent }} /> : null}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }): JSX.Element {
  return (
    <span
      title={hint}
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: color.muted,
        display: 'block'
      }}
    >
      {children}
    </span>
  );
}

/* Applied inline rather than via a stylesheet: the fields carry an inline `border`, and relying
   on an `!important` sheet rule to beat it proved unreliable. */
const FOCUS_RING: CSSProperties = {
  borderColor: color.brand,
  boxShadow: '0 0 0 3px rgba(0, 173, 144, 0.13)'
};

const inputStyle: CSSProperties = {
  width: '100%',
  border: `1px solid ${color.rule}`,
  borderRadius: radius.md,
  padding: '10px 12px',
  fontSize: 13.5,
  fontFamily: font.body,
  color: color.ink,
  background: color.surfaceSoft,
  outline: 'none',
  boxSizing: 'border-box'
};

export interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: 'text' | 'date' | 'number' | 'password';
  list?: string;
  min?: number;
  step?: number;
  flex?: string;
  mono?: boolean;
  onEnter?: () => void;
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = 'text',
  list,
  min,
  step,
  flex,
  mono,
  onEnter
}: FieldProps): JSX.Element {
  const focus = useFocus();
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex, minWidth: 0 }}>
      <Label hint={hint}>{label}</Label>
      <input
        type={type}
        value={value}
        list={list}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onEnter ? (event) => event.key === 'Enter' && onEnter() : undefined}
        {...focus.bind}
        style={{ ...inputStyle, fontFamily: mono ? font.mono : font.body, ...(focus.on ? FOCUS_RING : null) }}
      />
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  flex
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
  flex?: string;
}): JSX.Element {
  const focus = useFocus();
  const select = (
    <select
      value={value}
      title={hint}
      onChange={(event) => onChange(event.target.value as T)}
      {...focus.bind}
      style={{ ...inputStyle, padding: '10px 9px', fontSize: 13, ...(focus.on ? FOCUS_RING : null) }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  if (!label) return <span style={{ flex, minWidth: 0 }}>{select}</span>;
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex, minWidth: 0 }}>
      <Label hint={hint}>{label}</Label>
      {select}
    </label>
  );
}

export function TextArea({ label, value, onChange, placeholder }: Omit<FieldProps, 'type'>): JSX.Element {
  const focus = useFocus();
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <Label>{label}</Label>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        {...focus.bind}
        style={{ ...inputStyle, minHeight: 96, resize: 'vertical', lineHeight: 1.5, ...(focus.on ? FOCUS_RING : null) }}
      />
    </label>
  );
}

export function Stat({ value, label, tone = color.ink }: { value: string; label: string; tone?: string }): JSX.Element {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: 12, padding: '12px 16px', minWidth: 0 }}>
      <div style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, lineHeight: 1, color: tone }}>{value}</div>
      <div style={{ fontSize: 10.5, color: color.faint, marginTop: 5, letterSpacing: 0.3 }}>{label}</div>
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'warn' | 'bad' | 'good'; children: ReactNode }): JSX.Element {
  const palette = {
    warn: { bg: color.amberWash, bd: color.amberEdge, co: color.amberInk },
    bad: { bg: color.redWash, bd: color.redEdge, co: color.redInk },
    good: { bg: color.brandWash, bd: color.brandEdge, co: color.brandInk }
  }[tone];
  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        borderRadius: 12,
        padding: '12px 16px',
        fontSize: 12.5,
        color: palette.co,
        lineHeight: 1.6
      }}
    >
      {children}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div
      style={{
        border: `1px dashed ${color.dashRule}`,
        borderRadius: radius.xl,
        padding: '56px 28px',
        textAlign: 'center',
        background: color.surface
      }}
    >
      <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.6, marginTop: 6 }}>{body}</div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  width = 1060,
  padding = '24px 28px'
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  padding?: string;
}): JSX.Element {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(18, 18, 18, 0.55)',
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        data-scroll="1"
        style={{
          background: color.surface,
          borderRadius: radius.xl,
          width: '100%',
          maxWidth: width,
          maxHeight: '92vh',
          overflowY: 'auto',
          padding
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
          <Button tone="ghost" onClick={onClose} style={{ background: color.surfaceMuted, width: 32, height: 32, padding: 0, fontSize: 15 }}>
            ×
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A dropdown anchored under a header button. */
export function Popover({
  children,
  width = 376,
  align = 'right',
  padding = 16
}: {
  children: ReactNode;
  width?: number;
  align?: 'left' | 'right';
  padding?: number;
}): JSX.Element {
  return (
    <div
      data-scroll="1"
      style={{
        position: 'absolute',
        top: 'calc(100% + 12px)',
        left: align === 'left' ? 0 : undefined,
        right: align === 'right' ? 0 : undefined,
        width,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '76vh',
        overflow: 'auto',
        background: color.surface,
        border: `1px solid ${color.hairline}`,
        borderRadius: radius.lg,
        boxShadow: shadow.pop,
        padding,
        zIndex: 400
      }}
    >
      {children}
    </div>
  );
}

/** The pill-shaped search field. Its own focus ring, because an inline `outline: none`
    beats any stylesheet rule — see the note on FOCUS_RING. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  style
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  style?: CSSProperties;
}): JSX.Element {
  const focus = useFocus();
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      {...focus.bind}
      style={{
        border: `1px solid ${color.rule}`,
        borderRadius: radius.pill,
        padding: '11px 17px',
        fontSize: 13,
        fontFamily: font.body,
        color: color.ink,
        background: color.surface,
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
        ...style,
        ...(focus.on ? FOCUS_RING : null)
      }}
    />
  );
}

export interface LinkProps {
  href: string;
  children: ReactNode;
  style?: CSSProperties;
  hover?: CSSProperties;
  title?: string;
  /** Opens in a new tab. On by default — every link here points at edly.io. */
  external?: boolean;
}

/** An anchor with the design's hover behaviour baked in. */
export function Link({ href, children, style, hover, title, external = true }: LinkProps): JSX.Element {
  const h = useHover();
  return (
    <a
      href={href}
      title={title}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      {...h.bind}
      style={{
        textDecoration: 'none',
        transition: 'color 120ms ease, background 120ms ease',
        ...style,
        ...(h.on ? { color: color.red, ...hover } : null)
      }}
    >
      {children}
    </a>
  );
}

/** A clickable row or card: spreads hover handlers and merges a hovered style. */
export function useRowHover(hovered: CSSProperties): { bind: HoverState['bind']; style: CSSProperties } {
  const h = useHover();
  return { bind: h.bind, style: h.on ? hovered : {} };
}

export const Mono = ({ children, size = 11, tone = color.muted }: { children: ReactNode; size?: number; tone?: string }): JSX.Element => (
  <span style={{ fontFamily: font.mono, fontSize: size, color: tone }}>{children}</span>
);

export const Row = ({ children, gap = 10, align = 'center', wrap = true, style }: { children: ReactNode; gap?: number; align?: CSSProperties['alignItems']; wrap?: boolean; style?: CSSProperties }): JSX.Element => (
  <div style={{ display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap', alignItems: align, gap, ...style }}>{children}</div>
);

export const Spacer = (): JSX.Element => <span style={{ flex: 1 }} />;
