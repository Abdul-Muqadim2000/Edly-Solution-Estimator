import { describe, expect, it } from 'vitest';
import {
  addExtracted,
  addTokens,
  catalogHours,
  catalogLines,
  deskDrafts,
  documentLength,
  matchBatches,
  KEEP_WARM_EVERY_MS,
  KEEP_WARM_MAX,
  needsMatching,
  newTender,
  nextKeepWarm,
  NO_TOKENS,
  outOfScopeMatches,
  planRanges,
  platformDigest,
  rangeLabel,
  rangesToRun,
  nextStaleAt,
  STALE_CLAIM_MS,
  highestId,
  serialId,
  heldDocs,
  readFit,
  readMatches,
  readingPlan,
  readingSummary,
  readRequirements,
  sectionPages,
  sectionRanges,
  shortTitle,
  skippedSections,
  SOMETHING_NEW,
  sortRequirements,
  sourceLabel,
  splitRange,
  stageOpen,
  tenderCounts,
  tenderRequests,
  tenderSelection,
  tokenSummary,
  type DeskDraft,
  type ExtractedRequirement
} from '../src/domain/tender';
import { PRACTICES } from '../src/data/practices';
import type { Catalog, EstimateRequest, RequirementMatch, Solution, Tender, TenderDocument, TenderRange, TenderRequirement, TenderSection } from '../src/types';

/**
 * The line between what the AI proposes and what the app trusts runs through this module.
 *
 * Most of what is asserted here is refusal: a platform the app does not have, a catalog id the
 * model made up, a page outside the document, a requirement sent to the desk twice. Each of those
 * would otherwise reach a client-facing estimate looking exactly like a real number.
 */

const solution = (id: string, name: string, first: number | null): Solution => ({
  id,
  name,
  desc: `${name}, described`,
  form: 'Integration',
  status: 'Production',
  deploy: '2 days',
  first,
  repeat: first === null ? null : Math.round(first / 3),
  build: null,
  saving: null,
  account: null,
  integrations: null,
  notes: null,
  ref: null,
  category: 'Identity',
  subCategory: null
});

const catalog: Catalog = {
  meta: {
    title: 'Test catalog',
    subtitle: '',
    compiled: '',
    totals: { features: 3, buildHrs: null, firstHrs: 60, repeatHrs: 20, saved: null, noEstimate: 1, inDev: 0 },
    notes: []
  },
  bundles: [
    {
      id: 'B13',
      name: 'Identity & SSO',
      pitch: '',
      offerWhen: 'SSO',
      featureCount: 2,
      buildHrs: null,
      firstHrs: 40,
      repeatHrs: 13,
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items: [solution('SSO-1', 'Azure AD sign-on', 24), solution('SSO-2', 'SCIM provisioning | sync', 16)]
    },
    {
      id: 'B04',
      name: 'Assessment',
      pitch: '',
      offerWhen: '',
      featureCount: 2,
      buildHrs: null,
      firstHrs: 20,
      repeatHrs: 7,
      saved: null,
      noEstimate: 1,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      /* SSO-1 again: a solution listed in two bundles must reach the model once */
      items: [solution('AS-1', 'Proctored exams', null), solution('SSO-1', 'Azure AD sign-on', 24)]
    }
  ]
};

const catalogIds = new Set(['SSO-1', 'SSO-2', 'AS-1']);

const doc = (n: number, over: Partial<TenderDocument> = {}): TenderDocument => ({
  n,
  name: `Doc ${n}.pdf`,
  kind: 'pdf',
  bytes: 1000,
  pages: 40,
  fileId: `file_${n}`,
  expiresAt: '2026-10-01T00:00:00Z',
  ...over
});

const match = (over: Partial<RequirementMatch> = {}): RequirementMatch => ({
  kind: 'catalog',
  solutionIds: ['SSO-1'],
  confidence: 'high',
  reason: 'The SSO bundle covers it.',
  remainder: '',
  area: '',
  integrations: '',
  approved: true,
  ...over
});

const req = (id: string, over: Partial<TenderRequirement> = {}): TenderRequirement => ({
  id,
  doc: 1,
  page: 3,
  section: 'Identity',
  text: `Requirement ${id}`,
  quote: `The supplier shall deliver ${id}.`,
  priority: 'must',
  outOfScope: false,
  status: 'approved',
  ...over
});

const tender = (over: Partial<Tender> = {}): Tender => ({
  id: 'TND-1',
  plat: 'openedx',
  name: 'Acme Academy tender',
  slug: 'acme-academy-tender',
  client: 'Acme Academy',
  due: '2026-11-30',
  summary: '',
  at: '2026-09-01',
  up: '2026-09-01',
  stage: 'requirements',
  docs: [doc(1)],
  fit: null,
  outline: [],
  ranges: [],
  reqs: [],
  estId: '',
  sentAt: '',
  tokens: NO_TOKENS,
  ...over
});

/* --------------------------------------------------------------- fit */

