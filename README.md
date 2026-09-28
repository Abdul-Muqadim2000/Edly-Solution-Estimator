# Edly Solution Estimator

Sales and estimation tool for Edly's consulting practices. Sales configures a client solution
bundle and gets hours, cost and a delivery plan; the estimation desk prices whatever isn't in the
catalog and sends it back.

No database. **The catalog is a spreadsheet, and all working data is written to a spreadsheet in
your own account** — OneDrive, SharePoint, Google Sheets or Dropbox, chosen with one environment
variable.

**React 18 · TypeScript (strict) · Vite · Bun · Vercel.** Two runtime dependencies: React and
React DOM. Everything else, including the `.xlsx` reader and writer, is written here.

---

## Quick start

```bash
bun install
bun run check          # typecheck + lint + tests
bun run state:seed     # creates ./data/edly-state.xlsx
bun dev                # http://localhost:3000
```

Sign in with `admin` / `admin`, pick a role, then pick a practice and platform.

| Command | Does |
|---|---|
| `bun dev` | Vite dev server, with `/api/*` mounted from `api/` |
| `bun run build` | typecheck then build to `dist/` |
| `bun run check` | `typecheck` + `lint` + `test` — run before every commit |
| `bun run test:watch` | Vitest in watch mode |
| `bun run store:probe` | names the configured store and says whether it answers |
| `bun run store:discover` | lists drives/sheets you can write to |
| `bun run state:dump` | prints what is stored |

There are also two no-toolchain browser test runners — see **VERIFY.md**. They run the real
sources with no install step, and they are what caught the two bugs listed at the end of this file.

Read **ARCHITECTURE.md** before your first change, and **CONTRIBUTING.md** for the conventions.

## What is in this repository

The app is at the root. Two folders beside it are not part of the build:

| Path | |
|---|---|
| `src/` `server/` `api/` `tests/` `scripts/` `public/` | **The app.** See ARCHITECTURE.md. |
| `legacy/` | The two superseded generations, kept for reference. Not built, linted or deployed — see `legacy/README.md`. |
| `docs/source-material/` | The original brief, the source spreadsheets and the design screenshots the app was built from. |

---

## Choosing where the data lives

Set `EDLY_STORE` to `graph`, `gsheet`, `dropbox`, `blob` or `local`. Leave it unset and the app
detects whichever credentials are present, falling back to a local file in development.

Add the variables in **Vercel → Settings → Environment Variables**, redeploy, then confirm with
`bun run store:probe` or `GET /api/state?probe=1`.

### OneDrive / SharePoint — a real `.xlsx` in your Microsoft 365 drive

```
EDLY_STORE=graph
MS_TENANT_ID=…        Microsoft Entra ID → Overview → Tenant ID
MS_CLIENT_ID=…        App registrations → New registration
MS_CLIENT_SECRET=…    → Certificates & secrets → New client secret (the Value)
MS_DRIVE_ID=…         run: bun run store:discover
MS_FILE_PATH=Edly/edly-state.xlsx
```

The app registration needs **Microsoft Graph → Application permissions → `Files.ReadWrite.All`**
with admin consent. Application permissions, not delegated — that's what lets a serverless
function write without an interactive sign-in.

### Google Sheets — live rows in a spreadsheet you own

The nicest to work with: the app writes cell ranges, not a file, so the sheet stays live while the
tool runs. Filter it, pivot it, chart it.

```
EDLY_STORE=gsheet
GOOGLE_SHEET_ID=1AbC…
GOOGLE_SA_EMAIL=edly-estimator@your-project.iam.gserviceaccount.com
GOOGLE_SA_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
```

Google Cloud → enable the **Sheets API** → create a **service account** → create a **JSON key**,
then **share the spreadsheet with that service-account email as Editor**. That last step is the one
people miss.

### Dropbox

```
EDLY_STORE=dropbox
DROPBOX_PATH=/Edly/edly-state.xlsx
DROPBOX_REFRESH_TOKEN=…   preferred: doesn't expire
DROPBOX_APP_KEY=…
DROPBOX_APP_SECRET=…
```

### Vercel Blob — when you'd rather not connect an account

Dashboard → Storage → Create → Blob, connect it, and `BLOB_READ_WRITE_TOKEN` is injected.

---

## The two spreadsheets

| | Role | Written by |
|---|---|---|
| `public/catalog-source.xlsx` | The solution catalog — bundles, solutions, hours, deployment times | You, in Excel |
| your state spreadsheet | Estimations, custom requests, desk-added solutions, rate cards, delivery plans | The app |

