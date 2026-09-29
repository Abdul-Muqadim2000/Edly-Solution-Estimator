import { describe, expect, it } from 'vitest';
import {
  addTerms,
  byCategory,
  categoryLabel,
  copiedItems,
  deletable,
  goesWithEstimation,
  handItem,
  needsSorting,
  NOTE_MAX,
  openByEstimation,
  patchItem,
  readCategories,
  readCategory,
  readDay,
  readStatus,
  readTerms,
  readTopic,
  SALES_LEGAL_CATEGORIES,
  salesLegalCounts,
  salesLegalDrafts,
  salesLegalItems,
  statusLabel,
  topicLabel,
  type ExtractedTerm
} from '../src/domain/salesLegal';
import { NO_TOKENS } from '../src/domain/tender';
import type { RequirementMatch, SalesLegalItem, Tender, TenderRequirement, TenderTerm } from '../src/types';

/**
 * What a deal commits Edly to that is not software: the out-of-scope requirements and key terms a
 * tender holds, and the list each estimation keeps of them for the sales, account and legal teams.
 *
 * Most of what is asserted is what must not happen: an item copied twice, a left-out item copied
 * anyway, a category the AI invented taken as real, a date a person typed read as another day.
 */

const outMatch = (over: Partial<RequirementMatch> = {}): RequirementMatch => ({
  kind: 'out',
  solutionIds: [],
  confidence: 'high',
  reason: 'A certification the supplier holds, not software.',
  remainder: '',
  area: '',
  integrations: '',
  approved: true,
  ...over
});

const req = (id: string, over: Partial<TenderRequirement> = {}): TenderRequirement => ({
  id,
  doc: 1,
  page: 12,
  section: 'Security',
  text: `Obligation ${id}`,
  quote: `The Contractor shall meet obligation ${id}.`,
  priority: 'must',
  outOfScope: true,
  status: 'approved',
  match: outMatch(),
  ...over
});

const term = (id: string, over: Partial<TenderTerm> = {}): TenderTerm => ({
  id,
  doc: 1,
  page: 40,
  ref: '12.3',
  topic: 'payment',
  text: `Term ${id}`,
  quote: `Payment clause ${id}.`,
  category: 'sales',
  ...over
});

const tender = (over: Partial<Tender> = {}): Tender => ({
  id: 'TND-1',
  plat: 'openedx',
  name: 'Nordic University LMS',
  slug: 'nordic-university-lms',
  client: 'Nordic University',
  due: '',
  summary: '',
  at: '2026-09-01',
  up: '2026-09-01',
  stage: 'apply',
  docs: [{ n: 1, name: 'Nordic RFP.pdf', kind: 'pdf', bytes: 1000, pages: 60, fileId: 'file_1', expiresAt: '2026-10-01T00:00:00Z' }],
  fit: null,
  outline: [],
  ranges: [],
  reqs: [],
  estId: '',
  sentAt: '',
  tokens: NO_TOKENS,
  aiLimit: 4,
  aiApproved: 0,
  ...over
});

const item = (id: string, over: Partial<SalesLegalItem> = {}): SalesLegalItem => ({
  id,
  plat: 'openedx',
  estId: 'EST-1',
  tender: 'TND-1',
  tenderItem: 'R-01',
  category: 'legal',
  kind: 'obligation',
  text: 'Notify the university of a breach within a day.',
  quote: '',
  source: 'Nordic RFP.pdf, p. 12',
  section: 'Security',
  reason: '',
  priority: 'must',
  owner: '',
  status: 'open',
  due: '',
  note: '',
  at: '2026-09-01',
  up: '2026-09-01',
  ...over
});

/* ------------------------------------------------------ reading the sheet */

