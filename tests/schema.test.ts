import { describe, expect, it } from 'vitest';
import { readWorkbook, writeWorkbook } from '../src/lib/xlsx';
import { coerceState, COLUMNS, countRows, sheetsToState, stateToSheets, storedForm, syncKey, SHEETS } from '../server/schema';
import type { Catalog, PersistedState, SalesLegalItem, Tender, TenderRequirement } from '../src/types';
import { DEFAULT_SHEET, readSheetPrefs } from '../src/domain/taskBreakdown';

/**
 * These tests exist because every one of them once failed.
 * If you change the schema, they are the contract: nothing may be lost in a round-trip.
 */

/** A catalog big enough to exceed one Excel cell when serialised (32,767 chars). */
function bigCatalog(): Catalog {
  return {
    meta: {
      title: 'Loaded sheet',
      subtitle: '',
      compiled: '2026-09-01',
      totals: { features: 270, buildHrs: null, firstHrs: 1000, repeatHrs: 300, saved: null, noEstimate: 0, inDev: 0 },
      notes: []
    },
    bundles: Array.from({ length: 30 }, (_, bundleIndex) => ({
      id: `B${String(bundleIndex + 1).padStart(2, '0')}`,
      name: `Bundle number ${bundleIndex + 1}`,
      pitch: 'A pitch long enough to matter when serialised, with spaces near the boundaries. '.repeat(8),
      offerWhen: '',
      featureCount: 9,
      buildHrs: null,
      firstHrs: 100,
      repeatHrs: 30,
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items: Array.from({ length: 9 }, (_, itemIndex) => ({
        id: `X-${bundleIndex}-${itemIndex}`,
        name: `Solution ${bundleIndex}.${itemIndex}`,
        desc: 'What it does, described at the length a real catalog row uses, with spaces. '.repeat(5),
        form: 'Integration',
        status: 'Production' as const,
        deploy: '2–3 days',
        first: 8 + itemIndex,
        repeat: 3 + itemIndex,
        build: 40 + itemIndex,
        saving: null,
        account: null,
        integrations: null,
        notes: null,
        ref: null,
        category: 'Core Platform',
        subCategory: null
      }))
    }))
  };
}

function sample(): PersistedState {
  const catalog = bigCatalog();
  return {
    estimations: [
      {
        id: 'EST-1',
        plat: 'openedx',
        name: 'Acme Corporate Academy',
        slug: 'acme-corporate-academy',
        client: 'Acme Ltd',
        tag: 'Urgent',
        due: '2026-10-15',
        at: '2026-09-01',
        up: '2026-09-22',
        total: 1259.95,
        cost: 74_250,
        items: 13,
        snap: {
          sel: { 'EDU-071': true, 'EDU-041': true, 'CS-01': true },
          buf: { 'EDU-071': 4.5 },
          bufPct: 12,
          pm: 10,
          qa: 8,
          rate: 62,
          cur: 'EUR',
          cap: 80,
          gs: { B01: 0, B05: 2.5 },
          roles: [
            { id: 'sr', name: 'Senior Engineer', rate: 55 },
            { id: 'devops', name: 'DevOps', rate: 50 },
            { id: 'eng-jr', name: 'Engineer', level: 'Junior', rate: 30 },
            { id: 'eng-lead', name: 'Engineer', level: 'Lead', rate: 70 }
          ],
          lineRole: { 'EDU-071': 'devops', 'EDU-041': 'sr' },
          pmRole: 'pm',
          qaRole: 'qa',
          plan: { 'EDU-071': { start: 2, people: 3, order: 0 }, 'EDU-041': { people: 2, order: 1 } },
          hpw: 38,
          maxPar: 5,
          planStart: '2026-10-01',
          sheet: {
            contact: 'Jane Rivera, Edly',
            comments: 'Phase one covers payments only.\n\nPhase two follows sign-off.',
            notes: { 'EDU-071': 'Assumes a live Stripe account.', 'RQ-01': 'Proctoring vendor chosen by the client.' }
          }
        }
      },
      {
        id: 'EST-2',
        plat: 'moodle',
        name: 'Nordic University',
        slug: 'nordic-university',
        client: '',
        tag: 'Closed',
        due: '',
        at: '2026-08-02',
        up: '2026-08-30',
        total: 0,
        cost: 0,
        items: 0,
        snap: { sel: {}, buf: {}, bufPct: 0 }
      }
    ],
    requests: [
      {
        id: 'RQ-01',
        plat: 'openedx',
        estId: 'EST-1',
        estName: 'Acme Corporate Academy',
        client: 'Acme Ltd',
        title: 'Proctored exam integration',
        details: 'Live proctoring with identity check and session recording',
        area: 'Assessment',
        urgency: 'Blocking a Q4 deal',
        integrations: 'Proctorio',
        name: 'Sara',
        email: 'sara@edly.io',
        org: 'Edly',
        at: '2026-09-10',
        est: 48,
        repeatEst: 12,
        csId: 'CS-01',
        catBundle: 'B05',
        estBy: 'admin',
        estAt: '2026-09-12',
        catForm: 'Custom development',
        catDeploy: '3–4 days',
        catInteg: 'Proctorio',
        catCategory: 'Assessment',
        catSub: 'Custom',
        catAccount: 'Proctorio',
        catNotes: 'One exam window per course.\nAssumes the Proctorio contract is already in place.',
        tender: 'TND-1',
        tenderReq: 'R-01'
      },
      {
        id: 'RQ-02',
        plat: 'openedx',
        estId: 'EST-1',
        estName: 'Acme Corporate Academy',
        client: 'Acme Ltd',
        title: 'Manually added line',
        details: 'Manually added custom item',
        area: 'Custom',
        urgency: '',
        integrations: '',
        name: '',
        email: '',
        org: '',
        at: '2026-09-11',
        manual: true,
        est: 16
      },
      {
        id: 'RQ-03',
        plat: 'moodle',
        estId: 'EST-2',
        estName: 'Nordic University',
        client: '',
        title: 'Teams attendance sync',
        details: 'Still pending',
        area: 'Integration',
        urgency: '',
        integrations: '',
        name: '',
        email: '',
        org: '',
        at: '2026-09-18'
      }
    ],
    solutions: [
      {
        id: 'CS-01',
        plat: 'openedx',
        bundleId: 'B05',
        name: 'Proctored exam integration',
        desc: 'Live proctoring',
        first: 48,
        repeat: 12,
        form: 'Custom development',
        deploy: '3–4 days',
        integrations: '',
        category: 'Assessment',
        subCategory: 'Custom',
        account: 'Proctorio',
        notes: 'One exam window per course.\nAssumes the Proctorio contract is already in place.',
        from: 'RQ-01',
        estAt: '2026-09-12',
        direct: false
      },
      {
        id: 'CS-02',
        plat: 'moodle',
        bundleId: 'CB-01',
        name: 'Blue-green deployment pipeline',
        desc: 'Zero downtime releases',
        first: 64,
        repeat: 16,
        form: 'Custom development',
        deploy: '1 week',
        integrations: '',
        category: 'Infrastructure',
        subCategory: '',
        account: '',
        notes: 'Single-region only',
        from: '',
        estAt: '2026-09-20',
        direct: true
      }
    ],
    bundles: [
      {
        id: 'CB-01',
        plat: 'moodle',
        name: 'Deployment & Infrastructure',
        pitch: 'Zero-downtime releases',
        offerWhen: 'release safety, uptime',
        pairsWith: null,
        at: '2026-09-20'
      }
    ],
    settings: {
      'edly-platform-v2': { practice: 'edtech', plat: 'openedx' },
      'edly-open-estimation-v2': 'EST-1',
      'edly-workspace-v2': {
        display: { savings: true, notes: true, money: false, controls: true, blendBuffer: false },
        sheet: {
          columns: { ...DEFAULT_SHEET.columns, solutionId: true, notes: false },
          sections: { ...DEFAULT_SHEET.sections, cover: false },
          catalogNotes: false
        }
      },
      'edly-loaded-catalogs-v2': { openedx: catalog, moodle: catalog }
    },
    tenders: [tender()],
    salesLegal: salesLegal()
  };
}

