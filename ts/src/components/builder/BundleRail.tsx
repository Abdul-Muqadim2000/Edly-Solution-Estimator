import type { Bundle, Solution } from '@/types';
import { useApp } from '@/state/AppProvider';
import { color, font, radius } from '@/theme';
import { useRowHover } from '@/components/ui';

/**
 * The bundle rail.
 *
 * A vertical sidebar at desktop width and a wrapping row of chips below ~1020px — the same
 * element either way, so the selected-count badges and the "All solutions" entry never diverge
 * between breakpoints.
 */

export interface RailEntry {
  key: string;
  tag: string;
  name: string;
  total: number;
  selected: number;
}

export function railEntries(bundles: readonly Bundle[], everySolution: readonly Solution[], sel: Record<string, boolean>): RailEntry[] {
  const count = (items: readonly Solution[]): number => items.filter((item) => sel[item.id]).length;
  return [
    { key: 'ALL', tag: 'ALL', name: 'All solutions', total: everySolution.length, selected: count(everySolution) },
    ...bundles.map((bundle) => ({
      key: bundle.id,
      tag: bundle.id,
      name: bundle.name,
      total: bundle.items.length,
      selected: count(bundle.items)
    }))
  ];
}

function RailRow({ entry, on, narrow, onPick }: { entry: RailEntry; on: boolean; narrow: boolean; onPick: () => void }): JSX.Element {
  const hover = useRowHover({ background: color.surfaceMuted });
  const hasSelection = entry.selected > 0;
  return (
    <div
      onClick={onPick}
      {...hover.bind}
      style={{
        flex: narrow ? '0 0 auto' : 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 10px',
        borderRadius: radius.md,
        cursor: 'pointer',
        background: on ? color.brandWash : 'transparent',
        transition: 'background 120ms ease',
        ...hover.style
      }}
    >
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          fontWeight: 600,
          width: 27,
          flex: '0 0 27px',
          color: on ? color.brand : '#9C9C9C'
        }}
      >
        {entry.tag}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: '#333333', lineHeight: 1.25 }}>{entry.name}</span>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10.5,
          fontWeight: 600,
          borderRadius: radius.pill,
          padding: '2px 7px',
          background: hasSelection ? color.brand : color.hairlineSoft,
          color: hasSelection ? '#FFFFFF' : color.muted
        }}
      >
        {hasSelection ? `${entry.selected}/${entry.total}` : entry.total}
      </span>
    </div>
  );
}

export function BundleRail({
  entries,
  active,
  narrow,
  metaLine,
  metaFoot,
  onPick,
  onBack,
  estimationLabel
}: {
  entries: RailEntry[];
  active: string;
  narrow: boolean;
  metaLine: string;
  metaFoot: string;
  onPick: (key: string) => void;
  onBack: () => void;
  estimationLabel: string;
}): JSX.Element {
  const back = useRowHover({ background: '#D6F2EA' });

  return (
    <nav
      style={{
        background: color.surface,
        borderRight: narrow ? 'none' : `1px solid ${color.hairline}`,
        borderBottom: narrow ? `1px solid ${color.hairline}` : 'none',
        overflowY: narrow ? 'visible' : 'auto',
        padding: narrow ? '12px 14px' : '14px 10px 10px',
        display: 'flex',
        flexDirection: narrow ? 'row' : 'column',
        flexWrap: narrow ? 'wrap' : 'nowrap',
        gap: narrow ? 6 : 2
      }}
    >
      <div
        onClick={onBack}
        {...back.bind}
        title="Saved automatically — back to all estimations"
        style={{
          flex: narrow ? '0 0 auto' : 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '0 2px 10px',
          padding: '10px 12px',
          borderRadius: 10,
          cursor: 'pointer',
          background: color.brandWash,
          border: `1px solid ${color.brandEdge}`,
          transition: 'background 120ms ease',
          ...back.style
        }}
      >
        <span style={{ color: color.brandDeep, fontSize: 14, lineHeight: 1 }}>←</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: color.brandDeep }}>All estimations</div>
          <div style={{ fontSize: 10.5, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {estimationLabel}
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: color.ghost,
          padding: '0 12px 8px',
          flex: narrow ? '0 0 100%' : 'none'
        }}
      >
        Bundles
      </div>

      {entries.map((entry) => (
        <RailRow key={entry.key} entry={entry} on={active === entry.key} narrow={narrow} onPick={() => onPick(entry.key)} />
      ))}

      <div
        style={{
          display: narrow ? 'none' : 'block',
          marginTop: 'auto',
          padding: '14px 12px 6px',
          fontSize: 11,
          color: color.faint,
          lineHeight: 1.7,
          borderTop: `1px solid ${color.hairlineSoft}`
        }}
      >
        {metaLine}
        <br />
        {metaFoot}
      </div>
    </nav>
  );
}

