/**
 * What one read of the store should do to this tab. Pure, so the rules the sync loop lives by
 * are tested without React; `useSync` carries the answer out.
 */

export type PullStep =
  /** First read, and the store holds data: load it. */
  | 'hydrate'
  /** First read says the store is empty: ask once more before believing it. */
  | 'recheck'
  /** Two reads agree the store is empty: keep what this tab has and allow saving. */
  | 'start-fresh'
  /** The store holds what this tab last saved. */
  | 'ignore'
  /** Both sides changed: warn, do not pick a winner. */
  | 'conflict'
  /** The store reads empty while this tab holds rows: keep them, do not blank the screen. */
  | 'keep-local'
  /** Someone else saved and nothing here is unsaved: take their copy. */
  | 'update';

export interface PullInput {
  /** A read has already succeeded in this tab. */
  hydrated: boolean;
  /** The store reported that nothing is stored. */
  empty: boolean;
  /** This read is the second in a row after an empty first one. */
  rechecked: boolean;
  /** Sync keys: the store's copy, the copy both sides last agreed on, and this tab's copy. */
  incoming: string;
  lastSynced: string;
  local: string;
  /** Records this tab holds, settings not counted. */
  localRows: number;
}

export function pullStep(input: PullInput): PullStep {
  if (!input.hydrated) {
    if (!input.empty) return 'hydrate';
    /* What a tab reads from the store is not kept in browser storage, so after an "empty" answer
       the tab holds only what it made itself, and its next save goes over the whole sheet. A
       Google Sheets save used to pass through an empty sheet, and one read landing there was
       enough. One answer is not enough to act on. */
    return input.rechecked ? 'start-fresh' : 'recheck';
  }
  if (input.incoming === input.lastSynced) return 'ignore';
  if (input.local !== input.lastSynced) return 'conflict';
  /* An empty store under a tab full of rows is far likelier to be a read that went wrong than a
     store someone emptied. Applying it blanked the screen, and the next edit saved the blank. */
  if (input.empty && input.localRows > 0) return 'keep-local';
  return 'update';
}
