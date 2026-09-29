import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  bundlesTemplate,
  checkBundles,
  downloadTemplate,
  ESTIMATE_COLUMNS,
  estimatesTemplate,
  hasErrors,
  MAX_IMPORT_BYTES,
  plainHours,
  readDate,
  readEstimates,
  readImport,
  workbookShape,
  type BundlesImport,
  type EstimatesImport,
  type ImportIssue
} from '../src/lib/catalogImport';
import { parseCatalogWorkbook } from '../src/lib/catalogSheet';
import { importedFiles, planEstimateImport, removeImported, type EstimateRow } from '../src/domain/estimateImport';
import { confirmsName } from '../src/domain/importHistory';
import { readWorkbook, writeWorkbook, type CellValue, type Workbook } from '../src/lib/xlsx';

/**
 * Importing a workbook a person picked. The sheet parser forgives; this does not, because an
 * import is a choice to put a file into the catalog sales quote from. Every case below is a file
 * someone could plausibly pick, and the test says what they are told.
 *
 * The two kinds must never cross: built features read as estimates would be sold with a
 * build-time caveat they do not need, and estimates read as bundles would be sold as shipped.
 */

const SHIPPED = new Uint8Array(readFileSync(fileURLToPath(new URL('../public/catalog-source.xlsx', import.meta.url))));

const bytes = (sheets: Record<string, CellValue[][]>): Uint8Array => writeWorkbook(sheets);
const tables = async (sheets: Record<string, CellValue[][]>): Promise<Workbook> => readWorkbook(bytes(sheets));
const errors = (issues: readonly ImportIssue[]): string[] => issues.filter((issue) => issue.level === 'error').map((issue) => issue.text);
const warnings = (issues: readonly ImportIssue[]): string[] => issues.filter((issue) => issue.level === 'warning').map((issue) => issue.text);

const asBundles = async (sheets: Record<string, CellValue[][]>): Promise<BundlesImport> => (await readImport(bytes(sheets), 'bundles')) as BundlesImport;
const asEstimates = async (sheets: Record<string, CellValue[][]>): Promise<EstimatesImport> => (await readImport(bytes(sheets), 'estimates')) as EstimatesImport;

const COMPONENTS = ['Bundle ID', 'Bundle', 'Solution ID', 'Feature', 'Status', 'What it does', 'First-delivery hrs', 'Repeat config hrs', 'Original build hrs'];
const component = (bundle: string, id: string, name: string, first: CellValue = 5, extra: { status?: string; repeat?: CellValue; build?: CellValue } = {}): CellValue[] => [
  bundle,
  'Commerce',
  id,
  name,
  extra.status ?? 'Production',
  'Does a thing',
  first,
  extra.repeat ?? 1,
  extra.build ?? 16
];
const CATALOG_SHEET: CellValue[][] = [
  ['Bundle ID', 'Bundle', 'What it delivers'],
  ['B01', 'Commerce', 'Sell courses']
];

const ESTIMATE_HEADER = ESTIMATE_COLUMNS.map((column) => column.label);
/** A row in template order, from a few named fields. */
const estimate = (fields: Partial<Record<(typeof ESTIMATE_COLUMNS)[number]['field'], CellValue>>): CellValue[] =>
  ESTIMATE_COLUMNS.map((column) => fields[column.field] ?? '');

/* ------------------------------------------------- telling the files apart */

describe('which kind of workbook a file is', () => {
  it('reads the master sheet we ship as bundles with nothing to warn about', async () => {
    const read = (await readImport(SHIPPED, 'bundles')) as BundlesImport;
    /* a warning here would greet everyone who re-uploads the master sheet, and they would learn to ignore warnings */
    expect(read.issues).toEqual([]);
    expect(read.catalog?.bundles).toHaveLength(15);
    expect(read.catalog?.bundles.flatMap((bundle) => bundle.items)).toHaveLength(87);
    expect(read.hash).not.toBe('');
    /* its Notes & limits column is read as each solution's Notes / Assumptions */
    expect(read.catalog?.bundles.flatMap((bundle) => bundle.items).filter((item) => item.notes).length).toBeGreaterThan(0);
  });

  it('reads the same catalog the served sheet loads, so an import and a page load agree', async () => {
    const read = (await readImport(SHIPPED, 'bundles')) as BundlesImport;
    expect(read.catalog).toEqual((await parseCatalogWorkbook(SHIPPED)).catalog);
  });

  it('refuses the master sheet as estimates, and says to import it as bundles', async () => {
    const read = await readImport(SHIPPED, 'estimates');
    expect(errors(read.issues)).toEqual([expect.stringMatching(/This is a bundles workbook.*Import it under Bundles/)]);
    expect((read as EstimatesImport).rows).toEqual([]);
  });

  it('refuses an estimates sheet as bundles, and says to import it as estimates', async () => {
    const read = await asBundles({ Estimates: [ESTIMATE_HEADER, estimate({ name: 'SSO', first: 20 })] });
    expect(errors(read.issues)).toEqual([expect.stringMatching(/This is an estimates sheet.*Import it under Estimates/)]);
    expect(read.catalog).toBeNull();
  });

  it('refuses a client task breakdown under either kind, because it is a quote and not a catalog', async () => {
    const breakdown = { Introduction: [['Acme Academy | Project Task Breakdown']], 'Task Breakdown': [['', 'Deliverable no.', 'Area', 'Component', 'Hours']] };
    for (const kind of ['bundles', 'estimates'] as const) {
      const read = await readImport(bytes(breakdown), kind);
      expect(errors(read.issues)).toEqual([expect.stringMatching(/client task breakdown.*cannot be imported/)]);
    }
  });

  it('refuses a file that is not a workbook, without throwing', async () => {
    const read = await readImport(new TextEncoder().encode('id,name\nEDU-1,Stripe'), 'bundles');
    expect(errors(read.issues)).toEqual([expect.stringMatching(/could not be opened as an Excel workbook/)]);
  });

  it('refuses a file far bigger than any catalog before trying to open it', async () => {
    const read = await readImport(new Uint8Array(MAX_IMPORT_BYTES + 1), 'estimates');
    expect(errors(read.issues)).toEqual([expect.stringMatching(/check it is the right file/)]);
  });

  it('refuses a workbook that is neither kind, and says what each needs', async () => {
    const other = { Sheet1: [['Name', 'Email'], ['Jane', 'jane@example.com']] };
    expect(errors((await readImport(bytes(other), 'bundles')).issues)[0]).toMatch(/needs an All Components sheet/);
    expect(errors((await readImport(bytes(other), 'estimates')).issues)[0]).toMatch(/needs a sheet named Estimates/);
  });

  it('names the shape of a workbook from its sheets', async () => {
    expect(workbookShape(await tables({ 'All Components': [COMPONENTS] }))).toBe('bundles');
    expect(workbookShape(await tables({ 'B03 AI': [['Solution ID', 'Feature']] }))).toBe('bundles');
    expect(workbookShape(await tables({ Estimates: [['anything']] }))).toBe('estimates');
    expect(workbookShape(await tables({ Priced: [['Feature', 'First-delivery hrs']] }))).toBe('estimates');
    expect(workbookShape(await tables({ 'Task Breakdown': [['x']] }))).toBe('breakdown');
    expect(workbookShape(await tables({ Notes: [['x']] }))).toBe('unknown');
  });
});

