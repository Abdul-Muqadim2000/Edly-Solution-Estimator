# Edly Solution Estimator

Sales and estimation tool for Edly's consulting practices. Sales configures a client bundle and
gets hours, cost and a delivery plan; the estimation desk prices whatever isn't in the catalog and
sends it back.

No database. **The catalog is a spreadsheet, and all working data is written to a spreadsheet in
your own account** — OneDrive, SharePoint, Google Sheets or Dropbox, chosen with one environment
variable.

Runs on **Bun**, deploys to **Vercel** as static files plus two serverless functions. Zero npm
dependencies.

---

## Quick start

```bash
bun install
bun run check        # must print "all checks passed" before you deploy
bun run state:seed   # creates ./data/edly-state.xlsx
bun dev              # http://localhost:3000
```

Sign in with `admin` / `admin`, pick a role, then pick a practice and platform.

```bash
bun run check            # data-integrity suite: key coverage, round-trip, API guards
bun run store:probe      # which store is configured, and can it be reached
bun run store:discover   # list drives / sheets you can write to
bun run state:dump       # print what is stored
```

See **AUDIT.md** for what was checked before the first deploy, what was fixed, and the limits that
remain by design.

---

## Choosing where the data lives

Set `EDLY_STORE` to one of `graph`, `gsheet`, `dropbox`, `blob`, `local`. Leave it unset and the app
detects whichever credentials are present, falling back to a local file in development.

Add the variables in **Vercel → your project → Settings → Environment Variables**, then redeploy.
`bun run store:probe` tells you whether they work before you trust them.

### OneDrive / SharePoint — a real `.xlsx` in your Microsoft 365 drive

The file behaves like any other document in your drive: open it in Excel, keep version history,
share it with whoever needs it.

```
EDLY_STORE=graph
MS_TENANT_ID=…          Azure portal → Microsoft Entra ID → Overview → Tenant ID
MS_CLIENT_ID=…          App registrations → New registration → Application (client) ID
MS_CLIENT_SECRET=…      → Certificates & secrets → New client secret (copy the Value)
MS_DRIVE_ID=…           run: bun run store:discover
MS_FILE_PATH=Edly/edly-state.xlsx
```

On the app registration, add **Microsoft Graph → Application permissions → `Files.ReadWrite.All`**
and grant admin consent. Application permissions (not delegated) are what let a serverless function
write without an interactive sign-in.

### Google Sheets — live rows in a spreadsheet you own

The nicest option to look at: the app writes cell ranges, not a file, so the sheet stays live while
the tool runs. Filter it, pivot it, chart it — it updates as your team estimates.

```
EDLY_STORE=gsheet
GOOGLE_SHEET_ID=1AbC…       from the sheet URL
GOOGLE_SA_EMAIL=edly-estimator@your-project.iam.gserviceaccount.com
GOOGLE_SA_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
```

Google Cloud → enable the **Sheets API** → create a **service account** → create a **JSON key**;
copy `client_email` and `private_key` from it. Then **share the spreadsheet with that service
account email as Editor** — this is the step people miss.

Paste the key with its `\n` sequences intact; Vercel's environment editor handles multi-line values
fine either way.

### Dropbox — a real `.xlsx` in your Dropbox

```
EDLY_STORE=dropbox
DROPBOX_PATH=/Edly/edly-state.xlsx
DROPBOX_REFRESH_TOKEN=…     preferred: doesn't expire
DROPBOX_APP_KEY=…
DROPBOX_APP_SECRET=…
```

A quick `DROPBOX_TOKEN=sl.…` from the app console also works, but those expire in hours.

### Vercel Blob — when you don't want to connect an account

Vercel dashboard → Storage → Create → Blob, connect it to the project, and
`BLOB_READ_WRITE_TOKEN` is injected for you. Download the workbook from `/api/state?format=xlsx`.

---

## The two spreadsheets

| | Role | Written by |
|---|---|---|
| `public/catalog-source.xlsx` | The solution catalog — bundles, solutions, hours, deployment times | You, in Excel |
| your state spreadsheet | Estimations, custom requests, desk-added solutions, rate cards, delivery plans | The app |

