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

**State.** Five sheets, rewritten on every change:

| Sheet | Holds |
|---|---|
| `Estimations` | One row per deal, with selections/buffers/rates/plan in a `snapshotJson` column |
| `Requests` | The custom-estimate queue, including hours the desk returned |
| `EstimatedSolutions` | Anything the desk added to a catalog |
| `CustomBundles` | Bundle categories created in the app |
| `Settings` | Last platform, open estimation, display preferences, loaded catalogs |

Scalar columns stay readable so anyone can scan it in Excel; nested state sits in one JSON column
per row so the app round-trips losslessly. Download the live copy from `/api/state?format=xlsx`.

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

`vercel.json` builds with Bun, serves `dist/`, and pins the functions to Node 22 (needed for
`DecompressionStream` and `crypto.subtle`).

---

## Notes and limits

- **Sign-in is a demo gate** (`admin` / `admin`, client-side). Put Vercel Authentication or an SSO
  proxy in front of the deployment before it holds live client numbers.
- **`/api/state` is unauthenticated.** Anyone with the URL can read or overwrite your spreadsheet.
  The same gate fixes this.
- **Estimations are scoped per platform.** An Open edX estimation is invisible under Moodle; the desk
  only sees the platform it has open.
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
