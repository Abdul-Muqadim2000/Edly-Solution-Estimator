import { describe, expect, it } from 'vitest';
import {
  awaitingLabel,
  boardColumns,
  deskCounts,
  hubOrder,
  dealOrder,
  defaultStage,
  ESTIMATION_STAGES,
  isAwaiting,
  neighbourColumn,
  pricedTally,
  readBoardView,
  readRequestStage,
  readStage,
  showsRoleGap,
  stageLabel,
  stageOf,
  stageOnFiling,
  stageOnSettled,
  stageStep,
  stageTally,
  TICKET_STAGES,
  ticketLabel,
  ticketOrder,
  ticketStage
} from '../src/domain/stages';
import { EMPTY_SNAPSHOT } from '../src/state/reducer';
import { DEMO_ID } from '../src/domain/demo';
import type { EstimateRequest, Estimation, EstimationStage } from '../src/types';

/**
 * Where a deal and a desk request stand. The board is laid out from these, the builder's track
 * counts along them, and the spreadsheet writes their words, so a wrong answer here puts a deal
 * in the wrong column for everyone who opens the hub.
 */

const deal = (id: string, over: Partial<Estimation> = {}): Estimation => ({
  id,
  plat: 'openedx',
  name: `Deal ${id}`,
  slug: id.toLowerCase(),
  client: 'Acme Academy',
  tag: 'Active',
  due: '',
  at: '2026-09-01',
  up: '2026-09-01',
  total: 0,
  cost: 0,
  items: 0,
  snap: { ...EMPTY_SNAPSHOT },
  ...over
});

const ask = (id: string, over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id,
  plat: 'openedx',
  estId: 'EST-1',
  estName: '',
  client: '',
  title: `Request ${id}`,
  details: '',
  area: '',
  urgency: '',
  integrations: '',
  name: '',
  email: '',
  org: '',
  at: '2026-09-01',
  ...over
});

