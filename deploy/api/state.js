/* GET  /api/state             -> the whole store as JSON
   PUT  /api/state             -> replace it
   POST /api/state             -> same as PUT (sendBeacon can only POST)
   GET  /api/state?format=xlsx -> download it as a workbook
   GET  /api/state?probe=1     -> which provider is in play, and whether it answers

   The store is whatever EDLY_STORE points at: a workbook in your OneDrive, a Google Sheet you
   own, Dropbox, Vercel Blob, or a local file in development. */

import { loadState, saveState, exportBytes, storeLabel, storeKind, discover } from '../lib/store.js';
import { EMPTY_STATE } from '../lib/schema.js';
import { universal, json } from '../lib/handler.js';

const asArray = v => (Array.isArray(v) ? v : []);

export async function handle(request) {
  const url = new URL(request.url, 'http://localhost');

  try {
    if (request.method === 'GET') {
      if (url.searchParams.get('probe')) {
        let reachable = true, detail = null, targets = [], hasData = false;
        try {
          const state = await loadState();
          hasData = !!state;
          targets = await discover();
        } catch (err) {
          reachable = false;
          detail = String(err.message || err);
        }
        return json({ ok: true, store: storeKind(), label: await storeLabel(), reachable, hasData, detail, targets });
      }

      if (url.searchParams.get('format') === 'xlsx') {
        return new Response(await exportBytes(), {
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'content-disposition': 'attachment; filename="edly-state.xlsx"',
            'cache-control': 'no-store'
          }
        });
      }

      const state = await loadState();
      return json({
        ok: true,
        store: storeKind(),
        label: await storeLabel(),
        empty: !state,
        state: state || EMPTY_STATE
      });
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Body must be JSON' }, 400);
      }
      if (!body || typeof body !== 'object') return json({ ok: false, error: 'Body must be an object' }, 400);

      /* refuse a write that would wipe a populated store with nothing — a client that lost its
         data (cleared browser, failed boot) must not be able to blank the spreadsheet */
      const incoming = {
        estimations: asArray(body.estimations),
        requests: asArray(body.requests),
        solutions: asArray(body.solutions),
        bundles: asArray(body.bundles),
        settings: body.settings && typeof body.settings === 'object' ? body.settings : {}
      };
      const incomingEmpty = !incoming.estimations.length && !incoming.requests.length
        && !incoming.solutions.length && !incoming.bundles.length;
      if (incomingEmpty && url.searchParams.get('force') !== '1') {
        const existing = await loadState();
        const existingRows = existing
          ? existing.estimations.length + existing.requests.length + existing.solutions.length + existing.bundles.length
          : 0;
        if (existingRows > 0) {
          return json({
            ok: false,
            refused: true,
            error: 'Refusing to replace ' + existingRows + ' stored rows with an empty payload. '
              + 'Add ?force=1 if you really mean to clear the store.'
          }, 409);
        }
      }

      const out = await saveState(incoming);
      return json({
        ok: true,
        store: storeKind(),
        label: out.store,
        at: out.pathname || null,
        url: out.url || null,
        bytes: out.bytes,
        counts: {
          estimations: incoming.estimations.length,
          requests: incoming.requests.length,
          solutions: incoming.solutions.length,
          bundles: incoming.bundles.length,
          settings: Object.keys(incoming.settings).length
        }
      });
    }

    return json({ ok: false, error: 'Method not allowed' }, 405);
  } catch (err) {
    return json({ ok: false, store: storeKind(), error: String((err && err.message) || err) }, 500);
  }
}

export default universal(handle);