/** One of each: a tender's out-of-scope requirement, a key term, and an item typed in by hand on another deal. */
function salesLegal(): SalesLegalItem[] {
  return [
    {
      id: 'SL-01',
      plat: 'openedx',
      estId: 'EST-1',
      tender: 'TND-1',
      tenderItem: 'R-18',
      category: 'certification',
      kind: 'obligation',
      text: 'Hold a state cloud security certification before the contract starts.',
      quote: 'The Contractor shall maintain the certification for the duration of the contract.',
      source: 'Acme RFP.pdf, p. 5',
      section: '7.3 Security and compliance',
      reason: 'A certification the supplier must hold, not software delivery.',
      priority: 'must',
      owner: 'Legal',
      status: 'open',
      due: '2026-10-20',
      note: 'Ask the security lead whether ours covers hosting.\nRenewal falls in March.',
      at: '2026-09-21',
      up: '2026-09-22'
    },
    {
      id: 'SL-02',
      plat: 'openedx',
      estId: 'EST-1',
      tender: 'TND-1',
      tenderItem: 'T-01',
      category: 'sales',
      kind: 'term',
      text: 'Invoices are paid within 45 days of receipt.',
      quote: 'Payment shall be made within forty-five (45) days of receipt of a correct invoice.',
      source: 'Acme RFP.pdf, p. 40, 12.3',
      section: '',
      reason: '',
      topic: 'payment',
      priority: 'must',
      owner: '',
      status: 'handled',
      due: '',
      note: '',
      at: '2026-09-21',
      up: '2026-09-21'
    },
    {
      id: 'SL-03',
      plat: 'moodle',
      estId: 'EST-2',
      tender: '',
      tenderItem: '',
      category: '',
      kind: 'obligation',
      text: 'Quarterly business review with the provost office.',
      quote: '',
      source: '',
      section: '',
      reason: '',
      priority: 'should',
      owner: 'Sara',
      status: 'not-ours',
      due: '',
      note: '',
      at: '2026-09-18',
      up: '2026-09-19'
    }
  ];
}

/** A tender with enough requirements that its detail runs well past one cell. */
function tender(count = 120): Tender {
  const reqs: TenderRequirement[] = [];
  for (let i = 0; i < count; i++) {
    const req: TenderRequirement = {
      id: `R-${String(i + 1).padStart(2, '0')}`,
      doc: 1,
      page: 1 + Math.floor(i / 4),
      section: `4.${Math.floor(i / 10) + 1} Learner experience`,
      text: `The platform shall let every learner complete task number ${i + 1}, with spaces placed where a boundary could land. `.repeat(2).trim(),
      quote: `The supplier shall provide capability ${i + 1} to all learners, including those using assistive technology.`,
      priority: i % 3 === 0 ? 'should' : 'must',
      outOfScope: i % 17 === 0,
      status: i % 5 === 0 ? 'proposed' : 'approved'
    };
    if (i % 2 === 0) {
      req.match = { kind: i % 4 === 0 ? 'catalog' : 'custom', solutionIds: i % 4 === 0 ? ['X-0-1'] : [], confidence: 'high', reason: 'Covered by the identity bundle.', remainder: '', area: '', integrations: 'Azure AD', approved: i % 8 === 0 };
    }
    reqs.push(req);
  }
  return {
    id: 'TND-1',
    plat: 'openedx',
    name: 'Acme Academy LMS tender',
    slug: 'acme-academy-lms-tender',
    client: 'Acme Academy',
    due: '2026-11-30',
    summary: 'Acme Academy is replacing its LMS for 40,000 learners across three campuses.',
    at: '2026-09-20',
    up: '2026-09-21',
    stage: 'match',
    docs: [{ n: 1, name: 'Acme RFP.pdf', kind: 'pdf', bytes: 1_200_000, pages: 48, fileId: 'file_abc', expiresAt: '2026-09-23T10:00:00Z' }],
    fit: { platform: 'openedx', confidence: 'high', reasons: ['Names Open edX outright'], alternatives: [{ platform: 'moodle', reason: 'Also an LMS' }], elsewhere: [] },
    outline: [{ doc: 1, title: 'Scope of work', from: 3, to: 20 }],
    ranges: [
      { key: '1:1-20', doc: 1, from: 1, to: 20, status: 'done', found: 60 },
      { key: '1:21-48', doc: 1, from: 21, to: 48, status: 'failed', error: 'Too many AI requests at once.' }
    ],
    reqs,
    estId: '',
    sentAt: '',
    tokens: { input: 1200, output: 900, cacheRead: 80_000, cacheWrite: 90_000, usd: 0.51 },
    aiLimit: 4,
    aiApproved: 0
  };
}

