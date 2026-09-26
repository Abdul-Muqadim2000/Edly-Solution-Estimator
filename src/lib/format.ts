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
 * A URL-safe name, for the estimation slugs deep links are built from.
 *
 * Capped at 60 characters because a deal name can be a sentence, and the point of a slug is that
 * a human can read it in a pasted link.
 */
export function slugify(value: string): string {
  return String(value ?? '')
    .normalize('NFKD')
    /* strip the accents NFKD just split off, so "Café" becomes "cafe" rather than "caf" */
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** `slugify`, made unique against the slugs already in use. Falls back when a name has no letters. */
export function uniqueSlug(value: string, taken: Iterable<string>, fallback: string): string {
  const used = new Set(taken);
  const base = slugify(value) || slugify(fallback) || 'estimation';
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Fills in any missing slug, uniquely within each platform.
 *
 * Rows written before the column existed come back without one, and so does anything a hand-edited
 * sheet leaves blank. Slugs are only ever *added* here — an existing one is never recomputed,
 * because a link shared in a meeting has to keep working after the deal is renamed.
 */
export function withSlugs<T extends { id: string; plat?: string; name: string; slug?: string }>(rows: readonly T[]): T[] {
  const takenByPlatform = new Map<string, Set<string>>();
  const taken = (plat: string): Set<string> => {
    const found = takenByPlatform.get(plat);
    if (found) return found;
    const made = new Set<string>();
    takenByPlatform.set(plat, made);
    return made;
  };

  for (const row of rows) if (row.slug) taken(row.plat || 'openedx').add(row.slug);

  return rows.map((row) => {
    if (row.slug) return row;
    const used = taken(row.plat || 'openedx');
    const slug = uniqueSlug(row.name, used, row.id);
    used.add(slug);
    return { ...row, slug };
  });
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
