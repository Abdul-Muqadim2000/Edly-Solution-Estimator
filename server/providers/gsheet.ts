import type { WriteSheets, Workbook } from '../../src/lib/xlsx';
import { env, TokenCache, type DiscoveredTarget, type SaveResult, type SheetProvider } from './types';

/**
 * Google Sheets — the data lives in a spreadsheet in your own Drive, as real rows.
 *
 * Not a file the app overwrites: it writes cell ranges, so the sheet stays live and anyone with
 * access can open, filter and pivot it while the tool is running.
 *
 *   EDLY_STORE=gsheet
 *   GOOGLE_SHEET_ID     from the sheet URL
 *   GOOGLE_SA_EMAIL     service-account address
 *   GOOGLE_SA_KEY       its private key, newlines escaped or literal
 *
 * Enable the Sheets API, create a service account and a JSON key, then SHARE the spreadsheet
 * with the service-account email as Editor — that last step is the one people miss.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const cache = new TokenCache();

const base64Url = (input: Uint8Array | string): string => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const token = (): Promise<string> =>
  cache.get(async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: env('GOOGLE_SA_EMAIL', true),
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: issuedAt,
        exp: issuedAt + 3600
      })
    );
    const signingInput = `${header}.${claims}`;
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8(env('GOOGLE_SA_KEY', true)) as unknown as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
    const assertion = `${signingInput}.${base64Url(new Uint8Array(signature))}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
    });
    const json = (await response.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !json.access_token) {
      throw new Error(`Google auth failed: ${json.error_description ?? json.error ?? response.status}`);
    }
    return { token: json.access_token, ttlSeconds: json.expires_in ?? 3600 };
  });

const sheetId = (): string => env('GOOGLE_SHEET_ID', true);
const quote = (name: string): string => `'${name.replace(/'/g, "''")}'`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SHEETS_API}/${sheetId()}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...(init?.headers ?? {}) }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${text.slice(0, 240)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface SheetMeta {
  properties?: { title?: string };
  sheets?: { properties: { title: string; sheetId?: number } }[];
}

export const gsheetProvider: SheetProvider = {
  kind: 'sheets',

  label: () => `gsheet:${(process.env.GOOGLE_SHEET_ID ?? '?').slice(0, 12)}…`,

  async loadSheets(): Promise<Workbook | null> {
    const meta = await api<SheetMeta>('?fields=sheets(properties(title))');
    const titles = (meta.sheets ?? []).map((s) => s.properties.title);
    if (titles.length === 0) return null;
    const query = titles.map((t) => `ranges=${encodeURIComponent(quote(t))}`).join('&');
    const body = await api<{ valueRanges?: { values?: unknown[][] }[] }>(`/values:batchGet?${query}&majorDimension=ROWS`);
    const out: Workbook = {};
    (body.valueRanges ?? []).forEach((range, index) => {
      const title = titles[index];
      if (!title) return;
      out[title] = (range.values ?? []).map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
    });
    return out;
  },

  async saveSheets(sheets: WriteSheets): Promise<SaveResult> {
    const names = Object.keys(sheets);
    const meta = await api<SheetMeta>('?fields=sheets(properties(sheetId,title))');
    const existing = new Set((meta.sheets ?? []).map((s) => s.properties.title));

    const missing = names.filter((name) => !existing.has(name));
    if (missing.length > 0) {
      await api('/:batchUpdate'.replace('/:', ':'), {
        method: 'POST',
        body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) })
      });
    }

    /* clear then write, so deleted rows actually disappear */
    await api('/values:batchClear', { method: 'POST', body: JSON.stringify({ ranges: names.map(quote) }) });
    await api('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: names.map((name) => ({
          range: `${quote(name)}!A1`,
          majorDimension: 'ROWS',
          values: (sheets[name] ?? []).map((row) => (row ?? []).map((cell) => cell ?? ''))
        }))
      })
    });

    const url = `https://docs.google.com/spreadsheets/d/${sheetId()}`;
    return { pathname: url, url };
  },

  async discover(): Promise<DiscoveredTarget[]> {
    const meta = await api<SheetMeta>('?fields=properties(title),sheets(properties(title))');
    return [
      {
        kind: 'gsheet',
        name: meta.properties?.title ?? '(untitled)',
        tabs: (meta.sheets ?? []).map((s) => s.properties.title)
      }
    ];
  }
};
