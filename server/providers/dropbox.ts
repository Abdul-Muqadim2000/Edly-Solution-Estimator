import { env, TokenCache, type DiscoveredTarget, type FileProvider, type SaveResult } from './types';

/**
 * Dropbox — the simplest to set up: one token, one path.
 *
 *   EDLY_STORE=dropbox
 *   DROPBOX_PATH=/Edly/edly-state.xlsx
 *   DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY + DROPBOX_APP_SECRET   (preferred: never expires)
 *   or DROPBOX_TOKEN                                               (console token, expires in hours)
 */

const cache = new TokenCache();

const token = async (): Promise<string> => {
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  if (!refresh) return env('DROPBOX_TOKEN', true);
  return cache.get(async () => {
    const basic = btoa(`${env('DROPBOX_APP_KEY', true)}:${env('DROPBOX_APP_SECRET', true)}`);
    const response = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh })
    });
    const json = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !json.access_token) throw new Error(`Dropbox auth failed: ${json.error_description ?? response.status}`);
    return { token: json.access_token, ttlSeconds: json.expires_in ?? 14_400 };
  });
};

const path = (): string => {
  const value = env('DROPBOX_PATH', true);
  return value.startsWith('/') ? value : `/${value}`;
};

export const dropboxProvider: FileProvider = {
  kind: 'file',

  label: () => `dropbox:${process.env.DROPBOX_PATH ?? '?'}`,

  async load(): Promise<Uint8Array | null> {
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'Dropbox-API-Arg': JSON.stringify({ path: path() }) }
    });
    if (response.status === 409) return null; /* path not found */
    if (!response.ok) throw new Error(`Dropbox read failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    return new Uint8Array(await response.arrayBuffer());
  },

  async save(bytes: Uint8Array): Promise<SaveResult> {
    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: path(), mode: 'overwrite', mute: true, strict_conflict: false })
      },
      body: bytes as unknown as BodyInit
    });
    if (!response.ok) throw new Error(`Dropbox write failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    const json = (await response.json()) as { path_display?: string };
    return { pathname: json.path_display ?? null, url: null };
  },

  async discover(): Promise<DiscoveredTarget[]> {
    const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}` }
    });
    if (!response.ok) throw new Error(`Dropbox check failed: ${response.status}`);
    const me = (await response.json()) as { name?: { display_name?: string } };
    return [{ kind: 'dropbox', name: me.name?.display_name ?? '(account)', path: path() }];
  }
};