**Catalog.** Replace the file and redeploy; the browser parses it on load and the whole app
follows — search, bundle counts, totals. Add a row and it appears; change an hours cell and open
estimations recalculate. Set `EDLY_CATALOG_URL` to a hosted copy to update it without a deploy.

Only Open edX uses that sheet. The other 19 platforms ship benchmark catalogs in
`src/data/practices.ts` and are labelled *Sample* throughout — load a sheet for one of them through
the in-app **📚 Catalog** panel to replace it.

### Importing bundles and estimates

The catalog holds two kinds of thing, and the catalog page filters and colours them apart:

- **Bundles**: features Edly built for a client before and delivers again for less. Their hours
  are a record.
- **Estimates**, in violet: work the estimation desk priced, or that was priced for an earlier
  client, and never built. Their hours are a forecast.

Both come in through **📚 Catalog → Import from Excel** in the builder (estimates also from the
desk's *Add to catalog* tab). Pick the kind, pick the file, read what it would do, then apply it.
Each kind has a template to download from the same dialog, with example rows in grey. Their IDs
start `EXAMPLE`, and the import always leaves them out, so they can stay or go.

**A bundles workbook** is the master sheet's format: a *Bundle Catalog* sheet (Bundle ID, Bundle,
pitch, "offer when") and an *All Components* sheet (Bundle ID, Solution ID, Feature,
First-delivery hrs, plus Status, What it does, Repeat config hrs, Original build hrs and
Notes/Assumptions), with a `B01 …` sheet per bundle if you like. It can be **added** to the catalog, updating the solutions it
names and keeping the rest, or it can **replace** the catalog. A Bundle ID the catalog already uses
for a different bundle is a decision in the review: a new bundle under a free ID, or the existing
one. An imported catalog stays
in place over the sheet served beside the app, across reloads.

**An estimates workbook** is one sheet named *Estimates*, headers in one row, one estimate per row.
*Feature* and *First-delivery hrs* are required. *What it does* and *Estimated for* (the client) are
recommended. The optional columns are *Estimate ID*, *Repeat hrs*, *Bundle ID*, *Area*,
*Category*, *Sub category*, *Delivery form*, *Std deployment time*, *Integrations*,
*3rd-party account*, *Notes/Assumptions*, *Estimated by* and *Estimated on*. A row goes
under its Bundle ID, else under the bundle its Area names (a new bundle if none matches), else to
*Unassigned estimates*, where the desk files it. Importing the same file again updates rows by
Estimate ID, or by Feature and Estimated for, instead of adding them twice, and the desk can remove
a whole import.

**Nothing is saved until you review it.** After the checks, the file's rows are shown as groups:
rows going into an existing bundle, a new bundle per Area (or per new Bundle ID), a Bundle ID the
catalog uses for a different bundle, and Unassigned. Approve each group or leave it out; rename a
new bundle, or send the whole group into another bundle; open a group to move single rows or
untick them. Import stays disabled until every group is decided, and "Approve all remaining" is
there for a large file.

Imports are strict. A file of the wrong kind, a missing required column, a duplicate solution ID,
negative hours or a sheet with nothing to import is refused with the reason. Hours that are not a
plain number ("40-60", "TBC"), an unknown status or a missing recommended column are listed as
warnings, and the row is skipped or read as the warning says.

**State.** Five sheets, rewritten on every change:

| Sheet | Holds |
|---|---|
| `Estimations` | One row per deal, with a URL `slug` and selections/buffers/rates/plan in a `snapshotJson` column |
| `Requests` | The custom-estimate queue, including hours the desk returned |
| `EstimatedSolutions` | Anything the desk added to a catalog, and estimates imported from a workbook (with the file, its Estimate ID, the client and who priced it) |
| `CustomBundles` | Bundle categories created in the app, including those an estimates workbook's Area column made |
| `Settings` | Last platform, open estimation, display preferences, loaded catalogs |

Scalar columns stay readable so anyone can scan it in Excel; nested state sits in one JSON column
per row so the app round-trips losslessly. Download the live copy from `/api/state?format=xlsx`.

### Notes and assumptions

Every solution, built bundle or estimate, has one optional **Notes / Assumptions** entry: scope
limits, assumptions and exclusions, written for the client.