/* ------------------------------------------------------- bundles, strictly */

describe('checking a bundles workbook', () => {
  it('imports a minimal workbook: All Components and a Bundle Catalog', async () => {
    const read = await asBundles({ 'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe')], 'Bundle Catalog': CATALOG_SHEET });
    expect(read.issues).toEqual([]);
    expect(read.catalog?.bundles[0]).toMatchObject({ id: 'B01', name: 'Commerce', pitch: 'Sell courses' });
  });

  it('refuses All Components without an hours column, since nothing on it could be priced', async () => {
    const header = COMPONENTS.filter((name) => name !== 'First-delivery hrs');
    const read = await asBundles({ 'All Components': [header, ['B01', 'Commerce', 'EDU-101', 'Stripe']], 'Bundle Catalog': CATALOG_SHEET });
    expect(errors(read.issues)).toEqual(['Sheet "All Components" has no First-delivery hrs column, so none of its solutions could be priced.']);
    expect(read.catalog).toBeNull();
  });

  it('refuses All Components without a Bundle ID, since its solutions would have nowhere to go', async () => {
    const read = await asBundles({ 'All Components': [['Solution ID', 'Feature', 'First-delivery hrs'], ['EDU-101', 'Stripe', 5]] });
    expect(errors(read.issues)).toContain('Sheet "All Components" has no Bundle ID column, so its solutions cannot be placed in their bundles.');
  });

  it('refuses a bundle sheet with no header row', async () => {
    const read = await asBundles({ 'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe')], 'B01 Commerce': [['Pitch: sell'], ['just notes']] });
    expect(errors(read.issues)).toEqual(['Sheet "B01 Commerce" has no header row with Solution ID and Feature columns.']);
  });

  it('needs hours on each bundle sheet only when there is no All Components to fall back on', async () => {
    const detail = [['Solution ID', 'Feature'], ['EDU-101', 'Stripe']];
    expect(errors((await asBundles({ 'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe')], 'B01 Commerce': detail })).issues)).toEqual([]);
    expect(errors((await asBundles({ 'B01 Commerce': detail })).issues)).toEqual(['Sheet "B01 Commerce" has no First-delivery hrs column, so none of its solutions could be priced.']);
  });

  it('refuses a solution id used twice, on one sheet or across two bundles', async () => {
    const twice = await asBundles({ 'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe'), component('B01', 'EDU-101', 'PayPal')] });
    expect(errors(twice.issues)).toEqual(['EDU-101 is listed twice on "All Components", rows 2 and 3. Each solution needs its own ID.']);

    const detail = [['Solution ID', 'Feature', 'First-delivery hrs'], ['EDU-101', 'Stripe', 5]];
    const across = await asBundles({ 'B01 Commerce': detail, 'B02 Payments': detail });
    expect(errors(across.issues)).toEqual(['EDU-101 is on both "B01 Commerce" and "B02 Payments". A solution belongs to one bundle.']);
  });

  it('refuses negative hours outright', async () => {
    const read = await asBundles({ 'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe', -5)], 'Bundle Catalog': CATALOG_SHEET });
    expect(errors(read.issues)).toEqual(['EDU-101 ("All Components" row 2): First-delivery hrs is negative.']);
  });

  it('warns, with what it will read, when an hours cell is not a plain number', async () => {
    const read = await asBundles({
      'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe', '2-3'), component('B01', 'EDU-102', 'PayPal', 'TBC'), component('B01', 'EDU-103', 'Zoom', '40 hrs')],
      'Bundle Catalog': CATALOG_SHEET
    });
    /* "2-3" is read as 2 by the forgiving parser, which is exactly what a person needs to be told */
    expect(warnings(read.issues)).toEqual([
      'EDU-101 ("All Components" row 2): First-delivery hrs "2-3" is not a plain number of hours, so it reads as 2 h.',
      'EDU-102 ("All Components" row 3): First-delivery hrs "TBC" is not a plain number of hours, so it reads as not estimated.'
    ]);
    expect(read.catalog).not.toBeNull();
  });

  it('warns about a status nobody recognises, but reads one typed in lower case', async () => {
    const read = await asBundles({
      'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe', 5, { status: 'Shipped?' }), component('B01', 'EDU-102', 'PayPal', 5, { status: 'in development' })],
      'Bundle Catalog': CATALOG_SHEET
    });
    expect(warnings(read.issues)).toEqual(['EDU-101 ("All Components" row 2): status "Shipped?" is not Production, In Development or Estimation, so it reads as Production.']);
    expect(read.catalog?.bundles[0]?.items.map((item) => item.status)).toEqual(['Production', 'In Development']);
  });

  it('says which rows it skipped, and skips a bundle total without a word', async () => {
    const read = await asBundles({
      'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe'), component('B01', '', 'Forgot the id'), component('B01', 'Notes:', 'see the other tab')],
      'B01 Commerce': [['Solution ID', 'Feature', 'First-delivery hrs'], ['EDU-101', 'Stripe', 5], ['', 'Bundle total', 5]],
      'Bundle Catalog': CATALOG_SHEET
    });
    expect(warnings(read.issues)).toEqual([
      '"All Components" row 3: "Forgot the id" has no Solution ID, so it was skipped.',
      '"All Components" row 4: "Notes:" is not a solution ID (they look like EDU-001), so the row was skipped.'
    ]);
  });

  it('warns about a missing Bundle Catalog and about columns whose absence loses information', async () => {
    const read = await asBundles({ 'All Components': [['Bundle ID', 'Solution ID', 'Feature', 'First-delivery hrs'], ['B01', 'EDU-101', 'Stripe', 5]] });
    expect(warnings(read.issues)).toEqual([
      'No sheet has a What it does column, so solutions will have no description.',
      'No sheet has a Status column, so every solution will read as Production.',
      'No sheet has a Repeat config hrs column, so repeat deliveries will have no hours.',
      'No sheet has a Original build hrs column, so engineered hours and reuse savings will be missing.',
      'There is no Bundle Catalog sheet, so bundles will have no pitch or "offer when" text unless their own sheets carry it.',
      '1 solution is filed under B01, which has no bundle sheet and no Bundle Catalog row, so B01 will have no name or pitch of its own.'
    ]);
    expect(hasErrors(read.issues)).toBe(false);
  });

  it('says so when a solution with no Bundle ID will land in Unsorted', async () => {
    const read = await asBundles({ 'All Components': [COMPONENTS, component('', 'EDU-101', 'Stripe')], 'Bundle Catalog': CATALOG_SHEET });
    expect(warnings(read.issues)).toEqual(['EDU-101 has no Bundle ID, so it lands in "Unsorted solutions".']);
  });

  it('says which bundle wins when All Components and a bundle sheet disagree', async () => {
    const read = await asBundles({
      'All Components': [COMPONENTS, component('B02', 'EDU-101', 'Stripe')],
      'B01 Commerce': [['Solution ID', 'Feature'], ['EDU-101', 'Stripe']],
      'Bundle Catalog': [...CATALOG_SHEET, ['B02', 'Payments', 'Pay']]
    });
    expect(warnings(read.issues)).toEqual(['EDU-101 is on sheet "B01 Commerce" but All Components files it under B02. The bundle sheet wins, so it goes in B01.']);
  });

  it('points out work marked Estimation, which will be listed as estimates rather than bundles', async () => {
    const read = await asBundles({ 'All Components': [COMPONENTS, component('B01', 'EDU-101', 'Stripe', 5, { status: 'Estimation' })], 'Bundle Catalog': CATALOG_SHEET });
    expect(warnings(read.issues)).toEqual([expect.stringMatching(/^1 solution has status Estimation, so it is listed as estimates, not bundles/)]);
  });

  it('reads a Notes/Assumptions column on a bundles sheet as each solution\'s notes', async () => {
    const read = await asBundles({
      'All Components': [
        [...COMPONENTS, 'Notes/Assumptions'],
        [...component('B01', 'EDU-101', 'Stripe'), 'Assumes the client holds a Stripe account.'],
        [...component('B01', 'EDU-102', 'PayPal'), '']
      ],
      'Bundle Catalog': CATALOG_SHEET
    });
    expect(read.issues).toEqual([]);
    expect(read.catalog?.bundles[0]?.items.map((item) => item.notes)).toEqual(['Assumes the client holds a Stripe account.', null]);
  });

  it('joins a separate Assumptions column into the notes on a bundles sheet, and says so', async () => {
    const read = await asBundles({
      'All Components': [
        [...COMPONENTS, 'Notes & limits', 'Assumptions'],
        [...component('B01', 'EDU-101', 'Stripe'), 'Card payments only.', 'Assumes the client holds a Stripe account.']
      ],
      'Bundle Catalog': CATALOG_SHEET
    });
    expect(read.issues).toEqual([
      { level: 'note', text: 'Notes & limits and Assumptions are one field, Notes/Assumptions. Where a solution has both, they are joined, notes first.' }
    ]);
    expect(read.catalog?.bundles[0]?.items[0]?.notes).toBe('Card payments only.\nAssumes the client holds a Stripe account.');
  });

  it('refuses a workbook with headers and no solutions', async () => {
    expect(errors(checkBundles(await tables({ 'All Components': [COMPONENTS] })))).toEqual(['No solutions found: the sheets have headers but no rows with a Solution ID.']);
  });
});