describe('reading the platform fit', () => {
  const platforms = ['openedx', 'moodle', 'totara', 'ios'];
  const docs = [
    { n: 1, kind: 'pdf' as const, pages: 0 },
    { n: 2, kind: 'text' as const, pages: 7 }
  ];

  it('keeps a recommendation for a platform the app has', () => {
    const { fit } = readFit({ platform: 'openedx', confidence: 'high', reasons: ['Asks for Open edX'], alternatives: [{ platform: 'moodle', reason: 'Also an LMS' }] }, platforms, docs);
    expect(fit.platform).toBe('openedx');
    expect(fit.confidence).toBe('high');
    expect(fit.alternatives).toEqual([{ platform: 'moodle', reason: 'Also an LMS' }]);
  });

  it('replaces a platform the app does not have with the best alternative, and says it is a weak call', () => {
    /* recommending "blackboard-ultra" to a salesperson who cannot open it is no recommendation */
    const { fit } = readFit({ platform: 'blackboard-ultra', confidence: 'high', alternatives: [{ platform: 'nonsense' }, { platform: 'totara', reason: 'Compliance focus' }] }, platforms, docs);
    expect(fit.platform).toBe('totara');
    expect(fit.confidence).toBe('low');
    expect(fit.alternatives).toEqual([]);
  });

  it('lists each alternative once and never repeats the recommendation', () => {
    const { fit } = readFit(
      { platform: 'openedx', alternatives: [{ platform: 'openedx' }, { platform: 'moodle' }, { platform: 'moodle' }, { platform: 'totara' }, { platform: 'ios' }] },
      platforms,
      docs
    );
    expect(fit.alternatives.map((one) => one.platform)).toEqual(['moodle', 'totara', 'ios']);
  });

  it('keeps work that belongs elsewhere only when it names another real platform', () => {
    const { fit } = readFit(
      { platform: 'openedx', elsewhere: [{ platform: 'ios', what: 'A native learner app' }, { platform: 'openedx', what: 'itself' }, { platform: 'android', what: 'unknown' }] },
      platforms,
      docs
    );
    expect(fit.elsewhere).toEqual([{ platform: 'ios', what: 'A native learner app' }]);
  });

  it('takes page counts for PDFs from the model and for converted text from the browser', () => {
    const { pages } = readFit({ documents: [{ doc: 1, pages: 48 }, { doc: 2, pages: 99 }] }, platforms, docs);
    expect(pages).toEqual({ 1: 48, 2: 7 });
  });

  it('keeps an outline inside the document, and a deadline only as a date', () => {
    const result = readFit(
      {
        documents: [{ doc: 1, pages: 48 }],
        deadline: 'next Friday',
        outline: [
          { doc: 1, title: 'Scope', from: 3, to: 90 },
          { doc: 9, title: 'Not a document', from: 1, to: 2 },
          { doc: 1, title: '', from: 1, to: 2 }
        ]
      },
      platforms,
      docs
    );
    expect(result.outline).toEqual([{ doc: 1, title: 'Scope', from: 3, to: 48 }]);
    expect(result.header.deadline).toBe('');
  });

  it('skips a section only when the model says so plainly', () => {
    /* a section left unread loses its requirements silently, so anything short of true is read */
    const { outline } = readFit(
      {
        documents: [{ doc: 1, pages: 48 }],
        outline: [
          { doc: 1, title: 'Instructions to bidders', from: 2, to: 6, skip: true },
          { doc: 1, title: 'Scope', from: 7, to: 30, skip: false },
          { doc: 1, title: 'Terms', from: 31, to: 40, skip: 'yes' },
          { doc: 1, title: 'Annexes', from: 41, to: 48 }
        ]
      },
      platforms,
      docs
    );
    expect(outline.map((section) => [section.title, section.skip === true])).toEqual([
      ['Instructions to bidders', true],
      ['Scope', false],
      ['Terms', false],
      ['Annexes', false]
    ]);
    expect(outline[1]).not.toHaveProperty('skip');
  });

  it('puts the outline in document order, whatever order the model answered in', () => {
    /* the documents go to the model converted text first, so its outline tends to start with the annexes */
    const { outline } = readFit(
      {
        documents: [{ doc: 1, pages: 48 }],
        outline: [
          { doc: 2, title: 'Matrix', from: 1, to: 7 },
          { doc: 1, title: 'Terms', from: 30, to: 48 },
          { doc: 1, title: 'Scope', from: 3, to: 29 }
        ]
      },
      platforms,
      docs
    );
    expect(outline.map((section) => section.title)).toEqual(['Scope', 'Terms', 'Matrix']);
    expect(readFit({ deadline: '2026-11-30' }, platforms, docs).header.deadline).toBe('2026-11-30');
  });

  it('survives an answer that is not an object at all', () => {
    const result = readFit('nonsense', platforms, docs);
    expect(result.fit.platform).toBe('');
    expect(result.header).toEqual({ title: '', client: '', deadline: '', summary: '' });
  });
});

/* ------------------------------------------------------------- extraction */

