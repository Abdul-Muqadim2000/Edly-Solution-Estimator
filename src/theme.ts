/**
 * The visual vocabulary, in one place.
 * Taken from edly.io — do not invent new values, extend this file instead.
 */

export const color = {
  ink: '#252525',
  inkSoft: '#3C3C3C',
  /** The deepest ink, reserved for the dark estimate column. */
  inkDeep: '#1B1B1B',
  body: '#4A4A4A',
  /** Long-form body copy that should sit back from `body` — the hero blurb. */
  bodySoft: '#5A5A5A',
  muted: '#6E6E6E',
  faint: '#8F8F8B',
  ghost: '#9C9C97',
  /** The quietest label tone — hero footnotes and buffer bars. */
  dim: '#8A8A85',
  /** Disclosure chevrons and the resting edge of a toggle. */
  chevron: '#9C9C9C',
  /** A figure or label standing at zero — nothing to report yet. */
  quiet: '#A8A8A3',
  hairline: '#E5E5E3',
  hairlineSoft: '#F0F0EE',
  rule: '#DBDBD8',
  /** Dashed edges: empty drop targets and off-state toggles. */
  dashRule: '#CFCFCC',
  page: '#F7F7F5',
  surface: '#FFFFFF',
  surfaceSoft: '#FBFBFA',
  /** Form-field fill, straight from the source design. */
  fieldBg: '#FAFAF8',
  surfaceMuted: '#F4F4F2',
  /** The planner's empty track. */
  trackSoft: '#F6F6F4',
  /** Hairline grid lines drawn inside charts and the planner. */
  gridLine: '#ECECEA',

  /** Text and icons on a solid fill — brand, red, ink or dark. */
  onSolid: '#FFFFFF',
  black: '#000000',

  brand: '#00AD90',
  brandDeep: '#00846F',
  brandInk: '#0A6B5B',
  /** Brand ink at reading weight on a pale wash. */
  brandInkSoft: '#3D6B62',
  brandWash: '#EBF9F6',
  brandWashDeep: '#E2F7F1',
  /** The brand washes, palest first — row hovers, picked rows, callout panels. */
  brandWashTint: '#FAFDFC',
  brandWashSoft: '#F5FCFA',
  brandWashPale: '#F0FAF7',
  brandWashPicked: '#EDF9F5',
  brandWashRow: '#E7F6F1',
  brandChip: '#CBEFE6',
  brandEdge: '#A8E0D3',
  brandEdgePale: '#BFE7DD',
  brandEdgeFaint: '#CFE8E1',
  /** The hairline around the auth card and hero surfaces. */
  brandEdgeSoft: '#DCEFE9',
  /** A filled capacity bar that is within its cap. */
  brandBar: '#9BDCCB',
  /** Brand surfaces that sit on a dark panel rather than on the page. */
  brandOnDark: '#173B33',
  brandOnDarkEdge: '#2E6B5C',
  /** The focus ring behind a focused field. */
  focusRing: '#D6F2EA',
  brandGlow: '#5FD9C0',

  red: '#DD1F25',
  redDeep: '#B81920',
  redInk: '#C0161C',
  redWash: '#FDECEC',
  redEdge: '#F3B9BB',
  /** Red legible on a dark panel, where `red` reads as muddy. */
  redGlow: '#FF9B9B',
  redGlowBright: '#FF8B8B',
  redOnDark: '#3A2222',
  redOnDarkEdge: '#5A3A3A',

  amber: '#B45309',
  amberInk: '#8A5A12',
  amberWash: '#FDF3E3',
  amberEdge: '#F0C68A',
  amberEdgeSoft: '#F5DCB4',
  /** Amber legible on a dark panel. */
  amberGlow: '#F3C88B',
  amberOnDark: '#3B3222',

  violet: '#5B3FBF',
  violetWash: '#F0ECFB',

  dark: '#242424',
  darkSoft: '#363636',
  /** The raised state of a control on a dark panel. */
  panelRaise: '#414141',
  panelEdge: '#4A4A48',
  /** The footer's inset fields and their edges. */
  footerField: '#333333',
  footerFieldEdge: '#4C4C4A',
  onDark: '#EFEFEB',
  /** On-dark text, brightest to quietest. */
  onDarkBright: '#E8E8E4',
  onDarkSoft: '#C9C9C4',
  onDarkDim: '#C2C2BE',
  onDarkQuiet: '#BDBDB8',
  onDarkMuted: '#B3B3AE',
  onDarkFaint: '#9C9C97',
  onDarkRule: '#3D3D3B',

  /** Unassigned planner bars: must not collide with any rate-card role colour. */
  unassigned: '#5A6B66',
  custom: '#F3A33C',
  buffer: '#8A8A85',
  overhead: '#4DC6B1'
} as const;

/** Rate-card role colours, in assignment order. */
export const ROLE_COLORS = ['#00AD90', '#5B3FBF', '#DD1F25', '#B45309', '#0A6B5B', '#2563A8', '#8A5A12'] as const;

export function roleColor(index: number): string {
  return ROLE_COLORS[index % ROLE_COLORS.length]!;
}

export const font = {
  display: "'Poppins', sans-serif",
  body: "'DM Sans', sans-serif",
  mono: "'IBM Plex Mono', monospace"
} as const;

export const radius = { sm: 6, md: 9, lg: 14, xl: 16, pill: 999 } as const;

export const shadow = {
  card: '0 10px 26px rgba(20, 20, 20, 0.08)',
  lift: '0 14px 32px rgba(20, 20, 20, 0.09)',
  pop: '0 18px 44px rgba(20, 20, 20, 0.18)',
  brand: '0 12px 30px rgba(0, 173, 144, 0.08)',
  /** The sign-in card sits higher off the page than any other surface. */
  auth: '0 22px 54px rgba(20, 20, 20, 0.10)'
} as const;

export const tagStyle = (tag: string): { bg: string; co: string } =>
  ({
    Active: { bg: color.brandWashDeep, co: color.brandInk },
    Urgent: { bg: color.redWash, co: color.redInk },
    'On hold': { bg: color.amberWash, co: color.amber },
    Closed: { bg: color.surfaceMuted, co: color.muted }
  })[tag] ?? { bg: color.brandWashDeep, co: color.brandInk };

export interface DueInfo {
  label: string;
  bg: string;
  co: string;
}

/** Deadline chip — urgency comes from the date, not from a manual flag. */
export function dueInfo(due: string | undefined | null): DueInfo | null {
  if (!due) return null;
  const days = Math.round((new Date(due).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86_400_000);
  if (days < 0) return { label: `Overdue · was due ${due}`, bg: color.redWash, co: color.redInk };
  if (days === 0) return { label: 'Due today', bg: color.redWash, co: color.redInk };
  if (days <= 7) return { label: `Due ${due} · ${days}d left`, bg: color.amberWash, co: color.amber };
  return { label: `Due ${due}`, bg: color.surfaceMuted, co: color.inkSoft };
}