/* ------------------------------------------------------ estimates, strictly */

describe('reading an estimates sheet', () => {
  it('reads every column of the template', async () => {
    const read = await asEstimates({
      Estimates: [
        ESTIMATE_HEADER,
        estimate({
          sourceId: 'NU-014',
          name: 'Blue-green deployment pipeline',
          desc: 'Zero downtime releases',
          first: 64,
          repeat: 16,
          client: 'Nordic University',
          bundleId: 'B15',
          area: 'Deployment',
          category: 'Infrastructure',
          subCategory: 'Custom',
          form: 'Custom development',
          deploy: '1 week',
          integrations: 'GitHub Actions',
          account: 'AWS',
          notes: 'Single region. Assumes AWS.',
          estBy: 'Sam',
          estAt: '2026-03-01'
        })
      ]
    });
    expect(read.issues).toEqual([]);
    expect(read.rows).toEqual([
      {
        row: 2,
        sourceId: 'NU-014',
        name: 'Blue-green deployment pipeline',
        desc: 'Zero downtime releases',
        first: 64,
        repeat: 16,
        client: 'Nordic University',
        bundleId: 'B15',
        area: 'Deployment',
        category: 'Infrastructure',
        subCategory: 'Custom',
        form: 'Custom development',
        deploy: '1 week',
        integrations: 'GitHub Actions',
        account: 'AWS',
        notes: 'Single region. Assumes AWS.',
        estBy: 'Sam',
        estAt: '2026-03-01'
      }
    ]);
  });

  it('refuses a sheet without the hours column, naming it', async () => {
    const read = await asEstimates({ Estimates: [['Feature', 'What it does', 'Estimated for'], ['SSO', 'Sign in', 'Acme Academy']] });
    expect(errors(read.issues)).toEqual(['The "Estimates" sheet has no "First-delivery hrs" column. The headers go in one row, spelled as in the estimates template.']);
    expect(read.rows).toEqual([]);
  });

  it('names both required columns when neither is there', async () => {
    const read = await asEstimates({ Estimates: [['Title', 'Cost'], ['SSO', 400]] });
    expect(errors(read.issues)[0]).toMatch(/no "Feature" and "First-delivery hrs" columns/);
  });

  it('finds the header under title rows, and takes the headers people usually write', async () => {
    const read = await asEstimates({ Estimates: [['Nordic University estimates'], [], ['Feature', 'Hours', 'Client', 'Description'], ['SSO', '40 hrs', 'Nordic University', 'Sign in']] });
    expect(read.rows).toEqual([expect.objectContaining({ row: 4, name: 'SSO', first: 40, client: 'Nordic University', desc: 'Sign in' })]);
  });

  it('warns when the columns that say what and for whom are missing, and imports anyway', async () => {
    const read = await asEstimates({ Estimates: [['Feature', 'First-delivery hrs'], ['SSO', 40]] });
    expect(warnings(read.issues)).toEqual([
      'There is no What it does column, so the estimates will have no description for sales to read out.',
      'There is no Estimated for column, so nobody will be able to tell which client each estimate was made for.'
    ]);
    expect(read.rows).toHaveLength(1);
  });

  it('imports a sheet with no Notes/Assumptions column without a word, as the sheets estimates first came from', async () => {
    /* the column is optional: most rows have none, and a warning here would be one people learn to ignore */
    const read = await asEstimates({ Estimates: [['Feature', 'First-delivery hrs', 'What it does', 'Estimated for'], ['SSO', 40, 'Sign in', 'Acme Academy']] });
    expect(read.issues).toEqual([]);
    expect(read.rows[0]?.notes).toBe('');
  });

  it('reads a file filled in on the first template, joining its Notes & limits and Assumptions into one', async () => {
    const read = await asEstimates({
      Estimates: [
        ['Feature', 'First-delivery hrs', 'What it does', 'Estimated for', 'Notes & limits', 'Assumptions'],
        ['SSO', 40, 'Sign in', 'Acme Academy', 'Single region only.', 'Assumes Azure AD.'],
        ['Proctoring', 30, 'Exams', 'Acme Academy', 'One exam window per course.', ''],
        ['Webhooks', 20, 'Events out', 'Acme Academy', '', 'Assumes the client hosts the receiver.']
      ]
    });
    expect(read.rows.map((one) => one.notes)).toEqual(['Single region only.\nAssumes Azure AD.', 'One exam window per course.', 'Assumes the client hosts the receiver.']);
    /* said once as news, not as a warning: nothing was lost */
    expect(read.issues).toEqual([
      { level: 'note', text: 'Notes & limits and Assumptions are one column now, Notes/Assumptions. Where a row has both, they are joined, notes first.' }
    ]);
  });

  it('takes every header people write for the one note', async () => {
    for (const header of ['Notes/Assumptions', 'Notes & Assumptions', 'Notes & limits', 'Notes', 'Note', 'Assumptions', 'Note to sales', 'Limits']) {
      const read = await asEstimates({ Estimates: [['Feature', 'First-delivery hrs', 'What it does', 'Estimated for', header], ['SSO', 40, 'Sign in', 'Acme Academy', 'Assumes Azure AD.']] });
      expect({ header, notes: read.rows[0]?.notes, issues: read.issues }).toEqual({ header, notes: 'Assumes Azure AD.', issues: [] });
    }
  });

  it('names a column it does not recognise, so a typo is not silently dropped', async () => {
    const read = await asEstimates({ Estimates: [[...ESTIMATE_HEADER, 'Risk level'], [...estimate({ name: 'SSO', first: 40 }), 'High']] });
    expect(warnings(read.issues)).toEqual(['A column was not recognised, so it was ignored: "Risk level".']);
  });

  it('skips a row that is not an estimate yet, and says why for each', async () => {
    const read = await asEstimates({
      Estimates: [
        ESTIMATE_HEADER,
        estimate({ name: 'No hours', first: '' }),
        estimate({ name: 'A range', first: '40-60' }),
        estimate({ name: 'A guess', first: 'about 40' }),
        estimate({ name: 'Nothing', first: 0 }),
        estimate({ name: 'Money', first: 25000 }),
        estimate({ name: 'Dash', first: '—' }),
        estimate({ first: 12 }),
        estimate({ name: 'Real', first: '1,250' })
      ]
    });
    expect(warnings(read.issues).filter((text) => /^Row/.test(text))).toEqual([
      'Row 2 (No hours) has no First-delivery hrs, so it is not an estimate yet and was skipped. Send it to the estimation desk to be priced.',
      'Row 3 (A range): First-delivery hrs "40-60" is not a plain number of hours, so the row was skipped.',
      'Row 4 (A guess): First-delivery hrs "about 40" is not a plain number of hours, so the row was skipped.',
      'Row 5 (Nothing): First-delivery hrs must be more than 0, so the row was skipped.',
      'Row 6 (Money): 25,000 first-delivery hours is more than 10,000, which reads like money or minutes, so the row was skipped.',
      'Row 7 (Dash) has no First-delivery hrs, so it is not an estimate yet and was skipped. Send it to the estimation desk to be priced.',
      'Row 8 has no Feature, so it was skipped.'
    ]);
    expect(read.rows.map((one) => [one.name, one.first])).toEqual([['Real', 1250]]);
  });

  it('uses the first-delivery hours when the repeat hours cannot be read', async () => {
    const read = await asEstimates({ Estimates: [ESTIMATE_HEADER, estimate({ name: 'SSO', first: 40, repeat: 'less' })] });
    expect(warnings(read.issues)).toContain('Row 2 (SSO): Repeat hrs "less" is not a usable number of hours, so the first-delivery hours are used.');
    expect(read.rows[0]?.repeat).toBeNull();
  });

  it('reads a date Excel stored as a day number, and warns about one it cannot read', async () => {
    const read = await asEstimates({
      Estimates: [ESTIMATE_HEADER, estimate({ name: 'SSO', first: 40, estAt: 46082 }), estimate({ name: 'LTI', first: 8, estAt: '03/01/2026' })]
    });
    expect(read.rows.map((one) => one.estAt)).toEqual(['2026-03-01', '']);
    expect(warnings(read.issues)).toContain('Row 3 (LTI): Estimated on "03/01/2026" is not a date we can read, so the import date is used. Write dates as 2026-03-01.');
  });

  it('skips a row that repeats an earlier one, by Estimate ID or by Feature and client', async () => {
    const read = await asEstimates({
      Estimates: [
        ESTIMATE_HEADER,
        estimate({ sourceId: 'NU-1', name: 'SSO', first: 40 }),
        estimate({ sourceId: 'nu-1', name: 'SSO again', first: 41 }),
        estimate({ name: 'LTI', first: 8, client: 'Acme Academy' }),
        estimate({ name: 'lti', first: 9, client: 'acme academy' }),
        estimate({ name: 'LTI', first: 9, client: 'Nordic University' })
      ]
    });
    expect(read.rows.map((one) => one.row)).toEqual([2, 4, 6]);
    expect(warnings(read.issues)).toEqual([
      'Row 3 (SSO again) repeats row 2 (the same Estimate ID, nu-1), so it was skipped.',
      'Row 5 (lti) repeats row 4 (the same Feature and Estimated for), so it was skipped.'
    ]);
  });

  it('skips total rows without a word', async () => {
    const read = await asEstimates({ Estimates: [ESTIMATE_HEADER, estimate({ name: 'SSO', first: 40 }), estimate({ name: 'Total', first: 40 }), ['Subtotal', '', '', 40]] });
    expect(read.issues).toEqual([]);
    expect(read.rows).toHaveLength(1);
  });

  it('uses the one sheet that looks like estimates when none is named Estimates, and refuses to guess between two', async () => {
    const sheet = [['Feature', 'First-delivery hrs', 'What it does', 'Estimated for'], ['SSO', 40, 'Sign in', 'Acme Academy']];
    expect((await asEstimates({ Cover: [['Acme']], Priced: sheet })).rows).toHaveLength(1);
    const two = await asEstimates({ Nordic: sheet, Acme: sheet });
    expect(errors(two.issues)).toEqual(['Several sheets look like estimates ("Nordic" and "Acme"). Put the estimates on one sheet named Estimates.']);
  });

  it('says what it needs when handed a workbook with nothing that looks like estimates', async () => {
    const { issues, rows } = readEstimates(await tables({ Notes: [['Nothing here']] }));
    expect(errors(issues)[0]).toMatch(/needs a sheet named Estimates/);
    expect(rows).toEqual([]);
  });

  it('refuses a sheet where every row was skipped, rather than importing nothing quietly', async () => {
    const read = await asEstimates({ Estimates: [ESTIMATE_HEADER, estimate({ name: 'No hours' })] });
    expect(errors(read.issues)).toEqual(['No estimates to import: every row was skipped, for the reasons listed.']);
  });

  it('refuses more rows than one import should carry', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => estimate({ name: `Feature ${i}`, first: 4 }));
    const { issues } = readEstimates(await tables({ Estimates: [ESTIMATE_HEADER, ...rows] }));
    expect(errors(issues)).toEqual(['The sheet has 2,001 estimates. Split it into files of up to 2,000 rows.']);
  });
});

