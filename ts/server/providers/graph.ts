import { env, TokenCache, XLSX_MIME, type DiscoveredTarget, type FileProvider, type SaveResult } from './types';

/**
 * Microsoft 365 — OneDrive or SharePoint, via Graph.
 * The workbook is a real .xlsx in your own drive: open it in Excel, keep version history, share it.
 *
 *   EDLY_STORE=graph
 *   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET
 *   MS_DRIVE_ID        run `bun run store:discover` to find it
 *   MS_FILE_PATH       e.g. Edly/edly-state.xlsx
 *
 * The app registration needs the APPLICATION permission Files.ReadWrite.All with admin consent:
 * client-credentials, so it works without an interactive sign-in.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const cache = new TokenCache();

const token = (): Promise<string> =>
  cache.get(async () => {
    const body = new URLSearchParams({
      client_id: env('MS_CLIENT_ID', true),
      client_secret: env('MS_CLIENT_SECRET', true),
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    });
    const response = await fetch(`https://login.microsoftonline.com/${env('MS_TENANT_ID', true)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const json = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !json.access_token) throw new Error(`Graph auth failed: ${json.error_description ?? response.status}`);
    return { token: json.access_token, ttlSeconds: json.expires_in ?? 3600 };
  });

const itemUrl = (): string => {
  const drive = env('MS_DRIVE_ID', true);
  const path = env('MS_FILE_PATH', true).replace(/^\/+/, '');
  return `${GRAPH}/drives/${drive}/root:/${path.split('/').map(encodeURIComponent).join('/')}`;
};

export const graphProvider: FileProvider = {
  kind: 'file',

  label: () => `onedrive:${process.env.MS_FILE_PATH ?? '?'}`,

  async load(): Promise<Uint8Array | null> {
    const response = await fetch(`${itemUrl()}:/content`, { headers: { authorization: `Bearer ${await token()}` } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Graph read failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    return new Uint8Array(await response.arrayBuffer());
  },

  async save(bytes: Uint8Array): Promise<SaveResult> {
    /* single PUT handles anything under 4 MB; the state workbook is far smaller */
    const response = await fetch(`${itemUrl()}:/content`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': XLSX_MIME },
      body: bytes as unknown as BodyInit
    });
    if (!response.ok) throw new Error(`Graph write failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    const json = (await response.json()) as { name?: string; webUrl?: string };
    return { pathname: json.name ?? null, url: json.webUrl ?? null };
  },

  /** Lists drives you can reach, so MS_DRIVE_ID need not be guessed. */
  async discover(): Promise<DiscoveredTarget[]> {
    const bearer = `Bearer ${await token()}`;
    const out: DiscoveredTarget[] = [];

    const sites = await fetch(`${GRAPH}/sites?search=`, { headers: { authorization: bearer } });
    if (sites.ok) {
      const body = (await sites.json()) as { value?: { id: string; displayName?: string; name?: string }[] };
      for (const site of (body.value ?? []).slice(0, 10)) {
        const drives = await fetch(`${GRAPH}/sites/${site.id}/drives`, { headers: { authorization: bearer } });
        if (!drives.ok) continue;
        const list = (await drives.json()) as { value?: { id: string; name: string }[] };
        for (const drive of list.value ?? []) {
          out.push({ kind: 'sharepoint', site: site.displayName ?? site.name ?? '', name: drive.name, driveId: drive.id });
        }
      }
    }

    const users = await fetch(`${GRAPH}/users?$top=10&$select=id,userPrincipalName`, { headers: { authorization: bearer } });
    if (users.ok) {
      const body = (await users.json()) as { value?: { id: string; userPrincipalName: string }[] };
      for (const user of body.value ?? []) {
        const drive = await fetch(`${GRAPH}/users/${user.id}/drive`, { headers: { authorization: bearer } });
        if (!drive.ok) continue;
        const info = (await drive.json()) as { name?: string; id?: string };
        out.push({ kind: 'onedrive', site: user.userPrincipalName, name: info.name ?? '', driveId: info.id ?? '' });
      }
    }

    return out;
  }
};