describe('reading extracted requirements', () => {
  it('keeps each requirement with its place in the document', () => {
    const found = readRequirements(
      { requirements: [{ text: '  Single   sign-on  ', quote: 'The platform shall support SSO', page: 4, section: 'Identity', priority: 'must', outOfScope: false }] },
      { doc: 2 },
      40
    );
    expect(found).toEqual([{ doc: 2, page: 4, section: 'Identity', text: 'Single sign-on', quote: 'The platform shall support SSO', priority: 'must', outOfScope: false }]);
  });

  it("keeps the tender's own reference, which is what the bid team answers against", () => {
    const [withRef, without] = readRequirements(
      { requirements: [{ text: 'Grades export nightly', ref: '  FR-012 ', page: 2 }, { text: 'Branded theme', ref: '' }] },
      { doc: 1 },
      5
    );
    expect(withRef?.ref).toBe('FR-012');
    /* no reference is no field, so requirements from before references read the same */
    expect(without).not.toHaveProperty('ref');
  });

  it('drops a page outside the document rather than pointing somewhere that does not exist', () => {
    const [found] = readRequirements({ requirements: [{ text: 'Reporting', page: 400 }] }, { doc: 1 }, 40);
    expect(found?.page).toBe(0);
  });

  it('reads an unclear priority as must, and skips entries with no text', () => {
    /* treating an obligation as optional is the expensive mistake in a tender */
    const found = readRequirements({ requirements: [{ text: 'Accessibility', priority: 'essential' }, { text: '' }, 'not an object', { quote: 'orphan' }] }, { doc: 1 }, 0);
    expect(found).toHaveLength(1);
    expect(found[0]?.priority).toBe('must');
  });

  it('adds new requirements with fresh ids and skips wording it already has', () => {
    const existing = [req('R-01', { text: 'Single sign-on through Azure AD' })];
    const incoming: ExtractedRequirement[] = [
      { doc: 1, page: 2, section: '', text: 'single sign-on, through Azure AD!', quote: '', priority: 'must', outOfScope: false },
      { doc: 1, page: 9, section: '', text: 'Grade export to the SIS', quote: 'shared', priority: 'must', outOfScope: false },
      /* same quote, different requirement: split out of one compound sentence, so both stay */
      { doc: 1, page: 9, section: '', text: 'Attendance export to the SIS', quote: 'shared', priority: 'should', outOfScope: false }
    ];
    const { reqs, added } = addExtracted(existing, incoming);
    expect(added).toBe(2);
    expect(reqs.map((one) => one.id)).toEqual(['R-01', 'R-02', 'R-03']);
    expect(reqs[1]?.status).toBe('proposed');
  });

  it('keeps requirements in document order, with ones added by hand last', () => {
    const sorted = sortRequirements([req('R-03', { doc: 0, page: 0 }), req('R-02', { doc: 2, page: 1 }), req('R-01', { doc: 1, page: 9 }), req('R-04', { doc: 1, page: 2 })]);
    expect(sorted.map((one) => one.id)).toEqual(['R-04', 'R-01', 'R-02', 'R-03']);
  });

  it('says where a requirement came from in words a person can follow', () => {
    const docs = [doc(1, { name: 'RFP.pdf' }), doc(2, { name: 'Annex.docx', kind: 'text' })];
    expect(sourceLabel({ doc: 1, page: 14 }, docs)).toBe('RFP.pdf, p. 14');
    expect(sourceLabel({ doc: 2, page: 3 }, docs)).toBe('Annex.docx, part 3');
    expect(sourceLabel({ doc: 1, page: 0 }, docs)).toBe('RFP.pdf');
    expect(sourceLabel({ doc: 0, page: 0 }, docs)).toBe('added by hand');
  });

  it("names the tender's own reference, in place of a part number nobody holding the original can find", () => {
    const docs = [doc(1, { name: 'RFP.pdf' }), doc(2, { name: 'Matrix.xlsx', kind: 'text' })];
    expect(sourceLabel({ doc: 1, page: 14, ref: '4.2.3' }, docs)).toBe('RFP.pdf, p. 14, 4.2.3');
    expect(sourceLabel({ doc: 2, page: 7, ref: 'FR-012' }, docs)).toBe('Matrix.xlsx, FR-012');
    expect(sourceLabel({ doc: 2, page: 7, ref: '  ' }, docs)).toBe('Matrix.xlsx, part 7');
  });
});

/* ------------------------------------------------------------------ ranges */

