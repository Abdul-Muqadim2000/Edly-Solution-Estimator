import { describe, expect, it } from 'vitest';
import { CURRENCIES, FX, hours, hours1, longDate, money, plural, rateLabel, today } from '../src/lib/format';
import { quoteText } from '../src/lib/quoteExport';
import { calcEstimate, DEFAULT_ROLES } from '../src/domain/estimate';
import { schedule } from '../src/domain/planner';
import { DEFAULT_DISPLAY } from '../src/state/reducer';
import type { Catalog, EstimateRequest, Estimation, Solution } from '../src/types';

/**
 * Money, hours and the client-facing export.
 *
 * Formatting is where a correct calculation still becomes a wrong number on a client's screen,
 * and the export is where "Present to client" is either honoured or undone — the display
 * preferences have to reach the downloaded file, not just the page.
 */

describe('money', () => {
  it('rounds to whole units and groups the thousands', () => {
    expect(money(0)).toBe('$0');
    expect(money(1234)).toBe('$1,234');
    expect(money(1234.4)).toBe('$1,234');
    expect(money(1234.6)).toBe('$1,235');
    expect(money(1_250_000)).toBe('$1,250,000');
  });

  it('converts and carries the right symbol', () => {
    expect(money(100, 'EUR')).toBe('€92');
    expect(money(100, 'GBP')).toBe('£79');
    expect(money(100, 'PKR')).toBe('Rs 28,000');
    expect(money(100, 'AED')).toBe('AED 367');
  });

  it('falls back to dollars for a currency it does not know', () => {
    /* a currency code arriving from an old stored snapshot must not render "undefinedNaN" */
    expect(money(100, 'XXX' as never)).toBe('$100');
  });

  it('has a factor and a symbol for every currency on offer', () => {
    expect(CURRENCIES.length).toBeGreaterThan(0);
    for (const code of CURRENCIES) {
      expect(FX[code].factor).toBeGreaterThan(0);
      expect(FX[code].symbol.length).toBeGreaterThan(0);
    }
    /* USD is the base everything else is quoted from */
    expect(FX.USD.factor).toBe(1);
  });

  it('labels a rate per hour in the chosen currency', () => {
    expect(rateLabel(120)).toBe('$120/h');
    expect(rateLabel(120, 'EUR')).toBe('€110/h');
  });

  it('handles a negative amount without losing the sign', () => {
    expect(money(-500)).toBe('$-500');
  });
});

describe('hours', () => {
  it('shows an em dash for nothing at all, never a zero', () => {
    /* "0 h" reads as "we priced it at nothing"; the dash reads as "nobody has priced it" */
    expect(hours(null)).toBe('—');
    expect(hours(undefined)).toBe('—');
    expect(hours(0)).toBe('0');
  });

  it('keeps two decimals at most', () => {
    expect(hours(7.5)).toBe('7.5');
    expect(hours(7.456)).toBe('7.46');
    expect(hours(1234.5)).toBe('1,234.5');
  });

  it('rounds spans to one decimal', () => {
    expect(hours1(7.44)).toBe('7.4');
    expect(hours1(7.46)).toBe('7.5');
    expect(hours1(12)).toBe('12');
  });

  it('pluralises the way a sentence needs', () => {
    expect(plural(1, 'person')).toBe('1 person');
    expect(plural(0, 'week')).toBe('0 weeks');
    expect(plural(3, 'week')).toBe('3 weeks');
  });
});

describe('dates', () => {
  it('stamps today as an ISO date, which is what the sheet stores', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reads an ISO date as the local day it names', () => {
    /* parsed as local midnight, not UTC: `new Date('2026-03-01')` is the day before in the
       Americas, and a due date that slips a day in a client quote is a real complaint */
    expect(longDate('2026-03-01')).toBe('March 1, 2026');
    expect(longDate('2026-12-31')).toBe('December 31, 2026');
  });
});

/* ------------------------------------------------- the client-facing export */

const solution = (id: string, name: string, first: number): Solution => ({
  id,
  name,
  desc: '',
  form: 'Integration',
  status: 'Production',
  deploy: '2 days',
  first,
  repeat: Math.round(first * 0.3),
  build: first * 4,
  saving: null,
  account: null,
  integrations: null,
  notes: null,
  ref: null,
  category: 'Core Platform',
  subCategory: null
});

const items = [solution('OX-1', 'Stripe Payments', 40), solution('OX-2', 'SSO', 60)];

