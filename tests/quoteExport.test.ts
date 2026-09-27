import { describe, expect, it } from 'vitest';
import {
  defaultComments,
  PLAN_WEEK_LIMIT,
  rowHeight,
  detailLayout,
  sheetBreakdown,
  sheetFileName,
  sheetTerms,
  SHEET_NAMES,
  taskBreakdownSheets,
  teamNote,
  textLines,
  type SheetInput
} from '../src/lib/quoteExport';
import { readWorkbook, unzip, writeWorkbook } from '../src/lib/xlsx';
import { calcEstimate, DEFAULT_ROLES } from '../src/domain/estimate';
import { schedule } from '../src/domain/planner';
import { DEFAULT_SHEET, readSheetPrefs, SHEET_COLUMNS, type SheetPrefs } from '../src/domain/taskBreakdown';
import { sheetColor } from '../src/theme';
import type { Catalog, CurrencyCode, EstimateRequest, EstimationSnapshot, Solution } from '../src/types';

/**
 * The workbook a client receives: Edly's task-breakdown template, filled from the estimate.
 *
 * Asserted by writing the real file and reading it back, because that is what the client opens:
 * a row built correctly and then lost in the writer is the same bug to them as one never built.
 *
 * The rule under test throughout: **the file carries what the Excel sheet panel ticks, and
 * nothing else.** Untick the estimate and no amount of money may reach the file by another route.
 */

const solution = (id: string, name: string, first: number | null, over: Partial<Solution> = {}): Solution => ({
  id,
  name,
  desc: `${name} for every learner.`,
  form: 'Integration',
  status: 'Production',
  deploy: '2 days',
  first,
  repeat: null,
  build: first === null ? null : first * 4,
  saving: null,
  account: null,
  integrations: null,
  notes: null,
  ref: null,
  category: 'Core Platform',
  subCategory: null,
  ...over
});

const catalog: Catalog = {
  meta: {
    title: 'Test',
    subtitle: '',
    compiled: '',
    totals: { features: 5, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 1, inDev: 1 },
    notes: []
  },
  bundles: [
    {
      id: 'B01',
      name: 'Core Platform',
      pitch: '',
      offerWhen: '',
      featureCount: 4,
      buildHrs: null,
      firstHrs: null,
      repeatHrs: null,
      saved: null,
      noEstimate: 1,
      inDev: 1,
      accounts: null,
      pairsWith: null,
      items: [
        solution('OX-1', 'Stripe Payments', 40, { account: 'Stripe', notes: 'Internal: patched build.' }),
        solution('OX-2', 'Single sign-on', 60),
        solution('OX-3', 'Unpriced thing', null),
        solution('OX-4', 'Still building', 20, { status: 'In Development' })
      ]
    },
    {
      id: 'B02',
      name: 'Reporting',
      pitch: '',
      offerWhen: '',
      featureCount: 1,
      buildHrs: null,
      firstHrs: null,
      repeatHrs: null,
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items: [solution('OX-5', 'Dashboards', 16)]
    }
  ]
};

const snap: EstimationSnapshot = {
  sel: { 'OX-1': true, 'OX-2': true, 'OX-3': true, 'OX-4': true, 'OX-5': true },
  buf: { 'OX-1': 8 },
  bufPct: 10,
  pm: 10,
  qa: 5,
  rate: 120,
  cur: 'USD',
  roles: [...DEFAULT_ROLES],
  lineRole: {},
  plan: {},
  hpw: 40,
  maxPar: 4,
  planStart: '2026-10-05'
};

const request = (over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id: 'RQ-01',
  plat: 'openedx',
  estId: 'EST-1',
  estName: 'Acme Academy',
  client: 'Acme Inc',
  title: 'Bespoke reporting',
  details: 'Weekly exports',
  area: 'Reporting',
  urgency: '',
  integrations: '',
  name: 'Rep',
  email: 'rep@edly.io',
  org: 'Edly',
  at: '2026-01-01',
  ...over
});

interface Setup {
  prefs?: SheetPrefs;
  requests?: EstimateRequest[];
  snapshot?: EstimationSnapshot;
  blendBuffer?: boolean;
  currency?: CurrencyCode;
  sample?: boolean;
  client?: string;
}