describe('reading what a person typed into the sheet', () => {
  it('takes a category by its label, its id or the label’s first word, in any case', () => {
    expect(readCategory('Legal and compliance')).toBe('legal');
    expect(readCategory('legal & compliance')).toBe('legal');
    expect(readCategory('LEGAL')).toBe('legal');
    expect(readCategory('certification')).toBe('certification');
    expect(readCategory('People')).toBe('people');
    expect(readCategory('Account management')).toBe('account');
    /* something else entirely is listed as not sorted, never guessed into a team */
    expect(readCategory('Finance')).toBe('');
    expect(readCategory('')).toBe('');
    expect(readCategory(undefined)).toBe('');
  });

  it('writes each category the way it reads back', () => {
    for (const one of SALES_LEGAL_CATEGORIES) expect(readCategory(categoryLabel(one.id))).toBe(one.id);
    expect(categoryLabel('')).toBe('Not sorted yet');
  });

  it('reads a status in the words people use, and anything else as still open', () => {
    expect(readStatus('Handled')).toBe('handled');
    expect(readStatus('done')).toBe('handled');
    expect(readStatus('Not for us')).toBe('not-ours');
    expect(readStatus('not-ours')).toBe('not-ours');
    expect(readStatus('N/A')).toBe('not-ours');
    /* an item nobody can place is one somebody still has to look at */
    expect(readStatus('waiting on finance')).toBe('open');
    expect(readStatus('')).toBe('open');
    for (const status of ['open', 'handled', 'not-ours'] as const) expect(readStatus(statusLabel(status))).toBe(status);
  });

  it('reads a due date however the sheet hands it back, and nothing that is not one', () => {
    expect(readDay('2026-10-20')).toBe('2026-10-20');
    /* Excel keeps a typed date as the days since 30 December 1899 */
    expect(readDay('46315')).toBe('2026-10-20');
    expect(readDay(46315)).toBe('2026-10-20');
    /* Google Sheets hands back what it displays, month first by default */
    expect(readDay('10/20/2026')).toBe('2026-10-20');
    expect(readDay('3/4/2026')).toBe('2026-03-04');
    /* unless the first number cannot be a month */
    expect(readDay('20/10/2026')).toBe('2026-10-20');
    expect(readDay('20 Oct 2026')).toBe('2026-10-20');
    expect(readDay('October 20, 2026')).toBe('2026-10-20');
    /* a date that does not exist is not rolled into the next month */
    expect(readDay('2026-02-31')).toBe('');
    expect(readDay('13/13/2026')).toBe('');
    expect(readDay('next week')).toBe('');
    expect(readDay('Q4')).toBe('');
    expect(readDay('')).toBe('');
    expect(readDay(null)).toBe('');
  });
});

/* ------------------------------------------------------- what a tender offers */