describe('planning the extraction calls', () => {
  it('cuts a document into ranges no longer than the span', () => {
    const ranges = planRanges([{ n: 1, pages: 45 }], [], 20);
    expect(ranges.map((range) => [range.from, range.to])).toEqual([
      [1, 20],
      [21, 40],
      [41, 45]
    ]);
    expect(ranges.every((range) => range.status === 'pending')).toBe(true);
  });

  it('ends a range before a section that starts in its last third, so the section is read whole', () => {
    const ranges = planRanges([{ n: 1, pages: 45 }], [{ doc: 1, title: 'Integrations', from: 17, to: 30 }], 20);
    expect(ranges[0]).toMatchObject({ from: 1, to: 16 });
    expect(ranges[1]).toMatchObject({ from: 17, to: 36 });
  });

  it('ignores a section start too early in the range to be worth a short call', () => {
    const ranges = planRanges([{ n: 1, pages: 45 }], [{ doc: 1, title: 'Early', from: 5, to: 30 }], 20);
    expect(ranges[0]).toMatchObject({ from: 1, to: 20 });
  });

  it('reads a document of unknown length in one call, and plans each document separately', () => {
    const ranges = planRanges([{ n: 1, pages: 0 }, { n: 2, pages: 3 }], []);
    expect(ranges.map((range) => range.key)).toEqual(['1:1-end', '2:1-3']);
  });

  /* the fictional tender the stand-in drives use: 45 pages, requirements in 3-4, 10-22 and 27-38 */
  const itt: TenderSection[] = [
    { doc: 1, title: 'Cover', from: 1, to: 1, skip: true },
    { doc: 1, title: 'Contents', from: 2, to: 2, skip: true },
    { doc: 1, title: 'Introduction', from: 3, to: 4 },
    { doc: 1, title: 'Instructions to bidders', from: 5, to: 9, skip: true },
    { doc: 1, title: 'Statement of requirements', from: 10, to: 22 },
    { doc: 1, title: 'Evaluation', from: 23, to: 26, skip: true },
    { doc: 1, title: 'Terms and service levels', from: 27, to: 38 },
    { doc: 1, title: 'Pricing schedule', from: 39, to: 43, skip: true },
    { doc: 1, title: 'Form of tender', from: 44, to: 45, skip: true }
  ];

  it('leaves out skipped sections, less a page at each edge in case the outline is a page out', () => {
    const ranges = planRanges([{ n: 1, pages: 45 }], itt, 20);
    expect(ranges.map((range) => range.key)).toEqual(['1:2-5', '1:9-23', '1:26-39']);
    /* every page that holds a requirement is inside a range */
    const read = (page: number): boolean => ranges.some((range) => range.from <= page && page <= range.to);
    for (const page of [3, 4, ...Array.from({ length: 13 }, (_, i) => 10 + i), ...Array.from({ length: 12 }, (_, i) => 27 + i)]) expect(read(page)).toBe(true);
    expect(readingPlan([{ n: 1, pages: 45 }], itt)).toEqual({ read: 33, total: 45 });
  });

  it('reads a page no section claims, and a page a read section shares with a skipped one', () => {
    const ranges = planRanges(
      [{ n: 1, pages: 30 }],
      [
        { doc: 1, title: 'Forms', from: 1, to: 10, skip: true },
        { doc: 1, title: 'Scope', from: 10, to: 12 },
        { doc: 1, title: 'Terms', from: 13, to: 20, skip: true }
      ],
      20
    );
    /* 9, 13 and 20 are margin, 10 is shared with Scope, 21 to 30 belong to no section */
    expect(ranges.map((range) => range.key)).toEqual(['1:9-13', '1:20-30']);
  });

  it('reads a short gap between two stretches when that saves a call, and not otherwise', () => {
    const outline = (gapTo: number): TenderSection[] => [
      { doc: 1, title: 'Scope', from: 1, to: 6 },
      { doc: 1, title: 'Divider', from: 7, to: gapTo, skip: true },
      { doc: 1, title: 'More scope', from: gapTo + 1, to: gapTo + 6 }
    ];
    /* skipped 8 and 9 only, after margins: reading them turns two calls into one */
    expect(planRanges([{ n: 1, pages: 16 }], outline(10), 20).map((range) => range.key)).toEqual(['1:1-16']);
    /* skipped 8 to 13: six pages is more than a gap worth reading */
    expect(planRanges([{ n: 1, pages: 20 }], outline(14), 20).map((range) => range.key)).toEqual(['1:1-7', '1:14-20']);
    /* a merge that saves no call is not made, even over a short gap */
    expect(planRanges([{ n: 1, pages: 16 }], outline(10), 8).map((range) => range.key)).toEqual(['1:1-7', '1:10-16']);
  });

  it('reads nothing of a document whose every section is skipped, and all of one with no outline', () => {
    const ranges = planRanges(
      [
        { n: 1, pages: 6 },
        { n: 2, pages: 4 }
      ],
      [{ doc: 1, title: 'Pricing workbook', from: 1, to: 6, skip: true }],
      20
    );
    expect(ranges.map((range) => range.key)).toEqual(['2:1-4']);
    expect(readingPlan([{ n: 1, pages: 6 }], [{ doc: 1, title: 'Pricing workbook', from: 1, to: 6, skip: true }])).toEqual({ read: 0, total: 6 });
  });

  it("uses a spreadsheet's own span, because its parts are dense with requirements", () => {
    const ranges = planRanges([{ n: 1, pages: 10, span: 3 }, { n: 2, pages: 25 }], [], 20);
    expect(ranges.map((range) => range.key)).toEqual(['1:1-3', '1:4-6', '1:7-9', '1:10-10', '2:1-20', '2:21-25']);
  });

  it("reads a skipped section after all, without reading again a page a range already covers", () => {
    const base = tender({ docs: [doc(1, { pages: 45 })], outline: itt, ranges: planRanges([{ n: 1, pages: 45 }], itt, 20) });
    const instructions = itt[3]!;
    /* 5 and 9 are already read as margin; 6 to 8 are new */
    expect(sectionRanges(base, instructions).map((range) => [range.key, range.status])).toEqual([['1:6-8', 'pending']]);
    const failedOver = { ...base, ranges: [...base.ranges, { key: '1:6-8', doc: 1, from: 6, to: 8, status: 'failed' as const }] };
    /* a failed range still covers its pages: it has Retry, and reading them twice would pay twice */
    expect(sectionRanges(failedOver, instructions)).toEqual([]);
    expect(sectionRanges(base, { doc: 9, title: 'Not a document', from: 1, to: 3 })).toEqual([]);
  });

  it('keeps the cache warm every four minutes from the last read, and stops when a write is cheaper', () => {
    const fit = 1_000_000;
    expect(nextKeepWarm(fit, 0)).toBe(fit + KEEP_WARM_EVERY_MS);
    /* four minutes leaves a margin inside the five-minute cache, timed from the start of a request */
    expect(KEEP_WARM_EVERY_MS).toBeLessThan(5 * 60_000);
    expect(nextKeepWarm(fit + 90_000, 3)).toBe(fit + 90_000 + KEEP_WARM_EVERY_MS);
    /* past six the reads cost more than the hour-long cache they replace would have */
    expect(nextKeepWarm(fit, KEEP_WARM_MAX)).toBeNull();
    expect(KEEP_WARM_MAX * 0.1).toBeLessThan(0.75);
    expect(nextKeepWarm(0, 0)).toBeNull();
  });

  it('says how much of each document is read, in its own unit', () => {
    expect(readingSummary({ n: 1, pages: 45, kind: 'pdf', name: 'RFP.pdf' }, itt)).toBe('reads 33 of 45 pages');
    const sheets: TenderSection[] = [
      { doc: 2, title: 'Instructions', from: 1, to: 1, skip: true },
      { doc: 2, title: 'Functional', from: 2, to: 12 },
      { doc: 2, title: 'Non-functional', from: 13, to: 15 },
      { doc: 2, title: 'Pricing', from: 16, to: 16, skip: true }
    ];
    /* part counts mean nothing to someone holding the workbook; sheets do */
    expect(readingSummary({ n: 2, pages: 16, kind: 'text', name: 'Matrix.xlsx' }, sheets)).toBe('reads 2 of 4 sheets');
    expect(readingSummary({ n: 2, pages: 16, kind: 'text', name: 'Matrix.xlsx' }, [])).toBe('reads 16 of 16 parts');
    expect(readingSummary({ n: 3, pages: 0, kind: 'pdf', name: 'Scan.pdf' }, [])).toBe('reads all of it');
  });

  it('lists the sections left out, and their pages in words', () => {
    const docs = [doc(1, { name: 'RFP.pdf' }), doc(2, { name: 'Annex.docx', kind: 'text' }), doc(3, { name: 'Matrix.xlsx', kind: 'text' })];
    expect(skippedSections({ outline: itt }).map(({ index }) => index)).toEqual([0, 1, 3, 5, 7, 8]);
    expect(sectionPages({ doc: 1, from: 5, to: 9 }, docs)).toBe('pp. 5 to 9');
    expect(sectionPages({ doc: 1, from: 1, to: 1 }, docs)).toBe('p. 1');
    expect(sectionPages({ doc: 2, from: 1, to: 2 }, docs)).toBe('parts 1 to 2');
    expect(sectionPages({ doc: 2, from: 4, to: 4 }, docs)).toBe('part 4');
    /* a person thinks of a spreadsheet in sheets; part numbers exist only in the converted text */
    expect(sectionPages({ doc: 3, from: 1, to: 1 }, docs)).toBe('sheet');
  });

  it('cuts a range that was too much for one call in half, until a single page is left', () => {
    const range: TenderRange = { key: '1:21-40', doc: 1, from: 21, to: 40, status: 'failed' };
    expect(splitRange(range)?.map((half) => half.key)).toEqual(['1:21-30', '1:31-40']);
    expect(splitRange({ ...range, from: 7, to: 7 })).toBeNull();
  });

  it('peels pages off a document of unknown length instead of giving up on it', () => {
    /* refusing to split left the whole document stuck, with an error that blamed a single page */
    const whole: TenderRange = { key: '1:1-end', doc: 1, from: 1, to: 0, status: 'running' };
    const [first, rest] = splitRange(whole) ?? [];
    expect(first).toEqual({ key: '1:1-20', doc: 1, from: 1, to: 20, status: 'pending' });
    expect(rest).toEqual({ key: '1:21-end', doc: 1, from: 21, to: 0, status: 'pending' });
    expect(splitRange(rest!)?.map((part) => part.key)).toEqual(['1:21-40', '1:41-end']);
  });

  const now = 1_000_000_000;
  const me = 'tab-me';
  const range = (key: string, over: Partial<TenderRange> = {}): TenderRange => ({ key, doc: 1, from: 1, to: 2, status: 'pending', ...over });

  it('starts only pending ranges, keeping the number in flight under the limit', () => {
    const ranges = [range('a'), range('b', { status: 'done' }), range('c'), range('d')];
    expect(rangesToRun(ranges, new Set(), 2, now, me)).toEqual(['a', 'c']);
    expect(rangesToRun(ranges, new Set(['a']), 2, now, me)).toEqual(['c']);
    expect(rangesToRun(ranges, new Set(['a', 'c']), 2, now, me)).toEqual([]);
  });

  it('leaves a range another tab has claimed alone, and counts it against the limit', () => {
    /* two tabs on one tender would otherwise read, and pay for, every range twice */
    const ranges = [range('a', { status: 'running', startedAt: now - 10_000, by: 'tab-other' }), range('b'), range('c')];
    expect(rangesToRun(ranges, new Set(), 2, now, me)).toEqual(['b']);
  });

  it('starts a range this tab claimed but has not started, as a Retry or a split leaves it', () => {
    /* found driving two tabs: a retried range went back to pending first, both tabs saw it
       unclaimed, and both read it; claiming in the same step leaves it to the tab that asked */
    const ranges = [range('a', { status: 'running', startedAt: now, by: me })];
    expect(rangesToRun(ranges, new Set(), 3, now, me)).toEqual(['a']);
    expect(rangesToRun(ranges, new Set(), 3, now, 'tab-other')).toEqual([]);
    /* and once it is in flight here, it is not started again */
    expect(rangesToRun(ranges, new Set(['a']), 3, now, me)).toEqual([]);
  });

  it('takes over a claim that went stale, because the tab that made it went away', () => {
    const ranges = [range('a', { status: 'running', startedAt: now - STALE_CLAIM_MS - 1, by: 'tab-gone' }), range('b', { status: 'running', by: 'tab-gone' })];
    /* a claim with no time on it is as good as stale: nobody can say when it was made */
    expect(rangesToRun(ranges, new Set(), 3, now, me)).toEqual(['a', 'b']);
  });

  it('says when the next claim held elsewhere goes stale, so a waiting tab knows when to look again', () => {
    const ranges = [
      range('a', { status: 'running', startedAt: now - 1000, by: 'tab-other' }),
      range('b', { status: 'running', startedAt: now - 5000, by: 'tab-other' }),
      range('c', { status: 'running', startedAt: now - 9000, by: me })
    ];
    expect(nextStaleAt(ranges, now, me)).toBe(now - 5000 + STALE_CLAIM_MS);
    expect(nextStaleAt([range('c')], now, me)).toBeNull();
  });

  it('names a range the way a person reads it', () => {
    const docs = [doc(1, { name: 'RFP.pdf' }), doc(2, { name: 'Annex.docx', kind: 'text' })];
    expect(rangeLabel({ doc: 1, from: 1, to: 20 }, docs)).toBe('RFP.pdf, pages 1 to 20');
    expect(rangeLabel({ doc: 2, from: 4, to: 4 }, docs)).toBe('Annex.docx, part 4');
    expect(rangeLabel({ doc: 1, from: 1, to: 0 }, docs)).toBe('RFP.pdf, whole document');
    expect(rangeLabel({ doc: 1, from: 21, to: 0 }, docs)).toBe('RFP.pdf, pages 21 to the end');
  });
});

