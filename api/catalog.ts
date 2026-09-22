import { readWorkbook } from '../src/lib/xlsx';
import { json, universal } from '../server/handler';
import { XLSX_MIME } from '../server/providers/types';

/**
 * GET /api/catalog              what the served catalog workbook contains
 * GET /api/catalog?format=xlsx  the workbook itself
 *
 * The catalog is read-only at runtime: replace public/catalog-source.xlsx, or point
 * EDLY_CATALOG_URL at a hosted copy, and the next load picks it up.
 */

async function catalogBytes(request: Request): Promise<Uint8Array> {
  const remote = process.env.EDLY_CATALOG_URL;
  if (remote) {
    const response = await fetch(remote, { cache: 'no-store' });
    if (!response.ok) throw new Error(`catalog fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  try {
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile('./public/catalog-source.xlsx'));
  } catch {
    /* deployed, the static file is served rather than bundled with the function */
    const origin = new URL(request.url, 'http://localhost').origin;
    const response = await fetch(`${origin}/catalog-source.xlsx`, { cache: 'no-store' });
    if (!response.ok) throw new Error('catalog not found (set EDLY_CATALOG_URL or ship public/catalog-source.xlsx)');
    return new Uint8Array(await response.arrayBuffer());
  }
}

export async function handle(request: Request): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const url = new URL(request.url, 'http://localhost');
  try {
    const bytes = await catalogBytes(request);
    if (url.searchParams.get('format') === 'xlsx') {
      return new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          'content-type': XLSX_MIME,
          'content-disposition': 'attachment; filename="catalog-source.xlsx"',
          'cache-control': 'no-store'
        }
      });
    }
    const workbook = await readWorkbook(bytes);
    return json({
      ok: true,
      source: process.env.EDLY_CATALOG_URL ?? 'public/catalog-source.xlsx',
      sheets: Object.keys(workbook),
      allComponentsRows: (workbook['All Components'] ?? []).length,
      bytes: bytes.length,
      note: 'The browser parses this workbook directly; this endpoint exists for checks and integrations.'
    });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message ?? error) }, 500);
  }
}

export default universal(handle);