const roundTrip = async (state: PersistedState): Promise<PersistedState> =>
  sheetsToState(await readWorkbook(writeWorkbook(stateToSheets(state))));

describe('spreadsheet round-trip', () => {
  it('writes a workbook Excel can open', () => {
    expect(writeWorkbook(stateToSheets(sample())).length).toBeGreaterThan(2000);
  });

  it('keeps every estimation field, including the nested snapshot', async () => {
    const original = sample();
    const back = await roundTrip(original);
    expect(back.estimations).toHaveLength(2);
    expect(back.estimations[0]?.total).toBe(1259.95);
    expect(back.estimations[0]?.cost).toBe(74_250);
    /* the snapshot carries selections, buffers, rate card, role assignments and the plan */
    expect(back.estimations[0]?.snap).toEqual(original.estimations[0]?.snap);
  });

  it('keeps the slug a deep link is built from', async () => {
    const back = await roundTrip(sample());
    expect(back.estimations[0]?.slug).toBe('acme-corporate-academy');
    expect(back.estimations[1]?.slug).toBe('nordic-university');
  });

  it('gives a file written before the slug column a slug, unique within its platform', async () => {
    /* exactly what an older build wrote: the slug column is not there at all */
    const columns = ['id', 'plat', 'name', 'client', 'tag', 'due', 'created', 'updated', 'totalHours', 'cost', 'solutions', 'snapshotJson'];
    const row = (id: string, plat: string, client: string): (string | number)[] => [
      id, plat, 'Acme Corporate Academy', client, 'Active', '', '2026-01-01', '2026-01-02', 0, 0, 0, '{}'
    ];
    const legacy = {
      [SHEETS.estimations]: [columns, row('EST-1', 'openedx', 'One'), row('EST-2', 'openedx', 'Two'), row('EST-3', 'moodle', 'Three')]
    };

    const back = sheetsToState(await readWorkbook(writeWorkbook(legacy)));
    expect(back.estimations[0]?.slug).toBe('acme-corporate-academy');
    /* two deals with one name on one platform must not share a URL */
    expect(back.estimations[1]?.slug).toBe('acme-corporate-academy-2');
    /* another platform is its own namespace, so it starts clean */
    expect(back.estimations[2]?.slug).toBe('acme-corporate-academy');
  });

  it('never rewrites a slug that is already set', async () => {
    /* a renamed deal keeps its original slug, so a link shared last week still opens it */
    const renamed = sample();
    const first = renamed.estimations[0];
    if (first) first.name = 'Acme Global Academy — renamed';
    const back = await roundTrip(renamed);
    expect(back.estimations[0]?.slug).toBe('acme-corporate-academy');
  });

  it('keeps a closed estimation with blank fields', async () => {
    const back = await roundTrip(sample());
    expect(back.estimations[1]?.tag).toBe('Closed');
    expect(back.estimations[1]?.total).toBe(0);
    expect(back.estimations[1]?.due).toBe('');
  });

  it('keeps request hours and every catalog field', async () => {
    const back = await roundTrip(sample());
    expect(back.requests[0]?.est).toBe(48);
    expect(back.requests[0]?.repeatEst).toBe(12);
    expect(back.requests[0]?.catAccount).toBe('Proctorio');
    expect(back.requests[1]?.manual).toBe(true);
  });

  it('leaves an un-estimated request with NO hours, not zero', async () => {
    /* zero would read as "estimated at nothing" and would join the totals */
    const back = await roundTrip(sample());
    expect(back.requests[2]?.est).toBeUndefined();
  });

  it('keeps desk-added solutions and their direct flag', async () => {
    const back = await roundTrip(sample());
    expect(back.solutions).toHaveLength(2);
    expect(back.solutions[0]?.direct).toBe(false);
    expect(back.solutions[1]?.direct).toBe(true);
    expect(back.solutions[1]?.plat).toBe('moodle');
  });

  it('keeps the integrations of a desk solution and the deal it was priced for', async () => {
    /* both show in the catalog row's detail, and both used to vanish on the first reload */
    const original = sample();
    const priced = original.solutions[0];
    if (priced) Object.assign(priced, { integrations: 'Proctorio', estName: 'Acme Corporate Academy' });

    const back = await roundTrip(original);
    expect(back.solutions[0]?.integrations).toBe('Proctorio');
    expect(back.solutions[0]?.estName).toBe('Acme Corporate Academy');
    /* a solution entered straight at the desk belongs to no deal, and must not come back with one */
    expect(back.solutions[1]?.estName).toBeUndefined();
  });

  it('reads a solutions sheet written before the integrations and estimationName columns', async () => {
    /* exactly what an older build wrote: columns are read by name, so this must still load */
    const columns = [
      'id', 'plat', 'bundleId', 'name', 'description', 'firstHours', 'repeatHours', 'form', 'deploy',
      'category', 'subCategory', 'account', 'limits', 'note', 'fromRequest', 'addedOn', 'direct'
    ];
    const row = ['CS-01', 'openedx', 'B05', 'Proctored exam integration', 'Live proctoring', 48, 12, 'Custom development',
      '3 days', 'Assessment', '', 'Proctorio', '', '', 'RQ-01', '2026-09-12', ''];
    const back = sheetsToState(await readWorkbook(writeWorkbook({ [SHEETS.solutions]: [columns, row] })));

    expect(back.solutions[0]).toMatchObject({ id: 'CS-01', name: 'Proctored exam integration', first: 48, account: 'Proctorio', from: 'RQ-01', integrations: '', notes: '' });
    expect(back.solutions[0]?.estName).toBeUndefined();
  });

  it('keeps one Notes / Assumptions on a desk solution and its request, line breaks and all', async () => {
    /* the one entry the client's task breakdown prints, so a lost line break merges two sentences */
    const back = await roundTrip(sample());
    expect(back.solutions[0]?.notes).toBe('One exam window per course.\nAssumes the Proctorio contract is already in place.');
    expect(back.requests[0]?.catNotes).toBe('One exam window per course.\nAssumes the Proctorio contract is already in place.');
    expect(back.solutions[1]?.notes).toBe('Single-region only');
  });

  it('reads a request the desk wrote no notes for back with no entry, not an empty one', async () => {
    const back = await roundTrip(sample());
    expect(back.requests[1]).not.toHaveProperty('catNotes');
    expect(back.requests[2]).not.toHaveProperty('catNotes');
  });

  it('writes the note where an older build reads it, and no limits column any more', () => {
    /* A tab still running the build before this one reads `note` and nothing else, so the whole
       entry has to be there; a `limits` column left behind would be joined in a second time. */
    const sheets = stateToSheets(sample());
    const solutions = sheets[SHEETS.solutions] ?? [];
    const header = (solutions[0] ?? []).map(String);
    expect(header).not.toContain('limits');
    expect(solutions[1]?.[header.indexOf('note')]).toBe('One exam window per course.\nAssumes the Proctorio contract is already in place.');

    const requests = sheets[SHEETS.requests] ?? [];
    const requestHeader = (requests[0] ?? []).map(String);
    expect(requests[1]?.[requestHeader.indexOf('note')]).toBe('One exam window per course.\nAssumes the Proctorio contract is already in place.');
    expect(String(requests[1]?.[requestHeader.indexOf('extraJson')])).not.toContain('catLimits');
  });

  it('joins the limits and note an older build kept apart into one entry, limits first', async () => {
    const solutionColumns = [...COLUMNS.solutions.slice(0, COLUMNS.solutions.indexOf('note')), 'limits', ...COLUMNS.solutions.slice(COLUMNS.solutions.indexOf('note'))];
    const solutionRow = (id: string, limits: string, note: string): (string | number)[] =>
      solutionColumns.map((column) => ({ id, plat: 'openedx', name: `Solution ${id}`, firstHours: 8, limits, note } as Record<string, string | number>)[column] ?? '');
    const requestRow = COLUMNS.requests.map(
      (column) =>
        ({
          id: 'RQ-01',
          plat: 'openedx',
          title: 'Proctored exam integration',
          estimateHours: 48,
          note: 'Assumes the Proctorio contract is in place.',
          extraJson: JSON.stringify({ manual: false, catLimits: 'One exam window per course.' })
        } as Record<string, string | number>)[column] ?? ''
    );
    const back = sheetsToState(
      await readWorkbook(
        writeWorkbook({
          [SHEETS.solutions]: [
            solutionColumns,
            solutionRow('CS-01', 'Single region only.', 'Assumes AWS.'),
            solutionRow('CS-02', 'Single region only.', ''),
            solutionRow('CS-03', '', 'Assumes AWS.'),
            /* the desk often typed the same sentence into both boxes */
            solutionRow('CS-04', 'Assumes AWS.', 'Assumes AWS.')
          ],
          [SHEETS.requests]: [[...COLUMNS.requests], requestRow]
        })
      )
    );

    expect(back.solutions.map((solution) => solution.notes)).toEqual(['Single region only.\nAssumes AWS.', 'Single region only.', 'Assumes AWS.', 'Assumes AWS.']);
    expect(back.requests[0]?.catNotes).toBe('One exam window per course.\nAssumes the Proctorio contract is in place.');
    /* and once joined, a second trip leaves it as it is */
    const again = await roundTrip(back);
    expect(again.solutions[0]?.notes).toBe('Single region only.\nAssumes AWS.');
    expect(again.requests[0]?.catNotes).toBe('One exam window per course.\nAssumes the Proctorio contract is in place.');
  });

  it('keeps custom bundle categories', async () => {
    const back = await roundTrip(sample());
    expect(back.bundles[0]?.name).toBe('Deployment & Infrastructure');
  });

  it('keeps where an imported estimate came from: the file, the day, its own id, the client and who priced it', async () => {
    /* the file name is what "Remove import" removes by, and the Estimate ID is what a second
       import of the same file updates by, so losing either on reload breaks both. The day is
       what the import history shows. */
    const original = sample();
    original.solutions.push({
      ...original.solutions[1]!,
      id: 'CS-03',
      plat: 'openedx',
      bundleId: 'CB-02',
      from: '',
      direct: false,
      imported: 'Nordic estimates.xlsx',
      importedOn: '2026-09-29',
      sourceId: 'NU-014',
      client: 'Nordic University',
      estBy: 'Estimation desk'
    });
    original.bundles.push({ id: 'CB-02', plat: 'openedx', name: 'Mobile Apps', pitch: '', offerWhen: '', pairsWith: null, at: '2026-09-27', imported: 'Nordic estimates.xlsx' });

    const back = await roundTrip(original);
    expect(back.solutions[2]).toEqual(original.solutions[2]);
    expect(back.bundles[1]).toEqual(original.bundles[1]);
    /* and one priced in the app comes back without any of them, not with blanks */
    expect(back.solutions[0]).not.toHaveProperty('imported');
    expect(back.solutions[0]).not.toHaveProperty('importedOn');
    expect(back.solutions[0]).not.toHaveProperty('sourceId');
    expect(back.bundles[0]).not.toHaveProperty('imported');
    expect(storedForm(original)).toEqual(back);
  });

  it('reads solutions and bundles sheets written before the import columns existed', async () => {
    const solutionColumns = COLUMNS.solutions.filter((name) => !['importedFrom', 'sourceId', 'client', 'estimatedBy', 'importedOn'].includes(name));
    const bundleColumns = COLUMNS.bundles.filter((name) => name !== 'importedFrom');
    const back = sheetsToState(
      await readWorkbook(
        writeWorkbook({
          [SHEETS.solutions]: [solutionColumns, ['CS-01', 'openedx', 'B05', 'Proctoring', '', 48, 12, '', '', '', '', '', '', '', 'RQ-01', '', '2026-09-12', '']],
          [SHEETS.bundles]: [bundleColumns, ['CB-01', 'openedx', 'Compliance', '', '', '', '2026-09-12']]
        })
      )
    );

    expect(back.solutions[0]).toMatchObject({ id: 'CS-01', first: 48, from: 'RQ-01' });
    expect(back.solutions[0]?.imported).toBeUndefined();
    expect(back.solutions[0]?.importedOn).toBeUndefined();
    expect(back.bundles[0]).toMatchObject({ id: 'CB-01', name: 'Compliance' });
    expect(back.bundles[0]?.imported).toBeUndefined();
  });

  it('keeps the words on the Excel sheet: contact, comments and every line note', async () => {
    const back = await roundTrip(sample());
    /* written by sales for one client, so they travel with the deal, blank lines and all */
    expect(back.estimations[0]?.snap.sheet).toEqual({
      contact: 'Jane Rivera, Edly',
      comments: 'Phase one covers payments only.\n\nPhase two follows sign-off.',
      notes: { 'EDU-071': 'Assumes a live Stripe account.', 'RQ-01': 'Proctoring vendor chosen by the client.' }
    });
  });

  it("keeps each rate-card role's seniority, and reads a card saved before levels as having none", async () => {
    const back = await roundTrip(sample());
    const roles = back.estimations[0]?.snap.roles ?? [];
    expect(roles.map((role) => [role.id, role.level])).toEqual([
      ['sr', undefined],
      ['devops', undefined],
      ['eng-jr', 'Junior'],
      ['eng-lead', 'Lead']
    ]);
  });

  it('reads a deal saved before the Excel sheet had words of its own as having none', async () => {
    const back = await roundTrip(sample());
    expect(back.estimations[1]?.snap.sheet).toBeUndefined();
  });

  it('keeps the Excel sheet choices beside the display settings', async () => {
    const back = await roundTrip(sample());
    const workspace = back.settings['edly-workspace-v2'] as { sheet?: unknown };
    const prefs = readSheetPrefs(workspace.sheet);
    expect(prefs.columns.solutionId).toBe(true);
    expect(prefs.columns.notes).toBe(false);
    expect(prefs.sections.cover).toBe(false);
    /* leaving the catalog's notes off a client's sheet is a choice, and a reload must not undo it */
    expect(prefs.catalogNotes).toBe(false);
    expect(prefs).toEqual(workspace.sheet);
  });

  it('keeps settings, including a raw string value', async () => {
    const back = await roundTrip(sample());
    expect(back.settings['edly-open-estimation-v2']).toBe('EST-1');
    expect(back.settings['edly-platform-v2']).toEqual({ practice: 'edtech', plat: 'openedx' });
  });
});

