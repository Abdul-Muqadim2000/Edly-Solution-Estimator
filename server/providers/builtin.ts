import { XLSX_MIME, type DiscoveredTarget, type FileProvider, type SaveResult } from './types.js';

/** Vercel Blob — for when you would rather not connect an account of your own. */
export const blobProvider: FileProvider = {
  kind: 'file',

  label: () => `vercel-blob:${process.env.EDLY_STATE_BLOB ?? 'edly-state.xlsx'}`,

  async load(): Promise<Uint8Array | null> {
    const url = await currentUrl();
    if (!url) return null;
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  },

  async save(bytes: Uint8Array): Promise<SaveResult> {
    const response = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(key())}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token()}`,
        'x-api-version': '7',
        'x-content-type': XLSX_MIME,
        'x-add-random-suffix': '0',
        'x-cache-control-max-age': '0'
      },
      body: bytes as unknown as BodyInit
    });
    if (!response.ok) throw new Error(`Blob write failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) as SaveResult;
  },

  async discover(): Promise<DiscoveredTarget[]> {
    return [{ kind: 'blob', name: key(), url: (await currentUrl()) ?? '' }];
  }
};

const key = (): string => process.env.EDLY_STATE_BLOB ?? 'edly-state.xlsx';
const token = (): string => process.env.BLOB_READ_WRITE_TOKEN ?? '';

async function currentUrl(): Promise<string | null> {
  const response = await fetch(`https://blob.vercel-storage.com/?prefix=${encodeURIComponent(key())}&limit=1`, {
    headers: { authorization: `Bearer ${token()}`, 'x-api-version': '7' }
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { blobs?: { pathname: string; url: string }[] };
  const hit = (body.blobs ?? []).find((blob) => blob.pathname === key()) ?? (body.blobs ?? [])[0];
  return hit?.url ?? null;
}

/** Local file — what `vite dev` uses when no cloud credentials are set. */
export const localProvider: FileProvider = {
  kind: 'file',

  label: () => `local-file:${localPath()}`,

  async load(): Promise<Uint8Array | null> {
    try {
      const { readFile } = await import('node:fs/promises');
      return new Uint8Array(await readFile(localPath()));
    } catch {
      return null;
    }
  },

  /* Written beside the file and renamed over it, never rewritten in place. A read that landed while
     the file was truncated and half written parsed as a workbook missing sheets or rows, and a tab
     that hydrated from that saved it back over everything. A rename swaps the whole file at once, so
     a read sees the old workbook or the new one. */
  async save(bytes: Uint8Array): Promise<SaveResult> {
    const { writeFile, mkdir, rename, rm } = await import('node:fs/promises');
    const path = localPath();
    const dir = path.replace(/[^/\\]+$/, '');
    if (dir) await mkdir(dir, { recursive: true });
    const draft = `${path}.${process.pid}-${(savesMade += 1)}.tmp`;
    await writeFile(draft, bytes);
    try {
      await rename(draft, path);
    } catch (error) {
      await rm(draft, { force: true });
      throw error;
    }
    return { pathname: path };
  },

  async discover(): Promise<DiscoveredTarget[]> {
    return [{ kind: 'local', name: localPath() }];
  }
};

const localPath = (): string => process.env.EDLY_STATE_PATH ?? './data/edly-state.xlsx';
/** Numbers each save's temporary file, so two saves in flight never write the same one. */
let savesMade = 0;
