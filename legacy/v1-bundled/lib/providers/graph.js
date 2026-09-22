/* Microsoft 365 — OneDrive or SharePoint, via Graph.
   The workbook is a real .xlsx in your own drive: open it in Excel, edit it, share it.

   Env:
     EDLY_STORE=graph
     MS_TENANT_ID=...                 Directory (tenant) ID
     MS_CLIENT_ID=...                 App registration (client) ID
     MS_CLIENT_SECRET=...             Client secret value
     MS_DRIVE_ID=...                  Target drive (see scripts/store.js discover)
     MS_FILE_PATH=Edly/edly-state.xlsx

   App registration needs the APPLICATION permission Files.ReadWrite.All with admin consent
   (client-credentials flow — no interactive sign-in, so it works in a serverless function). */

const GRAPH = 'https://graph.microsoft.com/v1.0';

const env = (k, required) => {
  const v = process.env[k];
  if (!v && required) throw new Error('Missing env var ' + k);
  return v || '';
};

let cached = { token: '', expires: 0 };

async function token() {
  if (cached.token && Date.now() < cached.expires - 60000) return cached.token;
  const tenant = env('MS_TENANT_ID', true);
  const body = new URLSearchParams({
    client_id: env('MS_CLIENT_ID', true),
    client_secret: env('MS_CLIENT_SECRET', true),
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const res = await fetch('https://login.microsoftonline.com/' + tenant + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Graph auth failed: ' + (json.error_description || res.status));
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

const itemUrl = () => {
  const drive = env('MS_DRIVE_ID', true);
  const path = env('MS_FILE_PATH', true).replace(/^\/+/, '');
  return GRAPH + '/drives/' + drive + '/root:/' + path.split('/').map(encodeURIComponent).join('/');
};

export const label = () => 'onedrive:' + (process.env.MS_FILE_PATH || '?');

export async function load() {
  const res = await fetch(itemUrl() + ':/content', {
    headers: { authorization: 'Bearer ' + (await token()) }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Graph read failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return new Uint8Array(await res.arrayBuffer());
}

export async function save(bytes) {
  /* files under 4 MB upload in one PUT; the state workbook is far smaller than that */
  const res = await fetch(itemUrl() + ':/content', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer ' + (await token()),
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    },
    body: bytes
  });
  if (!res.ok) throw new Error('Graph write failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  return { pathname: json.name, url: json.webUrl };
}

/** Lists drives you can reach, so you can find MS_DRIVE_ID without guessing. */
export async function discover() {
  const t = await token();
  const out = [];
  const sites = await fetch(GRAPH + '/sites?search=', { headers: { authorization: 'Bearer ' + t } });
  if (sites.ok) {
    const body = await sites.json();
    for (const site of (body.value || []).slice(0, 10)) {
      const dr = await fetch(GRAPH + '/sites/' + site.id + '/drives', { headers: { authorization: 'Bearer ' + t } });
      if (!dr.ok) continue;
      const drives = await dr.json();
      (drives.value || []).forEach(d => out.push({ kind: 'sharepoint', site: site.displayName || site.name, name: d.name, driveId: d.id }));
    }
  }
  const users = await fetch(GRAPH + '/users?$top=10&$select=id,userPrincipalName', { headers: { authorization: 'Bearer ' + t } });
  if (users.ok) {
    const body = await users.json();
    for (const u of body.value || []) {
      const dr = await fetch(GRAPH + '/users/' + u.id + '/drive', { headers: { authorization: 'Bearer ' + t } });
      if (!dr.ok) continue;
      const d = await dr.json();
      out.push({ kind: 'onedrive', site: u.userPrincipalName, name: d.name, driveId: d.id });
    }
  }
  return out;
}