describe('the numbers and dates an import accepts', () => {
  it('takes a plain number of hours and nothing vaguer', () => {
    expect(['40', '7.5', '.5', '1,250', '40 h', '40hrs', '40 hours', ' 12 '].map(plainHours)).toEqual([40, 7.5, 0.5, 1250, 40, 40, 40, 12]);
    expect(['2-3', 'about 40', 'TBC', '-5', '40 days', '', '$400'].map(plainHours)).toEqual([null, null, null, null, null, null, null]);
  });

  it('takes an ISO date or an Excel day number, and nothing it would have to guess the order of', () => {
    expect(readDate('2026-03-01')).toBe('2026-03-01');
    expect(readDate('46082')).toBe('2026-03-01');
    expect(readDate('46082.0')).toBe('2026-03-01');
    /* 64 is an hours figure, not the 4th of March 1900 */
    expect(readDate('64')).toBeNull();
    expect(readDate('03/01/2026')).toBeNull();
    expect(readDate('2026-13-45')).toBeNull();
  });
});

/* -------------------------------------------------------------- templates */

describe('the templates', () => {
  it('writes an estimates template with every column and three examples, and refuses it untouched', async () => {
    const workbook = await readWorkbook(estimatesTemplate());
    expect(Object.keys(workbook)).toEqual(['Estimates', 'How to fill this in']);
    expect(workbook.Estimates?.[0]).toEqual(ESTIMATE_HEADER);
    expect(workbook.Estimates?.slice(1).map((line) => line[0])).toEqual(['EXAMPLE-1', 'EXAMPLE-2', 'EXAMPLE-3']);
    /* the examples are all it holds, so a made-up estimate can never reach the catalog */
    const read = await readImport(estimatesTemplate(), 'estimates');
    expect(errors(read.issues)).toEqual(['Only the example rows are filled in. Add your estimates under them, or in their place.']);
  });

  it('leaves the examples out when real rows are added under them, and says so as a note', async () => {
    const workbook = await readWorkbook(estimatesTemplate());
    const filled = writeWorkbook({ ...workbook, Estimates: [...(workbook.Estimates ?? []), estimate({ name: 'SSO', first: 40, desc: 'Sign in', client: 'Acme Academy' })] });
    const read = (await readImport(filled, 'estimates')) as EstimatesImport;

    expect(read.issues).toEqual([{ level: 'note', text: 'The 3 example rows were left out, as they always are.' }]);
    expect(read.rows.map((one) => one.name)).toEqual(['SSO']);
  });

  it('writes examples that are correct estimates, one for each way a row is filed', async () => {
    /* an example that would itself fail the checks would teach the wrong format */
    const workbook = await readWorkbook(estimatesTemplate());
    const asReal = (workbook.Estimates ?? []).map((line, i) => (i === 0 ? line : [line[0]!.replace('EXAMPLE', 'NU'), ...line.slice(1)]));
    const read = (await readImport(writeWorkbook({ ...workbook, Estimates: asReal }), 'estimates')) as EstimatesImport;
    expect(read.issues).toEqual([]);

    const plan = planEstimateImport({ rows: read.rows, file: 'examples.xlsx', platform: 'openedx', catalogBundles: [{ id: 'B15', name: 'Platform Engineering & Integrations' }], solutions: [], bundles: [], today: '2026-09-27' });
    expect(plan.added.map((one) => one.bundleId)).toEqual(['B15', 'B16', 'CX']);
    expect(plan.newBundles.map((one) => one.name)).toEqual(['Mobile Apps']);
  });

  it('imports a filled-in estimates template without a single warning', async () => {
    const workbook = await readWorkbook(estimatesTemplate());
    const filled = writeWorkbook({ ...workbook, Estimates: [ESTIMATE_HEADER, estimate({ name: 'SSO', first: 40, desc: 'Sign in', client: 'Acme Academy' })] });
    const read = (await readImport(filled, 'estimates')) as EstimatesImport;
    expect(read.issues).toEqual([]);
    expect(read.rows).toHaveLength(1);
  });

  it('writes one Notes/Assumptions column in the estimates template, never two', async () => {
    const header = (await readWorkbook(estimatesTemplate())).Estimates?.[0] ?? [];
    expect(header).toContain('Notes/Assumptions');
    expect(header).not.toContain('Notes & limits');
    expect(header).not.toContain('Assumptions');
    expect(ESTIMATE_COLUMNS.find((column) => column.field === 'notes')?.need).toBe('optional');
  });

  it('explains every column on the help sheet', async () => {
    const help = (await readWorkbook(estimatesTemplate()))['How to fill this in'] ?? [];
    const described = help.map((row) => row[0]);
    for (const column of ESTIMATE_COLUMNS) expect(described).toContain(column.label);
  });

  describe('saving one from the browser', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('names the file for its kind, as a real .xlsx', async () => {
      const saved: { name: string; type: string; bytes: number }[] = [];
      let blob: Blob | null = null;
      vi.stubGlobal('document', {
        createElement: () => ({ click() {}, remove() {}, set download(name: string) { saved.push({ name, type: blob?.type ?? '', bytes: blob?.size ?? 0 }); } }),
        body: { appendChild: () => undefined }
      });
      vi.spyOn(URL, 'createObjectURL').mockImplementation((made) => {
        blob = made as Blob;
        return 'blob:template';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      downloadTemplate('estimates');
      downloadTemplate('bundles');

      expect(saved.map((one) => one.name)).toEqual(['Edly estimates template.xlsx', 'Edly bundles template.xlsx']);
      expect(saved.every((one) => one.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && one.bytes > 0)).toBe(true);
    });
  });

  it('writes a bundles template with an example bundle, refused untouched and refused as estimates', async () => {
    expect(workbookShape(await readWorkbook(bundlesTemplate()))).toBe('bundles');
    expect(errors((await readImport(bundlesTemplate(), 'bundles')).issues)).toEqual(['Only the example rows are filled in. Add your solutions under them, or in their place.']);
    expect(errors((await readImport(bundlesTemplate(), 'estimates')).issues)[0]).toMatch(/Import it under Bundles/);
  });

  it('writes an example bundle that is a correct one: a priced solution and one still in development', async () => {
    const workbook = await readWorkbook(bundlesTemplate());
    const real = (table: string[][] | undefined, from: number): string[][] =>
      (table ?? []).map((line, i) => (i < from ? line : line.map((value) => value.replace(/^EXAMPLE/, value === 'EXAMPLE' ? 'B16' : 'EDU'))));
    const asReal = writeWorkbook({ ...workbook, 'Bundle Catalog': real(workbook['Bundle Catalog'], 4), 'All Components': real(workbook['All Components'], 3) });
    const read = (await readImport(asReal, 'bundles')) as BundlesImport;

    expect(read.issues).toEqual([]);
    expect(read.catalog?.bundles[0]).toMatchObject({ id: 'B16', name: 'Mobile Apps (example)', pitch: expect.stringMatching(/app stores/) });
    expect(read.catalog?.bundles[0]?.items.map((item) => [item.id, item.status, item.first])).toEqual([
      ['EDU-1', 'Production', 40],
      ['EDU-2', 'In Development', null]
    ]);
    /* the template carries the column, and the example shows a filled cell and a blank one */
    expect(read.catalog?.bundles[0]?.items.map((item) => item.notes)).toEqual([expect.stringMatching(/developer accounts/), null]);
  });

  it('imports a filled-in bundles template, leaving the example bundle out with a note', async () => {
    const workbook = await readWorkbook(bundlesTemplate());
    const header = workbook['All Components']?.[2] ?? [];
    const row = header.map((name) =>
      ({ 'Bundle ID': 'B16', Bundle: 'Accessibility Pack', 'Solution ID': 'EDU-301', Feature: 'Screen reader player', Status: 'Production', 'What it does': 'An accessible player', 'First-delivery hrs': '40', 'Repeat config hrs': '10', 'Original build hrs': '300' })[name] ?? ''
    );
    const catalogSheet = [...(workbook['Bundle Catalog'] ?? []), ['B16', 'Accessibility Pack', 'Every course usable with a screen reader']];
    const filled = writeWorkbook({ ...workbook, 'All Components': [...(workbook['All Components'] ?? []), row], 'Bundle Catalog': catalogSheet });
    const read = (await readImport(filled, 'bundles')) as BundlesImport;

    expect(read.issues).toEqual([{ level: 'note', text: 'The 2 example rows were left out, as they always are.' }]);
    /* the example bundle does not reach the catalog, not even as an empty bundle */
    expect(read.catalog?.bundles.map((bundle) => bundle.id)).toEqual(['B16']);
    expect(read.catalog?.bundles[0]?.items[0]).toMatchObject({ id: 'EDU-301', first: 40, repeat: 10, build: 300 });
  });
});

/* ---------------------------------------------------- what the preview says */

const row = (n: number, over: Partial<EstimateRow> = {}): EstimateRow => ({
  row: n + 1, sourceId: '', name: `Estimate ${n}`, desc: '', first: 10, repeat: null, client: 'Acme Academy', bundleId: '', area: '',
  category: '', subCategory: '', form: '', deploy: '', integrations: '', account: '', notes: '', estBy: '', estAt: '', ...over
});

describe('the estimates preview', () => {
  const input = {
    file: 'acme.xlsx',
    platform: 'openedx',
    catalogBundles: [{ id: 'B01', name: 'Commerce & Monetization' }],
    solutions: [],
    bundles: [],
    today: '2026-09-27'
  };

  it('counts new estimates, new bundles and what is left for the desk to file', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1, { area: 'Mobile Apps' }), row(2, { area: 'Mobile apps' }), row(3), row(4, { area: 'Commerce and Monetization' })] });

    expect(plan.added).toHaveLength(4);
    expect(plan.updated).toHaveLength(0);
    expect(plan.newBundles).toEqual([{ id: 'B02', name: 'Mobile Apps', count: 2 }]);
    expect(plan.unassigned).toBe(1);
    /* "and" and "&" are the same bundle, so no second Commerce bundle appears */
    expect(plan.added[3]?.bundleId).toBe('B01');
  });

  it('files a row under Unassigned when the Area says so', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1, { area: 'Unassigned' })] });
    expect(plan.added[0]?.bundleId).toBe('CX');
    expect(plan.newBundles).toEqual([]);
  });

  it('warns when a Bundle ID is not in the catalog, and says where the row goes instead', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1, { bundleId: 'B99', area: 'Mobile Apps' }), row(2, { bundleId: 'B98' })] });
    expect(plan.warnings).toEqual([
      'Row 2 (Estimate 1): bundle B99 is not in this catalog, so it is filed by its area, Mobile Apps.',
      'Row 3 (Estimate 2): bundle B98 is not in this catalog, so it is filed under Unassigned.'
    ]);
    /* the B99 the row named is not taken as the new bundle's number: numbers are the app's to hand out */
    expect(plan.added.map((one) => one.bundleId)).toEqual(['B02', 'CX']);
  });

  it('numbers new bundles after the catalog and after the bundles already made here', () => {
    const made = [
      { id: 'B02', plat: 'openedx', name: 'Proctoring', pitch: '', offerWhen: '', pairsWith: null, at: '' },
      { id: 'CB-04', plat: 'openedx', name: 'Older', pitch: '', offerWhen: '', pairsWith: null, at: '' }
    ];
    const plan = planEstimateImport({ ...input, bundles: made, rows: [row(1, { area: 'Mobile Apps' }), row(2, { area: 'Gamification' })] });
    expect(plan.newBundles.map((one) => one.id)).toEqual(['B03', 'B04']);
  });

  it('dates an estimate the day it is imported when the sheet gives no date', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1), row(2, { estAt: '2026-03-01' })] });
    expect(plan.added.map((one) => one.estAt)).toEqual(['2026-09-27', '2026-03-01']);
  });

  it('lists the workbooks imported on a platform, for the desk to see and undo', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1, { area: 'Mobile Apps' }), row(2)] });
    const moodle = planEstimateImport({ ...input, platform: 'moodle', file: 'moodle.xlsx', rows: [row(1)] });
    const all = [...plan.solutions, ...moodle.solutions.map((one) => ({ ...one, id: 'CS-09' }))];

    expect(importedFiles(all, plan.bundles, 'openedx')).toEqual([{ file: 'acme.xlsx', estimates: 2, bundles: 1, at: '2026-09-27', importedOn: '2026-09-27', used: 0 }]);
    expect(importedFiles(all, plan.bundles, 'moodle')).toEqual([{ file: 'moodle.xlsx', estimates: 1, bundles: 0, at: '2026-09-27', importedOn: '2026-09-27', used: 0 }]);
  });

  it('marks each estimate with the day it was imported, whatever date the sheet gives it', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1), row(2, { estAt: '2026-03-01' })] });
    expect(plan.added.map((one) => one.importedOn)).toEqual(['2026-09-27', '2026-09-27']);

    /* a second import is the one the history shows, so it moves the day on */
    const again = planEstimateImport({ ...input, solutions: plan.solutions, today: '2026-09-30', rows: [row(1)] });
    expect(again.solutions.map((one) => one.importedOn)).toEqual(['2026-09-30', '2026-09-27']);
  });
});