const inputFor = ({ prefs = DEFAULT_SHEET, requests = [], snapshot = snap, blendBuffer = false, currency = 'USD', sample = false, client = 'Acme Inc' }: Setup = {}): SheetInput => {
  const estimate = calcEstimate(catalog, snapshot, requests);
  return {
    estimation: { name: 'Acme Academy', client },
    snap: snapshot,
    estimate,
    requests,
    plan: schedule(estimate, requests, snapshot, { blendBuffer }),
    bundles: catalog.bundles,
    prefs,
    blendBuffer,
    currency,
    platformName: 'Open edX',
    sample,
    date: '2026-09-27'
  };
};

/** Build the real file and read back every sheet as text, one line per row: what the client sees. */
const workbookText = async (setup: Setup = {}): Promise<Record<string, string>> => {
  const workbook = await readWorkbook(writeWorkbook(taskBreakdownSheets(inputFor(setup))));
  return Object.fromEntries(Object.entries(workbook).map(([name, rows]) => [name, rows.map((row) => row.join(' | ')).join('\n')]));
};

const breakdownText = async (setup: Setup = {}): Promise<string> => (await workbookText(setup))[SHEET_NAMES.breakdown] ?? '';

/** Header row of the Task Breakdown, as the client reads it. */
const headers = async (setup: Setup = {}): Promise<string[]> => {
  const sheet = taskBreakdownSheets(inputFor(setup))[SHEET_NAMES.breakdown]!;
  const row = sheet.rows[(sheet.print?.repeatRows?.[0] ?? 0) - 1];
  return (row?.cells ?? []).map((cell) => (cell && typeof cell === 'object' ? String(cell.v ?? '') : '')).filter(Boolean);
};

const only = (...ids: string[]): SheetPrefs =>
  readSheetPrefs({ columns: Object.fromEntries(SHEET_COLUMNS.map((column) => [column.id, ids.includes(column.id)])), sections: DEFAULT_SHEET.sections });