describe('oversized values', () => {
  it('splits anything past an Excel cell and rejoins it exactly', async () => {
    const original = sample();
    const payload = JSON.stringify(original.settings['edly-loaded-catalogs-v2']);
    expect(payload.length).toBeGreaterThan(32_767);

    const sheets = stateToSheets(original);
    const settings = sheets[SHEETS.settings] ?? [];
    const chunked = settings.filter((row) => String(row[0]).includes('##'));
    expect(chunked.length).toBeGreaterThanOrEqual(2);
    /* no cell may exceed the limit, or the tail is silently truncated */
    for (const row of settings) expect(String(row[1] ?? '').length).toBeLessThanOrEqual(28_002);

    const back = await roundTrip(original);
    expect(back.settings['edly-loaded-catalogs-v2']).toEqual(original.settings['edly-loaded-catalogs-v2']);
  });

  it('keeps settings in the order they were written, even one split across rows', async () => {
    /* a split value used to be re-added after the plain ones, so it came back last */
    const original = sample();
    original.settings['edly-catalog-source-v2'] = { source: 'auto', at: '2026-09-26' };
    const back = await roundTrip(original);
    expect(Object.keys(back.settings)).toEqual(Object.keys(original.settings));
  });

  it('drops a split value with a chunk missing, and leaves no empty key where it was', async () => {
    /* a hand-edited sheet with one chunk row deleted: half a catalog would fail to parse later */
    const sheets = stateToSheets(sample());
    const settings = sheets[SHEETS.settings] ?? [];
    sheets[SHEETS.settings] = settings.filter((row) => !String(row[0]).startsWith('edly-loaded-catalogs-v2##2/'));

    const back = sheetsToState(await readWorkbook(writeWorkbook(sheets)));
    expect(Object.keys(back.settings)).not.toContain('edly-loaded-catalogs-v2');
    expect(back.settings['edly-platform-v2']).toEqual({ practice: 'edtech', plat: 'openedx' });
  });

  it('survives a space landing on a chunk boundary', async () => {
    /* chunks are pipe-wrapped because the reader trims cells */
    const spaced = { ...sample(), settings: { 'edly-workspace-v2': { blob: 'word '.repeat(12_000) } } };
    const back = await roundTrip(spaced);
    expect(back.settings['edly-workspace-v2']).toEqual(spaced.settings['edly-workspace-v2']);
  });
});