/** Bundle pitch, offer-when chips, stat line and the select-all controls. */
export function BundleHeader({
  bundle,
  selectedCount,
  stat,
  onSelectAll,
  onClear,
  onGoBundle
}: {
  bundle: Bundle;
  selectedCount: number;
  stat: string;
  onSelectAll: () => void;
  onClear: () => void;
  onGoBundle: (id: string) => void;
}): JSX.Element {
  const { catalog } = useApp();
  const chips = (bundle.offerWhen || '').split(/[,;·]/).map((part) => part.trim()).filter(Boolean);
  const pairs = (bundle.pairsWith || '')
    .split(/[,;·]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => {
      const match = /^(B\d{1,3}|C[BX]-?\d*)/i.exec(label);
      const target = match ? catalog.bundles.find((candidate) => candidate.id.toUpperCase() === match[1]!.toUpperCase()) : undefined;
      return { label, id: target?.id ?? '' };
    });

  return (
    <div style={{ marginBottom: 18, maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 11.5,
            fontWeight: 600,
            color: color.brand,
            background: color.brandWash,
            borderRadius: radius.sm,
            padding: '3px 8px'
          }}
        >
          {bundle.id}
        </span>
        {bundle.inDev > 0 ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: color.amber, background: color.amberWash, borderRadius: radius.pill, padding: '3px 10px' }}>
            {bundle.inDev >= bundle.items.length ? 'In development' : `${bundle.inDev} items in development`}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {selectedCount > 0 ? (
          <span style={{ fontSize: 12, color: color.brand, fontWeight: 600 }}>
            {selectedCount} of {bundle.items.length} selected
          </span>
        ) : null}
        <>
            <button
              type="button"
              onClick={onSelectAll}
              style={{
                border: `1px solid ${color.brand}`,
                background: color.surface,
                color: color.brand,
                borderRadius: 8,
                padding: '7px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: font.body
              }}
            >
              Select all {bundle.items.length}
            </button>
            <button
              type="button"
              onClick={onClear}
              style={{
                border: `1px solid ${color.hairline}`,
                background: color.surface,
                color: color.muted,
                borderRadius: 8,
                padding: '7px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: font.body
              }}
            >
              Clear
            </button>
        </>
      </div>

      <h1 style={{ fontFamily: font.display, fontSize: 27, fontWeight: 700, margin: '12px 0 8px', letterSpacing: -0.3 }}>{bundle.name}</h1>
      {bundle.pitch ? (
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: color.body, margin: 0, maxWidth: 760, textWrap: 'pretty' }}>{bundle.pitch}</p>
      ) : null}

      {chips.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: color.ghost }}>
            Offer when they ask about
          </span>
          {chips.map((chip) => (
            <span key={chip} style={{ fontSize: 12, fontWeight: 500, color: color.inkSoft, background: color.surfaceMuted, borderRadius: radius.pill, padding: '4px 12px' }}>
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          marginTop: 12,
          fontFamily: font.mono,
          fontSize: 11.5,
          color: color.muted
        }}
      >
        <span>{stat}</span>
        {pairs.length > 0 ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: font.body }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: color.ghost }}>Pairs with</span>
            {pairs.map((pair) => (
              <span
                key={pair.label}
                onClick={() => pair.id && onGoBundle(pair.id)}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: color.brand,
                  border: `1px solid ${color.brandEdge}`,
                  borderRadius: radius.pill,
                  padding: '3px 10px',
                  cursor: pair.id ? 'pointer' : 'default'
                }}
              >
                {pair.label}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
