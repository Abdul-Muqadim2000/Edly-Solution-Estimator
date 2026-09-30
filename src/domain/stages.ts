import type { EstimateRequest, Estimation, EstimationStage, EstimationTag, RequestStage } from '@/types';
/* relative, not '@/': the server imports this module, and the function bundler does not read tsconfig paths */
import { isDemoEstimation, isDemoRequest } from './demo.js';

/**
 * Where a deal stands, and where a desk request stands.
 *
 * A deal's stage is a person's call, with one exception agreed on 2026-09-30: filing a desk request
 * moves a deal nobody has taken past building to Pending custom estimates, and pricing (or removing)
 * its last waiting request moves it back to In progress. Nothing here moves a deal out of Pending
 * rates, In review or Completed, and the tag (Active, Urgent, On hold, Closed) is never touched: the
 * user chose to keep both.
 *
 * A request's stage is the desk's own, until its hours go back. From then its hours place it, so a
 * priced request is Estimated whatever was stored.
 */

export interface StageInfo<K extends string> {
  id: K;
  label: string;
  /** One line for a column header or a menu, saying what being here means. */
  hint: string;
}

export const ESTIMATION_STAGES: readonly StageInfo<EstimationStage>[] = [
  { id: 'backlog', label: 'Backlog', hint: 'Logged, not started yet' },
  { id: 'progress', label: 'In progress', hint: 'Sales is building the scope' },
  { id: 'custom', label: 'Pending custom estimates', hint: 'Waiting on the desk to price custom work' },
  { id: 'rates', label: 'Pending rates', hint: 'Hours are in, waiting on the rate card' },
  { id: 'review', label: 'In review', hint: 'Being checked before it goes to the client' },
  { id: 'done', label: 'Completed', hint: 'Sent to the client' }
];

/** A request's place on the desk: its own stage while unpriced, Estimated once its hours are back. */
export type TicketStage = RequestStage | 'estimated';

export const TICKET_STAGES: readonly StageInfo<TicketStage>[] = [
  { id: 'backlog', label: 'Backlog', hint: 'Filed, nobody has picked it up' },
  { id: 'progress', label: 'In progress', hint: 'Someone at the desk is pricing it' },
  { id: 'review', label: 'In review', hint: 'Hours drafted, being checked before they go back' },
  { id: 'info', label: 'Needs info', hint: 'The desk has asked sales for more detail' },
  { id: 'estimated', label: 'Estimated', hint: 'Hours returned to sales' }
];

const STAGE_IDS: readonly EstimationStage[] = ESTIMATION_STAGES.map((one) => one.id);

export const stageLabel = (stage: EstimationStage): string => ESTIMATION_STAGES.find((one) => one.id === stage)?.label ?? 'In progress';
export const ticketLabel = (stage: TicketStage): string => TICKET_STAGES.find((one) => one.id === stage)?.label ?? 'Backlog';

/** Where a deal saved before stages existed stands: a Closed deal was finished, anything else was being worked on. */
export const defaultStage = (tag: EstimationTag | ''): EstimationStage => (tag === 'Closed' ? 'done' : 'progress');

/** A deal's stage, with the default for one saved before stages existed. */
export function stageOf(estimation: Pick<Estimation, 'stage' | 'tag'>): EstimationStage {
  return estimation.stage && STAGE_IDS.includes(estimation.stage) ? estimation.stage : defaultStage(estimation.tag);
}

/** 1 for Backlog through 6 for Completed: how far along the track a deal is. */
export const stageStep = (stage: EstimationStage): number => STAGE_IDS.indexOf(stage) + 1;

/* ------------------------------------------------ reading the sheet back */

/* letters only, lower case: "In review", "in-review" and "INREVIEW" all read the same */
const squash = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '');

/* the words a person is likely to type over a stage in the sheet, beside its label and id */
const STAGE_WORDS: Record<EstimationStage, readonly string[]> = {
  backlog: ['todo', 'new', 'notstarted'],
  progress: ['wip', 'working', 'started', 'active'],
  custom: ['pendingcustom', 'pendingcustomestimate', 'pendingestimates', 'awaitingestimates', 'awaitingdesk', 'withthedesk'],
  rates: ['pendingrate', 'pricing', 'awaitingrates'],
  review: ['review', 'reviewing', 'underreview'],
  done: ['complete', 'sent', 'finished', 'closed']
};

