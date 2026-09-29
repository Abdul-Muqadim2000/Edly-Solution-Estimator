import { useCallback, useEffect, useState } from 'react';
import type { Catalog, SalesLegalItem, Tender, TenderRange, TenderTokens } from '@/types';
import type { Action } from '@/state/reducer';
import { TenderApiError, tenderExtract, tenderMatch, tenderSort, tenderTerms } from '@/api/client';
import {
  aiAllowance,
  aiSpent,
  callSlots,
  canSpend,
  catalogLines,
  documentsIn,
  heldByLimit,
  heldDocs,
  matchBatches,
  needsMatching,
  nextStaleAt,
  outOfScopeMatches,
  rangesReading,
  rangesToRun,
  termsWaiting,
  touchedCache,
  type DocRef
} from '@/domain/tender';
import { needsSorting } from '@/domain/salesLegal';

/**
 * Runs a tender's AI calls: every pending extraction range, then the key terms when a person asked
 * for them, matching when asked, and sorting the out-of-scope items after a match or when asked. No
 * call starts once the tender has spent what it is allowed; the screen asks a person whether to go on.
 *
 * What to run next is decided by the pure functions in `domain/tender.ts`; this is the glue that
 * calls the server and dispatches what comes back. Results land in the reducer, which lives
 * above this screen, so a call that finishes after the person has navigated away is kept.
 */

/** Extraction calls in flight at once. Enough to be quick, few enough to stay clear of rate limits. */
const PARALLEL_RANGES = 3;
const PARALLEL_MATCHES = 2;
/** Out-of-scope items per sort call. Each is a line of text, so one call holds a whole tender's worth. */
const SORT_BATCH = 100;

/* Two guards against paying for one range twice. The claim in the reducer (`claimRanges`) tells
   other tabs, and other browsers once the store syncs, that a range is taken. This set covers
   the gap in this tab before the claim has rendered: StrictMode's second effect run, and a new
   hook mounted while the old one's calls are still out, both see the range as pending. */
const inFlight = new Set<string>();
/** This page load's name in a claim. Random, so two tabs never share one; lost on reload, which is right. */
const THIS_TAB = Math.random().toString(36).slice(2, 10);
const claimNow = (): { at: number; by: string } => ({ at: Date.now(), by: THIS_TAB });
const matchingNow = new Set<string>();
const sortingNow = new Set<string>();
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((listener) => listener());

/* When the latest call that read each tender's documents, and each platform's catalog, started, so a
   cold start sends one call first and the rest read what it cached (`callSlots`). This page load's
   knowledge only: after a reload the first call goes alone, which costs time, not money. */
const docsReadAt = new Map<string, number>();
const catalogReadAt = new Map<string, number>();

function noteRead(reads: Map<string, number>, key: string, startedAt: number, tokens: TenderTokens | undefined): void {
  if (startedAt > 0 && touchedCache(tokens)) reads.set(key, Math.max(reads.get(key) ?? 0, startedAt));
}

/** The intake read the tender (the fit call, then any keep-warm) at `startedAt`; its extraction may start at full width. */
export function noteTenderRead(tenderId: string, startedAt: number): void {
  if (startedAt > 0) docsReadAt.set(tenderId, Math.max(docsReadAt.get(tenderId) ?? 0, startedAt));
}

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
  /** Ranges being read, here or by another tab that holds a live claim. */
  reading: TenderRange[];
  matching: boolean;
  matchError: string;
  /** What is waiting for a person to agree to spend more on the AI, in words; '' when nothing is. */
  held: string;
  /** Match every approved requirement that has no match yet. */
  runMatching: () => void;
  /** Read a failed range again, claimed for this tab in the same step. */
  retry: (key: string) => void;
  sorting: boolean;
  sortError: string;
  /** Put every out-of-scope item with no team in one, by the AI. */
  runSorting: () => void;
  /** Documents whose key terms are being read, here or by another tab that holds a live claim. */
  readingTerms: number;
  /** Read a document's terms again after a failure. */
  retryTerms: (key: string) => void;
  /** Allow the tender another step of spending, and carry on with what the limit stopped. */
  goOn: () => void;
}

