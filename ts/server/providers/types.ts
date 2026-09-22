import type { WriteSheets, Workbook } from '../../src/lib/xlsx';

/** A store that keeps a .xlsx file — we serialise, it stores bytes. */
export interface FileProvider {
  kind: 'file';
  label(): string;
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<SaveResult>;
  discover?(): Promise<DiscoveredTarget[]>;
}

/** A store that keeps rows natively — Google Sheets. No file is written. */
export interface SheetProvider {
  kind: 'sheets';
  label(): string;
  loadSheets(): Promise<Workbook | null>;
  saveSheets(sheets: WriteSheets): Promise<SaveResult>;
  discover?(): Promise<DiscoveredTarget[]>;
}

export type Provider = FileProvider | SheetProvider;

export interface SaveResult {
  pathname?: string | null;
  url?: string | null;
}

export interface DiscoveredTarget {
  kind: string;
  name: string;
  [extra: string]: unknown;
}

export function env(key: string, required: true): string;
export function env(key: string, required?: false): string;
export function env(key: string, required = false): string {
  const value = process.env[key];
  if (!value && required) throw new Error(`Missing env var ${key}`);
  return value ?? '';
}

/** Cache an access token until shortly before it expires. */
export class TokenCache {
  private token = '';
  private expires = 0;

  async get(fetchToken: () => Promise<{ token: string; ttlSeconds: number }>): Promise<string> {
    if (this.token && Date.now() < this.expires - 60_000) return this.token;
    const { token, ttlSeconds } = await fetchToken();
    this.token = token;
    this.expires = Date.now() + (ttlSeconds || 3600) * 1000;
    return token;
  }
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
