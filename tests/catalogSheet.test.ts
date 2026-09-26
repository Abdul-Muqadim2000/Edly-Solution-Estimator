import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCatalogWorkbook } from '../src/lib/catalogSheet';
import { writeWorkbook, type CellValue } from '../src/lib/xlsx';

/**
 * The master catalog workbook, and what happens to a sheet someone has edited by hand.
 *
 * This file is the one place the app trusts a human with a spreadsheet, so the parser is
 * deliberately forgiving — and every forgiving rule is a place a wrong number can enter a client
 * quote silently. The rule that matters most is the one about absent hours: an unpriced item is
 * `null`, never `0`, because zero joins the totals and quietly makes the work look free.
 */

const book = (sheets: Record<string, CellValue[][]>) => parseCatalogWorkbook(writeWorkbook(sheets));

const ITEM_HEADER = ['Solution ID', 'Feature', 'What it does', 'Status', 'First Delivery Hrs', 'Repeat Config Hrs', 'Original Build Hrs', 'Bundle ID'];
const item = (id: string, name: string, status: string, first: CellValue, repeat: CellValue, build: CellValue, bundle: string): CellValue[] => [id, name, '', status, first, repeat, build, bundle];

const BUNDLE_HEADER = ['Bundle ID', 'Bundle', 'What it delivers', 'Offer when', 'Features'];

/* ------------------------------------------------- the workbook we ship */

