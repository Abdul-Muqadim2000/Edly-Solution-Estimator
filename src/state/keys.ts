/** Browser storage keys. The sync bridge mirrors all of these except `auth`. */
export const STORAGE_KEYS = {
  /** Estimations, requests, desk additions, custom bundles. */
  estimations: 'edly-estimations-v2',
  requests: 'edly-requests-v2',
  solutions: 'edly-solutions-v2',
  bundles: 'edly-bundles-v2',
  /** Working snapshot of the open estimation, plus display preferences. */
  workspace: 'edly-workspace-v2',
  /** Which estimation is open. */
  openEstimation: 'edly-open-estimation-v2',
  /** Practice and platform last chosen. */
  platform: 'edly-platform-v2',
  /** A catalog loaded by hand, per platform. */
  loadedCatalogs: 'edly-loaded-catalogs-v2',
  /** Signed-in user. Deliberately NOT synced: a session belongs to its browser. */
  auth: 'edly-auth-v2'
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Keys whose contents belong in the spreadsheet. */
export const SYNCED_DATA_KEYS = [
  STORAGE_KEYS.estimations,
  STORAGE_KEYS.requests,
  STORAGE_KEYS.solutions,
  STORAGE_KEYS.bundles
] as const;

/** Keys stored in the workbook's Settings sheet. */
export const SYNCED_SETTING_KEYS = [
  STORAGE_KEYS.workspace,
  STORAGE_KEYS.openEstimation,
  STORAGE_KEYS.platform,
  STORAGE_KEYS.loadedCatalogs
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