describe("Edly's task-breakdown template", () => {
  it('is an Introduction, the Task Breakdown and the Delivery Plan, in that order', async () => {
    expect(Object.keys(await workbookText())).toEqual(['Introduction', 'Task Breakdown', 'Delivery Plan']);
  });

  it("carries the template's columns, with hours and the estimate added at the end", async () => {
    expect(await headers()).toEqual(['Deliverable no.', 'Area', 'Component', 'Description', 'Support Status', 'Notes/Assumptions', 'Hours', 'Estimate (USD)']);
  });

  it("titles every sheet with the client, in the template's 24pt red Arial", async () => {
    const sheets = await workbookText();
    for (const text of Object.values(sheets)) expect(text).toContain('Acme Inc | Project Task Breakdown');
    const styles = new TextDecoder().decode((await unzip(writeWorkbook(taskBreakdownSheets(inputFor()))))['xl/styles.xml']);
    expect(styles).toContain('<b/><sz val="24"/><color rgb="FFDC1F26"/><name val="Arial"/>');
  });

  it('falls back to the deal name when there is no client', async () => {
    expect(await breakdownText({ client: '' })).toContain('Acme Academy | Project Task Breakdown');
  });

  it('lists the project details the template asks for', async () => {
    const cover = (await workbookText({ snapshot: { ...snap, sheet: { contact: 'Jane Rivera' } } }))[SHEET_NAMES.cover] ?? '';
    for (const label of ['PROJECT TITLE', 'ORGANIZATION NAME', 'CONTACT POINT', 'DATE']) expect(cover).toContain(label);
    expect(cover).toContain('Jane Rivera');
  });

  it('writes the date as a real date, shown the way the template shows it', async () => {
    /* 27 September 2026 is day 46292 counted from Excel's epoch, displayed as 9/27/26 */
    const serial = (Date.UTC(2026, 8, 27) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const cover = (await readWorkbook(writeWorkbook(taskBreakdownSheets(inputFor()))))[SHEET_NAMES.cover] ?? [];
    expect(cover.find((row) => row.includes('DATE'))).toContain(String(serial));
    const styles = new TextDecoder().decode((await unzip(writeWorkbook(taskBreakdownSheets(inputFor()))))['xl/styles.xml']);
    expect(styles).toContain('formatCode="m/d/yy"');
  });

  it('groups lines into numbered deliverables, one per area', async () => {
    const text = await breakdownText({ requests: [request({ est: 24 })] });
    expect(text).toContain('1 | Core Platform | Stripe Payments');
    /* the custom request names Reporting, so it joins that bundle's deliverable */
    expect(text).toMatch(/2 \| Reporting \| Dashboards[^\n]*\n[^\n]*Bespoke reporting/);
  });

  it("names each line's status in the client's words", async () => {
    const text = await breakdownText({ requests: [request({ est: 24 }), request({ id: 'RQ-02', title: 'Offline sync' })] });
    expect(text).toContain('Pre-built');
    expect(text).toContain('In development');
    expect(text).toContain('Custom');
    expect(text).toContain('To be estimated');
  });
});

describe('the numbers', () => {
  it('writes hours and cost as numbers, so the client can total the columns', () => {
    const sheet = taskBreakdownSheets(inputFor())[SHEET_NAMES.breakdown]!;
    const numbers = sheet.rows.flatMap((row) => (row.cells ?? []).filter((cell) => cell && typeof cell === 'object' && typeof cell.n === 'number'));
    expect(numbers.length).toBeGreaterThan(10);
  });

  it('ends on the grand total the builder shows, in hours and in money', async () => {
    const input = inputFor();
    const text = await breakdownText();
    const total = text.split('\n').find((line) => line.includes('| Total |') || line.startsWith(' | Total'));
    expect(total).toBeDefined();
    expect(total).toContain(String(Math.round(input.estimate.grand * 100) / 100));
    const money = Number(total?.split(' | ').filter(Boolean).at(-1));
    expect(Math.round(money)).toBe(input.estimate.usd);
  });

  it('lists the buffer, PM and QA that make up the total', async () => {
    const text = await breakdownText();
    expect(text).toContain('Risk buffer (incl. 10%)');
    expect(text).toContain('Project management (10%)');
    expect(text).toContain('Quality assurance (5%)');
  });

  it('goes straight to the total when nothing is added on top of the components', async () => {
    const bare = await breakdownText({ snapshot: { ...snap, buf: {}, bufPct: 0, pm: 0, qa: 0 } });
    expect(bare).toMatch(/\| Total \|/);
    expect(bare).not.toContain('Components');
    expect(await breakdownText()).toContain('Components');
  });

  it('names an unpriced item as unpriced instead of pricing it at zero', async () => {
    /* "0" in an hours column reads as free work */
    const text = await breakdownText({ requests: [request()] });
    expect(text).toMatch(/Unpriced thing[^\n]*Not estimated/);
    expect(text).toMatch(/Bespoke reporting[^\n]*To be estimated/);
  });

  it('folds the buffer into the line when blended, and does not list it', async () => {
    /* OX-1 is 40 h with an 8 h line buffer and 10%: 52.8 h blended */
    const blended = await breakdownText({ blendBuffer: true });
    expect(blended).toMatch(/Stripe Payments[^\n]*\| 52\.8 \|/);
    expect(blended).not.toContain('Risk buffer');

    const apart = await breakdownText({ blendBuffer: false });
    expect(apart).toMatch(/Stripe Payments[^\n]*\| 40 \|/);
  });

  it("converts money into the estimate's currency and says so", async () => {
    const input = inputFor({ currency: 'EUR' });
    expect(await headers({ currency: 'EUR' })).toContain('Estimate (EUR)');
    const styles = new TextDecoder().decode((await unzip(writeWorkbook(taskBreakdownSheets(input))))['xl/styles.xml']);
    expect(styles).toContain('formatCode="&quot;€&quot;#,##0"');
    expect(sheetTerms(input, sheetBreakdown(input)).join(' ')).toContain('Amounts in EUR use an indicative exchange rate.');
  });

  it('subtotals an area of several lines, and not one of a single line', async () => {
    const text = await breakdownText();
    expect(text).toContain('Subtotal, Core Platform');
    expect(text).not.toContain('Subtotal, Reporting');
  });

  it('does not subtotal an area nobody has priced as "0"', async () => {
    const text = await breakdownText({ requests: [request({ area: 'Custom' }), request({ id: 'RQ-02', area: 'Custom' })] });
    expect(text).not.toContain('Subtotal, Custom development');
  });
});

describe('what unticking keeps out of the file', () => {
  it('leaves every money figure out when Estimate, Rate and Cost by role are all off', async () => {
    const prefs = readSheetPrefs({ columns: { estimate: false, rate: false }, sections: { roles: false } });
    for (const text of Object.values(await workbookText({ prefs, snapshot: { ...snap, lineRole: { 'OX-1': 'sr' } } }))) {
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).not.toContain('/h');
      expect(text).not.toContain('Priced');
      expect(text).not.toContain('ESTIMATE (');
    }
    /* hiding the economics is not hiding the work */
    expect(await breakdownText({ prefs })).toContain('Total');
  });

  it('drops a column that is unticked, and adds one that is ticked', async () => {
    const trimmed = await headers({ prefs: readSheetPrefs({ columns: { description: false, solutionId: true, window: true } }) });
    expect(trimmed).not.toContain('Description');
    expect(trimmed).toContain('Solution ID');
    expect(trimmed).toContain('Delivery Window');
  });

  it('keeps catalog notes out unless Internal Notes is ticked', async () => {
    expect(await breakdownText()).not.toContain('Internal: patched build.');
    expect(await breakdownText({ prefs: readSheetPrefs({ columns: { internal: true } }) })).toContain('Internal: patched build.');
  });

  it('drops the Introduction, the Delivery Plan and the terms when they are unticked', async () => {
    const prefs = readSheetPrefs({ sections: { cover: false, timeline: false, terms: false } });
    const sheets = await workbookText({ prefs });
    expect(Object.keys(sheets)).toEqual(['Task Breakdown']);
    expect(sheets[SHEET_NAMES.breakdown]).not.toContain('Terms and Caveats');
  });

  it('drops the totals block when neither Hours nor Estimate is in the sheet', async () => {
    const text = await breakdownText({ prefs: only('component', 'description') });
    expect(text).not.toContain('Subtotal');
    expect(text).not.toMatch(/\| Total \|/);
  });

  it('breaks the cost down by role only when asked', async () => {
    const assigned = { ...snap, lineRole: { 'OX-1': 'sr', 'OX-2': 'eng' } };
    expect(await breakdownText({ snapshot: assigned })).not.toContain('Cost by Role');
    const text = await breakdownText({ snapshot: assigned, prefs: readSheetPrefs({ sections: { roles: true } }) });
    expect(text).toContain('Cost by Role');
    expect(text).toContain('Senior Engineer, $55/h');
  });

  it('says a line needs an account once: in its own column when ticked, in the notes when not', async () => {
    const inNotes = await breakdownText();
    expect(inNotes).toContain('Needs a client-held Stripe account.');
    const inColumn = await breakdownText({ prefs: readSheetPrefs({ columns: { account: true } }) });
    expect(inColumn).not.toContain('Needs a client-held Stripe account.');
    expect(inColumn).toMatch(/Stripe Payments[^\n]*\| Stripe \|/);
  });
});