describe('what a tender has for the sales, account and legal teams', () => {
  const nordic = tender({
    reqs: [
      req('R-01', { match: outMatch({ category: 'certification' }) }),
      req('R-02', { match: outMatch({ approved: false }) }),
      req('R-03', { match: outMatch({ skip: true, category: 'people' }) }),
      /* not out of scope: the catalog or the desk has it */
      req('R-04', { outOfScope: false, match: outMatch({ kind: 'custom' }) }),
      /* out of scope, but a person removed the requirement */
      req('R-05', { status: 'removed' }),
      /* flagged at extraction and not matched yet: it joins once matching settles it */
      req('R-06', { match: undefined })
    ],
    terms: [term('T-01'), term('T-02', { topic: 'insurance', category: 'legal', skip: true, ref: undefined, page: 0 })]
  });

  it('lists every approved requirement matched as out of scope, then the key terms', () => {
    const drafts = salesLegalDrafts(nordic);
    expect(drafts.map((draft) => draft.key)).toEqual(['R-01', 'R-02', 'R-03', 'T-01', 'T-02']);
    expect(drafts[0]).toMatchObject({ kind: 'obligation', category: 'certification', accepted: true, skip: false, copied: false, reason: 'A certification the supplier holds, not software.', section: 'Security', confidence: 'high' });
    expect(drafts[0]?.source).toBe('Nordic RFP.pdf, p. 12');
    expect(drafts[1]).toMatchObject({ category: '', accepted: false });
    expect(drafts[2]).toMatchObject({ skip: true });
    /* a term needs no match to accept, and binds whoever signs it */
    expect(drafts[3]).toMatchObject({ kind: 'term', topic: 'payment', category: 'sales', accepted: true, priority: 'must', source: 'Nordic RFP.pdf, p. 40, 12.3' });
    expect(drafts[4]).toMatchObject({ skip: true, source: 'Nordic RFP.pdf' });
  });

  it('copies only what is accepted, kept in and not on the estimation already', () => {
    const drafts = salesLegalDrafts(nordic, new Set(['T-01']));
    expect(drafts.filter(goesWithEstimation).map((draft) => draft.key)).toEqual(['R-01']);
    /* R-02 waits for its match to be accepted, R-03 and T-02 were left out, T-01 is there already */
    expect(goesWithEstimation({ accepted: true, skip: false, copied: false })).toBe(true);
    expect(goesWithEstimation({ accepted: false, skip: false, copied: false })).toBe(false);
  });

  it('numbers the records after the ones that exist, and freezes where each came from', () => {
    const made = salesLegalItems([item('SL-01'), item('SL-07')], nordic, salesLegalDrafts(nordic), { id: 'EST-9' }, '2026-09-29');
    expect(made.map((one) => [one.id, one.tenderItem])).toEqual([
      ['SL-08', 'R-01'],
      ['SL-09', 'T-01']
    ]);
    expect(made[0]).toMatchObject({
      plat: 'openedx',
      estId: 'EST-9',
      tender: 'TND-1',
      category: 'certification',
      kind: 'obligation',
      source: 'Nordic RFP.pdf, p. 12',
      /* why it is there and where it sits travel with it: the estimation shows them without the tender */
      reason: 'A certification the supplier holds, not software.',
      section: 'Security',
      quote: 'The Contractor shall meet obligation R-01.',
      owner: '',
      status: 'open',
      due: '',
      at: '2026-09-29',
      up: '2026-09-29'
    });
    expect(made[1]).toMatchObject({ kind: 'term', category: 'sales', topic: 'payment', reason: '', section: '' });
    expect(made[0]).not.toHaveProperty('topic');
  });

  it('knows which of a tender’s items are on the list, by tender, so another tender’s R-01 is its own', () => {
    const items = [item('SL-01', { tenderItem: 'R-01' }), item('SL-02', { tender: 'TND-2', tenderItem: 'R-02' }), item('SL-03', { tender: '', tenderItem: '' })];
    expect(copiedItems(items, 'TND-1')).toEqual(new Set(['R-01']));
    expect(copiedItems(items, 'TND-2')).toEqual(new Set(['R-02']));
  });
});

/* --------------------------------------------------------- on the estimation */

describe('an item typed in by hand', () => {
  const input = { text: '  Quarterly business review with the provost  ', category: 'account' as const, owner: ' Sara ', due: '2026-12-01', note: ' Book it early ', priority: 'must' as const };

  it('joins the estimation open, trimmed, numbered after the highest', () => {
    const made = handItem([item('SL-04')], input, { id: 'EST-2', plat: 'moodle' }, '2026-09-29');
    expect(made).toMatchObject({
      id: 'SL-05',
      plat: 'moodle',
      estId: 'EST-2',
      tender: '',
      tenderItem: '',
      category: 'account',
      kind: 'obligation',
      text: 'Quarterly business review with the provost',
      owner: 'Sara',
      status: 'open',
      due: '2026-12-01',
      note: 'Book it early',
      at: '2026-09-29'
    });
  });

  it('is refused with nothing in it, and keeps no category or date it cannot read', () => {
    expect(handItem([], { ...input, text: '   ' }, { id: 'EST-1', plat: 'openedx' }, '2026-09-29')).toBeNull();
    const odd = handItem([], { ...input, category: 'finance' as never, due: 'soon' }, { id: 'EST-1', plat: 'openedx' }, '2026-09-29');
    expect(odd).toMatchObject({ category: '', due: '' });
  });
});