/**
 * `items`: the sales and legal items already copied from this tender to its estimation, so the sort
 * leaves alone any a person has put in a team there.
 */
export function useTenderRunner(tender: Tender | null, catalog: Catalog, dispatch: (action: Action) => void, items: readonly SalesLegalItem[] = []): TenderRunner {
  const [tick, setTick] = useState(0);
  const [matchError, setMatchError] = useState('');
  /* matching was asked for and the limit stopped it; `resume` runs it once the person has said go on */
  const [matchingHeld, setMatchingHeld] = useState(false);
  const [resume, setResume] = useState(false);
  const [sortError, setSortError] = useState('');
  /* items the limit kept from being sorted, whether a person had asked, and whether to go on once they say so */
  const [sortHeld, setSortHeld] = useState<{ count: number; asked: boolean }>({ count: 0, asked: false });
  const [resumeSort, setResumeSort] = useState(false);
  /* the tender whose matching run just finished in this tab, so its out-of-scope items are sorted next.
     An id, not a flag: a run that finishes after the person opened another tender must not sort that one */
  const [sortAfterMatch, setSortAfterMatch] = useState('');

  useEffect(() => {
    const listener = (): void => setTick((count) => count + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const tenderId = tender?.id ?? '';
  const running = mine(tenderId);

  useEffect(() => {
    setMatchingHeld(false);
    setResume(false);
    setSortHeld({ count: 0, asked: false });
    setResumeSort(false);
    setSortAfterMatch('');
    setSortError('');
  }, [tenderId]);

  /* `tick` is a dependency on purpose: a call frees its slot after the reply that re-rendered
     this, so the next range waits for the slot to free, not for another reply */
  useEffect(() => {
    if (!tender) return;
    const docs = docRefs(tender);
    if (!docs) return;
    /* nothing new starts past the limit; the ranges wait as pending until a person says go on */
    if (!canSpend(tender)) return;
    const now = Date.now();
    const local = mine(tender.id);
    /* one budget for every call that reads the documents: terms reads still out take their slots */
    const termsOut = [...local].filter((key) => key.startsWith('terms:')).length;
    const keys = rangesToRun(tender.ranges, local, Math.max(0, callSlots(PARALLEL_RANGES, docsReadAt.get(tender.id), now) - termsOut), now, THIS_TAB);

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
        .then(({ found, tokens }) => {
          noteRead(docsReadAt, tender.id, now, tokens);
          dispatch({ type: 'rangeDone', id: tender.id, key, found, tokens });
        })
        .catch((error: unknown) => {
          const failure = error instanceof TenderApiError ? error : null;
          noteRead(docsReadAt, tender.id, now, failure?.tokens);
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

  /* The key terms, one call per document, once the extraction has nothing left to read: the
     requirements come first, and the terms read the documents from the cache it kept warm. Claimed
     the way a range is, so two tabs on one tender do not pay for the same document twice. */
  useEffect(() => {
    if (!tender || !termsWaiting(tender)) return;
    const docs = docRefs(tender);
    if (!docs || !canSpend(tender)) return;
    const reads = tender.termReads ?? [];
    const now = Date.now();
    const keys = rangesToRun(reads, mine(tender.id), callSlots(PARALLEL_RANGES, docsReadAt.get(tender.id), now), now, THIS_TAB);

    if (keys.length === 0) {
      const staleAt = nextStaleAt(reads, now, THIS_TAB);
      if (staleAt === null) return;
      const timer = window.setTimeout(changed, Math.max(1000, staleAt - now + 500));
      return () => window.clearTimeout(timer);
    }

    dispatch({ type: 'claimTerms', id: tender.id, keys, claim: { at: now, by: THIS_TAB } });
    for (const key of keys) {
      const read = reads.find((one) => one.key === key);
      if (!read) continue;
      const slot = `${tender.id}|${key}`;
      inFlight.add(slot);
      tenderTerms(docs, { doc: read.doc, from: read.from, to: read.to })
        .then(({ found, tokens }) => {
          noteRead(docsReadAt, tender.id, now, tokens);
          dispatch({ type: 'termsDone', id: tender.id, key, found, tokens });
        })
        .catch((error: unknown) => {
          const failure = error instanceof TenderApiError ? error : null;
          noteRead(docsReadAt, tender.id, now, failure?.tokens);
          if (failure?.tokens) dispatch({ type: 'addTenderTokens', id: tender.id, tokens: failure.tokens });
          /* too much for one call: its pages in two calls, as a range is split, not the same call again */
          if (failure && (failure.code === 'truncated' || failure.code === 'timeout')) dispatch({ type: 'splitTerms', id: tender.id, key, claim: claimNow() });
          else dispatch({ type: 'termsFailed', id: tender.id, key, error: failure?.message ?? String(error) });
        })
        .finally(() => {
          inFlight.delete(slot);
          changed();
        });
    }
    changed();
    return undefined;
  }, [tender, dispatch, tick]);

  /* One small call per hundred items, one after another: they share no cached prefix worth waiting
     for, and there are rarely more than a hundred. Counted against the limit as they come back.
     `asked`: a person pressed Sort them, so items already on the estimation with no team are sorted
     too; the sort that follows matching by itself leaves the estimation alone. */
  const sortNow = useCallback((asked: boolean) => {
    if (!tender || sortingNow.has(tender.id)) return;
    const settled = outOfScopeMatches(tender);
    if (Object.keys(settled).length > 0) dispatch({ type: 'setMatches', id: tender.id, matches: settled });
    const wanted = needsSorting(tender, items, asked ? 'unsorted' : 'skip');
    if (wanted.length === 0) return;
    if (!canSpend(tender)) {
      setSortHeld({ count: wanted.length, asked });
      return;
    }

    setSortError('');
    setSortHeld({ count: 0, asked: false });
    sortingNow.add(tender.id);
    changed();
    let spent = aiSpent(tender);
    const allowed = aiAllowance(tender);
    let stopped = 0;
    const failures: string[] = [];
    void (async () => {
      for (const batch of matchBatches(wanted, SORT_BATCH)) {
        if (spent >= allowed) {
          stopped += batch.length;
          continue;
        }
        try {
          const { categories, tokens } = await tenderSort(batch);
          spent += Number(tokens.usd) || 0;
          dispatch({ type: 'setCategories', id: tender.id, categories, tokens, copies: asked });
        } catch (error) {
          if (error instanceof TenderApiError && error.tokens) {
            spent += Number(error.tokens.usd) || 0;
            dispatch({ type: 'addTenderTokens', id: tender.id, tokens: error.tokens });
          }
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    })().finally(() => {
      sortingNow.delete(tender.id);
      if (stopped > 0) setSortHeld({ count: stopped, asked });
      if (failures.length > 0) setSortError(`Some items could not be sorted: ${failures[0]}`);
      changed();
    });
  }, [tender, items, dispatch]);
  const runSorting = useCallback(() => sortNow(true), [sortNow]);

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

    if (!canSpend(tender)) {
      setMatchingHeld(true);
      return;
    }

    setMatchError('');
    setMatchingHeld(false);
    matchingNow.add(tender.id);
    changed();
    const queue = matchBatches(wanted);
    const failures: string[] = [];
    /* counted here as the batches come back: `tender` is the one from when matching was asked for,
       so its own total would not move until matching had finished */
    let spent = aiSpent(tender);
    const allowed = aiAllowance(tender);
    let stopped = false;
    const worker = async (most = Number.POSITIVE_INFINITY): Promise<void> => {
      for (let taken = 0; taken < most; taken++) {
        const batch = queue.shift();
        if (!batch) break;
        if (spent >= allowed) {
          stopped = true;
          break;
        }
        /* the wording each requirement had when asked, so an answer for since-changed text is dropped */
        const texts = Object.fromEntries(batch.map((req) => [req.id, req.text]));
        const started = Date.now();
        try {
          const { matches, tokens } = await tenderMatch(lines, batch);
          noteRead(catalogReadAt, tender.plat, started, tokens);
          spent += Number(tokens.usd) || 0;
          dispatch({ type: 'setMatches', id: tender.id, matches, texts, tokens });
        } catch (error) {
          if (error instanceof TenderApiError && error.tokens) {
            noteRead(catalogReadAt, tender.plat, started, error.tokens);
            spent += Number(error.tokens.usd) || 0;
            dispatch({ type: 'addTenderTokens', id: tender.id, tokens: error.tokens });
          }
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    };
    /* cold, the first batch goes alone: it writes the catalog to the cache, and the others read it */
    const first = callSlots(PARALLEL_MATCHES, catalogReadAt.get(tender.plat), Date.now()) < PARALLEL_MATCHES ? worker(1) : Promise.resolve();
    void first.then(() => Promise.all(Array.from({ length: Math.min(PARALLEL_MATCHES, queue.length) }, () => worker()))).finally(() => {
      matchingNow.delete(tender.id);
      if (stopped) setMatchingHeld(true);
      if (failures.length > 0) setMatchError(`Some requirements could not be matched: ${failures[0]}`);
      /* Only after a run that called the AI here. Opening a tender matched before sorting existed
         spends nothing by itself: its tab has a button for that. */
      setSortAfterMatch(tender.id);
      changed();
    });
  }, [tender, catalog, dispatch]);

  const retry = useCallback((key: string) => dispatch({ type: 'retryRange', id: tenderId, key, claim: claimNow() }), [dispatch, tenderId]);
  const retryTerms = useCallback((key: string) => dispatch({ type: 'retryTerms', id: tenderId, key, claim: claimNow() }), [dispatch, tenderId]);

  const goOn = useCallback(() => {
    if (!tenderId) return;
    dispatch({ type: 'allowMoreAi', id: tenderId });
    if (matchingHeld) {
      setMatchingHeld(false);
      setResume(true);
    }
    if (sortHeld.count > 0) {
      setSortHeld((held) => ({ ...held, count: 0 }));
      setResumeSort(true);
    }
  }, [dispatch, tenderId, matchingHeld, sortHeld]);

  /* after `allowMoreAi` has landed, so matching sees the new allowance rather than the old one */
  useEffect(() => {
    if (!resume || !tender || !canSpend(tender)) return;
    setResume(false);
    runMatching();
  }, [resume, tender, runMatching]);

  /* sorting follows matching, and waits for it: a batch still out may bring more out-of-scope items */
  useEffect(() => {
    if (!tender || matchingNow.has(tender.id)) return;
    if (sortAfterMatch === tender.id) {
      setSortAfterMatch('');
      sortNow(false);
    } else if (resumeSort && canSpend(tender)) {
      setResumeSort(false);
      sortNow(sortHeld.asked);
    }
  }, [sortAfterMatch, resumeSort, sortHeld.asked, tender, sortNow, tick]);

  return {
    running,
    reading: tender ? rangesReading(tender.ranges, running, Date.now(), THIS_TAB) : [],
    matching: matchingNow.has(tenderId),
    matchError,
    held: tender ? heldByLimit(tender, running, matchingHeld, sortHeld.count) : '',
    runMatching,
    retry,
    sorting: sortingNow.has(tenderId),
    sortError,
    runSorting,
    readingTerms: tender ? documentsIn(rangesReading(tender.termReads ?? [], running, Date.now(), THIS_TAB)) : 0,
    retryTerms,
    goOn
  };
}