describe('the introduction', () => {
  it("writes sales' general comments, or its own when they are blank", async () => {
    const own = (await workbookText())[SHEET_NAMES.cover] ?? '';
    expect(own).toContain('This workbook breaks the proposed Open edX scope for Acme Inc into 2 deliverables');
    const written = (await workbookText({ snapshot: { ...snap, sheet: { comments: 'Phase one covers payments only.' } } }))[SHEET_NAMES.cover] ?? '';
    expect(written).toContain('Phase one covers payments only.');
    expect(written).not.toContain('This workbook breaks');
  });

  it('only mentions cost in its own comments when the estimate is in the sheet', () => {
    const withCost = inputFor();
    expect(defaultComments(withCost, sheetBreakdown(withCost))).toContain('hours and cost');
    const hoursOnly = inputFor({ prefs: readSheetPrefs({ columns: { estimate: false } }) });
    expect(defaultComments(hoursOnly, sheetBreakdown(hoursOnly))).not.toContain('cost');
  });

  it('links to the next sheets under the comments, as the template does', async () => {
    const input = inputFor();
    const cover = taskBreakdownSheets(input)[SHEET_NAMES.cover]!;
    const text = (await workbookText())[SHEET_NAMES.cover] ?? '';
    expect(text).toContain('Next Sheet | Project Task Breakdown  →');
    /* the template carries no figures on its introduction; the commercials live in the breakdown */
    expect(text).not.toMatch(/\$\s?\d/);
    const links = cover.rows.flatMap((row) => (row.cells ?? []).filter((cell) => cell && typeof cell === 'object' && cell.link));
    expect(links.map((cell) => (cell && typeof cell === 'object' ? cell.link : ''))).toEqual(["'Task Breakdown'!A1", "'Delivery Plan'!A1"]);
  });
});