/**
 * What `useSync` compares. It used to compare raw JSON text, and the text of what the browser
 * holds never equals the text of what a store hands back for the same data: cells cannot tell ''
 * from a missing field, the reader trims every cell, and a split setting came back last. So every
 * 45 s poll looked like a change, and each open tab re-read and rewrote the whole workbook.
 */
describe('the sync key', () => {
  /** A workspace shaped the way the reducer shapes one, including the parts a cell flattens. */
  function heldByTheBrowser(): PersistedState {
    const state = sample();
    /* the deal seeded for a fresh workspace has no tag at all */
    state.estimations.push({
      id: 'EST-3', plat: 'openedx', name: 'General estimation', slug: 'general-estimation', client: '', tag: '',
      due: '', at: '2026-09-01', up: '2026-09-01', total: 0, cost: 0, items: 0,
      snap: { sel: {}, buf: {}, bufPct: 0, pm: null, qa: null, cur: 'USD', planStart: '' }
    });
    const pending = state.requests[2];
    /* typed into a textarea, so it ends in a newline the reader will trim */
    if (pending) pending.details = 'Still pending, see the thread\n';
    const priced = state.requests[0];
    /* the desk left the notes blank: '' here, and no cell at all in the sheet */
    if (priced) priced.catNotes = '';
    const item = state.salesLegal[1];
    /* a note typed into a textarea, with the newline the reader will trim */
    if (item) item.note = 'Finance confirmed the terms\n';
    const custom = state.solutions[0];
    /* set the way `submitEstimate` sets them for a desk-priced request */
    if (custom) Object.assign(custom, { integrations: 'Proctorio', estName: 'Acme Corporate Academy' });
    /* the order `SYNCED_SETTING_KEYS` produces, with the split catalog in the middle */
    const catalogs = state.settings['edly-loaded-catalogs-v2'];
    state.settings = {
      'edly-workspace-v2': state.settings['edly-workspace-v2'],
      'edly-open-estimation-v2': 'EST-1',
      'edly-platform-v2': { practice: 'edtech', plat: 'openedx' },
      'edly-loaded-catalogs-v2': catalogs,
      'edly-catalog-source-v2': { source: 'auto', name: 'catalog-source.xlsx', at: '2026-09-26' }
    };
    return state;
  }

  it('is the same for what the browser holds and what the store hands back', async () => {
    const held = heldByTheBrowser();
    const back = await roundTrip(held);
    expect(syncKey(back)).toBe(syncKey(held));
  });

  it('stays the same through a second read, so a quiet poll is not a change', async () => {
    const once = await roundTrip(heldByTheBrowser());
    const twice = await roundTrip(once);
    expect(syncKey(twice)).toBe(syncKey(once));
  });

  it('matches storedForm to what the file actually returns', async () => {
    /* storedForm is the in-memory model of the file round trip; if the two drift, the key lies */
    const held = heldByTheBrowser();
    expect(storedForm(held)).toEqual(await roundTrip(held));
  });

  it('ignores the order keys arrive in', () => {
    const held = heldByTheBrowser();
    const reversed: PersistedState = {
      ...held,
      settings: Object.fromEntries(Object.entries(held.settings).reverse()),
      estimations: held.estimations.map((one) => ({ ...one, snap: Object.fromEntries(Object.entries(one.snap).reverse()) as typeof one.snap }))
    };
    expect(syncKey(reversed)).toBe(syncKey(held));
  });

  it('changes when the store would hold something different', () => {
    const held = heldByTheBrowser();
    const base = syncKey(held);

    const edited = heldByTheBrowser();
    const deal = edited.estimations[0];
    if (deal) deal.snap = { ...deal.snap, bufPct: 13 };
    expect(syncKey(edited)).not.toBe(base);

    const retitled = heldByTheBrowser();
    const first = retitled.requests[0];
    if (first) first.title = 'Proctored exam integration, phase two';
    expect(syncKey(retitled)).not.toBe(base);

    const reopened = heldByTheBrowser();
    reopened.settings['edly-open-estimation-v2'] = 'EST-2';
    expect(syncKey(reopened)).not.toBe(base);

    const removed = heldByTheBrowser();
    removed.bundles = [];
    expect(syncKey(removed)).not.toBe(base);

    /* an owner taken or an item closed has to reach the sheet, where the teams read it */
    const assigned = heldByTheBrowser();
    const open = assigned.salesLegal[0];
    if (open) open.owner = 'Account';
    expect(syncKey(assigned)).not.toBe(base);
  });
});

