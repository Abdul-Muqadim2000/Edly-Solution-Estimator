import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, TokenCache } from '../server/providers/types';

/**
 * The cloud stores, driven against a stubbed `fetch`.
 *
 * These four providers hold the customer's data and none of them can be unit-tested against the
 * real service without live credentials, so what is tested here is everything up to the wire:
 * which URL is called, in which order, with what body, and — more importantly — what happens when
 * the answer is a 403 or a 404. Those are the two replies that actually occur in setup, and
 * misreading either one is how an empty store gets mistaken for a broken one.
 *
 * The Google path signs a real JWT with a real generated key, so the PEM parsing and the
 * base64url encoding are exercised rather than stubbed around.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

let calls: Call[];
let replies: Array<{ status?: number; json?: unknown; text?: string; bytes?: Uint8Array }>;
const realFetch = globalThis.fetch;

const stubFetch = (): void => {
  calls = [];
  replies = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw) for (const [key, value] of Object.entries(raw as Record<string, string>)) headers[key.toLowerCase()] = String(value);

    let body = '';
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body instanceof URLSearchParams) body = init.body.toString();
    else if (init?.body instanceof Uint8Array) body = `<${init.body.length} bytes>`;

    calls.push({ url: String(input), method: init?.method ?? 'GET', headers, body });

    const reply = replies.shift() ?? { json: {} };
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.json ?? {},
      text: async () => reply.text ?? JSON.stringify(reply.json ?? {}),
      arrayBuffer: async () => (reply.bytes ?? new Uint8Array()).buffer
    } as unknown as Response;
  }) as typeof fetch;
};

const setEnv = (values: Record<string, string>): void => {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
};

const clearEnv = (...keys: string[]): void => {
  for (const key of keys) delete process.env[key];
};

beforeEach(stubFetch);

afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ------------------------------------------------------------------ helpers */

describe('env', () => {
  afterEach(() => clearEnv('EDLY_TEST_VAR'));

  it('returns an empty string for something optional that is missing', () => {
    clearEnv('EDLY_TEST_VAR');
    expect(env('EDLY_TEST_VAR')).toBe('');
  });

  it('names the variable when something required is missing', () => {
    clearEnv('EDLY_TEST_VAR');
    /* the message is the whole diagnostic when a deploy fails at 3am */
    expect(() => env('EDLY_TEST_VAR', true)).toThrow('Missing env var EDLY_TEST_VAR');
  });

  it('treats an empty value as missing, because a blank dashboard field is not a value', () => {
    setEnv({ EDLY_TEST_VAR: '' });
    expect(() => env('EDLY_TEST_VAR', true)).toThrow(/Missing env var/);
  });
});

describe('TokenCache', () => {
  it('fetches once and reuses the token', async () => {
    const cache = new TokenCache();
    let fetched = 0;
    const get = () => cache.get(async () => ({ token: `t${++fetched}`, ttlSeconds: 3600 }));

    expect(await get()).toBe('t1');
    expect(await get()).toBe('t1');
    expect(fetched).toBe(1);
  });

  it('fetches again once the token is nearly expired', async () => {
    const cache = new TokenCache();
    let fetched = 0;
    /* a 30s ttl is inside the 60s safety margin, so it must never be reused */
    const get = () => cache.get(async () => ({ token: `t${++fetched}`, ttlSeconds: 30 }));

    expect(await get()).toBe('t1');
    expect(await get()).toBe('t2');
  });

  it('defaults a missing ttl to an hour rather than to zero', async () => {
    const cache = new TokenCache();
    let fetched = 0;
    const get = () => cache.get(async () => ({ token: `t${++fetched}`, ttlSeconds: 0 }));

    expect(await get()).toBe('t1');
    expect(await get()).toBe('t1');
  });
});

/* ------------------------------------------------------------ Google Sheets */