describe('the team composition sheet', () => {
  /* OX-1 to a senior engineer, OX-2 and OX-5 to a mid-level one; PM and QA overhead on their roles */
  const staffed: EstimationSnapshot = { ...snap, lineRole: { 'OX-1': 'sr', 'OX-2': 'eng', 'OX-5': 'eng' } };
  const teamText = async (setup: Setup = {}): Promise<string> => (await workbookText({ snapshot: staffed, ...setup }))[SHEET_NAMES.team] ?? '';
  const teamHeaders = (setup: Setup = {}): string[] => {
    const sheet = taskBreakdownSheets(inputFor({ snapshot: staffed, ...setup }))[SHEET_NAMES.team]!;
    const row = sheet.rows[(sheet.print?.repeatRows?.[0] ?? 0) - 1];
    return (row?.cells ?? []).map((cell) => (cell && typeof cell === 'object' ? String(cell.v ?? '') : '')).filter(Boolean);
  };

  it('comes after the breakdown once lines have roles', async () => {
    expect(Object.keys(await workbookText({ snapshot: staffed }))).toEqual(['Introduction', 'Task Breakdown', 'Team Composition', 'Delivery Plan']);
  });

  it('is left out while no line has a role, and when it is unticked', async () => {
    expect(Object.keys(await workbookText())).not.toContain(SHEET_NAMES.team);
    const unticked = await workbookText({ snapshot: staffed, prefs: readSheetPrefs({ sections: { team: false } }) });
    expect(Object.keys(unticked)).not.toContain(SHEET_NAMES.team);
  });

  it('lists role, seniority, people, weeks and hours, then rate and cost', () => {
    expect(teamHeaders()).toEqual(['Role', 'Seniority', 'People', 'On the Project', 'Hours', 'Rate (USD/h)', 'Cost (USD)', 'Notes']);
  });

  it('shows one role at two levels as two rows, each with its own rate', async () => {
    const text = await teamText();
    expect(text).toMatch(/\| Engineer \| Senior \|[^\n]*\| 55 \|/);
    expect(text).toMatch(/\| Engineer \| Mid-level \|[^\n]*\| 45 \|/);
    expect(text).toContain('| Project Manager | Senior |');
  });

  it('totals to the grand total the builder shows, in hours and money', async () => {
    const input = inputFor({ snapshot: staffed });
    const total = (await teamText()).split('\n').find((line) => line.startsWith(' | Team |'));
    const cells = total?.split(' | ') ?? [];
    expect(Number(cells[5])).toBeCloseTo(input.estimate.grand, 1);
    expect(Math.round(Number(cells[7]))).toBe(input.estimate.usd);
  });

  it('says which overhead a role carries, and what the Unassigned row is', async () => {
    const text = await teamText({ snapshot: { ...staffed, lineRole: { 'OX-1': 'sr' } } });
    expect(text).toContain('Includes project management (10%) across the delivery.');
    expect(text).toContain('Includes quality assurance (5%) across the delivery.');
    expect(text).toMatch(/Unassigned[^\n]*Work with no rate-card role, at the blended rate\./);
  });

  it('explains that people come from the plan and hours include the buffer', async () => {
    const text = await teamText();
    expect(text).toContain('People is the most in each role working at the same time in the delivery plan');
    expect(text).toContain('Hours include each line’s share of the risk buffer.');
  });

  it('keeps rate and cost off it when the Estimate column is unticked', async () => {
    const prefs = readSheetPrefs({ columns: { estimate: false } });
    expect(teamHeaders({ prefs })).toEqual(['Role', 'Seniority', 'People', 'On the Project', 'Hours', 'Notes']);
    expect(await teamText({ prefs })).not.toMatch(/\$\s?\d/);
  });

  it('is linked from the introduction, between the breakdown and the plan', () => {
    const cover = taskBreakdownSheets(inputFor({ snapshot: staffed }))[SHEET_NAMES.cover]!;
    const links = cover.rows.flatMap((row) => (row.cells ?? []).flatMap((cell) => (cell && typeof cell === 'object' && cell.link ? [cell.link] : [])));
    expect(links).toEqual(["'Task Breakdown'!A1", "'Team Composition'!A1", "'Delivery Plan'!A1"]);
  });

  it('writes the note for a role that carries nothing as blank', () => {
    const input = inputFor({ snapshot: staffed });
    expect(teamNote({ roleId: 'sr', role: 'Engineer', level: 'Senior', rate: 55, hours: 10, cost: 550, people: 1, weeks: null, carries: [] }, input)).toBe('');
  });
});

