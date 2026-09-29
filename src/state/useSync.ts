import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PersistedState } from '@/types';
import { beaconSave, fetchState, saveState } from '@/api/client';
import { countRows, syncKey } from '@server/schema';
import { ALL_SYNCED_KEYS, readStorage, STORAGE_KEYS, SYNCED_SETTING_KEYS, writeStorage } from '@/state/keys';
import { pullStep, unloadPlan } from '@/state/syncPolicy';

/**
 * Keeps the spreadsheet and the browser in step.
 *
 * Three rules keep data safe, each learned the hard way:
 *   1. Never push before a read has succeeded. An empty browser must not be able to overwrite
 *      the spreadsheet just because the network was down at boot.
 *   2. Never overwrite local edits with a background pull. If both sides changed, say so and let
 *      the person reload rather than silently picking a winner. A read that one of this tab's own
 *      saves overtook is dropped: it shows the store from before that save.
 *   3. Never act on one read that says the store is empty. At boot, read again first; later, keep
 *      this tab's rows rather than blank them. See `pullStep` for why.
 */

export type SyncTone = 'good' | 'busy' | 'warn' | 'bad';

export interface SyncStatus {
  tone: SyncTone;
  message: string;
  /** A read has succeeded, so writing is allowed. */
  hydrated: boolean;
  store: string;
}

export interface SyncApi {
  status: SyncStatus;
  /** Flush now — used before navigating away from a page. */
  flush: () => void;
  reload: () => void;
}

const SETTINGS_SNAPSHOT = (): Record<string, unknown> => {
  const settings: Record<string, unknown> = {};
  for (const key of SYNCED_SETTING_KEYS) {
    const value = readStorage<unknown>(key, undefined);
    if (value !== undefined) settings[key] = value;
  }
  return settings;
};

const shortStore = (label: string): string => label.split(':')[0] ?? 'store';

/** How long to wait before asking again after a first read that says the store is empty. */
const RECHECK_MS = 2000;

export interface UseSyncOptions {
  /** Current app data, already in persisted shape. */
  snapshot: PersistedState;
  /** Called with server data on the first successful read, and on a clean background update. */
  onHydrate: (state: PersistedState) => void;
  /** Debounce before a push, ms. */
  debounceMs?: number;
  /** Background re-read interval, ms. */
  pollMs?: number;
  enabled?: boolean;
}