describe('changing an item', () => {
  it('hands back the same item when nothing changed, so leaving a field is not an edit', () => {
    const one = item('SL-01', { owner: 'Legal', note: 'Checked' });
    expect(patchItem(one, { owner: 'Legal ', note: 'Checked' }, '2026-09-29')).toBe(one);
    expect(patchItem(one, {}, '2026-09-29')).toBe(one);
  });

  it('records owner, status, due date and note, and when', () => {
    const next = patchItem(item('SL-01'), { owner: 'Account', status: 'handled', due: '10/20/2026', note: 'Sent the form' }, '2026-09-29');
    expect(next).toMatchObject({ owner: 'Account', status: 'handled', due: '2026-10-20', note: 'Sent the form', up: '2026-09-29' });
  });

  it('keeps the tender’s own words on an item from a tender, and lets a hand-typed one be reworded', () => {
    const fromTender = item('SL-01');
    expect(patchItem(fromTender, { text: 'Something else' }, '2026-09-29')).toBe(fromTender);
    const typed = item('SL-02', { tender: '', tenderItem: '' });
    expect(patchItem(typed, { text: 'Reworded' }, '2026-09-29').text).toBe('Reworded');
    /* blank text is not a rewording */
    expect(patchItem(typed, { text: '  ' }, '2026-09-29')).toBe(typed);
  });

  it('ignores a status or category that is not one, and caps a note', () => {
    const one = item('SL-01');
    expect(patchItem(one, { status: 'maybe' as never, category: 'finance' as never }, '2026-09-29')).toBe(one);
    expect(patchItem(one, { category: '' }, '2026-09-29').category).toBe('');
    expect(patchItem(one, { note: 'x'.repeat(NOTE_MAX + 50) }, '2026-09-29').note).toHaveLength(NOTE_MAX);
  });
});

describe('counting and grouping', () => {
  const items = [
    item('SL-01', { status: 'open', due: '2026-09-01' }),
    item('SL-02', { status: 'open', due: '2026-12-01', category: '' }),
    item('SL-03', { status: 'handled', due: '2026-09-01', category: 'sales' }),
    item('SL-04', { status: 'not-ours', category: 'certification' })
  ];

  it('counts what is open, closed, unsorted and overdue', () => {
    /* a handled item past its date is done, not late */
    expect(salesLegalCounts(items, '2026-09-29')).toEqual({ total: 4, open: 2, handled: 1, notOurs: 1, unsorted: 1, overdue: 1 });
  });

  it('counts each deal’s open items in one pass, for the hub', () => {
    const counts = openByEstimation([...items, item('SL-05', { estId: 'EST-2' }), item('SL-06', { estId: 'EST-2', status: 'handled' })]);
    expect(counts.get('EST-1')).toBe(2);
    expect(counts.get('EST-2')).toBe(1);
    expect(counts.get('EST-9')).toBeUndefined();
  });

  it('lets a person delete an item typed by hand, or one whose tender is gone, and no other', () => {
    const tenders = new Set(['TND-1']);
    expect(deletable(item('SL-01', { tender: '' }), tenders)).toBe(true);
    /* its tender would offer it again as new: it is marked Not for us instead */
    expect(deletable(item('SL-02', { tender: 'TND-1' }), tenders)).toBe(false);
    expect(deletable(item('SL-03', { tender: 'TND-7' }), tenders)).toBe(true);
  });

  it('groups by category in the listed order, with anything unsorted last and no empty groups', () => {
    const groups = byCategory(items);
    expect(groups.map((group) => [group.label, group.items.map((one) => one.id)])).toEqual([
      ['Sales and commercial', ['SL-03']],
      ['Legal and compliance', ['SL-01']],
      ['Certification', ['SL-04']],
      ['Not sorted yet', ['SL-02']]
    ]);
  });
});

/* ------------------------------------------------------------- the two AI calls */