/* ---------------------------------------------------------------- matching */

describe('reading catalog matches', () => {
  const bundles = new Set(['B13', 'B04']);

  it('keeps a match to real catalog solutions', () => {
    const matches = readMatches({ matches: [{ id: 'R-01', kind: 'catalog', solutionIds: ['SSO-1'], confidence: 'high', reason: 'Covered', area: 'B13' }] }, ['R-01'], catalogIds, bundles);
    expect(matches['R-01']).toMatchObject({ kind: 'catalog', solutionIds: ['SSO-1'], approved: false, area: '' });
  });

  it('drops catalog ids the model invented, and sends a match left with none to the desk', () => {
    /* an invented id would add a line nobody can price; custom puts it in front of an estimator */
    const matches = readMatches(
      { matches: [{ id: 'R-01', kind: 'catalog', solutionIds: ['SSO-99'], confidence: 'high', reason: 'Covered by SSO-99' }, { id: 'R-02', kind: 'partial', solutionIds: ['SSO-1', 'MADE-UP'], remainder: 'SCIM' }] },
      ['R-01', 'R-02'],
      catalogIds,
      bundles
    );
    expect(matches['R-01']?.kind).toBe('custom');
    expect(matches['R-01']?.confidence).toBe('low');
    expect(matches['R-01']?.solutionIds).toEqual([]);
    expect(matches['R-01']?.reason).toContain('do not exist');
    expect(matches['R-02']?.solutionIds).toEqual(['SSO-1']);
    expect(matches['R-02']?.remainder).toBe('SCIM');
  });

  it('ignores requirements it was not asked about, and answers each one once', () => {
    const matches = readMatches({ matches: [{ id: 'R-09', kind: 'custom' }, { id: 'R-01', kind: 'custom' }, { id: 'R-01', kind: 'catalog', solutionIds: ['SSO-1'] }] }, ['R-01'], catalogIds, bundles);
    expect(Object.keys(matches)).toEqual(['R-01']);
    expect(matches['R-01']?.kind).toBe('custom');
  });

  it('keeps a desk area only when it is a real bundle, and clears solutions from custom work', () => {
    const matches = readMatches(
      { matches: [{ id: 'R-01', kind: 'custom', solutionIds: ['SSO-1'], area: 'B04', integrations: 'Proctorio' }, { id: 'R-02', kind: 'custom', area: 'B99' }, { id: 'R-03', kind: 'strange' }] },
      ['R-01', 'R-02', 'R-03'],
      catalogIds,
      bundles
    );
    expect(matches['R-01']).toMatchObject({ solutionIds: [], area: 'B04', integrations: 'Proctorio' });
    expect(matches['R-02']?.area).toBe('');
    expect(matches['R-03']?.kind).toBe('custom');
  });

  it('sends only approved, in-scope requirements with no match yet', () => {
    const subject = tender({
      reqs: [req('R-01'), req('R-02', { status: 'proposed' }), req('R-03', { match: match() }), req('R-04', { outOfScope: true }), req('R-05', { status: 'removed' })]
    });
    expect(needsMatching(subject).map((one) => one.id)).toEqual(['R-01']);
  });

  it('settles out-of-scope requirements without asking the AI', () => {
    const subject = tender({ reqs: [req('R-01', { outOfScope: true }), req('R-02', { outOfScope: true, match: match() }), req('R-03', { outOfScope: true, status: 'proposed' })] });
    const settled = outOfScopeMatches(subject);
    expect(Object.keys(settled)).toEqual(['R-01']);
    expect(settled['R-01']).toMatchObject({ kind: 'out', approved: false });
  });

  it('batches requirements so no single call outlives the function', () => {
    expect(matchBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(matchBatches([], 40)).toEqual([]);
  });

  it('describes the catalog to the model once per solution, and without hours', () => {
    const lines = catalogLines(catalog);
    expect(lines.map((line) => line.id)).toEqual(['SSO-1', 'SSO-2', 'AS-1']);
    expect(lines[0]).toEqual({ id: 'SSO-1', bundle: 'B13', bundleName: 'Identity & SSO', name: 'Azure AD sign-on', category: 'Identity', status: 'Production', desc: 'Azure AD sign-on, described' });
    expect(Object.keys(lines[0] ?? {})).not.toContain('first');
  });

  it('describes every platform, using a loaded sheet over the shipped one', () => {
    const digest = platformDigest(PRACTICES, { moodle: catalog });
    expect(digest.length).toBe(PRACTICES.reduce((total, practice) => total + practice.platforms.length, 0));
    expect(digest.find((one) => one.id === 'moodle')?.bundles).toEqual(['Identity & SSO (SSO)', 'Assessment']);
    expect(digest.find((one) => one.id === 'openedx')?.bundles).toEqual([]);
    expect(digest.find((one) => one.id === 'totara')?.practice).toBe('EdTech / LMS');
  });
});

/* ----------------------------------------------------------------- counts */

describe('counting a tender', () => {
  const subject = tender({
    ranges: [
      { key: 'a', doc: 1, from: 1, to: 20, status: 'done' },
      { key: 'b', doc: 1, from: 21, to: 40, status: 'pending' },
      { key: 'b2', doc: 1, from: 41, to: 45, status: 'running', startedAt: 1 },
      { key: 'c', doc: 1, from: 41, to: 50, status: 'failed' }
    ],
    reqs: [
      req('R-01', { match: match() }),
      req('R-02', { match: match({ kind: 'custom', solutionIds: [], approved: false }) }),
      req('R-03', { match: match({ kind: 'partial' }) }),
      req('R-04'),
      req('R-05', { status: 'proposed' }),
      req('R-06', { status: 'removed', match: match() })
    ]
  });

  it('counts requirements by status and matches by kind, for approved requirements only', () => {
    expect(tenderCounts(subject)).toEqual({
      total: 6,
      proposed: 1,
      approved: 4,
      removed: 1,
      matched: 3,
      reviewed: 2,
      /* R-03 is partial but has no remainder, so nothing is left for the desk */
      toDesk: 0,
      catalog: 1,
      partial: 1,
      custom: 1,
      out: 0,
      /* a range being read counts as not read yet */
      pendingRanges: 2,
      failedRanges: 1
    });
  });

  it('opens matching once something is approved, and applying once a match is accepted', () => {
    expect(stageOpen(tender(), 'requirements')).toBe(true);
    expect(stageOpen(tender(), 'match')).toBe(false);
    expect(stageOpen(tender({ reqs: [req('R-01')] }), 'match')).toBe(true);
    expect(stageOpen(tender({ reqs: [req('R-01')] }), 'apply')).toBe(false);
    expect(stageOpen(subject, 'apply')).toBe(true);
  });

  it('counts an accepted custom match, and a partial one with a remainder, as work for the desk', () => {
    const counted = tenderCounts(
      tender({
        reqs: [
          req('R-01', { match: match({ kind: 'custom', solutionIds: [] }) }),
          req('R-02', { match: match({ kind: 'partial', remainder: 'SCIM' }) }),
          req('R-03', { match: match({ kind: 'custom', approved: false }) })
        ]
      })
    );
    expect(counted.toDesk).toBe(2);
  });

  it('says how long a document is in its own unit, and when nobody has counted', () => {
    expect(documentLength({ kind: 'pdf', pages: 45 })).toBe('45 pages');
    expect(documentLength({ kind: 'text', pages: 1 })).toBe('1 part');
    expect(documentLength({ kind: 'pdf', pages: 0 })).toBe('pages not counted');
    expect(documentLength({ kind: 'text', pages: 0 })).toBe('parts not counted');
  });

  it('adds up tokens, and says so in words', () => {
    expect(tokenSummary(NO_TOKENS)).toBe('No AI calls yet');
    const total = addTokens(addTokens(NO_TOKENS, { input: 1000, cacheWrite: 90_000, output: 400 }), { cacheRead: 90_000, output: 600 });
    expect(total).toEqual({ input: 1000, output: 1000, cacheRead: 90_000, cacheWrite: 90_000 });
    expect(tokenSummary(total)).toBe('AI read 181,000 tokens (90,000 from cache) and wrote 1,000');
    expect(addTokens(total, null)).toEqual(total);
  });
});

/* ------------------------------------------------------------------ apply */

describe('turning approved matches into an estimation', () => {
  const subject = tender({
    reqs: [
      req('R-01', { match: match({ solutionIds: ['SSO-1', 'SSO-2'] }) }),
      req('R-02', { match: match({ kind: 'partial', solutionIds: ['SSO-1', 'AS-1'], remainder: 'SCIM for contractors' }) }),
      req('R-03', { match: match({ approved: false, solutionIds: ['AS-1'] }) }),
      req('R-04', { status: 'removed', match: match({ solutionIds: ['AS-1'] }) }),
      req('R-05', { match: match({ kind: 'custom', solutionIds: ['AS-1'] }) }),
      req('R-06', { match: match({ solutionIds: ['GONE-1'] }) })
    ]
  });

  it('picks each solution once, from accepted catalog and partial matches only', () => {
    /* not R-03 (not accepted), not R-04 (removed), not R-05 (custom), not GONE-1 (left the catalog) */
    expect(tenderSelection(subject, catalogIds)).toEqual(['SSO-1', 'SSO-2', 'AS-1']);
  });

  it('reads the hours from the catalog and counts what has none yet', () => {
    expect(catalogHours(['SSO-1', 'SSO-2', 'AS-1', 'SSO-1', 'GONE-1'], catalog)).toEqual({ first: 40, unpriced: 1 });
  });
});

describe('drafting desk requests', () => {
  const subject = tender({
    docs: [doc(1, { name: 'RFP.pdf' })],
    reqs: [
      req('R-01', { text: 'Proctored final exams for every accredited course. Recordings kept for a year.', quote: 'Exams shall be proctored', page: 12, match: match({ kind: 'custom', solutionIds: [], area: 'B04', integrations: 'Proctorio' }) }),
      req('R-02', { text: 'Single sign-on with provisioning', priority: 'should', match: match({ kind: 'partial', solutionIds: ['SSO-1'], remainder: 'SCIM provisioning for contractors' }) }),
      req('R-03', { match: match({ kind: 'partial', remainder: '' }) }),
      req('R-04', { match: match({ kind: 'custom', approved: false }) }),
      req('R-05', { match: match() }),
      req('R-06', { match: match({ kind: 'custom', skip: true, draft: { title: 'Reworded by sales', area: 'Assessment' } }) })
    ]
  });

  it('drafts accepted custom work and the remainder of accepted partial matches, nothing else', () => {
    expect(deskDrafts(subject, catalog).map((draft) => draft.reqId)).toEqual(['R-01', 'R-02', 'R-06']);
  });

  it('carries the tender wording and where it came from, for the estimator', () => {
    const [custom, partial] = deskDrafts(subject, catalog);
    expect(custom?.title).toBe('Proctored final exams for every accredited course');
    expect(custom?.area).toBe('Assessment');
    expect(custom?.integrations).toBe('Proctorio');
    expect(custom?.details).toContain('From the tender (RFP.pdf, p. 12): "Exams shall be proctored"');
    expect(custom?.details).toContain('Tender priority: must have.');

    expect(partial?.title).toBe('SCIM provisioning for contractors');
    expect(partial?.details).toContain('The catalog covers the rest: Azure AD sign-on.');
    expect(partial?.details).toContain('Full requirement: Single sign-on with provisioning');
    expect(partial?.details).toContain('nice to have');
    /* no bundle was named, so the area says so rather than guessing one */
    expect(partial?.area).toBe(SOMETHING_NEW);
  });

  it('uses what a person reworded, and remembers what they left out or already sent', () => {
    const drafts = deskDrafts(subject, catalog, new Set(['R-01']));
    const edited = drafts.find((draft) => draft.reqId === 'R-06');
    expect(edited).toMatchObject({ title: 'Reworded by sales', area: 'Assessment', skip: true, sent: false });
    expect(drafts.find((draft) => draft.reqId === 'R-01')?.sent).toBe(true);
  });

  it('shortens a long requirement into a title at a word boundary', () => {
    expect(shortTitle('Short one.')).toBe('Short one');
    const long = shortTitle('An integration with the national student records system that keeps enrolments, grades and attendance in step every night without manual work', 60);
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long).not.toMatch(/\s…$/);
  });

  it('numbers new requests after the existing ones, and leaves out skipped and sent drafts', () => {
    const existing = [{ id: 'RQ-07' } as EstimateRequest];
    const drafts: DeskDraft[] = [
      { reqId: 'R-01', kind: 'custom', title: ' Proctoring ', details: 'Exams', area: 'Assessment', integrations: 'Proctorio', source: '', skip: false, sent: false },
      { reqId: 'R-02', kind: 'custom', title: 'Skipped', details: '', area: '', integrations: '', source: '', skip: true, sent: false },
      { reqId: 'R-03', kind: 'custom', title: 'Already sent', details: '', area: '', integrations: '', source: '', skip: false, sent: true },
      { reqId: 'R-04', kind: 'partial', title: 'SCIM', details: 'Contractors', area: SOMETHING_NEW, integrations: '', source: '', skip: false, sent: false }
    ];
    const made = tenderRequests(existing, subject, drafts, { name: ' Sara ', email: 'sara@edly.io', org: 'Edly' }, { id: 'EST-9', name: 'Acme deal', client: 'Acme Academy' }, '2026-09-26');
    expect(made.map((one) => one.id)).toEqual(['RQ-08', 'RQ-09']);
    expect(made[0]).toMatchObject({
      plat: 'openedx',
      estId: 'EST-9',
      estName: 'Acme deal',
      client: 'Acme Academy',
      title: 'Proctoring',
      name: 'Sara',
      urgency: 'Tender due 2026-11-30',
      tender: 'TND-1',
      tenderReq: 'R-01',
      at: '2026-09-26'
    });
    /* never estimated, so no hours at all: zero would join the totals */
    expect(made[0]?.est).toBeUndefined();
  });
});