describe('the delivery plan', () => {
  it('draws a week column for each week of the plan, and a bar for each task', async () => {
    const input = inputFor();
    const plan = taskBreakdownSheets(input)[SHEET_NAMES.plan]!;
    expect(plan.widths).toHaveLength(2 + 5 + input.plan.weeks);
    const text = (await workbookText())[SHEET_NAMES.plan] ?? '';
    expect(text).toContain('Kick-off October 5, 2026');
    expect(text).toContain('Stripe Payments');
    expect(text).toContain('PM overhead (10%)');
  });

  it(`stops at ${PLAN_WEEK_LIMIT} weeks and says where the plan really ends`, async () => {
    const slow = { ...snap, buf: { 'OX-1': 8, 'OX-2': 160 }, hpw: 4, maxPar: 1 };
    const input = inputFor({ snapshot: slow });
    expect(input.plan.weeks).toBeGreaterThan(PLAN_WEEK_LIMIT);
    const text = (await workbookText({ snapshot: slow }))[SHEET_NAMES.plan] ?? '';
    expect(text).toContain(`the chart stops at week ${PLAN_WEEK_LIMIT}`);
  });

  it('is left out when nothing is scheduled', async () => {
    const nothing = { ...snap, sel: {} };
    expect(Object.keys(await workbookText({ snapshot: nothing }))).not.toContain(SHEET_NAMES.plan);
  });
});

describe('terms and caveats', () => {
  it('names what is unpriced, in development, client-held and benchmark', () => {
    const input = inputFor({ sample: true });
    const terms = sheetTerms(input, sheetBreakdown(input)).join('\n');
    expect(terms).toContain('1 item is not yet estimated and not included in the totals.');
    expect(terms).toContain('1 item is still in development');
    expect(terms).toContain('Client-held accounts needed: Stripe.');
    expect(terms).toContain('industry benchmarks, not Edly delivery records');
    expect(terms).toContain('Open edX® is a registered trademark');
  });

  it('says engineering hours only when no overhead was applied', () => {
    const input = inputFor({ snapshot: { ...snap, pm: 0, qa: 0 } });
    expect(sheetTerms(input, sheetBreakdown(input))[0]).toContain('Engineering hours only');
  });
});

