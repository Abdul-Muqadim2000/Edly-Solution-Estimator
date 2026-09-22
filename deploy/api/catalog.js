/* GET /api/catalog             -> what the served catalog workbook contains
   GET /api/catalog?format=xlsx -> the workbook itself

   The catalog is read-only at runtime: replace public/catalog-source.xlsx, or point
   EDLY_CATALOG_URL at a hosted copy, and the next load picks it up. */

import { readWorkbook } from '../lib/xlsx.js';
import { universal, json } from '../lib/handler.js';

async function catalogBytes(request) {
  const remote = process.env.EDLY_CATALOG_URL;
  if (remote) {
    const res = await fetch(remote, { cache: 'no-store' });
    if (!res.ok) throw new Error('catalog fetch failed: ' + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
  try {
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile('./public/catalog-source.xlsx'));
  } catch {
    /* deployed, the static file is served rather than bundled with the function — fetch it back */
    const origin = new URL(request.url, 'http://localhost').origin;
    const res = await fetch(origin + '/catalog-source.xlsx', { cache: 'no-store' });
    if (!res.ok) throw new Error('catalog not found (set EDLY_CATALOG_URL or ship public/catalog-source.xlsx)');
    return new Uint8Array(await res.arrayBuffer());
  }
}

export async function handle(request) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const url = new URL(request.url, 'http://localhost');
  try {
    const bytes = await catalogBytes(request);
    if (url.searchParams.get('format') === 'xlsx') {
      return new Response(bytes, {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment; filename="catalog-source.xlsx"',
          'cache-control': 'no-store'
        }
      });
    }
    const wb = await readWorkbook(bytes);
    const all = wb['All Components'] || [];
    return json({
      ok: true,
      source: process.env.EDLY_CATALOG_URL || 'public/catalog-source.xlsx',
      sheets: Object.keys(wb),
      allComponentsRows: all.length,
      bytes: bytes.length,
      note: 'The browser parses this workbook directly; this endpoint exists for checks and integrations.'
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export default universal(handle);