/**
 * A stage as the sheet hands it back: its label, its id, or a word a person may have typed there,
 * in any case. Null for anything else, which the reader replaces with the default for the tag.
 */
export function readStage(value: unknown): EstimationStage | null {
  const key = squash(value);
  if (!key) return null;
  const found = ESTIMATION_STAGES.find((one) => squash(one.label) === key || one.id === key || STAGE_WORDS[one.id].includes(key));
  return found?.id ?? null;
}

const REQUEST_WORDS: Record<RequestStage, readonly string[]> = {
  backlog: ['new', 'todo', 'open', 'awaiting', 'awaitingestimate'],
  progress: ['wip', 'working', 'started', 'pricing'],
  review: ['review', 'reviewing', 'underreview'],
  info: ['needsinfo', 'needinfo', 'moreinfo', 'blocked', 'waitingonsales', 'question']
};

/**
 * A request's stage as the sheet hands it back. Null for anything it cannot place, and for
 * "Estimated": hours say a request is estimated, never the word.
 */
export function readRequestStage(value: unknown): RequestStage | null {
  const key = squash(value);
  if (!key) return null;
  const found = TICKET_STAGES.find(
    (one) => one.id !== 'estimated' && (squash(one.label) === key || one.id === key || REQUEST_WORDS[one.id as RequestStage].includes(key))
  );
  return (found?.id as RequestStage | undefined) ?? null;
}

/* ------------------------------------------------------------ requests */

/** Still waiting on the desk: filed for pricing and not priced. A placeholder sales typed hours into is neither. */
export const isAwaiting = (request: Pick<EstimateRequest, 'manual' | 'est'>): boolean => !request.manual && !(Number(request.est) > 0);

/** Where a request stands on the desk. */
export function ticketStage(request: Pick<EstimateRequest, 'est' | 'stage'>): TicketStage {
  if (Number(request.est) > 0) return 'estimated';
  return request.stage ?? 'backlog';
}

/**
 * What sales sees on a request still with the desk. "Needs info" is the one they must act on, so it
 * says so; while presenting the client sees only that hours are coming.
 */
export function awaitingLabel(stage: TicketStage, presenting = false): string {
  if (presenting) return 'Awaiting hours';
  if (stage === 'progress') return 'Desk is pricing';
  if (stage === 'review') return 'Desk is checking';
  if (stage === 'info') return 'Desk needs info';
  return 'Awaiting hours';
}

export interface DeskCounts {
  /** Requests still waiting on the desk. */
  waiting: number;
  /** Of those, the ones the desk has asked sales about. */
  needsInfo: number;
}

/** What a deal's card says about its requests. */
export function deskCounts(requests: readonly EstimateRequest[]): DeskCounts {
  const waiting = requests.filter(isAwaiting);
  return { waiting: waiting.length, needsInfo: waiting.filter((request) => ticketStage(request) === 'info').length };
}

/* ------------------------------------------------------- automatic moves */

/** A deal a desk request was just filed for. Only a deal still being built starts waiting on the desk. */
export function stageOnFiling(stage: EstimationStage): EstimationStage {
  return stage === 'backlog' || stage === 'progress' ? 'custom' : stage;
}

/**
 * A deal one of whose waiting requests was just priced or taken out, with `stillWaiting` left. The
 * deal goes back to sales only from Pending custom estimates, and only once nothing is left waiting.
 */
export function stageOnSettled(stage: EstimationStage, stillWaiting: number): EstimationStage {
  return stage === 'custom' && stillWaiting === 0 ? 'progress' : stage;
}

/* ----------------------------------------------------------------- board */

export type BoardView = 'cards' | 'board';

/** A stored view choice, whatever browser storage handed back. Anything but "board" is the cards. */
export const readBoardView = (value: unknown): BoardView => (value === 'board' ? 'board' : 'cards');

export interface BoardColumn<T, K extends string> {
  id: K;
  items: T[];
}

/**
 * Items shared out into columns, in the columns' order, each column sorted by `order`, which is told
 * the column so a finished one can sort differently. An item whose column is unknown is left out.
 */
