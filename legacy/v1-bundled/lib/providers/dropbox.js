/* Dropbox — the simplest of the three to set up: one token, one path.

   Env:
     EDLY_STORE=dropbox
     DROPBOX_TOKEN=sl.xxxx            App console → Generate access token
     DROPBOX_PATH=/Edly/edly-state.xlsx

   A generated token is short-lived. For a long-running deployment create an app with
   files.content.write + files.content.read and set DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY and
   DROPBOX_APP_SECRET instead — this module prefers those when present. */

const env = (k, required) => {
  const v = process.env[k];
  if (!v && required) throw new Error('Missing env var ' + k);
  return v || '';
};

let cached = { token: '', expires: 0 };

async function token() {
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  if (!refresh) return env('DROPBOX_TOKEN', true);
  if (cached.token && Date.now() < cached.expires - 60000) return cached.token;
  const basic = btoa(env('DROPBOX_APP_KEY', true) + ':' + env('DROPBOX_APP_SECRET', true));
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { authorization: 'Basic ' + basic, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh })
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Dropbox auth failed: ' + (json.error_description || res.status));
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in || 14400) * 1000 };
  return cached.token;
}

const path = () => {
  const p = env('DROPBOX_PATH', true);
  return p.startsWith('/') ? p : '/' + p;
};

export const label = () => 'dropbox:' + (process.env.DROPBOX_PATH || '?');

export async function load() {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + (await token()),
      'Dropbox-API-Arg': JSON.stringify({ path: path() })
    }
  });
  if (res.status === 409) return null; /* path not found */
  if (!res.ok) throw new Error('Dropbox read failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return new Uint8Array(await res.arrayBuffer());
}

export async function save(bytes) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + (await token()),
      'content-type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: path(), mode: 'overwrite', mute: true, strict_conflict: false })
    },
    body: bytes
  });
  if (!res.ok) throw new Error('Dropbox write failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  return { pathname: json.path_display, url: null };
}

export async function discover() {
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + (await token()) }
  });
  if (!res.ok) throw new Error('Dropbox check failed: ' + res.status);
  const me = await res.json();
  return [{ kind: 'dropbox', name: me.name ? me.name.display_name : '(account)', path: path() }];
}
