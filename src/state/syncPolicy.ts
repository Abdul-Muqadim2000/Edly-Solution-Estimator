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
  /**
   * A save from this tab was on its way when the read left, or started before it came back, so
   * the read may show the store from before that save.
   */
  overtaken: boolean;
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
  /* A read this tab's own save overtook holds the store as it was before that save. Once the save
     lands, the tab and lastSynced both hold the change, so the old copy looked like someone else's
     and was applied: the tab rolled back, and its next save took the change out of the store too.
     Nothing is lost by dropping it; the next read comes in 45 seconds. */
  if (input.overtaken) return 'ignore';
  if (input.incoming === input.lastSynced) return 'ignore';
  if (input.local !== input.lastSynced) return 'conflict';
  /* An empty store under a tab full of rows is far likelier to be a read that went wrong than a
     store someone emptied. Applying it blanked the screen, and the next edit saved the blank. */
  if (input.empty && input.localRows > 0) return 'keep-local';
  return 'update';
}

/**
 * The most a save sent while the page unloads may carry. Chrome refuses a `sendBeacon` or
 * keepalive body over 64 KB, and refuses it without an error the page could act on, so the
 * limit sits under that with room for the request's own overhead.
 */
export const BEACON_LIMIT = 60_000;

export interface UnloadInput {
  hydrated: boolean;
  /** This tab holds a change the store does not have yet, including one still on its way. */
  unsaved: boolean;
  /** A save is on its way right now. */
  inFlight: boolean;
  /** Size of the save, in bytes. */
  bytes: number;
}

export interface UnloadPlan {
  /** `beacon` goes with the page; `now` is an ordinary save, started before the page can go. */
  send: 'nothing' | 'beacon' | 'now';
  /** Ask the browser to hold the page ("Leave site?") while the save goes up. */
  ask: boolean;
  /**
   * Cancel a save still on its way, and send the newest copy, which holds everything it carried.
   * Cancelled while still uploading, the older save never reaches the server; already received,
   * it started first and finishes first. Waiting for it is not an option: nothing runs while the
   * browser holds the page, so the newest copy would never be sent.
   */
  cancelInFlight: boolean;
}

export function unloadPlan(input: UnloadInput): UnloadPlan {
  if (!input.hydrated || !input.unsaved) return { send: 'nothing', ask: false, cancelInFlight: false };
  const big = input.bytes > BEACON_LIMIT;
  return { send: big ? 'now' : 'beacon', ask: big, cancelInFlight: input.inFlight };
}