const catalog: Catalog = {
  meta: {
    title: 'Test',
    subtitle: '',
    compiled: '',
    totals: { features: 2, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 },
    notes: []
  },
  bundles: [
    {
      id: 'B01',
      name: 'Core Platform',
      pitch: '',
      offerWhen: '',
      featureCount: 2,
      buildHrs: null,
      firstHrs: null,
      repeatHrs: null,
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items
    }
  ]
};

const snap = {
  sel: { 'OX-1': true, 'OX-2': true },
  buf: {},
  bufPct: 10,
  pm: 10,
  qa: 5,
  rate: 120,
  cur: 'USD' as const,
  roles: [...DEFAULT_ROLES],
  lineRole: {},
  plan: {},
  hpw: 40,
  maxPar: 4,
  planStart: ''
};

const estimation: Estimation = {
  id: 'EST-1',
  plat: 'openedx',
  name: 'Acme Academy',
  slug: 'acme-academy',
  client: 'Acme Inc',
  tag: 'Active',
  due: '2026-03-01',
  at: '2026-01-01',
  up: '2026-01-01',
  total: 0,
  cost: 0,
  items: 2,
  snap
};

const pending: EstimateRequest = {
  id: 'RQ-01',
  plat: 'openedx',
  estId: 'EST-1',
  estName: 'Acme Academy',
  client: 'Acme Inc',
  title: 'Bespoke reporting',
  details: '',
  area: '',
  urgency: '',
  integrations: '',
  name: '',
  email: '',
  org: '',
  at: '2026-01-01'
};

const quote = (display = DEFAULT_DISPLAY, requests: EstimateRequest[] = []): string => {
  const estimate = calcEstimate(catalog, snap, requests);
  return quoteText({
    estimation,
    estimate,
    requests,
    plan: schedule(estimate, requests, snap, { blendBuffer: display.blendBuffer }),
    display,
    currency: 'USD',
    platformName: 'Open edX'
  });
};

describe('the quote a client receives', () => {
  it('names the deal and lists what was selected', () => {
    const text = quote();
    expect(text).toContain('Open edX Solution Bundle');
    expect(text).toContain('Acme Academy · Acme Inc');
    expect(text).toContain('Stripe Payments');
    expect(text).toContain('SSO');
    expect(text).toContain('TOTAL:');
  });

  it('keeps money out of the file when money is hidden', () => {
    /* the whole point of "Present to client": hiding the rate on screen and then downloading a
       workbook with the rate in it would be worse than never hiding it */
    const hidden = quote({ ...DEFAULT_DISPLAY, money: false });
    expect(hidden).not.toMatch(/\$\d/);
    expect(hidden).not.toContain('/h');

    const shown = quote({ ...DEFAULT_DISPLAY, money: true });
    expect(shown).toMatch(/\$\d/);
    expect(shown).toContain('$120/h');
  });

  it('keeps the reuse saving out when savings are hidden', () => {
    expect(quote({ ...DEFAULT_DISPLAY, savings: true })).toContain('Effort saved');
    expect(quote({ ...DEFAULT_DISPLAY, savings: false })).not.toContain('Effort saved');
  });

  it('folds the buffer into the lines when it is blended, instead of naming it', () => {
    const separate = quote({ ...DEFAULT_DISPLAY, blendBuffer: false });
    expect(separate).toContain('Risk buffer');

    const blended = quote({ ...DEFAULT_DISPLAY, blendBuffer: true });
    expect(blended).not.toContain('Risk buffer');
    /* the hours have to go somewhere: blended means the lines carry them */
    expect(blended).toContain('44 h');
  });

  it('says a custom item is awaiting an estimate rather than pricing it at nothing', () => {
    const text = quote(DEFAULT_DISPLAY, [pending]);
    expect(text).toContain('Bespoke reporting');
    expect(text).toContain('awaiting estimate');
    expect(text).not.toContain('Bespoke reporting — 0 h');
  });

  it('prices a custom item once the desk has returned hours', () => {
    const text = quote(DEFAULT_DISPLAY, [{ ...pending, est: 24 }]);
    expect(text).toContain('Bespoke reporting — 24 h');
  });

  it('always carries the scope caveat, whatever is hidden', () => {
    for (const display of [DEFAULT_DISPLAY, { ...DEFAULT_DISPLAY, money: false, savings: false, notes: false }]) {
      expect(quote(display)).toContain('Engineering hours only');
    }
  });
});
