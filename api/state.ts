import { discover, exportBytes, loadState, saveState, storeKind, storeLabel } from '../server/store';
import { coerceState, countRows, EMPTY_STATE } from '../server/schema';
import { json, universal } from '../server/handler';
import { XLSX_MIME } from '../server/providers/types';

/**
 * GET  /api/state              the whole store as JSON
 * PUT  /api/state              replace it
 * POST /api/state              same as PUT (sendBeacon can only POST)
 * GET  /api/state?format=xlsx  download it as a workbook
 * GET  /api/state?probe=1      which provider is in play, and whether it answers
 */

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url, 'http://localhost');

  try {
    if (request.method === 'GET') {
      if (url.searchParams.get('probe')) {
        let reachable = true;
        let detail: string | null = null;
        let targets: unknown[] = [];
        let hasData = false;
        try {
          hasData = (await loadState()) !== null;
          targets = await discover();
        } catch (error) {
          reachable = false;
          detail = String((error as Error).message ?? error);
        }
        return json({ ok: true, store: storeKind(), label: await storeLabel(), reachable, hasData, detail, targets });
      }

      if (url.searchParams.get('format') === 'xlsx') {
        return new Response((await exportBytes()) as Uint8Array<ArrayBuffer>, {
          headers: {
            'content-type': XLSX_MIME,
            'content-disposition': 'attachment; filename="edly-state.xlsx"',
            'cache-control': 'no-store'
          }
        });
      }

      const state = await loadState();
      return json({ ok: true, store: storeKind(), label: await storeLabel(), empty: state === null, state: state ?? EMPTY_STATE });
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Body must be JSON' }, 400);
      }
      if (!body || typeof body !== 'object') return json({ ok: false, error: 'Body must be an object' }, 400);

      const incoming = coerceState(body);

      /* A client that lost its data — cleared browser, failed boot, offline read — must not be
         able to blank the spreadsheet. Clearing is possible, but only deliberately. */
      if (countRows(incoming) === 0 && url.searchParams.get('force') !== '1') {
        const existing = countRows(await loadState());
        if (existing > 0) {
          return json(
            {
              ok: false,
              refused: true,
              error:
                `Refusing to replace ${existing} stored rows with an empty payload. ` +
                'Add ?force=1 if you really mean to clear the store.'
            },
            409
          );
        }
      }

      const result = await saveState(incoming);
      return json({
        ok: true,
        store: storeKind(),
        label: result.store,
        at: result.pathname ?? null,
        url: result.url ?? null,
        bytes: result.bytes,
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
  } catch (error) {
    return json({ ok: false, store: storeKind(), error: String((error as Error).message ?? error) }, 500);
  }
}

export default universal(handle);