describe('the catalog we ship', () => {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../public/catalog-source.xlsx', import.meta.url))));

  it('parses without a single warning', async () => {
    const { warnings } = await parseCatalogWorkbook(bytes);
    /* a warning here means the shipped sheet and the parser have drifted apart, which sales
       would see as a missing bundle rather than as an error */
    expect(warnings).toEqual([]);
  });

  it('is the catalog the app is documented to have', async () => {
    const { catalog } = await parseCatalogWorkbook(bytes);
    const solutions = catalog.bundles.reduce((total, bundle) => total + bundle.items.length, 0);

    expect(catalog.bundles).toHaveLength(15);
    expect(solutions).toBe(87);
    expect(catalog.bundles.map((one) => one.id)).toEqual(
      Array.from({ length: 15 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`)
    );
    expect(catalog.meta.title).toContain('Open edX');
    expect(catalog.meta.totals.features).toBe(87);
  });

  it('carries the fields a quote is built from', async () => {
    const { catalog } = await parseCatalogWorkbook(bytes);
    const first = catalog.bundles[0]?.items[0];

    expect(first).toMatchObject({ id: expect.stringMatching(/^[A-Z]{2,}-\d+$/) });
    expect(typeof first?.name).toBe('string');
    expect(first?.name.length).toBeGreaterThan(0);
    /* every bundle has a pitch: it is what sales reads out loud */
    for (const bundle of catalog.bundles) expect(bundle.pitch.length).toBeGreaterThan(0);
  });

  it('keeps the unpriced items unpriced', async () => {
    const { catalog } = await parseCatalogWorkbook(bytes);
    const unpriced = catalog.bundles.flatMap((bundle) => bundle.items).filter((one) => one.first === null);

    expect(unpriced.length).toBeGreaterThan(0);
    /* not zero — zero would silently join the totals as free work */
    for (const one of unpriced) expect(one.first).toBeNull();
  });
});

/* -------------------------------------------------------- header matching */

describe('finding the header row', () => {
  it('does not let the "Bundle" alias steal the "Bundle ID" column', async () => {
    const { catalog } = await book({
      'All Components': [
        ['Solution ID', 'Feature', 'Bundle ID', 'Bundle'],
        ['EDU-001', 'Stripe', 'B02', 'Commerce']
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B02', 'Commerce', 'Sell courses', 'Payments come up', 1]]
    });

    /* if "Bundle" claimed column 2, the solution would land under a bundle called "B02" */
    expect(catalog.bundles.map((one) => one.id)).toEqual(['B02']);
    expect(catalog.bundles[0]?.name).toBe('Commerce');
    expect(catalog.bundles[0]?.items[0]?.id).toBe('EDU-001');
  });

  it('ignores case, punctuation and spacing in a header', async () => {
    const { catalog } = await book({
      'ALL COMPONENTS': [
        ['solution_id', 'FEATURE', 'first delivery hrs'],
        ['EDU-001', 'Stripe', 5]
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 1]]
    });

    expect(catalog.bundles[0]?.items[0]).toMatchObject({ id: 'EDU-001', name: 'Stripe', first: 5 });
  });

  it('finds the header below title rows, which every real sheet has', async () => {
    const { catalog } = await book({
      'All Components': [
        ['Edly — Open edX Solution Bundles'],
        ['Compiled March 2026'],
        [],
        ['Solution ID', 'Feature', 'First Delivery Hrs'],
        ['EDU-001', 'Stripe', 5]
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 1]]
    });

    expect(catalog.bundles[0]?.items).toHaveLength(1);
  });

  it('warns rather than throwing when a sheet is missing', async () => {
    const { warnings } = await book({ 'B01 Core': [['Solution ID', 'Feature'], ['EDU-001', 'Stripe']] });
    expect(warnings.join(' ')).toMatch(/All Components/i);
    expect(warnings.join(' ')).toMatch(/Bundle Catalog/i);
  });

  it('refuses a workbook with no sheets at all', async () => {
    await expect(parseCatalogWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

/* ------------------------------------------------------------- the numbers */

describe('reading the numbers', () => {
  const parse = async (first: CellValue, repeat: CellValue = 1, build: CellValue = 10) => {
    const { catalog } = await book({
      'All Components': [ITEM_HEADER, item('EDU-001', 'Stripe', 'Production', first, repeat, build, 'B01')],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 1]]
    });
    return catalog.bundles[0]?.items[0];
  };

  it('reads an absent figure as no estimate, not as zero', async () => {
    expect((await parse(''))?.first).toBeNull();
    expect((await parse(null))?.first).toBeNull();
  });

  it('reads a dash as no estimate, because that is how people write it', async () => {
    expect((await parse('—'))?.first).toBeNull();
    expect((await parse('–'))?.first).toBeNull();
    expect((await parse('-'))?.first).toBeNull();
  });

  it('keeps a real zero as zero', async () => {
    /* an item that genuinely costs nothing to repeat is not the same as one nobody has priced */
    expect((await parse(0))?.first).toBe(0);
  });

  it('strips the units and separators people type into an hours cell', async () => {
    expect((await parse('1,250'))?.first).toBe(1250);
    expect((await parse('40 hrs'))?.first).toBe(40);
    expect((await parse(' 7.5 '))?.first).toBe(7.5);
  });

  it('reads nonsense as no estimate rather than as NaN', async () => {
    const value = (await parse('to be confirmed'))?.first;
    expect(value).toBeNull();
    expect(Number.isNaN(value as number)).toBe(false);
  });

  it('counts the unpriced items on the bundle instead of summing them as free', async () => {
    const { catalog } = await book({
      'All Components': [
        ITEM_HEADER,
        item('EDU-001', 'Stripe', 'Production', 5, 1, 16, 'B01'),
        item('EDU-002', 'Unpriced', 'Production', '', '', '', 'B01')
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 2]]
    });

    const bundle = catalog.bundles[0];
    expect(bundle?.featureCount).toBe(2);
    expect(bundle?.firstHrs).toBe(5);
    expect(bundle?.noEstimate).toBe(1);
  });

  it('counts what is still in development', async () => {
    const { catalog } = await book({
      'All Components': [
        ITEM_HEADER,
        item('EDU-001', 'Shipped', 'Production', 5, 1, 16, 'B01'),
        item('EDU-002', 'Building', 'In Development', 8, 2, 20, 'B01')
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 2]]
    });

    expect(catalog.bundles[0]?.inDev).toBe(1);
    expect(catalog.bundles[0]?.items[1]?.status).toBe('In Development');
  });

  it('falls back to Production for a status nobody recognises', async () => {
    const { catalog } = await book({
      'All Components': [ITEM_HEADER, item('EDU-001', 'Stripe', 'Shipped?', 5, 1, 16, 'B01')],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 1]]
    });
    expect(catalog.bundles[0]?.items[0]?.status).toBe('Production');
  });

  it('recomputes a summary row that no longer matches the rows beneath it', async () => {
    const { catalog } = await book({
      'All Components': [
        ITEM_HEADER,
        item('EDU-001', 'One', 'Production', 5, 1, 16, 'B01'),
        item('EDU-002', 'Two', 'Production', 15, 3, 40, 'B01')
      ],
      /* the summary still says one feature and 5 hours: someone added a row and did not re-total */
      'Bundle Catalog': [[...BUNDLE_HEADER, 'First Delivery Hrs'], ['B01', 'Core', 'Pitch', '', 1, 5]]
    });

    expect(catalog.bundles[0]?.featureCount).toBe(2);
    expect(catalog.bundles[0]?.firstHrs).toBe(20);
  });

  it('trusts the summary row while it still agrees with the sheet', async () => {
    const { catalog } = await book({
      'All Components': [ITEM_HEADER, item('EDU-001', 'One', 'Production', 5, 1, 16, 'B01')],
      'Bundle Catalog': [[...BUNDLE_HEADER, 'First Delivery Hrs'], ['B01', 'Core', 'Pitch', '', 1, 5]]
    });
    expect(catalog.bundles[0]?.firstHrs).toBe(5);
  });
});

/* ------------------------------------------------------------ the odd rows */

describe('rows a human left behind', () => {
  it('skips a row whose id is not an id', async () => {
    const { catalog } = await book({
      'All Components': [
        ITEM_HEADER,
        item('EDU-001', 'Stripe', 'Production', 5, 1, 16, 'B01'),
        item('Notes:', 'see the tab beside this one', 'Production', '', '', '', 'B01'),
        item('', 'blank id', 'Production', 4, 1, 8, 'B01')
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 1]]
    });

    expect(catalog.bundles[0]?.items.map((one) => one.id)).toEqual(['EDU-001']);
  });

  it('keeps a solution whose bundle has no row of its own, and says so', async () => {
    const { catalog, warnings } = await book({
      'All Components': [
        ITEM_HEADER,
        item('EDU-001', 'Stripe', 'Production', 5, 1, 16, 'B01'),
        item('EDU-009', 'Orphan', 'Production', 9, 2, 20, 'B99')
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 1]]
    });

    /* dropping it silently is the failure mode: a solution the desk added would just vanish */
    const orphan = catalog.bundles.find((one) => one.id === 'B99');
    expect(orphan?.items.map((one) => one.id)).toEqual(['EDU-009']);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('lets a per-bundle sheet override the rows the summary sheet lists', async () => {
    const { catalog } = await book({
      'All Components': [ITEM_HEADER, item('EDU-001', 'Stripe', 'Production', 5, 1, 16, 'B01')],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'The curated pitch', '', 1]],
      'B01 Core': [
        ['Pitch: The detail sheet pitch'],
        [],
        ['Solution ID', 'Feature', 'First Delivery Hrs'],
        ['EDU-001', 'Stripe Payments', 12]
      ]
    });

    const solution = catalog.bundles[0]?.items[0];
    expect(solution?.name).toBe('Stripe Payments');
    expect(solution?.first).toBe(12);
    /* the fields the detail sheet does not carry fall back to All Components */
    expect(solution?.build).toBe(16);
    /* prose is the other way round: Bundle Catalog is curated, so it is not overwritten */
    expect(catalog.bundles[0]?.pitch).toBe('The curated pitch');
  });

  it('takes the pitch off the detail sheet only when the summary has none', async () => {
    const { catalog } = await book({
      'All Components': [ITEM_HEADER, item('EDU-001', 'Stripe', 'Production', 5, 1, 16, 'B01')],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', '', '', 1]],
      'B01 Core': [
        ['Pitch: The one sales reads out'],
        ['Offer when the client asks about: taking payments'],
        ['Pairs well with: B02'],
        [],
        ['Solution ID', 'Feature'],
        ['EDU-001', 'Stripe']
      ]
    });

    expect(catalog.bundles[0]?.pitch).toBe('The one sales reads out');
    expect(catalog.bundles[0]?.offerWhen).toBe('taking payments');
    expect(catalog.bundles[0]?.pairsWith).toBe('B02');
  });

  it('describes a solution by its category when the sheet gives no delivery form', async () => {
    const { catalog } = await book({
      'All Components': [
        ['Solution ID', 'Feature', 'Category', 'Sub Category'],
        ['EDU-001', 'Stripe', 'Integration', 'Out-of-the-box']
      ],
      'Bundle Catalog': [BUNDLE_HEADER, ['B01', 'Core', 'Pitch', '', 1]]
    });

    expect(catalog.bundles[0]?.items[0]?.form).toBe('Integration · Out-of-the-box');
  });
});
