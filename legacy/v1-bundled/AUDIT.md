# Audit — 22 September 2026

Read of every file in this package before first deploy, with the fixes applied. `bun run check`
reproduces the evidence for the data-integrity items.

## Problems found and fixed

**1. A loaded catalog was never saved.** `edly-catalog-sheet-v1` — the workbook a user loads by
hand through the in-app Catalog panel — was missing from the sync bridge's key list. Anyone who
loaded an updated Open edX sheet would have had it live only in their own browser, and lost on a
cache clear. Now synced.

**2. Long values were silently truncated.** Excel caps a cell at 32,767 characters, Google Sheets
at 50,000. A loaded catalog serialises to ~110,000. Both `edly-catalog-sheet-v1` and
`edly-catalog-sheetmap-v1` exceeded the cap, so the tail of the JSON was cut and the value failed
to parse on read — a total loss of that setting, with no error. Values now split across numbered
rows (`key##1/4`) and rejoin on read.

**3. Chunk boundaries were corrupted by cell trimming.** Once chunking was in, the reader's
`.trim()` on every cell ate a space that happened to land on a boundary, corrupting the rejoined
JSON. Found by the round-trip test, not by inspection. Each chunk is now pipe-wrapped so its edges
survive trimming.

**4. An empty client could wipe the spreadsheet.** Two paths led here: the sync bridge would push
local state even when the initial read had failed (offline, cold start, a 500 from the store), and
the API accepted any payload including an empty one. A colleague opening the app on a flaky
connection could have replaced every estimation with nothing.
- The bridge now refuses to push until a read has succeeded, and retries the read with backoff.
- `PUT /api/state` rejects a payload with zero rows when the store holds data — `409`, with
  `?force=1` as the deliberate escape hatch.

**5. The API handlers would not have run on Vercel.** They were written web-style
(`Request` → `Response`), which is the Edge convention; Vercel's Node runtime invokes `/api/*.js`
as `(req, res)`. The endpoints would have failed on the first request after deploy. `lib/handler.js`
now adapts one handler to both conventions, so the same file serves `bun dev` and production. Also
removed a `Buffer` dependency from that path so it runs anywhere web streams exist.

**6. Background pulls could silently diverge.** The 45-second refresh wrote server data into
storage while the running app kept its own state in memory — the app would not see the update, then
overwrite it on the next change. A pull now applies only when nothing local has changed since the
last confirmed save; otherwise it says so and asks for a reload.

## Deliberately not synced

`edly-auth-v1` — who is signed in, and as which role. A session belongs to its browser; sharing it
through the spreadsheet would sign your colleagues in as you.

## Verified

`bun run check` covers:

- **Key coverage.** Every `edly-*` key the app reads or writes is scraped out of the built app and
  asserted present in the sync bridge. This test fails if a future change adds a key and forgets to
  sync it — the failure mode that caused problem 1.
- **Round-trip fidelity.** A fixture exercising every field: fractional hours (1,259.95), zero
  values, blank strings, a closed estimation with no deadline, per-line buffers, the rate card,
  line-to-role assignments, the delivery plan with pinned starts and headcounts, PM/QA overhead
  roles, manual custom items, an un-estimated request, both `direct` flags, and a 112,000-character
  loaded catalog. Compared with strict deep equality, not field spot-checks.
- **No coercion damage.** An un-estimated request must come back with *no* hours rather than zero —
  `0` would mean "estimated at nothing" and would join the totals. Asserted explicitly.
- **Chunking.** Payload over one cell, split into ≥4 rows, no cell over the cap, rejoined byte-exact.
- **API guards.** Empty store reads cleanly; write accepted; read-back preserves the snapshot and
  the big catalog; blank payload refused with 409; store survives that refusal; `?force=1` clears;
  `?format=xlsx` exports; `?probe=1` reports; unknown methods 405; a non-object body is rejected.
- **Both handler conventions**, GET and PUT, including response headers.
- **The catalog workbook** parses, yields ≥80 solution rows, and has no duplicate IDs.

## Still true, by design

- **Sign-in is a demo gate.** `admin` / `admin`, hard-coded client-side. It stops a passer-by, not
  an attacker. Put Vercel Authentication or an SSO proxy in front of the deployment before it holds
  live client numbers.
- **`/api/state` is unauthenticated.** Anyone with the URL can read or overwrite the spreadsheet.
  The same gate fixes this.
- **Last-write-wins** across the whole workbook. Two people editing different estimations is fine —
  the loser's tab shows "changed by someone else — reload to merge". Two people editing the *same*
  estimation simultaneously will lose one set of edits. If that becomes real, move `Estimations`
  into a database and keep the sheets as an export.
- **Benchmark catalogs are not delivery records.** Everything except Open edX carries sample hours
  gathered as industry benchmarks, labelled *Sample* throughout the UI.
- **The catalog is read-only at runtime.** Changing hours means replacing
  `public/catalog-source.xlsx` (or pointing `EDLY_CATALOG_URL` at a hosted copy), not editing in the
  app.

## Before you deploy

```bash
bun install
bun run check          # must print "all checks passed"
bun run store:probe    # after setting your store's env vars
```

Then `vercel`, add the environment variables, `vercel --prod`, and confirm the status pill in the
app bottom-left reads "saved to <your store>".