- **Where it comes from.** A bundles workbook's *Notes/Assumptions* column (the master sheet's
  *Notes & limits* is read as the same thing), an estimates workbook's *Notes/Assumptions* column,
  and the estimation desk, when it prices a request or adds an estimate. The desk can reword an
  estimate's notes later, in *Estimates in the catalog*. Neither template requires the column, and
  a file without it imports without a warning.
- **Older files.** The first estimates template had *Notes & limits* and *Assumptions* as two
  columns, and the desk had two boxes. Both still load, joined into one entry, notes first.
- **A second import** of the same estimates file replaces an estimate's notes only where its row has
  some, so a file with no notes never wipes what the desk wrote in the app.
- **Where it goes.** The catalog row's details (they stay on while presenting, since they are
  written for the client), under a priced custom request in the estimate column, the printed quote,
  and the *Notes/Assumptions* column of the Excel task breakdown, before the caveats the sheet adds
  itself. In the builder's *Excel sheet* panel, each line's box starts with the solution's own text:
  what sales writes there replaces it on that client's sheet only, and clearing it leaves the line
  blank. *Each solution's own notes* switches all of them off at once.

---

## How persistence works

`src/state/useSync.ts` keeps the spreadsheet and the browser in step:

- on load, `GET /api/state` → hydrates the reducer
- on any change, debounced `PUT /api/state`
- every 45 seconds while the tab is visible, and on tab focus, it re-reads
- `beforeunload` fires a final beacon

Three rules protect the data, each of which failed at least once before it existed:

1. **Nothing is pushed before a read succeeds.** If the store is unreachable at boot, the pill goes
   red and nothing is saved, rather than letting an empty browser overwrite the spreadsheet.
2. **A background pull never overwrites unsaved local edits.** If both sides changed, the pill says
   so and asks for a reload instead of silently picking a winner.
3. **`PUT` refuses a zero-row payload** while the store holds data (`409`). `?force=1` clears it
   deliberately.

Concurrency is last-write-wins across the whole workbook — deliberate for a small sales team. If
two people will edit the same estimation at once, move `Estimations` to a real database and keep the
sheets as an export.

---

## Deploying

```bash
bun install -g vercel
vercel                 # links the project, first deploy
# add the env vars for your chosen store in the dashboard
vercel --prod
```

`vercel.json` builds with Bun, serves `dist/`, and gives `/api/tender` 300 seconds and the other
functions 15. The Node version is the project's Node.js setting in Vercel (22.x and 24.x both
work; the code needs 20 or later for `DecompressionStream` and `crypto.subtle`). Do not put a
`runtime` key in `vercel.json` for it: that key is for community runtimes written as
`package@version`, and anything else fails the build before it starts.

---

## Starting from a tender

"Start from a tender" on the practice picker or the estimations hub takes an RFP (PDF, Word, Excel
or text) and walks it through three steps: the AI reads it and recommends a platform, extracts the
requirements with the tender's own wording beside each, and matches them against the catalog. A
person approves each step. The last step creates the estimation with the accepted catalog solutions
picked, then sends whatever is custom to the estimation desk.

It needs one variable on the server:

```
ANTHROPIC_API_KEY=sk-ant-...     # from console.anthropic.com; never sent to the browser
EDLY_AI_MODEL=                   # optional, defaults to claude-opus-5-5
```

Before you set the key on a public deployment, turn on Vercel Authentication (or put an SSO proxy
in front): `/api/tender` is as open as `/api/state`, and it spends money. Give the key its own
Anthropic workspace with a monthly spend limit, so an open endpoint has a ceiling. Tender files go
to Anthropic's API and are deleted there when the desk requests go out (once every part has been
read), or after 72 hours at the latest. PDFs are limited to 4 MB for now. The details, and what is
still to come, are in DEFERRED.md.

---

## Notes and limits

- **Sign-in is a demo gate** (`admin` / `admin`, client-side). Put Vercel Authentication or an SSO
  proxy in front of the deployment before it holds live client numbers. Deep links make this more
  urgent, not less: a shared link names a deal, so the gate in front of it has to be real.
- **`/api/state` is unauthenticated.** Anyone with the URL can read or overwrite your spreadsheet.
  The same gate fixes this.
- **Estimations are scoped per platform.** An Open edX estimation is invisible under Moodle; the desk
  only sees the platform it has open. A URL carries the platform, so a link never crosses that line.
