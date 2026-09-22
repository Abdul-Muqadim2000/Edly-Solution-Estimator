import { useState, type CSSProperties, type ReactNode } from 'react';
import type { CurrencyCode } from '@/types';
import { useApp } from '@/state/AppProvider';
import { openEstimationRecord, openRequests } from '@/state/reducer';
import { allSolutions } from '@/domain/catalog';
import { findPlatform } from '@/data/practices';
import { EDLY_LINKS } from '@/data/nav';
import { color, font, roleColor } from '@/theme';
import { CURRENCIES, hours, hours1, money, plural, rateLabel } from '@/lib/format';
import { downloadQuote, quoteText } from '@/lib/quoteExport';
import { mailRequests } from '@/lib/mail';
import { Link } from '@/components/ui';
import { useFocus, useHover } from '@/lib/useHover';

/**
 * The dark estimate column: what is selected, what it adds up to, and every way out of it.
 *
 * Three stacked sections, matching the source design — the controls block, the scrolling line
 * list, and the totals plinth that sits on a darker background so the grand total reads as the
 * one number in the room.
 */

const INK = '#1B1B1B';
const PANEL = '#363636';
const EDGE = '#4A4A48';
const AMBER = '#F3C88B';

const darkFieldStyle: CSSProperties = {
  background: INK,
  border: `1px solid ${EDGE}`,
  borderRadius: 8,
  color: '#FFFFFF',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: font.mono,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
};

const capLabel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: color.onDarkFaint
};

function DarkNumber({
  label,
  hint,
  value,
  max,
  onChange
}: {
  label: string;
  hint?: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
}): JSX.Element {
  const focus = useFocus();
  return (
    <label title={hint} style={capLabel}>
      {label}
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(0, Math.round(Number(event.target.value) || 0)))}
        {...focus.bind}
        style={{ ...darkFieldStyle, ...(focus.on ? { borderColor: color.brand } : null) }}
      />
    </label>
  );
}

/** The grey buttons in the totals plinth. */
function DarkButton({
  children,
  onClick,
  variant = 'grey',
  style
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'grey' | 'red' | 'brand' | 'dashed' | 'danger' | 'brandDashed';
  style?: CSSProperties;
}): JSX.Element {
  const h = useHover();
  const base: Record<string, { rest: CSSProperties; hover: CSSProperties }> = {
    grey: { rest: { border: `1px solid ${EDGE}`, background: PANEL, color: '#E8E8E4' }, hover: { background: '#414141' } },
    red: { rest: { border: 'none', background: color.red, color: '#FFFFFF' }, hover: { background: color.redDeep } },
    brand: { rest: { border: 'none', background: color.brand, color: '#FFFFFF' }, hover: { background: color.brandDeep } },
    dashed: { rest: { border: `1px dashed ${color.ghost}`, background: 'transparent', color: '#E8E8E4' }, hover: { background: PANEL } },
    danger: { rest: { border: '1px solid #5A3A3A', background: 'transparent', color: '#FF9B9B' }, hover: { background: '#3A2222' } },
    brandDashed: { rest: { border: `1px dashed ${color.brandGlow}`, background: 'transparent', color: color.brandGlow }, hover: { background: '#173B33' } }
  };
  const tone = base[variant]!;
  return (
    <button
      type="button"
      onClick={onClick}
      {...h.bind}
      style={{
        cursor: 'pointer',
        borderRadius: 9,
        padding: '10px 8px',
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: font.body,
        transition: 'background 120ms ease',
        ...tone.rest,
        ...style,
        ...(h.on ? tone.hover : null)
      }}
    >
      {children}
    </button>
  );
}

