/** Browser storage keys. The sync bridge mirrors all of these except `auth`. */
export const STORAGE_KEYS = {
  /** Estimations, requests, desk additions, custom bundles, tenders, the sales and legal list. */
  estimations: 'edly-estimations-v2',
  requests: 'edly-requests-v2',
  solutions: 'edly-solutions-v2',
  bundles: 'edly-bundles-v2',
  /** Tenders in review, with their extracted requirements and decisions. */
  tenders: 'edly-tenders-v1',
  /** What each deal commits Edly to that is not software, for the sales, account and legal teams. */
  salesLegal: 'edly-sales-legal-v1',
  /** Working snapshot of the open estimation, plus display preferences. */
  workspace: 'edly-workspace-v2',
  /** Which estimation is open. */
  openEstimation: 'edly-open-estimation-v2',
  /** Practice and platform last chosen. */
  platform: 'edly-platform-v2',
  /** A catalog loaded by hand, per platform. */
  loadedCatalogs: 'edly-loaded-catalogs-v2',
  /** Where the catalog in play came from — pins a hand-loaded sheet across reloads. */
  catalogSource: 'edly-catalog-source-v2',
  /** Signed-in user. Deliberately NOT synced: a session belongs to its browser. */
  auth: 'edly-auth-v2'
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Cards or board, for the hub and for the desk's queue. Kept apart from `STORAGE_KEYS` on purpose:
 * this is one browser's preference, never synced, so one person's view does not become everyone's.
 * Not in the URL either, where Back would flip it and a link to a deal would lose it.
 */
export const VIEW_KEYS = { hub: 'quotient-hub-view-v1', queue: 'quotient-queue-view-v1' } as const;

/** Keys whose contents belong in the spreadsheet. */
export const SYNCED_DATA_KEYS = [
  STORAGE_KEYS.estimations,
  STORAGE_KEYS.requests,
  STORAGE_KEYS.solutions,
  STORAGE_KEYS.bundles,
  STORAGE_KEYS.tenders,
  STORAGE_KEYS.salesLegal
] as const;

/** Keys stored in the workbook's Settings sheet. */
export const SYNCED_SETTING_KEYS = [
  STORAGE_KEYS.workspace,
  STORAGE_KEYS.openEstimation,
  STORAGE_KEYS.platform,
  STORAGE_KEYS.loadedCatalogs,
  STORAGE_KEYS.catalogSource
] as const;

export const ALL_SYNCED_KEYS: readonly string[] = [...SYNCED_DATA_KEYS, ...SYNCED_SETTING_KEYS];

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or privacy mode — the server copy is the one that matters */
  }
}

export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * The slices whose value changed since this tab last wrote them, compared by reference.
 *
 * Writing only these is what keeps two tabs from fighting. A tab that rewrote every slice on any
 * change echoed its stale copy of the slices it had not touched back over the other tab's newer
 * ones, and because a storage event fires only when a value changes, the other tab then adopted
 * the stale copy: a tender applied in one tab lost its estimation to an idle hub in the other.
 */
export function changedSlices(previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(next).filter((key) => previous[key] !== next[key]);
}

/**
 * `next`, keeping `previous`'s value for each array slice whose items are the very same records, in
 * the same order. The demo is taken out of every slice before it is written (`toPersisted`), which
 * makes a new array each time even when no real record changed, and `changedSlices` compares by
 * reference: without this, every slice would be written on every change, the two-tab echo above.
 */
export function stableSlices(previous: Readonly<Record<string, unknown>>, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    const before = previous[key];
    const same =
      Array.isArray(value) &&
      Array.isArray(before) &&
      before.length === value.length &&
      value.every((item, index) => item === before[index]);
    out[key] = same ? before : value;
  }
  return out;
}