describe('the look', () => {
  it("is drawn in the template's own colours", async () => {
    const styles = new TextDecoder().decode((await unzip(writeWorkbook(taskBreakdownSheets(inputFor()))))['xl/styles.xml']);
    const argb = (hex: string): string => `FF${hex.replace('#', '').toUpperCase()}`;
    for (const tone of [sheetColor.red, sheetColor.deliverable, sheetColor.area, sheetColor.head, sheetColor.rule, sheetColor.line]) {
      expect(styles).toContain(argb(tone));
    }
  });

  it('colours the tabs as the template does: the introduction red, the rest blue', () => {
    const sheets = taskBreakdownSheets(inputFor());
    expect(sheets[SHEET_NAMES.cover]?.tab).toBe(sheetColor.introTab);
    expect(sheets[SHEET_NAMES.breakdown]?.tab).toBe(sheetColor.tab);
    expect(sheets[SHEET_NAMES.plan]?.tab).toBe(sheetColor.tab);
  });

  it('hides gridlines, prints landscape and repeats the header on every page, without freezing it', () => {
    const sheet = taskBreakdownSheets(inputFor())[SHEET_NAMES.breakdown]!;
    expect(sheet.gridlines).toBe(false);
    /* the template does not freeze its header, and a frozen pane nine rows deep fills a laptop screen */
    expect(sheet.freezeRows).toBeUndefined();
    expect(sheet.print?.repeatRows?.[0]).toBeGreaterThan(0);
    expect(sheet.print?.landscape).toBe(true);
  });

  it("keeps the template's column widths and margins for its six columns", () => {
    const prefs = only('deliverable', 'area', 'component', 'description', 'status', 'notes');
    expect(taskBreakdownSheets(inputFor({ prefs }))[SHEET_NAMES.breakdown]?.widths).toEqual([7, 17.63, 33.75, 28.13, 24.63, 14, 40.25, 5.75]);
    expect(taskBreakdownSheets(inputFor())[SHEET_NAMES.cover]?.widths).toEqual([5.13, 19.5, 12.63, 12.63, 12.63, 13.75, 12.63, 12.63, 6.88]);
  });

  it('spaces the top of the breakdown row for row as the template does', () => {
    const sheet = taskBreakdownSheets(inputFor())[SHEET_NAMES.breakdown]!;
    const head = sheet.print!.repeatRows![0];
    const heights = sheet.rows.slice(0, head + 2).map((row) => row.h);
    /* blank, title, blank, two detail rows, two blank, red band, header, tall spacer ruled off, blank */
    expect(heights).toEqual([21, 36, 21, 21, 21, 21, 21, 21, heights[8], 49.5, 21]);
    expect(head).toBe(9);
    expect(heights[8]).toBeGreaterThanOrEqual(21);
  });

  it('puts the project details where the template does, and gives each value room', () => {
    /* the template's six columns: label B, value C:D, label E, value F:G */
    expect(detailLayout([17.63, 33.75, 28.13, 24.63, 14, 40.25])).toEqual({ leftEnd: 0, rightStart: 3, rightEnd: 3, heights: [21, 21] });
    /* with Hours and Estimate added, the second label takes Support Status beside Description */
    expect(detailLayout([17.63, 33.75, 28.13, 24.63, 14, 40.25, 10, 14])).toMatchObject({ leftEnd: 0, rightStart: 3, rightEnd: 4 });
    /* the team sheet: the second label moves right, so the project title keeps 30 characters */
    expect(detailLayout([28.13, 14, 10, 17.63, 10, 12, 14, 40.25])).toMatchObject({ leftEnd: 0, rightStart: 4, rightEnd: 5 });
    /* two columns cannot hold two pairs, so the details stack */
    expect(detailLayout([28.13, 10])).toBeNull();
  });

  it('never merges a cell into two ranges, which Excel refuses to open', () => {
    /* every mix of columns, sections and area layouts the tests use, all sheets */
    const setups: Setup[] = [
      {},
      { prefs: readSheetPrefs({ columns: Object.fromEntries(SHEET_COLUMNS.map((column) => [column.id, true])), sections: { roles: true } }) },
      { prefs: only('component', 'hours') },
      { prefs: only('component') },
      { requests: [request({ est: 24 }), request({ id: 'RQ-02', area: 'Mobile' })] },
      { snapshot: { ...snap, lineRole: { 'OX-1': 'sr', 'OX-2': 'eng' } } }
    ];
    const cells = (range: string): string[] => {
      const [from, to = from] = range.split(':') as [string, string?];
      const parse = (ref: string): [number, number] => {
        const [, letters = '', digits = '0'] = /^([A-Z]+)(\d+)$/.exec(ref) ?? [];
        return [[...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), Number(digits)];
      };
      const [c1, r1] = parse(from);
      const [c2, r2] = parse(to);
      const out: string[] = [];
      for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) out.push(`${c}:${r}`);
      return out;
    };
    for (const setup of setups) {
      for (const [name, sheet] of Object.entries(taskBreakdownSheets(inputFor(setup)))) {
        const seen = new Set<string>();
        for (const range of sheet.merges ?? []) {
          for (const cell of cells(range)) {
            expect(seen.has(cell), `${name}: ${range} overlaps another merge`).toBe(false);
            seen.add(cell);
          }
        }
      }
    }
  });

  it('names the file after the deal and the date', () => {
    expect(sheetFileName('Acme Academy: phase 1', '2026-09-27')).toBe('Edly-Acme-Academy-phase-1-Task-Breakdown-2026-09-27.xlsx');
    expect(sheetFileName('', '2026-09-27')).toBe('Edly-Estimate-Task-Breakdown-2026-09-27.xlsx');
  });
});

describe('row heights for wrapped text', () => {
  it('counts the lines a value wraps to, paragraph by paragraph', () => {
    expect(textLines('short', 40)).toBe(1);
    expect(textLines('x'.repeat(200), 40)).toBeGreaterThan(3);
    expect(textLines('one\ntwo\nthree', 40)).toBe(3);
  });

  it('makes a row tall enough for its longest cell, and never shorter than the minimum', () => {
    const long = 'A description long enough to wrap across several lines of a narrow column. '.repeat(3);
    expect(rowHeight([{ value: 'short', width: 40 }], 26)).toBe(26);
    expect(rowHeight([{ value: long, width: 28 }, { value: 'short', width: 40 }])).toBeGreaterThan(60);
  });
});
