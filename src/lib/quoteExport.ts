import type { CurrencyCode, EstimateRequest, EstimateResult, Estimation, Schedule } from '@/types';
import type { DisplayPrefs } from '@/state/reducer';
import { writeWorkbook, type CellValue } from '@/lib/xlsx';
import { hours, hours1, longDate, money, plural, rateLabel } from '@/lib/format';

/**
 * The client-facing estimate, as a spreadsheet and as plain text.
 *
 * Both respect the display preferences: if sales has hidden the economics, the export hides them
 * too. Otherwise "Present to client" would be undone the moment someone downloaded the quote.
 *
 * Note: this writes structure and values, not cell formatting — lib/xlsx.ts is a minimal writer
 * with no style table. Excel opens it cleanly; it just isn't brand-styled.
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

export function quoteRows({ estimation, estimate, requests, plan, display, currency, platformName }: QuoteInput): CellValue[][] {
  const factor = display.blendBuffer ? 1 + estimate.bufPct / 100 : 1;
  const rows: CellValue[][] = [];

  rows.push([`${platformName} Solution Bundle — Estimate`]);
  rows.push([
    `Prepared ${longDate()}` +
      (estimate.pm ? ` · +${estimate.pm}% PM overhead` : '') +
      (estimate.qa ? ` · +${estimate.qa}% QA overhead` : '') +
      (!display.blendBuffer && estimate.bufH ? ` · +${hours(estimate.bufH)} h risk buffer` : '') +
      (display.money ? ` · rate ${rateLabel(estimate.rate, currency)}` : '')
  ]);
  rows.push([estimation.name + (estimation.client ? ` · ${estimation.client}` : '')]);
  rows.push([]);

  rows.push(['Bundle', 'Solution', 'What it does', 'Hours', 'Std deployment']);
  for (const group of estimate.groups) {
    for (const item of group.items) {
      const buffer = Number(estimation.snap.buf?.[item.id]) || 0;
      rows.push([
        group.name,
        `${item.id} — ${item.name}`,
        item.desc,
        Number((((item.first ?? 0) + (display.blendBuffer ? buffer : 0)) * factor).toFixed(2)),
        item.deploy ?? ''
      ]);
    }
    rows.push([`${group.name} subtotal`, '', '', Number((group.first * factor).toFixed(2)), '']);
    rows.push([]);
  }

  if (requests.length > 0) {
    const pending = requests.filter((request) => !(Number(request.est) > 0)).length;
    rows.push([
      `CUSTOM DEVELOPMENT — estimated items are already in the total below${pending ? `; ${pending} still awaiting hours and excluded` : ''}`
    ]);
    rows.push(['ID', 'Area', 'Item', 'Hours', 'Requested by']);
    for (const request of requests) {
      rows.push([
        request.id,
        request.area || 'Custom',
        request.title + (request.details ? ` — ${request.details}` : ''),
        Number(request.est) > 0 ? Number((Number(request.est) * factor).toFixed(2)) : 'awaiting estimate',
        [request.name, request.org, request.email].filter(Boolean).join(' · ')
      ]);
    }
    rows.push([]);
  }

  if (!display.blendBuffer && estimate.bufH > 0) rows.push(['', '', 'Risk buffer', Number(estimate.bufH.toFixed(2)), '']);
  if (estimate.pm > 0) rows.push(['', '', `PM overhead (${estimate.pm}%)`, Number(estimate.pmH.toFixed(2)), '']);
  if (estimate.qa > 0) rows.push(['', '', `QA overhead (${estimate.qa}%)`, Number(estimate.qaH.toFixed(2)), '']);
  rows.push(['', '', 'TOTAL ENGINEERING HOURS', Number(estimate.grand.toFixed(2)), '']);
  rows.push(['', '', 'Person-days (8 h)', Number(estimate.days.toFixed(1)), '']);
  rows.push(['', '', 'Delivery span', `${hours1(plan.end)} weeks at peak ${plural(plan.peak, 'person')}`, '']);

  if (display.money) {
    rows.push([]);
    rows.push(['', '', `Estimate at ${rateLabel(estimate.rate, currency)} (${currency})`, money(estimate.usd, currency), '']);
    if (estimate.assignedH > 0) {
      rows.push([]);
      rows.push(['COST BY ROLE']);
      rows.push(['Role', 'Rate', 'Hours', 'Cost', '']);
      for (const role of estimate.roleRows) {
        rows.push([role.name, money(role.rate, currency), Number(role.hrs.toFixed(2)), money(role.cost, currency), '']);
      }
    }
  }

  if (display.savings && estimate.savedPct !== null) {
    rows.push([]);
    rows.push(['', '', 'Effort saved vs building new', `${estimate.savedPct}%`, '']);
    rows.push(['', '', 'Engineering already built', Number(estimate.build.toFixed(2)), '']);
  }

  if (estimate.accts.length > 0) {
    rows.push([]);
    rows.push([`Client-held accounts required: ${estimate.accts.join(' · ')}`]);
  }

  rows.push([]);
  rows.push([
    'Engineering hours only — add PM, QA and support overhead per delivery standards unless applied above. Third-party vendor fees are payable by the client and are not included.'
  ]);

  return rows;
}

/** Triggers a download of the estimate as .xlsx. */
export function downloadQuote(input: QuoteInput): void {
  const bytes = writeWorkbook({ [SHEET]: quoteRows(input) });
  const safe = (input.estimation.name || 'estimate').replace(/[^\w\-. ]+/g, '').trim() || 'estimate';
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safe} — estimate.xlsx`;
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
