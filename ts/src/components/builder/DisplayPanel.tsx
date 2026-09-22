import { useApp } from '@/state/AppProvider';
import type { DisplayPrefs } from '@/state/reducer';
import { color, font, radius } from '@/theme';
import { Button, Popover, Row } from '@/components/ui';
import { useHover } from '@/lib/useHover';

/**
 * What sales lets the client see.
 *
 * "Present to client" is the one-click version; this panel is the fine-grained one. Flipping any
 * switch exits presenting, because otherwise the toggle would appear to do nothing.
 */

interface ToggleRow {
  key: keyof DisplayPrefs;
  label: string;
  sub: string;
}

const ROWS: ToggleRow[] = [
  { key: 'savings', label: 'Reuse savings & economics', sub: 'Savings pill, % bar, engineered hours' },
  { key: 'blendBuffer', label: 'Blend buffers into hours', sub: 'Buffers fold invisibly into each line' },
  { key: 'money', label: 'USD estimate', sub: 'Money total and rate field' },
  { key: 'notes', label: 'Internal notes & references', sub: 'Catalog notes and source links' },
  { key: 'controls', label: 'Estimation controls', sub: 'PM, QA, buffer and rate inputs' }
];

function Toggle({ row, on, onFlip }: { row: ToggleRow; on: boolean; onFlip: () => void }): JSX.Element {
  const hover = useHover();
  return (
    <div
      onClick={onFlip}
      {...hover.bind}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 6px',
        borderRadius: radius.md,
        cursor: 'pointer',
        background: hover.on ? color.surfaceMuted : 'transparent',
        transition: 'background 120ms ease'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: color.ink }}>{row.label}</div>
        <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.4 }}>{row.sub}</div>
      </div>
      <div
        style={{
          width: 34,
          height: 20,
          flex: '0 0 34px',
          borderRadius: radius.pill,
          background: on ? color.brand : '#CFCFCC',
          padding: 2,
          transition: 'background 150ms ease'
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#FFFFFF',
            transform: on ? 'translateX(14px)' : 'translateX(0px)',
            transition: 'transform 150ms ease'
          }}
        />
      </div>
    </div>
  );
}

export function DisplayPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { dispatch, display } = useApp();

  return (
    <Popover width={312} padding={14}>
      <Row gap={10} wrap={false} style={{ padding: '0 6px' }}>
        <span style={{ flex: 1, fontFamily: font.display, fontSize: 14, fontWeight: 600 }}>Display settings</span>
        <Button tone="ghost" onClick={onClose} style={{ background: color.surfaceMuted, width: 24, height: 24, padding: 0, fontSize: 13 }}>
          ×
        </Button>
      </Row>
      <div style={{ fontSize: 11.5, color: color.faint, lineHeight: 1.5, padding: '2px 6px 8px' }}>
        Choose what’s visible — e.g. before sharing your screen with a client.
      </div>
      {ROWS.map((row) => (
        <Toggle
          key={row.key}
          row={row}
          on={display[row.key]}
          /* setDisplay also clears presenting — see the reducer */
          onFlip={() => dispatch({ type: 'setDisplay', patch: { [row.key]: !display[row.key] } })}
        />
      ))}
      <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.5, borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 8, padding: '8px 6px 0' }}>
        “Present to client” overrides these while active; flipping a switch exits presenting.
      </div>
    </Popover>
  );
}