**Catalog.** Replace `public/catalog-source.xlsx` and redeploy; the browser parses it on load and
the whole app follows — search, bundle counts, totals, exports. Add a row and it appears; change an
hours cell and open estimations recalculate. Set `EDLY_CATALOG_URL` to a hosted copy to update the
catalog without a deploy.

Only Open edX uses that sheet. The other 19 platforms ship benchmark catalogs and are labelled
*Sample* throughout — load a sheet for one of them through the in-app **📚 Catalog** panel to
replace it.

**State.** Five tables, rewritten on every change:

| Sheet | Holds |
|---|---|
| `Estimations` | One row per deal — hours, cost, status, deadline, plus selections/buffers/rates/plan in a `snapshotJson` column |
| `Requests` | The custom-estimate queue, including hours the desk returned |
| `EstimatedSolutions` | Anything the desk added to a catalog |
| `CustomBundles` | Bundle categories created in the app |
| `Settings` | Last platform, open estimation, display preferences |

Scalar columns stay readable so anyone can scan it; the nested state sits in one JSON column per
row so the app round-trips it losslessly.

---

## How persistence works

The app keeps working state in browser storage under a few known keys. `public/sync.js` bridges
those keys to the store:

- on load, `GET /api/state` → writes the keys → the app boots with server data
- on any change, debounced `PUT /api/state` → the spreadsheet is rewritten
- every 45 seconds while the tab is visible it pulls again, so a teammate's edits arrive
- `beforeunload` fires a final beacon

Two rules protect the data:

1. **Nothing is pushed before a read succeeds.** If the store is unreachable at boot the app says
   so in red and saves nothing, rather than letting an empty browser overwrite the spreadsheet.
2. **A background pull never overwrites unsaved local edits.** If both sides changed, the pill reads
   "changed by someone else — reload to merge" instead of silently picking a winner.

The API adds a third: a PUT carrying zero rows is refused with 409 while the store holds data.
`?force=1` clears it deliberately.

A pill bottom-left reports the truth: *loaded from onedrive*, *saved to gsheet · 4 estimations*, or
*NOT SAVED* in red with the reason.

Concurrency is last-write-wins across the whole workbook — deliberate for a small sales team. If two
people will edit the same estimation at once, move `Estimations` into a real database and keep the
sheets as an export.

---

## Deploying

```bash
bun install -g vercel
vercel                 # links the project, first deploy
# add the env vars for your chosen store in the dashboard
vercel --prod
```

`vercel.json` pins the functions to Node 22 and marks `/api/*` as `no-store`.

---

## Layout

```
api/
  state.js        GET/PUT the store as JSON; ?format=xlsx to download; ?probe=1 to diagnose
  catalog.js      catalog introspection + download
lib/
  xlsx.js         dependency-free .xlsx reader and writer
  schema.js       app state <-> sheet rows (long values chunked across rows)
  handler.js      one endpoint, two calling conventions (Bun web + Vercel node)
  store.js        provider selection (graph | gsheet | dropbox | blob | local)
  providers/
    graph.js      OneDrive / SharePoint via Microsoft Graph
    gsheet.js     Google Sheets via a service account
    dropbox.js    Dropbox files API
public/
  index.html      the app, self-contained
  sync.js         storage <-> /api/state bridge
  catalog-source.xlsx
scripts/
  state.js        probe | discover | dump | seed
  check.js        data-integrity suite
AUDIT.md          pre-deploy audit: what was fixed, what is by design
server.js         local dev server (bun dev)
```

The Excel reader and writer are about 300 lines using `DecompressionStream` and a stored-zip
writer — both built into Bun and modern browsers, so there is nothing to install or audit.

---

## Notes and limits

- **Sign-in is a demo gate** (`admin` / `admin`, hard-coded client-side). Put real auth in front of
  this before it holds live client numbers — Vercel Authentication or an SSO proxy is enough.
- **`/api/state` is unauthenticated.** Anyone with the URL can read or overwrite your spreadsheet.
  Gate the deployment before sharing it.
- **Estimations are scoped per platform.** An Open edX estimation is invisible under Moodle; the desk
  only sees the platform it has open.
- **Benchmark catalogs are not delivery records.** Everything except Open edX carries sample hours
  gathered as industry benchmarks. Confirm before quoting.
- **Rate cards are per estimation** — set them once on a deal and they travel with it.