describe('the stages a deal moves through', () => {
  it('runs from Backlog to Completed in the order the board lays them out', () => {
    expect(ESTIMATION_STAGES.map((one) => one.label)).toEqual(['Backlog', 'In progress', 'Pending custom estimates', 'Pending rates', 'In review', 'Completed']);
    expect(ESTIMATION_STAGES.map((one) => stageStep(one.id))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gives every stage a hint, since the column header and the menu both show one', () => {
    expect(ESTIMATION_STAGES.every((one) => one.hint.length > 0)).toBe(true);
    expect(TICKET_STAGES.every((one) => one.hint.length > 0)).toBe(true);
  });

  it('keeps On hold as a tag, not a stage: the user chose to keep both, and it would sit in two places', () => {
    expect(ESTIMATION_STAGES.map((one) => one.label)).not.toContain('On hold');
  });

  it('reads a deal saved before stages existed as Completed when it was Closed, and In progress otherwise', () => {
    expect(stageOf(deal('EST-1', { tag: 'Closed' }))).toBe('done');
    expect(stageOf(deal('EST-1', { tag: 'Active' }))).toBe('progress');
    expect(stageOf(deal('EST-1', { tag: 'Urgent' }))).toBe('progress');
    expect(stageOf(deal('EST-1', { tag: 'On hold' }))).toBe('progress');
    /* the General estimation older builds seeded had no tag at all */
    expect(stageOf(deal('EST-1', { tag: '' }))).toBe('progress');
    expect(defaultStage('Closed')).toBe('done');
  });

  it('takes a stored stage over the tag, and ignores one it does not know', () => {
    expect(stageOf(deal('EST-1', { tag: 'Closed', stage: 'review' }))).toBe('review');
    /* a hand-edited browser store could hold anything */
    expect(stageOf(deal('EST-1', { stage: 'shipped' as EstimationStage }))).toBe('progress');
  });

  it('names each stage, and falls back to In progress for one it does not know', () => {
    expect(stageLabel('custom')).toBe('Pending custom estimates');
    expect(stageLabel('rates')).toBe('Pending rates');
    expect(stageLabel('nothing' as EstimationStage)).toBe('In progress');
  });
});

describe('reading a stage typed into the sheet', () => {
  it('reads every label and id back as written', () => {
    for (const stage of ESTIMATION_STAGES) {
      expect(readStage(stage.label)).toBe(stage.id);
      expect(readStage(stage.id)).toBe(stage.id);
    }
  });

  it('reads the words a person is likely to type, in any case and spacing', () => {
    expect(readStage('in-review')).toBe('review');
    expect(readStage('  IN REVIEW ')).toBe('review');
    expect(readStage('Done')).toBe('done');
    expect(readStage('closed')).toBe('done');
    expect(readStage('To do')).toBe('backlog');
    expect(readStage('WIP')).toBe('progress');
    expect(readStage('pending custom')).toBe('custom');
    expect(readStage('Awaiting estimates')).toBe('custom');
    expect(readStage('pricing')).toBe('rates');
  });

  it('reads nothing it cannot place, so the tag decides instead of a guess', () => {
    expect(readStage('')).toBeNull();
    expect(readStage(undefined)).toBeNull();
    expect(readStage('maybe next week')).toBeNull();
  });
});

describe('where a desk request stands', () => {
  it('is Backlog until someone at the desk picks it up', () => {
    expect(ticketStage(ask('RQ-01'))).toBe('backlog');
    expect(ticketStage(ask('RQ-01', { stage: 'info' }))).toBe('info');
  });

  it('is Estimated once its hours are back, whatever stage was stored', () => {
    expect(ticketStage(ask('RQ-01', { est: 16, stage: 'review' }))).toBe('estimated');
    /* zero hours is nobody having priced it, which is how the rest of the app reads it too */
    expect(ticketStage(ask('RQ-01', { est: 0, stage: 'progress' }))).toBe('progress');
  });

  it('counts as waiting on the desk only when filed for pricing and not priced', () => {
    expect(isAwaiting(ask('RQ-01'))).toBe(true);
    expect(isAwaiting(ask('RQ-01', { est: 8 }))).toBe(false);
    /* a placeholder sales typed hours into never went to the desk */
    expect(isAwaiting(ask('RQ-01', { manual: true }))).toBe(false);
  });

  it('runs Backlog, In progress, In review, Needs info, then Estimated', () => {
    expect(TICKET_STAGES.map((one) => one.label)).toEqual(['Backlog', 'In progress', 'In review', 'Needs info', 'Estimated']);
    expect(ticketLabel('info')).toBe('Needs info');
    expect(ticketLabel('nothing' as 'info')).toBe('Backlog');
  });

  it('reads a status typed into the sheet, but never reads Estimated from a word', () => {
    expect(readRequestStage('Needs info')).toBe('info');
    expect(readRequestStage('blocked')).toBe('info');
    expect(readRequestStage('in progress')).toBe('progress');
    expect(readRequestStage('Backlog')).toBe('backlog');
    /* the old queue's word for an unpriced request */
    expect(readRequestStage('Awaiting estimate')).toBe('backlog');
    /* hours say a request is estimated; a word typed over a request with none must not */
    expect(readRequestStage('Estimated')).toBeNull();
    expect(readRequestStage('')).toBeNull();
    expect(readRequestStage('who knows')).toBeNull();
  });
});

describe('what sales sees of the desk', () => {
  it('names where the desk is with a request, and says so plainly when sales has to answer', () => {
    expect(awaitingLabel('backlog')).toBe('Awaiting hours');
    expect(awaitingLabel('progress')).toBe('Desk is pricing');
    expect(awaitingLabel('review')).toBe('Desk is checking');
    expect(awaitingLabel('info')).toBe('Desk needs info');
  });

  it('shows the client only that hours are coming, whatever the desk is doing', () => {
    for (const stage of ['backlog', 'progress', 'review', 'info'] as const) expect(awaitingLabel(stage, true)).toBe('Awaiting hours');
  });

  it('counts what is waiting on the desk and what the desk is waiting on sales for', () => {
    const counts = deskCounts([
      ask('RQ-01'),
      ask('RQ-02', { stage: 'info' }),
      /* priced with a stage a tab left on it: it is not waiting on anyone */
      ask('RQ-03', { stage: 'info', est: 8 }),
      ask('RQ-04', { manual: true, est: 4 })
    ]);
    expect(counts).toEqual({ waiting: 2, needsInfo: 1 });
    expect(deskCounts([])).toEqual({ waiting: 0, needsInfo: 0 });
  });
});

describe('moving a deal by itself', () => {
  it('sends a deal still being built to Pending custom estimates when a request is filed', () => {
    expect(stageOnFiling('backlog')).toBe('custom');
    expect(stageOnFiling('progress')).toBe('custom');
    expect(stageOnFiling('custom')).toBe('custom');
  });

  it('leaves a deal someone has moved past building where they put it', () => {
    expect(stageOnFiling('rates')).toBe('rates');
    expect(stageOnFiling('review')).toBe('review');
    expect(stageOnFiling('done')).toBe('done');
  });

  it('hands a deal back to sales once nothing is left waiting, and only from Pending custom estimates', () => {
    expect(stageOnSettled('custom', 0)).toBe('progress');
    expect(stageOnSettled('custom', 1)).toBe('custom');
    expect(stageOnSettled('rates', 0)).toBe('rates');
    expect(stageOnSettled('review', 0)).toBe('review');
    expect(stageOnSettled('backlog', 0)).toBe('backlog');
  });
});

describe('the board', () => {
  it('remembers the board only when board was stored, whatever else storage hands back', () => {
    expect(readBoardView('board')).toBe('board');
    expect(readBoardView('cards')).toBe('cards');
    expect(readBoardView(null)).toBe('cards');
    expect(readBoardView({ view: 'board' })).toBe('cards');
  });

  it('shares items into columns in the columns order, and leaves out one whose column it does not have', () => {
    const items = [
      { id: 'a', col: 'review' },
      { id: 'b', col: 'backlog' },
      { id: 'c', col: 'review' },
      { id: 'd', col: 'gone' }
    ];
    const columns = boardColumns(['backlog', 'progress', 'review'], items, (item) => item.col as 'backlog', (x, y) => y.id.localeCompare(x.id));
    expect(columns.map((column) => column.id)).toEqual(['backlog', 'progress', 'review']);
    expect(columns.map((column) => column.items.map((item) => item.id))).toEqual([['b'], [], ['c', 'a']]);
  });

  it('tells the order which column it is sorting, so a finished column can sort its own way', () => {
    const seen: string[] = [];
    boardColumns(['a', 'b'], [{ id: '1', col: 'a' }, { id: '2', col: 'a' }, { id: '3', col: 'b' }, { id: '4', col: 'b' }], (item) => item.col as 'a', (x, y, column) => {
      seen.push(column);
      return x.id.localeCompare(y.id);
    });
    expect([...new Set(seen)].sort()).toEqual(['a', 'b']);
  });

  it('puts the latest finished deal first in Completed, where a deadline no longer counts, and keeps the deal order elsewhere', () => {
    const early = deal('early-due', { due: '2026-10-01', up: '2026-09-02' });
    const recent = deal('recent', { due: '2026-12-01', up: '2026-09-29' });
    expect([early, recent].sort((a, b) => hubOrder(a, b, 'done')).map((one) => one.id)).toEqual(['recent', 'early-due']);
    expect([early, recent].sort((a, b) => hubOrder(a, b, 'review')).map((one) => one.id)).toEqual(['early-due', 'recent']);
  });

  it('keeps the order items arrived in when given no order', () => {
    const columns = boardColumns(['x'], [{ id: '2' }, { id: '1' }], () => 'x');
    expect(columns[0]?.items.map((item) => item.id)).toEqual(['2', '1']);
  });

  it('moves from the keyboard to the nearest column that will take the item, and nowhere past the ends', () => {
    const ids = ['backlog', 'progress', 'review', 'estimated'] as const;
    expect(neighbourColumn(ids, 'progress', 1)).toBe('review');
    expect(neighbourColumn(ids, 'progress', -1)).toBe('backlog');
    expect(neighbourColumn(ids, 'backlog', -1)).toBeNull();
    expect(neighbourColumn(ids, 'estimated', 1)).toBeNull();
    /* a column that refuses is stepped over, not landed on */
    expect(neighbourColumn(ids, 'backlog', 1, (id) => id !== 'progress')).toBe('review');
    expect(neighbourColumn(ids, 'review', 1, (id) => id !== 'estimated')).toBeNull();
  });

  it('puts Urgent deals first and Closed ones last, then the nearest deadline, then the latest change', () => {
    const deals = [
      deal('closed', { tag: 'Closed', due: '2026-10-01' }),
      deal('later', { due: '2026-12-01' }),
      deal('undated-new', { up: '2026-09-20' }),
      deal('urgent', { tag: 'Urgent', due: '2026-12-31' }),
      deal('sooner', { due: '2026-10-05' }),
      deal('undated-old', { up: '2026-09-02' }),
      deal('held', { tag: 'On hold', due: '2026-10-02' })
    ];
    expect(deals.slice().sort(dealOrder).map((one) => one.id)).toEqual(['urgent', 'sooner', 'later', 'undated-new', 'undated-old', 'held', 'closed']);
  });

  it('works the desk queue oldest first, and shows the latest priced first among the estimated', () => {
    const requests = [
      ask('RQ-03', { at: '2026-09-03' }),
      ask('RQ-01', { at: '2026-09-01' }),
      ask('RQ-04', { at: '2026-09-01', est: 8, estAt: '2026-09-10' }),
      ask('RQ-05', { at: '2026-09-02', est: 4, estAt: '2026-09-12' }),
      ask('RQ-02', { at: '2026-09-01' })
    ];
    expect(requests.slice().sort(ticketOrder).map((one) => one.id)).toEqual(['RQ-01', 'RQ-02', 'RQ-03', 'RQ-05', 'RQ-04']);
  });

  it('breaks a tie between two requests priced the same day by the newer id', () => {
    const requests = [ask('RQ-01', { est: 2, estAt: '2026-09-10' }), ask('RQ-02', { est: 2, estAt: '2026-09-10' })];
    expect(requests.slice().sort(ticketOrder).map((one) => one.id)).toEqual(['RQ-02', 'RQ-01']);
  });

  it('adds up a column from the totals each deal caches', () => {
    expect(stageTally([deal('a', { total: 120 }), deal('b', { total: 5.5 })])).toEqual({ count: 2, hours: 125.5, demo: false });
    expect(stageTally([])).toEqual({ count: 0, hours: 0, demo: false });
  });

  it('leaves the demo out of a column total, as out of every hub figure, and says it did', () => {
    /* counted, its 2,013 h beside a real deal's 80 made In review read as if it were real work */
    expect(stageTally([deal(DEMO_ID, { total: 2013 }), deal('real', { total: 80 })])).toEqual({ count: 2, hours: 80, demo: true });
  });

  it('copes with what an old or hand-edited store can hold: an unknown tag, a missing date, a total that is not a number', () => {
    /* an unknown tag sorts with Active rather than throwing the column into disorder */
    const odd = deal('odd', { tag: 'Paused' as Estimation['tag'], due: '2026-10-01' });
    expect([deal('closed', { tag: 'Closed' }), odd, deal('urgent', { tag: 'Urgent' })].sort(dealOrder).map((one) => one.id)).toEqual(['urgent', 'odd', 'closed']);
    expect([deal('later', { due: '2026-11-01' }), deal('sooner', { due: '2026-10-01' })].sort(dealOrder).map((one) => one.id)).toEqual(['sooner', 'later']);
    /* priced before the desk recorded when: after the dated ones */
    const undated = ask('RQ-01', { est: 4 });
    delete undated.estAt;
    expect([undated, ask('RQ-02', { est: 4, estAt: '2026-09-10' })].sort(ticketOrder).map((one) => one.id)).toEqual(['RQ-02', 'RQ-01']);
    expect(stageTally([deal('a', { total: Number.NaN }), deal('b', { total: 8 })]).hours).toBe(8);
  });

  it('adds up the hours the desk returned, counting nothing for a request still waiting', () => {
    expect(pricedTally([ask('RQ-01', { est: 24 }), ask('RQ-02'), ask('RQ-03', { est: 0 }), ask('RQ-04', { est: 6.5 })])).toEqual({ hours: 30.5, demo: false });
    expect(pricedTally([])).toEqual({ hours: 0, demo: false });
  });

  it('leaves the demo requests out of the Estimated total, as the desk figures do, and says it did', () => {
    const demo = ask('RQ-DEMO-01', { estId: DEMO_ID, est: 96 });
    expect(pricedTally([demo, ask('RQ-04', { est: 32 })])).toEqual({ hours: 32, demo: true });
  });

  it('names the hours without a role only once a deal waits on its rates or is being checked', () => {
    expect(ESTIMATION_STAGES.filter((one) => showsRoleGap(one.id)).map((one) => one.id)).toEqual(['rates', 'review']);
  });
});