describe('sorting out-of-scope items into teams', () => {
  it('asks only about approved out-of-scope items with no team, with the reason each is out of scope', () => {
    const asked = needsSorting(
      tender({
        reqs: [
          req('R-01'),
          req('R-02', { match: outMatch({ category: 'legal' }) }),
          req('R-03', { status: 'proposed' }),
          req('R-04', { match: outMatch({ kind: 'custom' }) }),
          /* flagged at extraction and not matched yet: matching settles it without the AI, so it is asked about */
          req('R-05', { match: undefined }),
          req('R-06', { match: undefined, outOfScope: false })
        ]
      })
    );
    expect(asked).toEqual([
      { id: 'R-01', text: 'Obligation R-01', section: 'Security', reason: 'A certification the supplier holds, not software.' },
      { id: 'R-05', text: 'Obligation R-05', section: 'Security', reason: 'Marked out of scope when the requirement was extracted.' }
    ]);
  });

  it('leaves the estimation’s copies alone when no one asked, and sorts the ones with no team when someone did', () => {
    /* R-03's tender match has a team, but its copy on the estimation has none: the copy is the record */
    const nordic = tender({ reqs: [req('R-01'), req('R-02'), req('R-03', { match: outMatch({ category: 'legal' }) }), req('R-04')] });
    const onEstimation = [
      item('SL-01', { tenderItem: 'R-01', category: 'people' }),
      item('SL-02', { tenderItem: 'R-02', category: '' }),
      item('SL-03', { tenderItem: 'R-03', category: '' }),
      /* another tender's R-04 is not this one's */
      item('SL-04', { tender: 'TND-9', tenderItem: 'R-04', category: 'legal' })
    ];
    /* the sort that follows matching runs with no click, so it touches nothing already copied */
    expect(needsSorting(nordic, onEstimation).map((one) => one.id)).toEqual(['R-04']);
    /* Sort them, pressed: copies with no team are sorted too, a team a person chose never is */
    expect(needsSorting(nordic, onEstimation, 'unsorted').map((one) => one.id)).toEqual(['R-02', 'R-03', 'R-04']);
  });

  it('takes a category only for an id it asked about, only from the five, and only once', () => {
    const answer = {
      items: [
        { id: 'R-01', category: 'certification' },
        { id: 'R-01', category: 'legal' },
        { id: 'R-02', category: 'finance' },
        { id: 'R-99', category: 'sales' },
        { id: 'R-03', category: 'people' },
        'nonsense'
      ]
    };
    expect(readCategories(answer, ['R-01', 'R-02', 'R-03'])).toEqual({ 'R-01': 'certification', 'R-03': 'people' });
    expect(readCategories(null, ['R-01'])).toEqual({});
  });
});

describe('reading the key terms', () => {
  it('sends payment and service credits to sales and the rest to legal, from what each term is about', () => {
    const found = readTerms(
      {
        terms: [
          { topic: 'payment', text: 'Invoices are paid within 45 days.', quote: 'within forty-five (45) days', page: 40, ref: '12.3' },
          { topic: 'service-credits', text: 'A 5% credit for each missed service level.', quote: '', page: 41, ref: '' },
          { topic: 'insurance', text: 'Cyber cover of $5 million.', quote: '', page: 99, ref: '' },
          { topic: 'astrology', text: 'Something the model made up a topic for.', quote: '', page: 2, ref: '' },
          { topic: 'law', text: '   ', quote: 'empty text is not a term' }
        ]
      },
      1,
      60
    );
    expect(found.map((one) => [one.topic, one.category])).toEqual([
      ['payment', 'sales'],
      ['service-credits', 'sales'],
      ['insurance', 'legal'],
      ['other', 'legal']
    ]);
    expect(found[0]).toMatchObject({ doc: 1, page: 40, ref: '12.3' });
    /* a page outside the document is a misreading, not a location */
    expect(found[2]?.page).toBe(0);
    expect(found[1]).not.toHaveProperty('ref');
    expect(topicLabel('service-credits')).toBe('Service credits');
    /* read back from the sheet by its words, or its id */
    expect(readTopic('Service credits')).toBe('service-credits');
    expect(readTopic('payment')).toBe('payment');
    expect(readTopic('weather')).toBeUndefined();
    expect(readTopic('')).toBeUndefined();
  });

  it('adds a document’s terms once, numbered after the highest, whatever order documents finish in', () => {
    const one = (text: string): ExtractedTerm => ({ doc: 2, page: 1, topic: 'liability', text, quote: '', category: 'legal' });
    const { terms, added } = addTerms([term('T-03')], [one('Liability is capped at the contract value.'), one('liability is capped at the contract value'), one('No cap on data breaches.')]);
    expect(added).toBe(2);
    expect(terms.map((t) => t.id)).toEqual(['T-03', 'T-04', 'T-05']);
    expect(addTerms(terms, [one('No cap on data breaches.')]).added).toBe(0);
  });
});
