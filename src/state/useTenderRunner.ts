import { useCallback, useEffect, useState } from 'react';
import type { Catalog, Tender } from '@/types';
import type { Action } from '@/state/reducer';
import { TenderApiError, tenderExtract, tenderMatch } from '@/api/client';
import { catalogLines, heldDocs, matchBatches, needsMatching, nextStaleAt, outOfScopeMatches, rangesToRun, type DocRef } from '@/domain/tender';

/**
 * Runs a tender's AI calls: every pending extraction range, and matching when asked.
 *
 * What to run next is decided by the pure functions in `domain/tender.ts`; this is the glue that
 * calls the server and dispatches what comes back. Results land in the reducer, which lives
 * above this screen, so a call that finishes after the person has navigated away is kept.
 */

/** Extraction calls in flight at once. Enough to be quick, few enough to stay clear of rate limits. */
const PARALLEL_RANGES = 3;
const PARALLEL_MATCHES = 2;

/* Two guards against paying for one range twice. The claim in the reducer (`claimRanges`) tells
   other tabs, and other browsers once the store syncs, that a range is taken. This set covers
   the gap in this tab before the claim has rendered: StrictMode's second effect run, and a new
   hook mounted while the old one's calls are still out, both see the range as pending. */
const inFlight = new Set<string>();
/** This page load's name in a claim. Random, so two tabs never share one; lost on reload, which is right. */
const THIS_TAB = Math.random().toString(36).slice(2, 10);
const claimNow = (): { at: number; by: string } => ({ at: Date.now(), by: THIS_TAB });
const matchingNow = new Set<string>();
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((listener) => listener());

const mine = (tenderId: string): Set<string> =>
  new Set([...inFlight].filter((slot) => slot.startsWith(`${tenderId}|`)).map((slot) => slot.slice(tenderId.length + 1)));

/** The documents as the server addresses them, or null once any of them is gone from Anthropic. */
export function docRefs(tender: Pick<Tender, 'docs'>, now = Date.now()): DocRef[] | null {
  if (tender.docs.length === 0 || heldDocs(tender.docs, now).length !== tender.docs.length) return null;
  return tender.docs.map((doc) => ({ n: doc.n, name: doc.name, kind: doc.kind, fileId: doc.fileId, pages: doc.pages }));
}

export interface TenderRunner {
  /** Range keys this tab is reading right now. */
  running: ReadonlySet<string>;
  matching: boolean;
  matchError: string;
  /** Match every approved requirement that has no match yet. */
  runMatching: () => void;
  /** Read a failed range again, claimed for this tab in the same step. */
  retry: (key: string) => void;
}

export function useTenderRunner(tender: Tender | null, catalog: Catalog, dispatch: (action: Action) => void): TenderRunner {
  const [tick, setTick] = useState(0);
  const [matchError, setMatchError] = useState('');

  useEffect(() => {
    const listener = (): void => setTick((count) => count + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const tenderId = tender?.id ?? '';
  const running = mine(tenderId);

  /* `tick` is a dependency on purpose: a call frees its slot after the reply that re-rendered
     this, so the next range waits for the slot to free, not for another reply */
  useEffect(() => {
    if (!tender) return;
    const docs = docRefs(tender);
    if (!docs) return;
    const now = Date.now();
    const local = mine(tender.id);
    const keys = rangesToRun(tender.ranges, local, PARALLEL_RANGES, now, THIS_TAB);

    if (keys.length === 0) {
      /* another tab holds a claim; nothing changes here when it goes stale, so look again then */
      const staleAt = nextStaleAt(tender.ranges, now, THIS_TAB);
      if (staleAt === null) return;
      const timer = window.setTimeout(changed, Math.max(1000, staleAt - now + 500));
      return () => window.clearTimeout(timer);
    }

    dispatch({ type: 'claimRanges', id: tender.id, keys, claim: { at: now, by: THIS_TAB } });
    for (const key of keys) {
      const range = tender.ranges.find((one) => one.key === key);
      if (!range) continue;
      const slot = `${tender.id}|${key}`;
      inFlight.add(slot);
      tenderExtract(docs, { doc: range.doc, from: range.from, to: range.to })
        .then(({ found, tokens }) => dispatch({ type: 'rangeDone', id: tender.id, key, found, tokens }))
        .catch((error: unknown) => {
          const failure = error instanceof TenderApiError ? error : null;
          if (failure?.tokens) dispatch({ type: 'addTenderTokens', id: tender.id, tokens: failure.tokens });
          /* too much for one call: two smaller calls, not the same call again */
          if (failure && (failure.code === 'truncated' || failure.code === 'timeout')) dispatch({ type: 'splitRange', id: tender.id, key, claim: claimNow() });
          else dispatch({ type: 'rangeFailed', id: tender.id, key, error: failure?.message ?? String(error) });
        })
        .finally(() => {
          inFlight.delete(slot);
          changed();
        });
    }
    changed();
    return undefined;
  }, [tender, dispatch, tick]);

  const runMatching = useCallback(() => {
    if (!tender || matchingNow.has(tender.id)) return;
    const settled = outOfScopeMatches(tender);
    if (Object.keys(settled).length > 0) dispatch({ type: 'setMatches', id: tender.id, matches: settled });

    const wanted = needsMatching(tender);
    if (wanted.length === 0) return;
    const lines = catalogLines(catalog);
    if (lines.length === 0) {
      setMatchError('This platform has no catalog to match against yet. Load its sheet, or mark the requirements custom by hand.');
      return;
    }

    setMatchError('');
    matchingNow.add(tender.id);
    changed();
    const queue = matchBatches(wanted);
    const failures: string[] = [];
    const worker = async (): Promise<void> => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        /* the wording each requirement had when asked, so an answer for since-changed text is dropped */
        const texts = Object.fromEntries(batch.map((req) => [req.id, req.text]));
        try {
          const { matches, tokens } = await tenderMatch(lines, batch);
          dispatch({ type: 'setMatches', id: tender.id, matches, texts, tokens });
        } catch (error) {
          if (error instanceof TenderApiError && error.tokens) dispatch({ type: 'addTenderTokens', id: tender.id, tokens: error.tokens });
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(PARALLEL_MATCHES, queue.length) }, worker)).finally(() => {
      matchingNow.delete(tender.id);
      if (failures.length > 0) setMatchError(`Some requirements could not be matched: ${failures[0]}`);
      changed();
    });
  }, [tender, catalog, dispatch]);

  const retry = useCallback((key: string) => dispatch({ type: 'retryRange', id: tenderId, key, claim: claimNow() }), [dispatch, tenderId]);

  return { running, matching: matchingNow.has(tenderId), matchError, runMatching, retry };
}
