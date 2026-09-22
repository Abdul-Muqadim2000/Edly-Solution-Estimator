import { useState, type ReactNode } from 'react';
import type { Solution } from '@/types';
import { useApp } from '@/state/AppProvider';
import type { DisplayPrefs } from '@/state/reducer';
import { color, font, radius, roleColor } from '@/theme';
import { hours } from '@/lib/format';
import { Field, useRowHover } from '@/components/ui';

/**
 * The catalog, as a table.
 *
 * A real grid rather than stacked flex rows: hours have to line up down the right-hand edge so
 * a salesperson can scan them, which is also why the column template is shared between the
 * header and every row.
 */

export const tableColumns = (narrow: boolean): string =>
  narrow ? '40px minmax(0, 1fr) 78px 32px' : '46px minmax(0, 1fr) 150px 96px 40px';

export interface CatalogRow {
  item: Solution;
  bundleId: string;
  bundleName: string;
}

function Row({
  row,
  columns,
  narrow,
  display,
  onGoBundle
}: {
  row: CatalogRow;
  columns: string;
  narrow: boolean;
  display: DisplayPrefs;
  onGoBundle: (id: string) => void;
}): JSX.Element {
  const { state, dispatch, estimate } = useApp();
  const [expanded, setExpanded] = useState(false);
  const { item } = row;

  const selected = Boolean(state.draft.sel[item.id]);
  const ownedByRequest = Object.values(state.requests).some((request) => request.csId === item.id && request.estId === state.openEstimation);
  const buffer = Number(state.draft.buf?.[item.id]) || 0;
  const hover = useRowHover({ background: selected ? color.brandWashRow : color.surfaceSoft });

  const roleId = state.draft.lineRole?.[item.id];
  const roleIndex = estimate.roles.findIndex((role) => role.id === roleId);

  const detail: [string, string][] = [
    ['Delivery form', item.form ?? '—'],
    item.status === 'Estimation' ? ['Status', 'Estimation — scoped and priced, not yet built'] : null,
    item.category ? ['Category', item.category + (item.subCategory ? ` · ${item.subCategory}` : '')] : null,
    ['Std deployment', item.deploy ?? 'Not recorded'],
    item.repeat !== null ? ['Repeat delivery', `${hours(item.repeat)} h`] : null,
    display.savings && item.build !== null ? ['Already engineered', `${hours(item.build)} h`] : null,
    item.account ? ['Client-held account', item.account] : null,
    item.integrations ? ['Integrations', item.integrations] : null,
    display.notes && item.notes ? ['Notes', item.notes] : null,
    display.notes && item.ref ? ['Reference', item.ref] : null
  ].filter((entry): entry is [string, string] => entry !== null);

  const badge = (text: string, bg: string, co: string, title?: string): JSX.Element => (
    <span key={text} title={title} style={{ fontSize: 10.5, fontWeight: 600, color: co, background: bg, borderRadius: radius.pill, padding: '2px 8px' }}>
      {text}
    </span>
  );

  return (
    <div style={{ borderTop: `1px solid ${color.hairlineSoft}`, background: selected ? color.brandWashPale : color.surface, transition: 'background 110ms ease', ...hover.style }} {...hover.bind}>
      <div
        onClick={() => setExpanded((value) => !value)}
        style={{ display: 'grid', gridTemplateColumns: columns, alignItems: 'center', padding: '11px 0', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div
            onClick={(event) => {
              event.stopPropagation();
              if (!ownedByRequest) dispatch({ type: 'toggleSolution', id: item.id });
            }}
            title={ownedByRequest ? 'Its hours already count through the custom request in this estimation — selectable in other estimations' : undefined}
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.sm,
              border: `1.5px solid ${ownedByRequest ? color.rule : selected ? color.brand : color.dashRule}`,
              background: ownedByRequest ? color.surfaceMuted : selected ? color.brand : color.surface,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <span style={{ color: color.onSolid, fontSize: 12, fontWeight: 700, lineHeight: 1, opacity: selected && !ownedByRequest ? 1 : 0 }}>✓</span>
          </div>
        </div>

        <div style={{ minWidth: 0, paddingRight: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: color.ink }}>{item.name}</span>
            <span style={{ fontFamily: font.mono, fontSize: 10, color: color.ghost }}>{item.id}</span>
            {item.status === 'In Development' ? badge('In development', color.amberWash, color.amber) : null}
            {item.status === 'Estimation'
              ? badge('Estimation', color.violetWash, color.violet, 'Scoped and priced by the estimation desk — not yet engineered, so hours are an estimate rather than a reuse figure')
              : null}
            {item.status === 'Sample' ? badge('Sample', color.amberWash, color.amber, 'Benchmark hours, not a delivery record') : null}
            {ownedByRequest ? badge('Counted as custom', color.surfaceMuted, color.muted, 'Its hours already count through the custom request in this estimation') : null}
            {item.first === null && item.status !== 'In Development' ? badge('No estimate', color.surfaceMuted, color.muted) : null}
            {roleIndex >= 0 ? (
              <span
                title="Billed at this role’s rate"
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: roleColor(roleIndex),
                  border: `1px solid ${roleColor(roleIndex)}`,
                  borderRadius: radius.pill,
                  padding: '2px 7px'
                }}
              >
                {estimate.roles[roleIndex]?.name}
              </span>
            ) : null}
            {row.bundleId ? (
              <span
                onClick={(event) => {
                  event.stopPropagation();
                  onGoBundle(row.bundleId);
                }}
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: color.brand,
                  background: color.brandWash,
                  borderRadius: radius.pill,
                  padding: '2px 8px',
                  cursor: 'pointer'
                }}
              >
                {row.bundleId} · {row.bundleName}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.5, paddingTop: 2 }}>{item.desc}</div>
        </div>

        {!narrow ? <div style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted }}>{item.deploy ?? '—'}</div> : null}

        <div style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, textAlign: 'right', color: color.ink }}>
          {item.first === null ? '—' : `${hours(item.first)} h`}
          {buffer > 0 && display.controls ? (
            <div style={{ fontSize: 10, fontWeight: 500, color: color.amber }}>+{hours(buffer)}</div>
          ) : null}
        </div>

        <div style={{ textAlign: 'center', color: color.ghost, fontSize: 11, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          ▼
        </div>
      </div>

      {expanded ? (
        <div style={{ padding: '2px 20px 16px 46px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '7px 28px', maxWidth: 820 }}>
            {detail.map(([key, value]) => (
              <div key={key} style={{ display: 'flex', gap: 12, fontSize: 12.5, lineHeight: 1.55 }}>
                <span style={{ flex: '0 0 132px', color: color.ghost }}>{key}</span>
                <span style={{ color: color.inkSoft, minWidth: 0 }}>{value}</span>
              </div>
            ))}
          </div>
          {display.controls && selected ? (
            <div style={{ marginTop: 10, maxWidth: 150 }}>
              <Field
                label="Risk buffer (h)"
                hint="Buffer hours for this line"
                type="number"
                min={0}
                mono
                value={buffer > 0 ? String(buffer) : ''}
                onChange={(value) => dispatch({ type: 'setLineBuffer', id: item.id, hours: value === '' ? null : Number(value) })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CatalogTable({
  rows,
  narrow,
  showBundleTag,
  onGoBundle,
  children
}: {
  rows: CatalogRow[];
  narrow: boolean;
  showBundleTag: boolean;
  onGoBundle: (id: string) => void;
  /** The empty state, rendered inside the card so it keeps the table's frame. */
  children?: ReactNode;
}): JSX.Element {
  const { display } = useApp();
  const columns = tableColumns(narrow);

  return (
    <div style={{ maxWidth: 1000, background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: columns,
          padding: '10px 0',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: color.ghost,
          background: color.surfaceSoft
        }}
      >
        <span />
        <span>Solution</span>
        {!narrow ? <span>Std deploy</span> : null}
        <span style={{ textAlign: 'right' }}>Est. hours</span>
        <span />
      </div>
      {rows.map((row) => (
        <Row
          key={row.item.id}
          row={{ ...row, bundleId: showBundleTag ? row.bundleId : '', bundleName: row.bundleName }}
          columns={columns}
          narrow={narrow}
          display={display}
          onGoBundle={onGoBundle}
        />
      ))}
      {children}
    </div>
  );
}