export function useSync({ snapshot, onHydrate, debounceMs = 1200, pollMs = 45_000, enabled = true }: UseSyncOptions): SyncApi {
  const [status, setStatus] = useState<SyncStatus>({ tone: 'busy', message: 'connecting…', hydrated: false, store: 'store' });

  const hydrated = useRef(false);
  /* The sync key of the state both sides last agreed on. Always a key, never a raw payload:
     comparing the browser's text with the store's text rewrote the workbook on every poll. */
  const lastSynced = useRef('');
  const inFlight = useRef(false);
  /* the save on its way, so a newer one sent as the page goes can cancel it */
  const saving = useRef<AbortController | null>(null);
  /* A save asked for while this tab could not make one (no read had succeeded yet, or another save
     was on its way) is owed rather than dropped. Dropping it left the change unsaved until the
     next edit, and a reload before that edit lost it: an import made just after selecting a
     solution, or in a new workspace's first seconds, never reached the store. */
  const owed = useRef(false);
  const failures = useRef(0);
  /* saves this tab has started, so a read can tell whether one crossed it on the way */
  const saves = useRef(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const hydrateRef = useRef(onHydrate);
  hydrateRef.current = onHydrate;

  const current = useCallback((): PersistedState => ({ ...latest.current, settings: SETTINGS_SNAPSHOT() }), []);

  /* `supersede`: the page is going, so cancel a save still on its way and send the newest copy now */
  const push = useCallback(async (supersede = false) => {
    if (!hydrated.current) {
      owed.current = true;
      setStatus((s) => ({ ...s, tone: 'warn', message: 'waiting for the store before saving…' }));
      return;
    }
    if (inFlight.current && !supersede) {
      owed.current = true;
      return;
    }
    owed.current = false;
    const state = current();
    const key = syncKey(state);
    if (key === lastSynced.current && !inFlight.current) return;

    saving.current?.abort();
    const controller = new AbortController();
    saving.current = controller;
    inFlight.current = true;
    setStatus((s) => ({ ...s, tone: 'busy', message: 'saving…' }));
    try {
      saves.current += 1;
      const result = await saveState(state, controller.signal);
      lastSynced.current = key;
      failures.current = 0;
      const store = shortStore(result.label ?? 'store');
      setStatus({ tone: 'good', store, hydrated: true, message: `saved to ${store} · ${result.counts?.estimations ?? 0} estimations` });
    } catch (error) {
      /* cancelled by a newer save, which reports for both */
      if (controller.signal.aborted) return;
      failures.current += 1;
      setStatus((s) => ({ ...s, tone: 'bad', message: `NOT SAVED — ${(error as Error).message} · retrying` }));
      const delay = Math.min(30_000, 2000 * failures.current);
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => void push(), delay);
    } finally {
      if (saving.current === controller) {
        saving.current = null;
        inFlight.current = false;
      }
    }
    /* after a failure a retry is already scheduled, and it sends the latest copy */
    if (owed.current && failures.current === 0) {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => void push(), 0);
    }
  }, [current]);

  const pull = useCallback(async (rechecked = false) => {
    const savesBefore = saves.current;
    const savingBefore = inFlight.current;
    try {
      const result = await fetchState();
      const store = shortStore(result.label);
      const incoming = syncKey({
        estimations: result.state.estimations ?? [],
        requests: result.state.requests ?? [],
        solutions: result.state.solutions ?? [],
        bundles: result.state.bundles ?? [],
        tenders: result.state.tenders ?? [],
        salesLegal: result.state.salesLegal ?? [],
        settings: result.state.settings ?? {}
      });

      const local = current();
      const step = pullStep({
        hydrated: hydrated.current,
        empty: result.empty === true,
        rechecked,
        incoming,
        lastSynced: lastSynced.current,
        local: syncKey(local),
        localRows: countRows(local),
        overtaken: savingBefore || saves.current !== savesBefore
      });

      if (step === 'recheck') {
        setTimeout(() => void pull(true), RECHECK_MS);
        return;
      }

      if (step === 'hydrate' || step === 'start-fresh') {
        if (step === 'hydrate') {
          /* settings land in storage first, so the app reads them as it mounts */
          for (const [key, value] of Object.entries(result.state.settings ?? {})) {
            if ((ALL_SYNCED_KEYS as readonly string[]).includes(key) && value !== null && value !== undefined) {
              writeStorage(key, value);
            }
          }
          hydrateRef.current(result.state);
        }
        hydrated.current = true;
        lastSynced.current = step === 'start-fresh' ? '' : incoming;
        /* Only after starting fresh: this tab's copy is then the one to keep. After a hydrate the
           store's copy has not rendered yet, so saving now would send the old one over it; the
           save that follows the render does the job. */
        if (step === 'start-fresh' && owed.current) {
          if (pushTimer.current) clearTimeout(pushTimer.current);
          pushTimer.current = setTimeout(() => void push(), 0);
        }
        setStatus({
          tone: 'good',
          store,
          hydrated: true,
          message: step === 'start-fresh' ? `${store} is empty, starting fresh` : `loaded from ${store}`
        });
        return;
      }

      if (step === 'ignore') return;
      if (step === 'conflict') {
        setStatus({ tone: 'warn', store, hydrated: true, message: `changed in ${store} by someone else — reload to merge` });
        return;
      }
      if (step === 'keep-local') {
        setStatus({ tone: 'warn', store, hydrated: true, message: `${store} read as empty, so this tab kept its copy. Reload to check` });
        return;
      }
      hydrateRef.current(result.state);
      lastSynced.current = incoming;
      setStatus({ tone: 'warn', store, hydrated: true, message: `updated from ${store}` });
    } catch (error) {
      if (hydrated.current) return;
      failures.current += 1;
      setStatus({
        tone: 'bad',
        store: 'store',
        hydrated: false,
        message: `cannot reach the store — nothing will be saved (${(error as Error).message})`
      });
      if (failures.current < 6) setTimeout(() => void pull(), Math.min(15_000, 1500 * failures.current));
    }
  }, [current, push]);

  /* first read */
  useEffect(() => {
    if (!enabled) return;
    void pull();
  }, [enabled, pull]);

  /* debounced write whenever the data changes */
  useEffect(() => {
    if (!enabled) return;
    if (!hydrated.current) {
      owed.current = true;
      return;
    }
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => void push(), debounceMs);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [snapshot, enabled, debounceMs, push]);

  /* background re-read, and one on tab focus */
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (!document.hidden) void pull();
    }, pollMs);
    const onVisible = (): void => {
      if (!document.hidden) void pull();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, pollMs, pull]);

  /* Last chance on the way out. A beacon is the only send that outlives the page, and Chrome
     drops one over 64 KB without telling the page, which is every save once a workspace holds a
     large import. So a save too big for one starts now, and the browser is asked to hold the
     page ("Leave site?") while it goes, instead of the change being lost in silence. A save
     still on its way is cancelled first: on production a desk's own 600 KB save was going up when
     a filing and a reload came, and the filing was lost waiting behind it. */
  useEffect(() => {
    if (!enabled) return;
    const onLeave = (event: BeforeUnloadEvent): void => {
      const state = current();
      const unsaved = hydrated.current && (inFlight.current || syncKey(state) !== lastSynced.current);
      const json = JSON.stringify(state);
      const plan = unloadPlan({ hydrated: hydrated.current, unsaved, inFlight: inFlight.current, bytes: new Blob([json]).size });
      if (plan.send === 'beacon') {
        if (plan.cancelInFlight) saving.current?.abort();
        beaconSave(state);
      }
      if (plan.send === 'now') {
        if (pushTimer.current) clearTimeout(pushTimer.current);
        /* sent inside this handler, before the browser holds the page and nothing else can run */
        void push(plan.cancelInFlight);
      }
      if (plan.ask) {
        event.preventDefault();
        /* older browsers ask only when returnValue is set */
        event.returnValue = '';
      }
    };
    /* hidden is often the last event a phone or a closing tab delivers, so a pending save goes now */
    const onHidden = (): void => {
      if (document.visibilityState !== 'hidden' || !hydrated.current || !pushTimer.current) return;
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
      void push();
    };
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [enabled, current, push]);

  return useMemo<SyncApi>(
    () => ({
      status,
      flush: () => void push(),
      reload: () => void pull()
    }),
    [status, push, pull]
  );
}

export { STORAGE_KEYS };