/** A removable line's × affordance. */
function Remove({ onClick }: { onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <span
      onClick={onClick}
      title="Remove"
      style={{ color: h.on ? '#FF8B8B' : color.dim, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}
      {...h.bind}
    >
      ×
    </span>
  );
}

export function SummaryPanel({ onOpenPlanner, onOpenRequest }: { onOpenPlanner: () => void; onOpenRequest: () => void }): JSX.Element {
  const { state, dispatch, catalog, estimate, display, plan } = useApp();
  const estimation = openEstimationRecord(state);
  const requests = openRequests(state);
  const currency = state.draft.cur ?? 'USD';
  const factor = display.blendBuffer ? 1 + estimate.bufPct / 100 : 1;

  const [flash, setFlash] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addHours, setAddHours] = useState('');
  const [addErr, setAddErr] = useState('');

  const catalogTotal = allSolutions(catalog).length;
  const platformName = findPlatform(state.platform)?.platform.name ?? '';
  const hasSel = estimate.selIds.length > 0;
  const hasAny = hasSel || requests.length > 0;

  const ping = (key: string): void => {
    setFlash(key);
    window.setTimeout(() => setFlash((current) => (current === key ? '' : current)), 2200);
  };

  /* The builder only renders with an estimation open; this keeps the exports honest if that
     record ever goes missing mid-session (deleted in another tab, say). */
  const quoteInput = estimation ? { estimation, estimate, requests, plan, display, currency, platformName } : null;

  const copy = async (text: string, key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      ping(key);
    } catch {
      ping('');
    }
  };

  const addManual = (): void => {
    const value = Number(addHours);
    if (!addTitle.trim() || !(value > 0)) {
      setAddErr('Give it a name and a positive number of hours.');
      return;
    }
    setAddErr('');
    dispatch({ type: 'addManualItem', title: addTitle.trim(), hours: value });
    setAddTitle('');
    setAddHours('');
    setAddOpen(false);
  };

  const caveats = [
    estimate.inDev > 0 ? `${estimate.inDev} in development — sell with a delivery-date caveat` : null,
    estimate.noEst > 0 ? `${estimate.noEst} without recorded estimates — totals understate` : null
  ].filter(Boolean);

  const totalRow = (label: ReactNode, value: string, tone: string = color.onDark, marginTop = 5): JSX.Element => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: color.onDarkMuted, marginTop }}>
      <span>{label}</span>
      <span style={{ fontFamily: font.mono, color: tone }}>{value}</span>
    </div>
  );

  return (
    <>
      {/* ---- heading and estimate controls ---- */}
      <div style={{ padding: '20px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>Your bundle</span>
          <span style={{ fontFamily: font.mono, fontSize: 11, color: color.onDarkFaint }}>
            {hasSel ? `${estimate.selIds.length} of ${catalogTotal} selected` : ''}
          </span>
        </div>

        {display.controls ? (
          <div style={{ marginTop: 14, background: PANEL, borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {display.money ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 8 }}>
                  <DarkNumber
                    label="Blended rate USD/h"
                    hint="Entered in USD — totals are shown in the currency selected beside it"
                    max={500}
                    value={state.draft.rate ?? estimate.rate}
                    onChange={(rate) => dispatch({ type: 'patchDraft', patch: { rate } })}
                  />
                  <label style={capLabel}>
                    Currency
                    <select
                      value={currency}
                      onChange={(event) => dispatch({ type: 'setCurrency', currency: event.target.value as CurrencyCode })}
                      style={{ ...darkFieldStyle, padding: '8px 6px' }}
                    >
                      {CURRENCIES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <DarkNumber
                  label="PM overhead %"
                  hint="Project management overhead, % of solution hours"
                  max={100}
                  value={state.draft.pm ?? 0}
                  onChange={(pm) => dispatch({ type: 'patchDraft', patch: { pm } })}
                />
                <DarkNumber
                  label="QA overhead %"
                  hint="Quality assurance overhead, % of solution hours"
                  max={100}
                  value={state.draft.qa ?? 0}
                  onChange={(qa) => dispatch({ type: 'patchDraft', patch: { qa } })}
                />
                <DarkNumber
                  label="Buffer %"
                  hint="Risk buffer % applied on top of solution + custom hours"
                  max={100}
                  value={state.draft.bufPct}
                  onChange={(bufPct) => dispatch({ type: 'patchDraft', patch: { bufPct } })}
                />
              </div>

              <div style={{ fontSize: 10.5, color: color.onDarkFaint, lineHeight: 1.5 }}>
                Tip: per-line buffers sit next to each selected solution below. “Blend buffers” in ⚙ Display folds them invisibly
                into the hours.
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- the selected lines ---- */}
      <div style={{ flex: 1, padding: '6px 22px 12px' }}>
        {!hasSel ? (
          <div
            style={{
              marginTop: 16,
              border: `1px dashed ${EDGE}`,
              borderRadius: 12,
              padding: '22px 18px',
              fontSize: 13,
              lineHeight: 1.65,
              color: color.onDarkMuted,
              textAlign: 'center'
            }}
          >
            Nothing selected yet.
            <br />
            Check solutions on the left, or use “Select all” to add a whole bundle.
          </div>
        ) : null}

        {estimate.groups.map((group) => {
          const subtotal = group.items.reduce(
            (sum, item) => sum + (item.first ?? 0) + (display.blendBuffer ? Number(state.draft.buf?.[item.id]) || 0 : 0),
            0
          );
          return (
            <div key={group.id} style={{ padding: '12px 0 2px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color: color.onDarkFaint
                }}
              >
                <span style={{ fontFamily: font.mono, color: color.overhead }}>{group.id}</span>
                <span style={{ minWidth: 0 }}>{group.name}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: font.mono }}>{hours(subtotal * factor)} h</span>
              </div>
              {group.items.map((item) => {
                const buffer = Number(state.draft.buf?.[item.id]) || 0;
                const roleIndex = estimate.roles.findIndex((role) => role.id === state.draft.lineRole?.[item.id]);
                const shown =
                  item.first === null && buffer === 0 ? '—' : `${hours(((item.first ?? 0) + (display.blendBuffer ? buffer : 0)) * factor)}`;
                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: color.onDark, lineHeight: 1.4 }}>{item.name}</span>
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
                          borderRadius: 999,
                          padding: '2px 7px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {estimate.roles[roleIndex]?.name}
                      </span>
                    ) : null}
                    {display.controls ? (
                      <input
                        type="number"
                        min={0}
                        value={buffer > 0 ? buffer : ''}
                        placeholder="+h"
                        title="Buffer hours for this line"
                        onChange={(event) =>
                          dispatch({ type: 'setLineBuffer', id: item.id, hours: event.target.value === '' ? null : Number(event.target.value) })
                        }
                        style={{
                          width: 46,
                          background: INK,
                          border: `1px solid ${EDGE}`,
                          borderRadius: 6,
                          color: AMBER,
                          padding: '3px 5px',
                          fontSize: 11,
                          fontFamily: font.mono,
                          outline: 'none',
                          textAlign: 'right'
                        }}
                      />
                    ) : null}
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: '#C9C9C4' }}>{shown}</span>
                    <Remove onClick={() => dispatch({ type: 'toggleSolution', id: item.id })} />
                  </div>
                );
              })}
            </div>
          );
        })}

        {requests.length > 0 ? (
          <div style={{ padding: '12px 0 2px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: color.onDarkFaint
              }}
            >
              <span style={{ fontFamily: font.mono, color: AMBER }}>RQ</span>
              <span>Custom requests</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: font.mono }}>
                {[estimate.pend > 0 ? `${estimate.pend} pending` : '', requests.length - estimate.pend > 0 ? `${requests.length - estimate.pend} estimated` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            {requests.map((request) => {
              const estimated = Number(request.est) > 0;
              return (
                <div key={request.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: color.onDark, lineHeight: 1.4 }}>{request.title}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: AMBER,
                      background: '#3B3222',
                      borderRadius: 999,
                      padding: '2px 8px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {estimated ? `${hours(Number(request.est) * factor)} h` : 'Awaiting hours'}
                  </span>
                  <Remove onClick={() => dispatch({ type: 'deleteRequest', id: request.id })} />
                </div>
              );
            })}
            <DarkButton
              variant="grey"
              style={{ width: '100%', marginTop: 6, padding: 8, fontSize: 12 }}
              onClick={() => {
                void mailRequests(requests, { name: estimation?.name ?? '', client: estimation?.client ?? '' }).then(() => ping('mail'));
              }}
            >
              {flash === 'mail' ? '✓ Email copied — paste into your mail app' : '✉ Email requests to Edly'}
            </DarkButton>
            <div style={{ fontSize: 10.5, color: color.onDarkFaint, marginTop: 5, textAlign: 'center', lineHeight: 1.5 }}>
              Submitting opens a mail draft and copies the full email to your clipboard — if no mail app appeared, just paste it.
              Team replies land as hours in the total above.
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- totals ---- */}
      <div style={{ padding: '16px 22px 20px', borderTop: `1px solid ${color.onDarkRule}`, background: INK }}>
        {hasAny ? (
          <div>
            {hasSel && display.savings ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  background: '#173B33',
                  border: '1px solid #2E6B5C',
                  color: color.brandGlow,
                  borderRadius: 999,
                  padding: '5px 12px',
                  fontSize: 11.5,
                  fontWeight: 600
                }}
              >
                Reusing {hours(estimate.build)} h of proven engineering
              </div>
            ) : null}

            {totalRow(
              'Solution hours',
              `${hours(display.blendBuffer ? (estimate.first + estimate.itemBufSum) * factor : estimate.first)} h`,
              '#FFFFFF',
              12
            )}
            {requests.length > 0
              ? totalRow(
                  'Custom development',
                  estimate.estSum > 0
                    ? `+${hours(display.blendBuffer ? estimate.estSum * factor : estimate.estSum)} h${estimate.pend ? ` · ${estimate.pend} pending` : ''}`
                    : `${estimate.pend} pending`,
                  AMBER
                )
              : null}
            {!display.blendBuffer && estimate.bufH > 0
              ? totalRow(`Risk buffer${estimate.bufPct > 0 ? ` (incl. ${estimate.bufPct}%)` : ''}`, `+${hours(estimate.bufH)} h`)
              : null}
            {estimate.pm > 0 ? totalRow(`PM overhead (${estimate.pm}%)`, `+${hours(estimate.pmH)} h`) : null}
            {estimate.qa > 0 ? totalRow(`QA overhead (${estimate.qa}%)`, `+${hours(estimate.qaH)} h`) : null}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${color.onDarkRule}`
              }}
            >
              <span style={{ fontSize: 12, color: color.onDarkMuted }}>Total estimate</span>
              <span style={{ fontFamily: font.display, fontSize: 31, fontWeight: 700, letterSpacing: -0.5 }}>{hours(estimate.grand)} h</span>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11.5, color: color.onDarkFaint, marginTop: -2 }}>
              ≈ {hours1(estimate.days)} person-days · {hours1(estimate.weeks)} wks
            </div>
            {estimate.pend > 0 ? (
              <div style={{ textAlign: 'right', fontSize: 11, color: AMBER, marginTop: 3 }}>
                + {plural(estimate.pend, 'custom request')} awaiting hours — not yet in total
              </div>
            ) : null}

            {display.money ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
                <span style={{ fontSize: 12, color: color.onDarkMuted }}>
                  Estimate at{' '}
                  {estimate.assignedH > 0 ? `${money(estimate.effRate, currency)}/h blended across roles` : rateLabel(estimate.rate, currency)}
                </span>
                <span style={{ fontFamily: font.display, fontSize: 21, fontWeight: 700, color: color.brandGlow }}>
                  {money(estimate.usd, currency)}
                </span>
              </div>
            ) : null}

            {display.savings && estimate.savedPct !== null ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: color.onDarkFaint }}>
                  <span>Effort saved vs building new</span>
                  <span style={{ fontFamily: font.mono, color: color.brandGlow, fontWeight: 600 }}>{estimate.savedPct}%</span>
                </div>
                <div style={{ height: 5, background: PANEL, borderRadius: 999, marginTop: 5, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      background: color.brand,
                      borderRadius: 999,
                      width: `${Math.max(0, Math.min(100, estimate.savedPct))}%`
                    }}
                  />
                </div>
              </div>
            ) : null}

            {display.notes && caveats.length > 0 ? (
              <div style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.55, color: AMBER }}>⚠ {caveats.join(' · ')}</div>
            ) : null}

            {estimate.accts.length > 0 ? (
              <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.6, color: color.onDarkMuted }}>
                <span style={{ color: color.onDarkFaint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10 }}>
                  Client-held accounts
                </span>
                <br />
                {estimate.accts.join(' · ')}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          <DarkButton
            variant="red"
            style={{ gridColumn: '1 / -1', padding: '11px 8px', fontSize: 13 }}
            onClick={() => {
              if (!hasAny || !quoteInput) {
                ping('nosel');
                return;
              }
              downloadQuote(quoteInput);
              ping('xlsx');
            }}
          >
            {flash === 'xlsx' ? '✓ Sheet downloaded' : flash === 'nosel' ? 'Select solutions first' : 'Download branded sheet (.xlsx)'}
          </DarkButton>
          <DarkButton onClick={() => quoteInput && void copy(quoteText(quoteInput), 'sum')}>{flash === 'sum' ? '✓ Copied' : 'Copy summary'}</DarkButton>
          <DarkButton onClick={() => window.print()}>Print quote</DarkButton>
          <DarkButton onClick={() => void copy(window.location.href, 'link')}>{flash === 'link' ? '✓ Link copied' : 'Copy link'}</DarkButton>
          <DarkButton variant="danger" onClick={() => dispatch({ type: 'clearSelection' })}>
            Clear all
          </DarkButton>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <DarkButton variant="brand" style={{ fontWeight: 700 }} onClick={onOpenPlanner}>
            📊 Timeline view
          </DarkButton>
          <DarkButton variant="dashed" onClick={() => setAddOpen((value) => !value)}>
            + Custom item
          </DarkButton>
        </div>

        {addOpen ? (
          <div style={{ marginTop: 8, background: PANEL, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={addTitle}
              onChange={(event) => setAddTitle(event.target.value)}
              placeholder="Custom feature name"
              style={{ ...darkFieldStyle, fontFamily: font.body, fontSize: 12.5 }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
              <input
                type="number"
                min={0}
                value={addHours}
                onChange={(event) => setAddHours(event.target.value)}
                placeholder="Est. hours"
                style={{ ...darkFieldStyle, fontSize: 12.5 }}
              />
              <DarkButton variant="brand" style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8 }} onClick={addManual}>
                Add
              </DarkButton>
              <DarkButton
                variant="grey"
                style={{ padding: '8px 10px', fontSize: 12, background: 'transparent', color: color.onDarkFaint, borderRadius: 8 }}
                onClick={() => setAddOpen(false)}
              >
                ×
              </DarkButton>
            </div>
            {addErr ? <div style={{ fontSize: 11, color: '#FF9B9B' }}>{addErr}</div> : null}
            <div style={{ fontSize: 10.5, color: color.onDarkFaint, lineHeight: 1.45 }}>
              Joins the total and the timeline immediately — use it for custom work you’ve already scoped.
            </div>
          </div>
        ) : null}

        <DarkButton variant="brandDashed" style={{ width: '100%', marginTop: 8 }} onClick={onOpenRequest}>
          + Can’t find it? Request an estimate
        </DarkButton>

        <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.6, color: color.onDarkMuted, textAlign: 'center' }}>
          These are only our pre-built solutions — missing something?{' '}
          <Link href={EDLY_LINKS.contact} style={{ color: color.brandGlow, fontWeight: 600 }} hover={{ color: '#FFFFFF' }}>
            We build custom too ↗
          </Link>
        </div>
      </div>
    </>
  );
}
