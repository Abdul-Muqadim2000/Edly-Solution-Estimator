import { useApp } from '@/state/AppProvider';
import { openEstimationRecord, openRequests } from '@/state/reducer';
import { isLiveCatalog, findPlatform } from '@/data/practices';
import { color, font } from '@/theme';
import { hours, hours1, longDate, money, rateLabel } from '@/lib/format';

/**
 * The printed quote.
 *
 * Hidden on screen and revealed by the print stylesheet, which hides the app in the same breath
 * (see index.css). Printing the working screen would put a dark estimate rail, a scrolling
 * catalogue and a rate card in front of a client; this is the one page they should get instead.
 */

const mono = { fontFamily: font.mono } as const;

function TotalLine({ label, value, top = 4 }: { label: string; value: string; top?: number }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: color.body, marginTop: top }}>
      <span>{label}</span>
      <span style={mono}>{value}</span>
    </div>
  );
}

export function QuoteSheet(): JSX.Element | null {
  const { state, estimate, display } = useApp();
  const estimation = openEstimationRecord(state);
  const requests = openRequests(state);
  const currency = state.draft.cur ?? 'USD';
  const factor = display.blendBuffer ? 1 + estimate.bufPct / 100 : 1;

  if (!estimation) return null;

  const platformName = findPlatform(state.platform)?.platform.name ?? 'Open edX';
  const title = isLiveCatalog(state.platform) ? 'Open edX Solution Bundle — Estimate' : `${platformName} Solution Bundle — Estimate`;

  const basis =
    'Estimated engineering hours' +
    (estimate.pm ? ` · +${estimate.pm}% PM` : '') +
    (estimate.qa ? ` · +${estimate.qa}% QA` : '') +
    (display.blendBuffer || !estimate.bufH ? '' : ` · +${hours(estimate.bufH)} h buffer`);

  const caveats = [
    estimate.inDev > 0 ? `${estimate.inDev} in development — sell with a delivery-date caveat` : null,
    estimate.noEst > 0 ? `${estimate.noEst} without recorded estimates — totals understate` : null
  ].filter(Boolean);

  return (
    <div data-quote="true" style={{ display: 'none', fontFamily: font.body, color: color.ink, padding: '24px 8px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `3px solid ${color.ink}`, paddingBottom: 14 }}>
          <div>
            <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30, color: color.ink, lineHeight: 1 }}>edly</div>
            <div style={{ fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase', color: color.bodyDim, fontWeight: 600, marginTop: 6 }}>
              {title}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11.5, color: color.bodyDim, lineHeight: 1.6 }}>
            {longDate()}
            <br />
            {basis}
          </div>
        </div>

        {estimate.groups.map((group) => {
          const subtotal = group.items.reduce(
            (sum, item) => sum + (item.first ?? 0) + (display.blendBuffer ? Number(state.draft.buf?.[item.id]) || 0 : 0),
            0
          );
          return (
            <div key={group.id} style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontFamily: font.display, fontWeight: 600, fontSize: 14 }}>
                <span style={{ color: color.brand, fontFamily: font.mono, fontSize: 11.5 }}>{group.id}</span>
                <span>{group.name}</span>
                <span style={{ flex: 1, borderBottom: '1px dotted #CCCCC8' }} />
                <span style={{ ...mono, fontSize: 13 }}>{hours(subtotal * factor)} h</span>
              </div>
              {group.items.map((item) => {
                const buffer = Number(state.draft.buf?.[item.id]) || 0;
                const shown =
                  item.first === null && buffer === 0 ? '—' : hours(((item.first ?? 0) + (display.blendBuffer ? buffer : 0)) * factor);
                return (
                  <div key={item.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '4px 0 0 24px', color: color.inkSoft }}>
                    <span style={{ flex: 1 }}>{item.name}</span>
                    <span style={{ ...mono, fontSize: 12 }}>{shown}</span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {requests.length > 0 ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: font.display, fontWeight: 600, fontSize: 14 }}>
              Custom development
              {estimate.pend ? ` — ${estimate.pend} item${estimate.pend === 1 ? '' : 's'} still being estimated` : ''}
            </div>
            {requests.map((request) => (
              <div key={request.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '4px 0 0 24px', color: color.inkSoft }}>
                <span style={{ flex: 1 }}>
                  {request.title} ({[request.area, request.urgency].filter(Boolean).join(' · ') || 'custom'})
                </span>
                <span style={{ ...mono, fontSize: 12 }}>{Number(request.est) > 0 ? hours(Number(request.est)) : 'TBD'}</span>
              </div>
            ))}
            <p style={{ fontSize: 11, color: color.muted, margin: '6px 0 0 24px', lineHeight: 1.5 }}>
              {estimate.pend
                ? `Items with hours are already included in the total below. The ${estimate.pend} marked TBD are not — Edly’s solutions team returns those separately.`
                : 'Estimated by Edly’s solutions team and included in the total below.'}
            </p>
          </div>
        ) : null}

        <div style={{ marginTop: 26, border: `2px solid ${color.ink}`, borderRadius: 10, padding: '16px 20px' }}>
          <TotalLine
            label="Solution hours"
            value={hours(display.blendBuffer ? (estimate.first + estimate.itemBufSum) * factor : estimate.first)}
            top={0}
          />
          {requests.length > 0 ? (
            <TotalLine
              label="Custom development"
              value={
                estimate.estSum > 0
                  ? `+${hours(display.blendBuffer ? estimate.estSum * factor : estimate.estSum)} h${estimate.pend ? ` · ${estimate.pend} pending` : ''}`
                  : `${estimate.pend} pending`
              }
            />
          ) : null}
          {!display.blendBuffer && estimate.bufH > 0 ? (
            <TotalLine label={`Risk buffer${estimate.bufPct > 0 ? ` (incl. ${estimate.bufPct}%)` : ''}`} value={`+${hours(estimate.bufH)}`} />
          ) : null}
          {estimate.pm > 0 ? <TotalLine label={`PM overhead (${estimate.pm}%)`} value={`+${hours(estimate.pmH)}`} /> : null}
          {estimate.qa > 0 ? <TotalLine label={`QA overhead (${estimate.qa}%)`} value={`+${hours(estimate.qaH)}`} /> : null}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              borderTop: '1px solid #E0E0DD',
              marginTop: 10,
              paddingTop: 10
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14 }}>Total estimate</span>
            <span style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700 }}>{hours(estimate.grand)} h</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, color: color.bodyDim, marginTop: 2 }}>
            <span>
              ≈ {hours1(estimate.days)} person-days · {hours1(estimate.weeks)} working weeks
            </span>
            {display.money ? (
              <span style={{ fontWeight: 700, color: color.ink, fontSize: 16 }}>
                {money(estimate.usd, currency)} at{' '}
                {estimate.assignedH > 0 ? `${money(estimate.effRate, currency)}/h blended across roles` : rateLabel(estimate.rate, currency)}
              </span>
            ) : null}
          </div>
          {display.savings && estimate.savedPct !== null ? (
            <div style={{ fontSize: 12, color: color.brandInk, fontWeight: 600, marginTop: 8 }}>
              Reusing {hours(estimate.build)} h of engineered work — {estimate.savedPct}% effort saved vs building new
            </div>
          ) : null}
        </div>

        {estimate.accts.length > 0 ? (
          <p style={{ fontSize: 12, color: color.body, margin: '14px 0 0', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700 }}>Client-held accounts required:</span> {estimate.accts.join(' · ')}
          </p>
        ) : null}
        {caveats.length > 0 ? (
          <p style={{ fontSize: 12, color: color.amberInk, margin: '8px 0 0', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700 }}>Caveats:</span> {caveats.join(' · ')}
          </p>
        ) : null}

        <p style={{ fontSize: 10.5, color: color.faint, marginTop: 18, lineHeight: 1.65 }}>
          Engineering hours only — add PM, QA and support overhead per delivery standards unless applied above. Third-party vendor
          fees are payable by the client and are not included. Prepared with the Edly Bundle Builder · edly.io · Open edX® is a
          registered trademark of edX Inc. This estimate covers pre-built solutions only — Edly also designs and builds fully
          custom Open edX solutions: edly.io/contact-us.
        </p>
      </div>
    </div>
  );
}
