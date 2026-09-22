import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PersistedState } from '@/types';
import { beaconSave, fetchState, saveState } from '@/api/client';
import { ALL_SYNCED_KEYS, readStorage, STORAGE_KEYS, SYNCED_SETTING_KEYS, writeStorage } from '@/state/keys';

/**
 * Keeps the spreadsheet and the browser in step.
 *
 * Two rules keep data safe, both learned the hard way:
 *   1. Never push before a read has succeeded. An empty browser must not be able to overwrite
 *      the spreadsheet just because the network was down at boot.
 *   2. Never overwrite local edits with a background pull. If both sides changed, say so and let
 *      the person reload rather than silently picking a winner.
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
  const lastSynced = useRef('');
  const inFlight = useRef(false);
  const failures = useRef(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const hydrateRef = useRef(onHydrate);
  hydrateRef.current = onHydrate;

  const payload = useCallback((): string => JSON.stringify({ ...latest.current, settings: SETTINGS_SNAPSHOT() }), []);

  const push = useCallback(async () => {
    if (!hydrated.current) {
      setStatus((s) => ({ ...s, tone: 'warn', message: 'waiting for the store before saving…' }));
      return;
    }
    if (inFlight.current) return;
    const body = payload();
    if (body === lastSynced.current) return;

    inFlight.current = true;
    setStatus((s) => ({ ...s, tone: 'busy', message: 'saving…' }));
    try {
      const result = await saveState(JSON.parse(body) as PersistedState);
      lastSynced.current = body;
      failures.current = 0;
      const store = shortStore(result.label ?? 'store');
      setStatus({ tone: 'good', store, hydrated: true, message: `saved to ${store} · ${result.counts?.estimations ?? 0} estimations` });
    } catch (error) {
      failures.current += 1;
      setStatus((s) => ({ ...s, tone: 'bad', message: `NOT SAVED — ${(error as Error).message} · retrying` }));
      const delay = Math.min(30_000, 2000 * failures.current);
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => void push(), delay);
    } finally {
      inFlight.current = false;
    }
  }, [payload]);

  const pull = useCallback(async () => {
    try {
      const result = await fetchState();
      const store = shortStore(result.label);
      const incoming = JSON.stringify({
        estimations: result.state.estimations ?? [],
        requests: result.state.requests ?? [],
        solutions: result.state.solutions ?? [],
        bundles: result.state.bundles ?? [],
        settings: result.state.settings ?? {}
      });

      if (!hydrated.current) {
        if (!result.empty) {
          /* settings land in storage first, so the app reads them as it mounts */
          for (const [key, value] of Object.entries(result.state.settings ?? {})) {
            if ((ALL_SYNCED_KEYS as readonly string[]).includes(key) && value !== null && value !== undefined) {
              writeStorage(key, value);
            }
          }
          hydrateRef.current(result.state);
        }
        hydrated.current = true;
        lastSynced.current = result.empty ? '' : incoming;
        setStatus({
          tone: 'good',
          store,
          hydrated: true,
          message: result.empty ? `${store} is empty — starting fresh` : `loaded from ${store}`
        });
        return;
      }

      if (incoming === lastSynced.current) return;
      if (payload() !== lastSynced.current) {
        setStatus({ tone: 'warn', store, hydrated: true, message: `changed in ${store} by someone else — reload to merge` });
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
  }, [payload]);

  /* first read */
  useEffect(() => {
    if (!enabled) return;
    void pull();
  }, [enabled, pull]);

  /* debounced write whenever the data changes */
  useEffect(() => {
    if (!enabled || !hydrated.current) return;
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

  /* last chance on the way out */
  useEffect(() => {
    if (!enabled) return;
    const onLeave = (): void => {
      if (!hydrated.current) return;
      const body = payload();
      if (body === lastSynced.current) return;
      beaconSave(JSON.parse(body) as PersistedState);
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [enabled, payload]);

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
