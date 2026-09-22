import type { CurrencyCode } from '@/types';

/** Conversion from USD, with the symbol to render. Rates are indicative, not live. */
export const FX: Record<CurrencyCode, { factor: number; symbol: string }> = {
  USD: { factor: 1, symbol: '$' },
  EUR: { factor: 0.92, symbol: '€' },
  GBP: { factor: 0.79, symbol: '£' },
  PKR: { factor: 280, symbol: 'Rs ' },
  AED: { factor: 3.67, symbol: 'AED ' }
};

export const CURRENCIES = Object.keys(FX) as CurrencyCode[];

/** Money from a USD amount, in the chosen currency. */
export function money(usd: number, cur: CurrencyCode = 'USD'): string {
  const fx = FX[cur] ?? FX.USD;
  return fx.symbol + Math.round(usd * fx.factor).toLocaleString('en-US');
}

/** An hourly rate entered in USD, shown in the chosen currency. */
export function rateLabel(rate: number, cur: CurrencyCode = 'USD'): string {
  return money(rate, cur) + '/h';
}

/** Hours, to two decimals, em dash for nothing. */
export function hours(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Hours, to one decimal — for spans and durations. */
export function hours1(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function longDate(iso?: string): string {
  const d = iso ? new Date(`${iso}T00:00:00`) : new Date();
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Next id in a prefixed series, derived from the highest existing number.
 * Never from the array length: deleting a record would otherwise reissue a live id.
 */
export function nextId<T>(prefix: string, list: readonly T[], field?: keyof T): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const item of list) {
    const raw = field ? item[field] : item;
    const m = re.exec(String(raw ?? ''));
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}
