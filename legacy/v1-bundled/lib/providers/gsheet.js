/* Google Sheets — the data lives in a spreadsheet in your own Drive, as real rows.
   Not a file the app overwrites: the app writes cell ranges, so the sheet stays live and
   anyone with access can open, filter and pivot it while the tool is running.

   Env:
     EDLY_STORE=gsheet
     GOOGLE_SHEET_ID=1AbC...                    from the sheet URL
     GOOGLE_SA_EMAIL=edly-estimator@project.iam.gserviceaccount.com
     GOOGLE_SA_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

   Setup: Google Cloud → enable Sheets API → create a service account → create a JSON key →
   then SHARE the spreadsheet with the service account email as Editor. */

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

const env = (k, required) => {
  const v = process.env[k];
  if (!v && required) throw new Error('Missing env var ' + k);
  return v || '';
};

const b64url = (bytes) => {
  let s = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToPkcs8(pem) {
  const body = pem.replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let cached = { token: '', expires: 0 };

async function token() {
  if (cached.token && Date.now() < cached.expires - 60000) return cached.token;
  const email = env('GOOGLE_SA_EMAIL', true);
  const key = env('GOOGLE_SA_KEY', true);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signingInput = header + '.' + claims;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', pemToPkcs8(key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = signingInput + '.' + b64url(new Uint8Array(sig));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Google auth failed: ' + (json.error_description || json.error || res.status));
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

const sheetId = () => env('GOOGLE_SHEET_ID', true);

async function api(path, init) {
  const res = await fetch(SHEETS + '/' + sheetId() + path, {
    ...init,
    headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json', ...((init || {}).headers || {}) }
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Sheets ' + res.status + ': ' + text.slice(0, 240));
  return text ? JSON.parse(text) : {};
}

export const label = () => 'gsheet:' + (process.env.GOOGLE_SHEET_ID || '?').slice(0, 12) + '…';

/** Reads every tab into { tabName: rows[][] } — same shape readWorkbook returns. */
export async function loadSheets() {
  const meta = await api('?fields=sheets(properties(title))');
  const titles = (meta.sheets || []).map(s => s.properties.title);
  if (!titles.length) return null;
  const q = titles.map(t => 'ranges=' + encodeURIComponent("'" + t.replace(/'/g, "''") + "'")).join('&');
  const body = await api('/values:batchGet?' + q + '&majorDimension=ROWS');
  const out = {};
  (body.valueRanges || []).forEach((vr, i) => {
    const rows = vr.values || [];
    out[titles[i]] = rows.map(r => r.map(c => (c == null ? '' : String(c))));
  });
  return out;
}

/** Replaces the contents of each named tab, creating tabs that don't exist yet. */
export async function saveSheets(sheets) {
  const names = Object.keys(sheets);
  const meta = await api('?fields=sheets(properties(sheetId,title))');
  const existing = {};
  (meta.sheets || []).forEach(s => { existing[s.properties.title] = s.properties.sheetId; });

  const missing = names.filter(n => existing[n] === undefined);
  if (missing.length) {
    await api(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: missing.map(title => ({ addSheet: { properties: { title } } })) })
    });
  }

  /* clear then write, so deleted rows actually disappear */
  await api('/values:batchClear', {
    method: 'POST',
    body: JSON.stringify({ ranges: names.map(n => "'" + n.replace(/'/g, "''") + "'") })
  });
  await api('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: names.map(n => ({
        range: "'" + n.replace(/'/g, "''") + "'!A1",
        majorDimension: 'ROWS',
        values: (sheets[n] || []).map(row => (row || []).map(c => (c == null ? '' : c)))
      }))
    })
  });
  return { pathname: 'https://docs.google.com/spreadsheets/d/' + sheetId(), url: 'https://docs.google.com/spreadsheets/d/' + sheetId() };
}

export async function discover() {
  const meta = await api('?fields=properties(title),sheets(properties(title,gridProperties(rowCount)))');
  return [{
    kind: 'gsheet',
    name: meta.properties ? meta.properties.title : '(untitled)',
    tabs: (meta.sheets || []).map(s => s.properties.title)
  }];
}
