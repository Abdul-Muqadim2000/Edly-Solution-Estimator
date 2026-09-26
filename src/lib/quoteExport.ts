import type { CurrencyCode, EstimateRequest, EstimateResult, Estimation, Schedule } from '@/types';
import type { DisplayPrefs } from '@/state/reducer';
import { writeWorkbook, type SheetCell, type SheetRow, type StyledSheet } from '@/lib/xlsx';
import { hours, hours1, longDate, money, plural, rateLabel } from '@/lib/format';

/**
 * The client-facing estimate, as a spreadsheet and as plain text.
 *
 * Both respect the display preferences: if sales has hidden the economics, the export hides them
 * too. Otherwise "Present to client" would be undone the moment someone downloaded the quote.
 *
 * The workbook is brand-styled: a dark title band, brand-wash subtotals and fixed column widths,
 * written through the style table in lib/xlsx.ts. It is what a client receives, so it should not
 * look like a raw data dump.
 */

export interface QuoteInput {
  estimation: Estimation;
  estimate: EstimateResult;
  requests: readonly EstimateRequest[];
  plan: Schedule;
  display: DisplayPrefs;
  currency: CurrencyCode;
  platformName: string;
}

const SHEET = 'Estimate';

export function quoteSheet({ estimation, estimate, requests, plan, display, currency, platformName }: QuoteInput): StyledSheet {
  const factor = display.blendBuffer ? 1 + estimate.bufPct / 100 : 1;
  const buf = estimation.snap.buf ?? {};
  const bufOf = (id: string): number => (Number(buf[id]) > 0 ? Number(buf[id]) : 0);
  const rows: SheetRow[] = [];
  const merges: string[] = [];
  const band = (v: string): SheetCell[] => [{ v, s: 3 }, { v: '', s: 3 }, { v: '', s: 3 }, { v: '', s: 3 }, { v: '', s: 3 }];

  rows.push({
    h: 30,
    cells: [{ v: `EDLY — ${platformName.toUpperCase()} SOLUTION BUNDLE ESTIMATE`, s: 1 }, { v: '', s: 1 }, { v: '', s: 1 }, { v: '', s: 1 }, { v: '', s: 1 }]
  });
  merges.push('A1:E1');
  rows.push({
    cells: [
      {
        v:
          `Prepared ${longDate()}` +
          (estimate.pm ? ` · +${estimate.pm}% PM overhead` : '') +
          (estimate.qa ? ` · +${estimate.qa}% QA overhead` : '') +
          (display.blendBuffer || !estimate.bufH ? '' : ` · +${hours(estimate.bufH)} h risk buffer`) +
          (display.money ? ` · rate ${rateLabel(estimate.rate, currency)}` : '') +
          ' · Edly by Arbisoft, core Open edX contributor since 2013',
        s: 2
      }
    ]
  });
  merges.push('A2:E2');
  rows.push({});
  rows.push({ cells: [{ v: estimation.name + (estimation.client ? ` · ${estimation.client}` : ''), s: 6 }] });
  rows.push({});

  rows.push({ cells: [{ v: 'Bundle', s: 3 }, { v: 'Solution ID', s: 3 }, { v: 'Solution', s: 3 }, { v: 'Est. hours', s: 3 }, { v: 'Client-held account', s: 3 }] });
  for (const group of estimate.groups) {
    group.items.forEach((item, index) => {
      rows.push({
        cells: [
          { v: index === 0 ? `${group.id} · ${group.name}` : '' },
          { v: item.id },
          { v: item.name },
          item.first === null
            ? { v: item.status === 'In Development' ? 'in development' : 'no estimate' }
            : { n: Number((((item.first ?? 0) + (display.blendBuffer ? bufOf(item.id) : 0)) * factor).toFixed(2)) },
          { v: item.account ?? '' }
        ]
      });
    });
    const subtotal = group.items.reduce((sum, item) => sum + (item.first ?? 0) + (display.blendBuffer ? bufOf(item.id) : 0), 0);
    rows.push({
      cells: [{ v: '', s: 4 }, { v: '', s: 4 }, { v: `${group.name} — subtotal`, s: 4 }, { n: Number((subtotal * factor).toFixed(2)), s: 4 }, { v: '', s: 4 }]
    });
  }
  rows.push({
    cells: [
      { v: '', s: 3 },
      { v: '', s: 3 },
      { v: 'TOTAL — solution hours', s: 3 },
      { n: Number(((estimate.first + (display.blendBuffer ? estimate.itemBufSum : 0)) * factor).toFixed(2)), s: 3 },
      { v: '', s: 3 }
    ]
  });
  rows.push({});

  if (estimate.estSum) {
    rows.push({
      cells: [null, null, { v: 'Custom development (estimated)', s: 5 }, { v: `+${hours(display.blendBuffer ? estimate.estSum * factor : estimate.estSum)} h`, s: 5 }]
    });
  }
  if (!display.blendBuffer && estimate.bufH) {
    rows.push({ cells: [null, null, { v: `Risk buffer${estimate.bufPct ? ` (incl. ${estimate.bufPct}%)` : ''}`, s: 5 }, { v: `+${hours(estimate.bufH)} h`, s: 5 }] });
  }
  if (estimate.pm) rows.push({ cells: [null, null, { v: `PM overhead (${estimate.pm}%)`, s: 5 }, { v: `+${hours(estimate.pmH)} h`, s: 5 }] });
  if (estimate.qa) rows.push({ cells: [null, null, { v: `QA overhead (${estimate.qa}%)`, s: 5 }, { v: `+${hours(estimate.qaH)} h`, s: 5 }] });
  rows.push({ cells: [null, null, { v: 'Total estimate', s: 5 }, { v: `${hours(estimate.grand)} h  (≈ ${hours1(estimate.days)} person-days)`, s: 5 }] });

  if (display.money) {
    rows.push({
      cells: [
        null,
        null,
        {
          v:
            estimate.assignedH > 0
              ? `Estimate at ${money(estimate.effRate, currency)}/h blended across roles (${currency})`
              : `Estimate at ${rateLabel(estimate.rate, currency)} (${currency})`,
          s: 5
        },
        { v: money(estimate.usd, currency), s: 5 }
      ]
    });
    if (estimate.assignedH > 0) {
      rows.push({});
      rows.push({ cells: band('COST BY ROLE') });
      for (const role of estimate.roleRows) {
        rows.push({ cells: [{ v: role.name }, { v: `${money(role.rate, currency)}/h` }, { v: '' }, { n: Number(role.hrs.toFixed(2)) }, { v: money(role.cost, currency) }] });
      }
    }
  }

  if (display.savings && estimate.savedPct !== null) {
    rows.push({ cells: [null, null, { v: `Reusing ${hours(estimate.build)} engineered hours — ${estimate.savedPct}% effort saved vs building new`, s: 6 }] });
  }
  if (estimate.accts.length > 0) {
    rows.push({ cells: [null, null, { v: `Client-held accounts: ${estimate.accts.join(', ')}`, s: 2 }] });
  }
  const caveats: string[] = [];
  if (estimate.inDev) caveats.push(`${estimate.inDev} item(s) in development — sold with a delivery-date caveat`);
  if (estimate.noEst) caveats.push(`${estimate.noEst} item(s) without recorded estimates — totals understate`);
  if (caveats.length > 0) rows.push({ cells: [null, null, { v: `Caveats: ${caveats.join('; ')}`, s: 2 }] });

  if (requests.length > 0) {
    rows.push({});
    const pending = requests.filter((request) => !(Number(request.est) > 0)).length;
    rows.push({
      cells: band(
        `CUSTOM DEVELOPMENT — estimated items are already in the total above${pending ? `; ${pending} still awaiting hours and excluded` : ''}`
      )
    });
    for (const request of requests) {
      rows.push({
        cells: [
          { v: request.id },
          { v: request.area || 'Custom' },
          { v: request.title + (request.details ? ` — ${request.details}` : '') },
          Number(request.est) > 0 ? { n: Number(request.est) } : { v: 'awaiting estimate' },
          { v: [request.name, request.org, request.email].filter(Boolean).join(' · ') }
        ]
      });
    }
  }

  if (plan.bars.length > 0) {
    rows.push({});
    rows.push({ cells: band(`DELIVERY TIMELINE — ${plan.cap} people at once, ${plan.weeks} weeks`) });
    for (const bar of plan.bars) {
      rows.push({
        cells: [
          { v: bar.name },
          { v: '' },
          { v: bar.span ? 'Runs across full delivery' : `Week ${bar.start + 1} – ${Math.ceil(bar.start + bar.dur)}` },
          { n: Number(bar.hrs.toFixed(1)) },
          { v: `${hours1(bar.dur)} wks` }
        ]
      });
    }
  }

  rows.push({});
  rows.push({
    cells: [
      {
        v: 'Engineering hours only — PM, QA and support overhead per delivery standards unless applied above. Third-party vendor fees are payable by the client. Edly by Arbisoft · edly.io · Open edX® is a registered trademark of edX Inc. This estimate covers pre-built solutions only — Edly also builds fully custom Open edX solutions: edly.io/contact-us.',
        s: 2
      }
    ]
  });

  return { rows, merges, widths: [30, 12, 56, 14, 34] };
}

