import { discover, exportBytes, loadState, loadStore, saveState, storeKind, storeLabel } from '../server/store.js';
import { publicPeople } from '../server/users.js';
import { coerceState, countRows, EMPTY_STATE, namesEveryRow } from '../server/schema.js';
import { json, universal } from '../server/handler.js';
import { XLSX_MIME } from '../server/providers/types.js';
import type { PersistedState, Tender } from '../src/types.js';

/**
 * GET  /api/state              the whole store as JSON, with who can sign in (names and roles only)
 * PUT  /api/state              replace it
 * POST /api/state              same as PUT (sendBeacon can only POST)
 * GET  /api/state?format=xlsx  download it as a workbook
 * GET  /api/state?probe=1      which provider is in play, and whether it answers
 */

/** Tenders from a client that does not know about key terms, with the stored ones' terms put back. */
function keepTerms(incoming: Tender[], stored: readonly Tender[]): Tender[] {
  const byId = new Map(stored.map((tender) => [tender.id, tender]));
  return incoming.map((tender) => {
    const was = byId.get(tender.id);
    if (!was || tender.readTerms !== undefined || tender.terms !== undefined || tender.termReads !== undefined) return tender;
    return {
      ...tender,
      ...(was.readTerms ? { readTerms: true } : {}),
      ...(was.terms ? { terms: was.terms } : {}),
      ...(was.termReads ? { termReads: was.termReads } : {})
    };
  });
}

/**
 * Deals and requests from a tab that does not know who is on them, with the stored people and ticket
 * events put back. Such a tab runs a build from before assignments and never read them, so each of
 * its saves would otherwise unassign everyone. A build that knows them says so (`knowsPeople`), and
 * then an absent field means nobody, which is how removing the last person is saved.
 */
function keepPeople(incoming: PersistedState, stored: PersistedState | null): void {
  const deals = new Map((stored?.estimations ?? []).map((one) => [one.id, one] as const));
  incoming.estimations = incoming.estimations.map((deal) => {
    const was = deals.get(deal.id);
    return was?.assigned && deal.assigned === undefined ? { ...deal, assigned: was.assigned } : deal;
  });
  const requests = new Map((stored?.requests ?? []).map((one) => [one.id, one] as const));
  incoming.requests = incoming.requests.map((request) => {
    const was = requests.get(request.id);
    if (!was) return request;
    const kept = { ...request };
    for (const key of ['assigned', 'by', 'staged', 'priced'] as const) {
      if (kept[key] === undefined && was[key] !== undefined) Object.assign(kept, { [key]: was[key] });
    }
    return kept;
  });
}

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

      /* `people` sits beside the state, not in it: no browser saves it back, and no hash is in it */
      const { state, users } = await loadStore();
      return json({ ok: true, store: storeKind(), label: await storeLabel(), empty: state === null, state: state ?? EMPTY_STATE, people: publicPeople(users) });
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
         able to blank the spreadsheet. Clearing is possible, but only deliberately: with ?force=1,
         or by naming every stored row as one a person deleted, which is how the last deal goes. */
      if (countRows(incoming) === 0 && url.searchParams.get('force') !== '1') {
        const stored = await loadState();
        const existing = countRows(stored);
        if (existing > 0 && !namesEveryRow(stored, (body as { deleted?: unknown }).deleted)) {
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

      /* A missing collection means "I do not know about this", not "delete it all". A tab still
         running a build from before tenders existed sends no `tenders` key, and reading that as an
         empty list would wipe every tender on each of its saves; a tab from before the sales and
         legal list sends no `salesLegal`, the same way. Checked after the guard above, so such a
         client's empty payload is still refused rather than let through on stored rows. */
      const sent = body as Record<string, unknown>;
      const unknown = { tenders: !Array.isArray(sent.tenders), salesLegal: !Array.isArray(sent.salesLegal) };
      if (unknown.tenders || unknown.salesLegal) {
        const stored = await loadState();
        if (unknown.tenders) incoming.tenders = stored?.tenders ?? [];
        if (unknown.salesLegal) {
          incoming.salesLegal = stored?.salesLegal ?? [];
          /* The same build reads tenders but not their key terms, which came with the list, so each
             tender it saves would lose them. A build that knows them never takes them away, so
             keeping the stored ones cannot undo anything a person did. */
          incoming.tenders = keepTerms(incoming.tenders, stored?.tenders ?? []);
        }
      }

      if ((body as { knowsPeople?: unknown }).knowsPeople !== true) keepPeople(incoming, await loadState());

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
          tenders: incoming.tenders.length,
          salesLegal: incoming.salesLegal.length,
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