export function boardColumns<T, K extends string>(
  ids: readonly K[],
  items: readonly T[],
  columnOf: (item: T) => K,
  order?: (a: T, b: T, column: K) => number
): BoardColumn<T, K>[] {
  const columns = ids.map((id) => ({ id, items: [] as T[] }));
  const byId = new Map(columns.map((column) => [column.id as string, column] as const));
  for (const item of items) byId.get(columnOf(item))?.items.push(item);
  if (order) for (const column of columns) column.items.sort((a, b) => order(a, b, column.id));
  return columns;
}

/**
 * How many cards a finished column shows before "Show more". Completed and Estimated only ever grow,
 * and a column of every deal ever sent would bury the board; the latest are the ones anyone looks for.
 */
export const FINISHED_SHOWN = 6;

/**
 * The column an item moves to from the keyboard: the nearest one in `direction` that will take it.
 * Null at either end, or when nothing that way will.
 */
export function neighbourColumn<K extends string>(ids: readonly K[], from: K, direction: -1 | 1, accepts: (id: K) => boolean = () => true): K | null {
  for (let at = ids.indexOf(from) + direction; at >= 0 && at < ids.length; at += direction) {
    const id = ids[at]!;
    if (accepts(id)) return id;
  }
  return null;
}

const TAG_WEIGHT: Record<string, number> = { Urgent: 0, Active: 1, '': 1, 'On hold': 2, Closed: 3 };

/**
 * The order of deals inside a column: Urgent first and Closed last, then the nearest deadline (a deal
 * with none after every dated one), then the most recently updated.
 */
export function dealOrder(a: Estimation, b: Estimation): number {
  const byTag = (TAG_WEIGHT[a.tag] ?? 1) - (TAG_WEIGHT[b.tag] ?? 1);
  if (byTag) return byTag;
  if ((a.due || '') !== (b.due || '')) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return String(b.up).localeCompare(String(a.up));
}

/**
 * The hub's order: `dealOrder` while a deal is in play, and the latest change first once it is
 * Completed, where a deadline no longer means anything and a deal just finished should lead.
 */
export function hubOrder(a: Estimation, b: Estimation, column: EstimationStage): number {
  return column === 'done' ? String(b.up).localeCompare(String(a.up)) : dealOrder(a, b);
}

/** The order of requests inside a column: a queue, oldest first, except Estimated, where the latest priced leads. */
export function ticketOrder(a: EstimateRequest, b: EstimateRequest): number {
  const priced = Number(Number(a.est) > 0) - Number(Number(b.est) > 0);
  if (priced) return priced;
  if (Number(a.est) > 0) return String(b.estAt ?? '').localeCompare(String(a.estAt ?? '')) || b.id.localeCompare(a.id);
  return String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id);
}

export interface StageTally {
  count: number;
  /** The real deals' hours, as each caches them. */
  hours: number;
  /** The demo is in the column, and its hours are not in `hours`. */
  demo: boolean;
}

/**
 * What a column header says: how many deals, and their hours. The demo's are left out, as they are
 * of every figure on the hub, and `demo` says so, so the header can tell the reader rather than show
 * a sum that the cards under it do not add up to.
 */
export function stageTally(estimations: readonly Pick<Estimation, 'id' | 'total'>[]): StageTally {
  const real = estimations.filter((one) => !isDemoEstimation(one));
  return { count: estimations.length, hours: real.reduce((sum, one) => sum + (Number(one.total) || 0), 0), demo: real.length < estimations.length };
}

/** The hours the desk has returned on these requests: the Estimated column's figure, the demo's left out as in the desk's own. */
export function pricedTally(requests: readonly Pick<EstimateRequest, 'id' | 'estId' | 'est'>[]): { hours: number; demo: boolean } {
  const real = requests.filter((request) => !isDemoRequest(request));
  return { hours: real.reduce((sum, request) => sum + (Number(request.est) > 0 ? Number(request.est) : 0), 0), demo: real.length < requests.length };
}

/**
 * Whether a card should say how many hours carry no role. Early on that is every hour and says
 * nothing; once a deal waits on its rates, or is being checked, it is the work left.
 */
export const showsRoleGap = (stage: EstimationStage): boolean => stage === 'rates' || stage === 'review';