- **Every screen has a URL, and "Copy link" gives you one.** `/p/openedx/e/acme-academy/b/B03`
  opens that deal on that bundle. A link carries ids and slugs only — never hours, money or client
  names — so forwarding one cannot leak what "Present to client" hides. It is not an access grant
  either: whoever opens it still meets the same sign-in gate.
- **Benchmark catalogs are not delivery records.** Everything except Open edX carries sample hours
  gathered as industry benchmarks, labelled *Sample* in the UI.
- **Rate cards are per estimation** — set them on a deal and they travel with it.
- **Concurrency is last-write-wins** across the whole workbook. Fine for a small sales team; move
  `Estimations` to a database if two people will edit one deal at once.

## Verification status

Run in a browser against the real sources (see VERIFY.md):

- `tests/domain.test.ts` + `tests/schema.test.ts` — **33/33 assertions pass**, including the
  spreadsheet round-trip with a 112 KB catalog that chunks across cells.
- Full app walkthrough — **29/29 steps pass**, no uncaught errors: sign-in, practice/platform
  picker, desk, role swap, estimation creation, catalog parse (87 solutions from the real workbook),
  selection, rate card, role assignment, planner, presentation mode, plus four assertions that the
  branded chrome renders (marketing header, hero + stat cards + credibility row, sticky
  bundle-builder bar, footer), and two that drive real pointer and focus events to confirm hover
  and focus states actually fire.

A static pass stood in for `tsc`: it caught **seven real build errors** — `React.ReactNode` and
`React.PointerEvent` referenced in module files without importing React, which `tsc` rejects as
UMD-global access, and would have failed `bun run build`. Also fixed a type-shadowing bug the fix
itself introduced (React's synthetic `PointerEvent` masking the DOM one used by a native listener).

Still not run by me: `tsc --noEmit`, ESLint, `bun run build`, and the cloud storage providers
(they need real credentials — use `bun run store:probe`). **Run `bun run check` first.**

### Six things these runs found and fixed

1. **The catalog URL was absolute** (`/catalog-source.xlsx`), which 404s on any non-root deploy —
   and the `.catch()` swallowed the failure. Unlike the previous build, there is no bundled
   fallback for Open edX, so a salesperson would have seen an empty catalog with no explanation.
   Now resolved against `document.baseURI`, retried three times, and surfaced as a red banner.
2. **`fetchCatalog` used a dynamic `import('@/lib/xlsx')`** for a symbol it already imported
   statically. Vite resolves that alias, so it would have survived production — but it breaks under
   any consumer that does not rewrite aliases inside dynamic imports. Both needless dynamic imports
   are now static.
3. **Every hover and focus state was missing.** The source design declares 119 `style-hover` and
   58 `style-focus` states; React inline style objects cannot express `:hover` at all, so the
   first port silently had none — nothing lit up under the cursor anywhere in the app. Interaction
   state now lives in three shared places (`useHover`/`useFocus`, the `Button`/`Card`/`Link`
   primitives, and `index.css`), so every consumer gets it. Note that a focus ring uses
   `outline` + `box-shadow`, not `border-color`: these fields set `border` inline, and a
   stylesheet cannot reliably override an inline declaration.
4. **Three features existed only as dead code or not at all.** `addManualItem` sat in the reducer
   with no UI dispatching it, so sales could not add already-scoped custom work; the branded
   **XLSX estimate export** was never ported; and **copy summary to clipboard** was missing. All
   three are now wired, and the export respects the display preferences so "Present to client"
   cannot leak economics into a downloaded file.
5. **The builder layout was wrong.** The source design is a three-column full-height app shell —
   bundle rail | catalog table | dark estimate column, each scrolling independently — and the
   first port flattened it into two columns with the bundles as a row of pills above the catalog.
   Rebuilt to match, including all three breakpoints (`280px 1fr 400px` ≥1320px,
   `238px 1fr 344px` 1020–1320px, single column below, where the rail becomes a wrapping row)
   and the catalog as a real grid table so hours align down the right edge.
6. **The branded chrome was missing entirely.** The first port rebuilt the UI approximately instead
   of carrying the design across: no edly.io marketing header, no hero, no stat cards, no
   credibility row, no footer, and a generic builder bar. All of it is now ported from the source
   design — `SiteHeader`, `Hero`, `SiteFooter`, and the sticky `Bundle Builder` bar — with the
   real nav tree and links in `src/data/nav.ts`, and asserted in `verify-app.html` so it cannot
   silently regress.