describe('Google Sheets', () => {
  let pem: string;

  beforeAll(async () => {
    /* a real key, so the PEM stripping, the pkcs8 import and the RS256 signing all run */
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    let binary = '';
    for (const byte of pkcs8) binary += String.fromCharCode(byte);
    const base64 = btoa(binary).replace(/(.{64})/g, '$1\n');
    pem = `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
  });

  beforeEach(() => {
    setEnv({
      GOOGLE_SHEET_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      GOOGLE_SA_EMAIL: 'edly-estimator@project.iam.gserviceaccount.com',
      GOOGLE_SA_KEY: pem
    });
  });

  afterEach(() => clearEnv('GOOGLE_SHEET_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY'));

  /** Each test gets a fresh module, so the module-level token cache does not leak between them. */
  const provider = async () => {
    vi.resetModules();
    return (await import('../server/providers/gsheet')).gsheetProvider;
  };

  const authReply = { json: { access_token: 'ya29.test', expires_in: 3600 } };

  it('names the sheet without printing the whole id', async () => {
    expect((await provider()).label()).toBe('gsheet:1AbCdEfGhIjK…');
  });

  it('signs a JWT and exchanges it for a token', async () => {
    replies = [authReply, { json: { sheets: [] } }];

    await (await provider()).loadSheets();

    const auth = calls[0]!;
    expect(auth.url).toBe('https://oauth2.googleapis.com/token');
    expect(auth.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');

    const assertion = new URLSearchParams(auth.body).get('assertion') ?? '';
    const [header, claims] = assertion.split('.');
    /* base64url, not base64: a "+" or "/" in the signature makes Google reject the assertion */
    expect(assertion.split('.')).toHaveLength(3);
    expect(assertion).not.toMatch(/[+/=]/);
    expect(JSON.parse(atob(header!))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(atob(claims!))).toMatchObject({
      iss: 'edly-estimator@project.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token'
    });
  });

  it('says what Google said when the credentials are refused', async () => {
    replies = [{ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid JWT Signature' } }];
    await expect((await provider()).loadSheets()).rejects.toThrow(/Google auth failed: Invalid JWT Signature/);
  });

  it('reads every tab into a workbook', async () => {
    replies = [
      authReply,
      { json: { sheets: [{ properties: { title: 'Estimations' } }, { properties: { title: 'Requests' } }] } },
      { json: { valueRanges: [{ values: [['id', 'name'], ['EST-1', 'Acme']] }, { values: [['id'], ['RQ-01']] }] } }
    ];

    const workbook = await (await provider()).loadSheets();

    expect(workbook).toEqual({
      Estimations: [['id', 'name'], ['EST-1', 'Acme']],
      Requests: [['id'], ['RQ-01']]
    });
  });

  it('turns a blank Google cell into an empty string, not into "null"', async () => {
    replies = [
      authReply,
      { json: { sheets: [{ properties: { title: 'Estimations' } }] } },
      { json: { valueRanges: [{ values: [['id', null, undefined, 12]] }] } }
    ];

    const workbook = await (await provider()).loadSheets();
    expect(workbook?.Estimations?.[0]).toEqual(['id', '', '', '12']);
  });

  it('reports an untouched spreadsheet as nothing stored', async () => {
    replies = [authReply, { json: { sheets: [] } }];
    expect(await (await provider()).loadSheets()).toBeNull();
  });

  it('surfaces the 403 that means the sheet was never shared with the service account', async () => {
    /* the single most common setup mistake, and the message has to point at it */
    replies = [authReply, { status: 403, text: '{"error":{"message":"The caller does not have permission"}}' }];

    await expect((await provider()).loadSheets()).rejects.toThrow(/Sheets 403.*does not have permission/s);
  });

  it('creates missing tabs, then clears, then writes', async () => {
    replies = [authReply, { json: { sheets: [{ properties: { title: 'Estimations', sheetId: 0 } }] } }, { json: {} }, { json: {} }, { json: {} }];

    const result = await (await provider()).saveSheets({
      Estimations: [['id'], ['EST-1']],
      Requests: [['id'], ['RQ-01']]
    });

    const urls = calls.map((call) => call.url);
    expect(urls[2]).toContain(':batchUpdate');
    expect(JSON.parse(calls[2]!.body)).toEqual({ requests: [{ addSheet: { properties: { title: 'Requests' } } }] });

    /* clear before write, or a shorter list leaves the deleted rows sitting underneath it */
    expect(urls[3]).toContain('/values:batchClear');
    expect(urls[4]).toContain('/values:batchUpdate');

    expect(result.url).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz');
  });

  it('does not add a tab that is already there', async () => {
    replies = [
      authReply,
      { json: { sheets: [{ properties: { title: 'Estimations', sheetId: 0 } }] } },
      { json: {} },
      { json: {} }
    ];

    await (await provider()).saveSheets({ Estimations: [['id']] });

    expect(calls.map((call) => call.url).some((url) => url.includes(':batchUpdate') && !url.includes('values'))).toBe(false);
  });

  it('writes raw values, so a name beginning with = is not run as a formula', async () => {
    replies = [authReply, { json: { sheets: [{ properties: { title: 'Estimations', sheetId: 0 } }] } }, { json: {} }, { json: {} }];

    await (await provider()).saveSheets({ Estimations: [['=1+1']] });

    const write = calls.find((call) => call.url.includes('/values:batchUpdate'))!;
    expect(JSON.parse(write.body).valueInputOption).toBe('RAW');
  });

  it('quotes a tab name containing an apostrophe', async () => {
    replies = [authReply, { json: { sheets: [{ properties: { title: "Bob's tab", sheetId: 0 } }] } }, { json: {} }, { json: {} }];

    await (await provider()).saveSheets({ "Bob's tab": [['x']] });

    const write = calls.find((call) => call.url.includes('/values:batchUpdate'))!;
    expect(JSON.parse(write.body).data[0].range).toBe("'Bob''s tab'!A1");
  });

  it('describes the spreadsheet and its tabs for store:discover', async () => {
    replies = [authReply, { json: { properties: { title: 'Edly estimator state' }, sheets: [{ properties: { title: 'Estimations' } }] } }];

    const gsheet = await provider();
    expect(gsheet.discover).toBeDefined();
    expect(await gsheet.discover!()).toEqual([{ kind: 'gsheet', name: 'Edly estimator state', tabs: ['Estimations'] }]);
  });

  it('reuses one access token across calls', async () => {
    replies = [authReply, { json: { sheets: [] } }, { json: { sheets: [] } }];
    const gsheet = await provider();

    await gsheet.loadSheets();
    await gsheet.loadSheets();

    expect(calls.filter((call) => call.url.includes('oauth2.googleapis.com'))).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ Dropbox */

describe('Dropbox', () => {
  const provider = async () => {
    vi.resetModules();
    return (await import('../server/providers/dropbox')).dropboxProvider;
  };

  beforeEach(() => setEnv({ DROPBOX_PATH: '/Edly/edly-state.xlsx', DROPBOX_TOKEN: 'sl.static' }));
  afterEach(() => clearEnv('DROPBOX_PATH', 'DROPBOX_TOKEN', 'DROPBOX_REFRESH_TOKEN', 'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET'));

  it('reads the file with a static token', async () => {
    replies = [{ bytes: new Uint8Array([0x50, 0x4b, 3, 4]) }];

    const bytes = await (await provider()).load();

    expect(Array.from(bytes!)).toEqual([0x50, 0x4b, 3, 4]);
    expect(calls[0]?.headers.authorization).toBe('Bearer sl.static');
    expect(JSON.parse(calls[0]?.headers['dropbox-api-arg'] ?? '{}')).toEqual({ path: '/Edly/edly-state.xlsx' });
  });

  it('reads a 409 as "nothing stored yet", not as a failure', async () => {
    /* Dropbox answers 409 for a path that does not exist; treating it as an error would make a
       first run look broken instead of empty */
    replies = [{ status: 409 }];
    expect(await (await provider()).load()).toBeNull();
  });

  it('raises anything else, with the status and the reason', async () => {
    replies = [{ status: 401, text: 'expired_access_token' }];
    await expect((await provider()).load()).rejects.toThrow(/Dropbox read failed: 401 expired_access_token/);
  });

  it('adds the leading slash a path may be missing', async () => {
    setEnv({ DROPBOX_PATH: 'Edly/edly-state.xlsx' });
    replies = [{ status: 409 }];

    await (await provider()).load();

    expect(JSON.parse(calls[0]?.headers['dropbox-api-arg'] ?? '{}').path).toBe('/Edly/edly-state.xlsx');
  });

  it('overwrites on save rather than creating a second copy', async () => {
    replies = [{ json: { path_display: '/Edly/edly-state.xlsx' } }];

    const result = await (await provider()).save(new Uint8Array([1, 2, 3]));

    expect(JSON.parse(calls[0]?.headers['dropbox-api-arg'] ?? '{}')).toMatchObject({ mode: 'overwrite' });
    expect(result.pathname).toBe('/Edly/edly-state.xlsx');
  });

  it('exchanges a refresh token, which is the setup that does not expire', async () => {
    clearEnv('DROPBOX_TOKEN');
    setEnv({ DROPBOX_REFRESH_TOKEN: 'refresh-me', DROPBOX_APP_KEY: 'key', DROPBOX_APP_SECRET: 'secret' });
    replies = [{ json: { access_token: 'sl.fresh', expires_in: 14_400 } }, { status: 409 }];

    await (await provider()).load();

    expect(calls[0]?.url).toBe('https://api.dropbox.com/oauth2/token');
    expect(calls[0]?.headers.authorization).toBe(`Basic ${btoa('key:secret')}`);
    expect(calls[1]?.headers.authorization).toBe('Bearer sl.fresh');
  });

  it('asks for a token before it will do anything without one', async () => {
    clearEnv('DROPBOX_TOKEN');
    await expect((await provider()).load()).rejects.toThrow(/Missing env var DROPBOX_TOKEN/);
  });
});

/* ------------------------------------------------- OneDrive / SharePoint */

describe('OneDrive and SharePoint', () => {
  const provider = async () => {
    vi.resetModules();
    return (await import('../server/providers/graph')).graphProvider;
  };

  beforeEach(() =>
    setEnv({
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_DRIVE_ID: 'drive-1',
      MS_FILE_PATH: 'Edly/edly-state.xlsx'
    })
  );
  afterEach(() => clearEnv('MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_DRIVE_ID', 'MS_FILE_PATH'));

  const authReply = { json: { access_token: 'graph-token', expires_in: 3600 } };

  it('asks for a client-credentials token, so no human has to sign in', async () => {
    replies = [authReply, { status: 404 }];

    await (await provider()).load();

    expect(calls[0]?.url).toBe('https://login.microsoftonline.com/tenant/oauth2/v2.0/token');
    expect(calls[0]?.body).toContain('grant_type=client_credentials');
    expect(calls[0]?.body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
  });

  it('reads a 404 as "nothing stored yet"', async () => {
    replies = [authReply, { status: 404 }];
    expect(await (await provider()).load()).toBeNull();
  });

  it('builds the item URL from the drive and the path', async () => {
    replies = [authReply, { status: 404 }];

    await (await provider()).load();

    expect(calls[1]?.url).toBe('https://graph.microsoft.com/v1.0/drives/drive-1/root:/Edly/edly-state.xlsx:/content');
  });

  it('escapes a path segment with a space in it', async () => {
    setEnv({ MS_FILE_PATH: '/Edly Sales/edly state.xlsx' });
    replies = [authReply, { status: 404 }];

    await (await provider()).load();

    expect(calls[1]?.url).toContain('/root:/Edly%20Sales/edly%20state.xlsx:/content');
  });

  it('returns where the workbook landed after a write', async () => {
    replies = [authReply, { json: { name: 'edly-state.xlsx', webUrl: 'https://contoso.sharepoint.com/edly-state.xlsx' } }];

    const result = await (await provider()).save(new Uint8Array([1, 2, 3]));

    expect(calls[1]?.method).toBe('PUT');
    expect(result).toEqual({ pathname: 'edly-state.xlsx', url: 'https://contoso.sharepoint.com/edly-state.xlsx' });
  });

  it('explains an auth failure in Microsoft s own words', async () => {
    replies = [{ status: 401, json: { error_description: 'AADSTS7000215: Invalid client secret provided' } }];
    await expect((await provider()).load()).rejects.toThrow(/Graph auth failed: AADSTS7000215/);
  });

  it('lists the drives it can reach, so MS_DRIVE_ID need not be guessed', async () => {
    replies = [
      authReply,
      { json: { value: [{ id: 'site-1', displayName: 'Sales' }] } },
      { json: { value: [{ id: 'drive-a', name: 'Documents' }] } },
      { json: { value: [{ id: 'user-1', userPrincipalName: 'rep@edly.io' }] } },
      { json: { name: 'OneDrive', id: 'drive-b' } }
    ];

    const graph = await provider();
    expect(graph.discover).toBeDefined();
    expect(await graph.discover!()).toEqual([
      { kind: 'sharepoint', site: 'Sales', name: 'Documents', driveId: 'drive-a' },
      { kind: 'onedrive', site: 'rep@edly.io', name: 'OneDrive', driveId: 'drive-b' }
    ]);
  });
});