/** Triggers a download of the estimate as .xlsx. */
export function downloadQuote(input: QuoteInput): void {
  const bytes = writeWorkbook({ [SHEET]: quoteSheet(input) });
  const safe = (input.estimation.name || 'Bundle-Estimate').replace(/[^\w-]+/g, '-') || 'Bundle-Estimate';
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Edly-${safe}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The same estimate as plain text, for pasting into an email or a chat. */
export function quoteText(input: QuoteInput): string {
  const { estimation, estimate, requests, plan, display, currency, platformName } = input;
  const factor = display.blendBuffer ? 1 + estimate.bufPct / 100 : 1;
  const lines: string[] = [];

  lines.push(`${platformName} Solution Bundle — Estimate`);
  lines.push(estimation.name + (estimation.client ? ` · ${estimation.client}` : ''));
  lines.push(`Prepared ${longDate()}`, '');

  for (const group of estimate.groups) {
    lines.push(`${group.name} — ${hours(group.first * factor)} h`);
    for (const item of group.items) {
      const buffer = Number(estimation.snap.buf?.[item.id]) || 0;
      lines.push(`  · ${item.name} — ${hours(((item.first ?? 0) + (display.blendBuffer ? buffer : 0)) * factor)} h`);
    }
    lines.push('');
  }

  if (requests.length > 0) {
    lines.push('Custom development');
    for (const request of requests) {
      lines.push(`  · ${request.title} — ${Number(request.est) > 0 ? `${hours(Number(request.est) * factor)} h` : 'awaiting estimate'}`);
    }
    lines.push('');
  }

  if (!display.blendBuffer && estimate.bufH > 0) lines.push(`Risk buffer: +${hours(estimate.bufH)} h`);
  if (estimate.pm > 0) lines.push(`PM overhead (${estimate.pm}%): +${hours(estimate.pmH)} h`);
  if (estimate.qa > 0) lines.push(`QA overhead (${estimate.qa}%): +${hours(estimate.qaH)} h`);

  lines.push(
    `TOTAL: ${hours(estimate.grand)} h ≈ ${hours1(estimate.days)} person-days` +
      (display.money ? ` · ${money(estimate.usd, currency)} @ ${rateLabel(estimate.rate, currency)}` : '')
  );
  lines.push(`Delivery span: ${hours1(plan.end)} weeks at peak ${plural(plan.peak, 'person')}`);

  if (display.savings && estimate.savedPct !== null) {
    lines.push(`Effort saved vs building new: ${estimate.savedPct}%`);
  }
  if (estimate.accts.length > 0) lines.push('', `Client-held accounts required: ${estimate.accts.join(' · ')}`);

  lines.push(
    '',
    'Engineering hours only — add PM, QA and support overhead per delivery standards unless applied above. Third-party vendor fees are payable by the client and are not included.'
  );
  return lines.join('\n');
}
