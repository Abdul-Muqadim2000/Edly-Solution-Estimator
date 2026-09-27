import type { CatalogKind } from '@/domain/catalog';
import { useHover } from '@/lib/useHover';
import { color, font, radius } from '@/theme';

/**
 * Bundles or estimates, or both: the one filter the catalog page has.
 *
 * Its colours are the ones the rows use, green for what is built and violet for what is only
 * priced, so the control doubles as the legend.
 */

interface Option {
  kind: CatalogKind | null;
  label: string;
  count: number;
  tone: string;
  wash: string;
}

const LEGEND: Record<'all' | CatalogKind, string> = {
  all: 'Bundles are features built for a client before, delivered again for less. Estimates, in violet, were priced by the desk and never built.',
  bundles: 'Built for a client before, delivered again for less. Their hours come from real deliveries.',
  estimates: 'Priced by the estimation desk, never built. Their hours are a forecast, not a delivery record.'
};

export function KindFilter({
  kind,
  counts,
  onPick
}: {
  kind: CatalogKind | null;
  counts: Record<'all' | CatalogKind, number>;
  onPick: (kind: CatalogKind | null) => void;
}): JSX.Element {
  const options: Option[] = [
    { kind: null, label: 'All', count: counts.all, tone: color.ink, wash: color.surfaceMuted },
    { kind: 'bundles', label: 'Bundles', count: counts.bundles, tone: color.brandInk, wash: color.brandWash },
    { kind: 'estimates', label: 'Estimates', count: counts.estimates, tone: color.violet, wash: color.violetWash }
  ];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', marginBottom: 16, maxWidth: 1000 }}>
      <div
        role="group"
        aria-label="Show bundles, estimates or both"
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          gap: 2,
          padding: 3,
          background: color.surface,
          border: `1px solid ${color.hairline}`,
          borderRadius: radius.pill
        }}
      >
        {options.map((option) => (
          <KindButton key={option.label} option={option} on={option.kind === kind} onClick={() => onPick(option.kind)} />
        ))}
      </div>
      <span style={{ flex: '1 1 260px', fontSize: 12, color: color.muted, lineHeight: 1.5 }}>{LEGEND[kind ?? 'all']}</span>
    </div>
  );
}

function KindButton({ option, on, onClick }: { option: Option; on: boolean; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      {...h.bind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        border: 'none',
        cursor: 'pointer',
        borderRadius: radius.pill,
        padding: '6px 13px',
        fontFamily: font.body,
        fontSize: 12.5,
        fontWeight: 700,
        color: on || h.on ? option.tone : color.muted,
        background: on ? option.wash : h.on ? color.surfaceSoft : 'transparent',
        transition: 'background 120ms ease, color 120ms ease'
      }}
    >
      {option.kind ? (
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: option.kind === 'estimates' ? color.violet : color.brand }} />
      ) : null}
      {option.label}
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10.5,
          fontWeight: 600,
          borderRadius: radius.pill,
          padding: '1px 7px',
          background: on ? color.surface : color.hairlineSoft,
          color: on ? option.tone : color.muted
        }}
      >
        {option.count}
      </span>
    </button>
  );
}