describe('coerceState', () => {
  it('narrows anything to the persisted shape', () => {
    expect(coerceState(null)).toEqual({ estimations: [], requests: [], solutions: [], bundles: [], settings: {}, tenders: [], salesLegal: [] });
    expect(coerceState({ estimations: 'nope', settings: 7 }).estimations).toEqual([]);
    expect(coerceState({ settings: { a: 1 } }).settings).toEqual({ a: 1 });
    expect(coerceState({ tenders: 'nope' }).tenders).toEqual([]);
    expect(coerceState({ salesLegal: 'nope' }).salesLegal).toEqual([]);
  });

  it('counts rows for the empty-payload guard, tenders and the sales and legal list included', () => {
    expect(countRows(null)).toBe(0);
    expect(countRows(sample())).toBe(2 + 3 + 2 + 1 + 1 + 3);
    /* a store holding only these is holding someone's work, so the guard must see it */
    expect(countRows({ ...sample(), estimations: [], requests: [], solutions: [], bundles: [], tenders: [] })).toBe(3);
  });
});

describe('tenders', () => {
  const detailColumn = COLUMNS.tenders.indexOf('detailJson');

  it('keeps a tender whole: its details, requirements, matches, ranges and token count', async () => {
    const original = sample();
    const back = await roundTrip(original);
    expect(back.tenders).toHaveLength(1);
    expect(back.tenders[0]).toEqual(original.tenders[0]);
  });

  it("keeps what the reading plan and the tender's references depend on", async () => {
    /* a lost skip reads the pricing forms again on reload; a lost span sends 400 sheet rows to one call */
    const base = tender(2);
    const planned: Tender = {
      ...base,
      docs: [...base.docs, { n: 2, name: 'Matrix.xlsx', kind: 'text', bytes: 40_000, pages: 12, span: 3, fileId: 'file_def', expiresAt: '2026-09-23T10:00:00Z' }],
      outline: [...base.outline, { doc: 1, title: 'Pricing forms', from: 40, to: 48, skip: true }],
      reqs: base.reqs.map((req, index) => (index === 0 ? { ...req, ref: 'FR-012' } : req))
    };
    const back = await roundTrip({ ...sample(), tenders: [planned] });
    expect(back.tenders[0]?.docs[1]?.span).toBe(3);
    expect(back.tenders[0]?.outline[1]?.skip).toBe(true);
    expect(back.tenders[0]?.reqs[0]?.ref).toBe('FR-012');
    expect(back.tenders[0]).toEqual(planned);
  });

  it('splits a tender whose requirements run past one cell, and rejoins it exactly', async () => {
    const rows = stateToSheets(sample())[SHEETS.tenders] ?? [];
    /* 120 requirements serialise far past what Excel keeps in one cell */
    expect(rows.filter((row) => String(row[0]).startsWith('TND-1##')).length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(String(row[detailColumn] ?? '').length).toBeLessThanOrEqual(28_002);

    const back = await roundTrip(sample());
    expect(back.tenders[0]?.reqs).toHaveLength(120);
    expect(back.tenders[0]?.reqs[119]?.text).toContain('task number 120');
  });

  it('survives a space landing on a part boundary', async () => {
    /* the parts are pipe-wrapped because the reader trims every cell */
    const spaced = { ...sample(), tenders: [{ ...tender(0), summary: 'word '.repeat(12_000) }] };
    const back = await roundTrip(spaced);
    expect(back.tenders[0]?.summary).toBe(spaced.tenders[0]?.summary);
  });

  it('drops a tender with a part missing rather than loading half its requirements', async () => {
    /* a hand-edited sheet with one row deleted: a partial list reads as a finished review */
    const sheets = stateToSheets(sample());
    sheets[SHEETS.tenders] = (sheets[SHEETS.tenders] ?? []).filter((row) => !String(row[0]).startsWith('TND-1##2/'));
    const back = sheetsToState(await readWorkbook(writeWorkbook(sheets)));
    expect(back.tenders).toEqual([]);
    expect(back.estimations).toHaveLength(2);
  });

  it('writes readable counts beside the detail, for whoever scans the sheet', () => {
    const rows = stateToSheets(sample())[SHEETS.tenders] ?? [];
    const header = rows[0] ?? [];
    const first = rows[1] ?? [];
    const cell = (name: string): unknown => first[header.indexOf(name)];
    const reqs = tender().reqs;
    const approved = reqs.filter((req) => req.status === 'approved');
    expect(cell('name')).toBe('Acme Academy LMS tender');
    expect(cell('stage')).toBe('match');
    expect(cell('requirements')).toBe(120);
    expect(cell('approved')).toBe(approved.length);
    expect(cell('catalog')).toBe(approved.filter((req) => req.match?.kind === 'catalog').length);
    expect(cell('custom')).toBe(approved.filter((req) => req.match?.kind === 'custom').length);
  });

  it('keeps what a tender has cost and what it may spend, and shows both to whoever scans the sheet', async () => {
    const spent: Tender = { ...tender(2), tokens: { ...tender(2).tokens, usd: 4.6137 }, aiLimit: 4, aiApproved: 4.3 };
    const back = await roundTrip({ ...sample(), tenders: [spent] });
    /* a lost approval asks the person again on reload; a lost total lets the tender spend again from zero */
    expect(back.tenders[0]).toEqual(spent);

    const rows = stateToSheets({ ...sample(), tenders: [spent] })[SHEETS.tenders] ?? [];
    const header = rows[0] ?? [];
    const cell = (name: string): unknown => rows[1]?.[header.indexOf(name)];
    expect(cell('aiSpent')).toBe(4.61);
    expect(cell('aiLimit')).toBe(4);
    expect(cell('aiApproved')).toBe(4.3);
    /* the continuation rows put their part in the last column, so detailJson has to stay last */
    expect(header[header.length - 1]).toBe('detailJson');
  });

  it('prices a tender saved before its cost was kept, and gives it the default limit', async () => {
    /* exactly what the previous build wrote: no aiSpent, aiLimit or aiApproved column, no usd in the detail */
    const sheets = stateToSheets({ ...sample(), tenders: [tender(2)] });
    const rows = sheets[SHEETS.tenders] ?? [];
    const header = (rows[0] ?? []).map(String);
    const dropped = ['aiSpent', 'aiLimit', 'aiApproved'].map((name) => header.indexOf(name));
    const detail = header.indexOf('detailJson');
    sheets[SHEETS.tenders] = rows.map((row, index) => {
      const cells = row.map((value, column) => {
        if (index === 0 || column !== detail) return value;
        const parsed = JSON.parse(String(value)) as { tokens: Record<string, number> };
        delete parsed.tokens.usd;
        return JSON.stringify(parsed);
      });
      return cells.filter((_, column) => !dropped.includes(column));
    });

    const back = sheetsToState(await readWorkbook(writeWorkbook(sheets)));
    expect(back.tenders[0]).toMatchObject({ aiLimit: 4, aiApproved: 0 });
    /* 1,200 in at $4, 900 out at $20, 80,000 from cache at $0.20 and 90,000 written at $5, per million */
    expect(back.tenders[0]?.tokens.usd).toBeCloseTo(0.0048 + 0.018 + 0.016 + 0.45, 10);
  });

  it('keeps the tender a desk request was drafted from, and adds nothing to one typed by hand', async () => {
    const back = await roundTrip(sample());
    expect(back.requests[0]?.tender).toBe('TND-1');
    expect(back.requests[0]?.tenderReq).toBe('R-01');
    expect(back.requests[1]?.tender).toBeUndefined();
    expect(back.requests[1]?.tenderReq).toBeUndefined();
  });

  it('reads a requests sheet written before the tender columns', async () => {
    const columns = ['id', 'plat', 'estimationId', 'title', 'details', 'submitted'];
    const back = sheetsToState(await readWorkbook(writeWorkbook({ [SHEETS.requests]: [columns, ['RQ-01', 'openedx', 'EST-1', 'Custom SSO', 'Details', '2026-01-01']] })));
    expect(back.requests[0]).toMatchObject({ id: 'RQ-01', title: 'Custom SSO' });
    expect(back.requests[0]?.tender).toBeUndefined();
  });

  it('reads a workbook written before tenders existed as holding none', async () => {
    const back = sheetsToState(await readWorkbook(writeWorkbook({ [SHEETS.estimations]: [[...COLUMNS.estimations]] })));
    expect(back.tenders).toEqual([]);
  });

  it('reads an unknown stage as the first step, and gives a blank slug one', async () => {
    const sheets = stateToSheets({ ...sample(), tenders: [{ ...tender(3), slug: '' }] });
    const rows = sheets[SHEETS.tenders] ?? [];
    const stageColumn = COLUMNS.tenders.indexOf('stage');
    const first = rows[1];
    if (first) first[stageColumn] = 'somewhere else';
    const back = sheetsToState(await readWorkbook(writeWorkbook(sheets)));
    expect(back.tenders[0]?.stage).toBe('requirements');
    expect(back.tenders[0]?.slug).toBe('acme-academy-lms-tender');
  });

  it('keeps the key terms a person asked for, the choice itself, and how far their reading got', async () => {
    const asked: Tender = {
      ...tender(2),
      readTerms: true,
      terms: [
        { id: 'T-01', doc: 1, page: 40, ref: '12.3', topic: 'payment', text: 'Invoices are paid within 45 days of receipt.', quote: 'Payment shall be made within 45 days.', category: 'sales' },
        { id: 'T-02', doc: 1, page: 41, topic: 'insurance', text: 'Cyber liability cover of $5 million.', quote: 'Cyber liability of not less than $5,000,000.', category: 'legal', skip: true }
      ],
      termReads: [{ key: 'terms:1', doc: 1, from: 1, to: 48, status: 'done', found: 2 }]
    };
    /* a lost tick reads the terms again on reload, or never; a lost read list pays for them twice */
    const back = await roundTrip({ ...sample(), tenders: [asked] });
    expect(back.tenders[0]).toEqual(asked);

    const rows = stateToSheets({ ...sample(), tenders: [asked] })[SHEETS.tenders] ?? [];
    const header = rows[0] ?? [];
    expect(rows[1]?.[header.indexOf('readTerms')]).toBe('yes');
    /* the continuation rows put their part in the last column, so the new column sits before it */
    expect(header[header.length - 1]).toBe('detailJson');
  });

  it('reads a tender that never asked for its terms with no trace of them, as it was written', async () => {
    /* `readTerms: false` or an empty list would make every older tender look edited on the first read */
    const back = await roundTrip(sample());
    expect(back.tenders[0]).not.toHaveProperty('readTerms');
    expect(back.tenders[0]).not.toHaveProperty('terms');
    expect(back.tenders[0]).not.toHaveProperty('termReads');
  });
});

describe('the sales, account and legal sheet', () => {
  it('keeps every item whole: where it came from, who has it, where it stands', async () => {
    const back = await roundTrip(sample());
    expect(back.salesLegal).toEqual(salesLegal());
  });

  it('writes one readable row per item, with the deal named and the category and status in words', () => {
    const rows = stateToSheets(sample())[SHEETS.salesLegal] ?? [];
    const header = (rows[0] ?? []).map(String);
    const cell = (row: number, name: string): unknown => rows[row]?.[header.indexOf(name)];
    expect(rows).toHaveLength(4);
    /* the columns a colleague filters on lead, so the sheet reads without scrolling sideways */
    expect(header.slice(0, 11)).toEqual(['id', 'plat', 'estimationId', 'estimationName', 'client', 'category', 'item', 'status', 'owner', 'due', 'note']);
    expect(cell(1, 'estimationName')).toBe('Acme Corporate Academy');
    expect(cell(1, 'client')).toBe('Acme Ltd');
    expect(cell(1, 'category')).toBe('Certification');
    expect(cell(1, 'status')).toBe('Open');
    expect(cell(2, 'category')).toBe('Sales and commercial');
    expect(cell(2, 'status')).toBe('Handled');
    expect(cell(3, 'category')).toBe('');
    expect(cell(3, 'status')).toBe('Not for us');
    /* why it is there and where it sits, so the sheet reads without the tender beside it */
    expect(cell(1, 'reason')).toBe('A certification the supplier must hold, not software delivery.');
    expect(cell(1, 'section')).toBe('7.3 Security and compliance');
    expect(cell(2, 'topic')).toBe('Payment and invoicing');
  });

  it('reads a sheet written before the reason, section and topic columns, with those blank', async () => {
    /* exactly the columns the first build of this sheet wrote */
    const header = ['id', 'plat', 'estimationId', 'category', 'item', 'status', 'owner', 'due', 'note', 'kind', 'priority', 'source', 'quote', 'tenderId', 'tenderItem', 'created', 'updated'];
    const row = ['SL-01', 'openedx', 'EST-1', 'Legal and compliance', 'Notify a breach within a day', 'Open', 'Legal', '', '', 'term', 'must', 'RFP.docx, 9.6', '', 'TND-1', 'T-02', '2026-09-29', '2026-09-29'];
    const back = sheetsToState(await readWorkbook(writeWorkbook({ [SHEETS.salesLegal]: [header, row] }))).salesLegal;
    expect(back[0]).toMatchObject({ id: 'SL-01', section: '', reason: '', kind: 'term', owner: 'Legal' });
    expect(back[0]).not.toHaveProperty('topic');
  });

  it('shows a renamed deal under its new name, because only the id is kept on the item', async () => {
    const renamed = sample();
    const deal = renamed.estimations[0];
    if (deal) deal.name = 'Acme Global Academy';
    const rows = stateToSheets(renamed)[SHEETS.salesLegal] ?? [];
    expect(rows[1]?.[(rows[0] ?? []).indexOf('estimationName')]).toBe('Acme Global Academy');
    const back = await roundTrip(renamed);
    expect(back.salesLegal[0]).not.toHaveProperty('estimationName');
  });

  it('reads what a person typed over the sheet: a status in their own words, a category, a date as the sheet shows it', async () => {
    /* the legal and account teams assign and close these rows in Google Sheets itself */
    const header = [...COLUMNS.salesLegal];
    const row = (id: string, values: Record<string, string>): string[] => header.map((name) => (name === 'id' ? id : values[name] ?? ''));
    const typed = {
      [SHEETS.salesLegal]: [
        header,
        row('SL-01', { estimationId: 'EST-1', item: 'Background checks for on-site staff', category: 'people and staffing', status: 'done', due: '10/12/2026', owner: 'Delivery' }),
        row('SL-02', { estimationId: 'EST-1', item: 'Breach notice within a day', category: 'Legal', status: 'NOT FOR US', due: '46315' }),
        row('SL-03', { estimationId: 'EST-1', item: 'Spend report', category: 'something else', status: 'waiting on finance', due: 'next week', priority: 'Should', kind: 'Term' })
      ]
    };
    const back = sheetsToState(await readWorkbook(writeWorkbook(typed))).salesLegal;
    expect(back[0]).toMatchObject({ category: 'people', status: 'handled', due: '2026-10-12', owner: 'Delivery' });
    /* Excel keeps a typed date as a day count, and that is what the reader hands back */
    expect(back[1]).toMatchObject({ category: 'legal', status: 'not-ours', due: '2026-10-20' });
    /* what cannot be read is open, unsorted and undated, never guessed at */
    expect(back[2]).toMatchObject({ category: '', status: 'open', due: '', priority: 'should', kind: 'term' });
  });

  it('reads a workbook written before the sheet existed as holding none', async () => {
    const back = sheetsToState(await readWorkbook(writeWorkbook({ [SHEETS.estimations]: [[...COLUMNS.estimations]] })));
    expect(back.salesLegal).toEqual([]);
  });
});