describe('a new tender', () => {
  it('starts at the requirements step with its ranges planned and a slug unique on its platform', () => {
    const made = newTender(
      { plat: 'openedx', name: 'Acme Academy tender', client: 'Acme', due: '', summary: '', docs: [doc(1, { pages: 30 })], fit: null, outline: [], tokens: NO_TOKENS },
      'TND-2',
      [{ plat: 'openedx', slug: 'acme-academy-tender' }, { plat: 'moodle', slug: 'acme-academy-tender-2' }],
      '2026-09-26'
    );
    expect(made.stage).toBe('requirements');
    expect(made.slug).toBe('acme-academy-tender-2');
    expect(made.ranges.map((range) => range.key)).toEqual(['1:1-20', '1:21-30']);
    expect(made.reqs).toEqual([]);
  });

  it('names an untitled tender rather than leaving it blank', () => {
    const made = newTender({ plat: 'openedx', name: '', client: '', due: '', summary: '', docs: [], fit: null, outline: [], tokens: NO_TOKENS }, 'TND-3', [], '2026-09-26');
    expect(made.name).toBe('Untitled tender');
    expect(made.slug).toBe('tnd-3');
  });
});

describe('ids and held files', () => {
  it('continues a series from its highest number in one pass, never from the count', () => {
    /* R-02 was deleted: counting would hand out R-03 twice */
    expect(highestId('R', ['R-01', 'R-03', 'RQ-09', 'R-x', 'nonsense'])).toBe(3);
    expect(highestId('RQ', [])).toBe(0);
    expect(serialId('R', 4)).toBe('R-04');
    expect(serialId('R', 120)).toBe('R-120');
  });

  it('numbers a large tender in document order without rescanning it per requirement', () => {
    const incoming: ExtractedRequirement[] = Array.from({ length: 500 }, (_, i) => ({ doc: 1, page: i + 1, section: '', text: `Requirement ${i}`, quote: '', priority: 'must', outOfScope: false }));
    const { reqs, added } = addExtracted([req('R-07')], incoming);
    expect(added).toBe(500);
    expect(reqs.find((one) => one.text === 'Requirement 0')?.id).toBe('R-08');
    expect(reqs.find((one) => one.text === 'Requirement 499')?.id).toBe('R-507');
  });

  it('treats a file past its expiry as gone, like one that was deleted', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    const docs = [
      doc(1, { expiresAt: '2026-09-28T00:00:00Z' }),
      doc(2, { expiresAt: '2026-09-27T11:00:00Z' }),
      doc(3, { fileId: '' }),
      doc(4, { expiresAt: '' })
    ];
    expect(heldDocs(docs, now).map((one) => one.n)).toEqual([1, 4]);
  });
});