describe('the import history', () => {
  const input = { file: 'acme.xlsx', platform: 'openedx', catalogBundles: [{ id: 'B01', name: 'Commerce & Monetization' }], solutions: [], bundles: [], today: '2026-09-27' };
  const deal = (plat: string, sel: Record<string, boolean>): { plat: string; snap: { sel: Record<string, boolean> } } => ({ plat, snap: { sel } });

  it('counts the estimations that picked any of a workbook\'s estimates, so a delete says what it takes from them', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1), row(2), row(3)] });
    const deals = [
      deal('openedx', { 'CS-01': true, 'CS-02': true }),
      deal('openedx', { 'CS-03': true }),
      /* unticked is not picked, and a Moodle deal cannot hold an Open edX estimate */
      deal('openedx', { 'CS-01': false }),
      deal('moodle', { 'CS-01': true }),
      deal('openedx', { B01: true })
    ];

    expect(importedFiles(plan.solutions, plan.bundles, 'openedx', deals)[0]?.used).toBe(2);
  });

  it('dates a workbook imported before import days were kept by the bundles it made, and leaves the rest undated', () => {
    /* the user's first import on production is one of these: its rows carry no import day */
    const made = planEstimateImport({ ...input, rows: [row(1, { area: 'Mobile Apps' })] });
    const older = made.solutions.map(({ importedOn: _dropped, ...one }) => one);
    const bundles = made.bundles.map((one) => ({ ...one, at: '2026-09-12' }));
    const plain = planEstimateImport({ ...input, file: 'nordic.xlsx', rows: [row(2)] }).solutions.map(({ importedOn: _dropped, ...one }) => ({ ...one, id: 'CS-09' }));

    expect(importedFiles([...older, ...plain], bundles, 'openedx').map((one) => [one.file, one.importedOn])).toEqual([
      ['acme.xlsx', '2026-09-12'],
      ['nordic.xlsx', '']
    ]);
  });

  it('says what a delete takes: its estimates, and only the bundles left holding nothing else', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1, { area: 'Mobile Apps' }), row(2, { area: 'Gamification' })] });
    /* the desk has since filed its own work under Mobile Apps, so that bundle is no longer the import's alone */
    const { imported: _file, importedOn: _day, ...priced } = plan.solutions[0]!;
    const deskWork = { ...priced, id: 'CS-07' };
    const removal = removeImported([...plan.solutions, deskWork], plan.bundles, 'openedx', 'acme.xlsx');

    expect(removal.removed).toEqual({ estimates: 2, bundles: 1 });
    expect(removal.solutions.map((one) => one.id)).toEqual(['CS-07']);
    expect(removal.bundles.map((one) => one.name)).toEqual(['Mobile Apps']);
  });

  it('leaves the same bundle number on another platform alone', () => {
    const plan = planEstimateImport({ ...input, rows: [row(1, { area: 'Mobile Apps' })] });
    const moodleBundle = { ...plan.bundles[0]!, plat: 'moodle' };
    const removal = removeImported(plan.solutions, [...plan.bundles, moodleBundle], 'openedx', 'acme.xlsx');

    expect(removal.bundles).toEqual([moodleBundle]);
    expect(removeImported(plan.solutions, plan.bundles, 'openedx', 'nothing.xlsx').removed).toEqual({ estimates: 0, bundles: 0 });
  });

  it('takes the file name as confirmation, with other capitals or stray spaces', () => {
    expect(confirmsName('Edly_estimates_filled.xlsx', 'Edly_estimates_filled.xlsx')).toBe(true);
    expect(confirmsName('  edly_ESTIMATES_filled.xlsx ', 'Edly_estimates_filled.xlsx')).toBe(true);
  });

  it('refuses part of the name, the name without its extension, or nothing', () => {
    /* the point is that nobody deletes 400 estimates by pressing Enter on an empty box */
    expect(confirmsName('', 'Edly_estimates_filled.xlsx')).toBe(false);
    expect(confirmsName('   ', '   ')).toBe(false);
    expect(confirmsName('Edly_estimates', 'Edly_estimates_filled.xlsx')).toBe(false);
    expect(confirmsName('Edly_estimates_filled', 'Edly_estimates_filled.xlsx')).toBe(false);
  });
});
