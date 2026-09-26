# Architecture

Read this before your first change. It is short, and it explains the decisions that are expensive
to undo.

## Shape

```
src/
  types.ts              every domain type, in one file
  theme.ts              the palette, type scale, radii — no colour is invented elsewhere
  data/practices.ts     practice → platform registry + the 19 benchmark catalogs
  lib/
    useHover.ts         hover + focus state, because inline styles cannot do :hover
    useViewport.ts      viewport width, for layout that must branch on it
    router.ts           the URL as a value — parse, format, base path, hash fallback (pure)
    xlsx.ts             dependency-free .xlsx reader and writer (browser + server)
    catalogSheet.ts     parses the master catalog workbook into a Catalog
    format.ts           money, hours, ids, dates
  domain/               PURE functions — no React, no I/O, fully unit-tested
    estimate.ts         hours and role-aware cost from a snapshot
    planner.ts          the delivery schedule
    catalog.ts          catalog composition, diffing, bundle guessing
  state/
    keys.ts             browser storage keys, and which are synced
    reducer.ts          all workspace state and every transition (pure, exported)
    AppProvider.tsx     context: reducer + persistence + sync + routing + derived values
    useSync.ts          spreadsheet ↔ browser, with the three safety rules
    useRouting.ts       address bar ↔ reducer, in that direction
  api/client.ts         the only place the app calls the server
  components/
    SiteHeader.tsx      edly.io marketing header — part of the product, not decoration
    SiteFooter.tsx      edly.io footer
    builder/Hero.tsx    hero, stat cards, credibility row
    builder/Builder.tsx three-column shell: rail | catalog | dark estimate column
    builder/BundleRail.tsx  the bundle rail (sidebar ≥1020px, wrapping row below) + bundle header
    builder/CatalogTable.tsx  the catalog grid table and its expandable rows
    …                   remaining screens and primitives
  data/nav.ts           the real edly.io nav tree and links
server/                 runs in Node, never shipped to the browser
  schema.ts             app state ↔ spreadsheet rows
  store.ts              provider selection
  providers/            graph | gsheet | dropbox | blob | local
  handler.ts            one endpoint, two calling conventions
api/                    Vercel functions; thin wrappers over server/
tests/                  Vitest: domain, reducer, router, schema round-trip, the /api/state
                        endpoint end to end, the .xlsx reader/writer, the catalog workbook
                        and the client-facing quote. See CLAUDE.md for what a change owes.
```

## The five decisions worth knowing

**1. Domain logic is pure and lives outside React.** `calcEstimate` and `schedule` take a snapshot
and return numbers. That is why the estimation desk can price a deal it doesn't have open, why the
hub can show a total for every card, and why the maths is covered by tests rather than by clicking.
Put new calculation in `domain/`, not in a component.

**2. The open estimation is one snapshot object.** `state.draft` holds selections, buffers, rate
card, role assignments and the delivery plan together. It is committed back into the estimation on
close (`commitDraft`). Fifteen loose fields on the state root was the previous design; a single
snapshot is what makes persistence and the desk's read-only view straightforward.

**3. Styling is inline, from `theme.ts`.** No CSS modules, no utility classes, no styled-components.
The palette is one file; components import `color`, `font`, `radius`. This keeps presentation next
to structure and has kept the look consistent. If you need a new colour, add it to `theme.ts` with
a name that says what it is for.

**4. The spreadsheet is the database, and the schema is a contract.** `server/schema.ts` maps state
to rows and back. Scalar columns stay readable for humans; nested state goes in one JSON column.
Two rules there exist because they failed in production:
   - values longer than ~28,000 characters are **split across numbered rows** (`key##1/4`) — Excel
     truncates a longer cell silently;
   - each chunk is **pipe-wrapped**, because the reader trims cells and would otherwise eat a space
     landing on a chunk boundary.
   `tests/schema.test.ts` enforces both. Do not change the schema without running it.

**5. Nothing writes before a read succeeds.** See `useSync.ts`. An empty browser must never be able
to blank the spreadsheet, and a background refresh must never discard local edits. The API adds a
server-side guard: a zero-row `PUT` is refused while the store holds data.

**6. The URL is a projection of state, not a second source of truth.** `lib/router.ts` turns a
path into a `Route` and back; `state/useRouting.ts` reads a URL in exactly three places — on boot,
on Back/Forward, and when something calls `navigate` — and each becomes one `applyRoute` action.
After that, state drives the screen exactly as it always did and the address bar follows. This is
why `App.tsx` is still a list of conditions rather than a route table, and why the routing logic is
unit-tested with plain objects instead of clicked.

```
/                                        sign in
/practices[/:practice]                   practice → platform picker
/p/:platform                             estimations hub
/p/:platform/e/:slug[/b/:bundle]         builder      ?q=…  ?plan=1
/p/:platform/desk[/:tab]                 estimation desk
/p/:platform/desk/e/:slug                one deal at the desk
```

Three things worth knowing before you touch it:

- **Estimations are addressed by `slug`, not by id.** A slug is assigned once at creation and
  never rewritten, so a link pasted into Slack survives the deal being renamed. Lookups accept the
  id too, for links made before slugs existed. Rows from an older spreadsheet are backfilled by
  `withSlugs` on the way in, uniquely per platform.
- **A link may switch role.** `/p/openedx/desk` opens the desk even if you were last in sales.
  Role is a one-click toggle in the chrome, so honouring the link is less surprising than ignoring
  it. A link is not an access grant: the sign-in gate is unchanged and still client-side.
- **Clean paths need the host to serve `index.html` for unknown paths.** `vercel.json` has the
  rewrite, and `index.html` carries a `<base href>` so relative URLs — the catalog sheet above all
  — keep resolving against the mount point rather than against the route you are on. Where neither
  can be true (a plain static server, the runners in VERIFY.md), `usesHash` puts routing in the
  fragment instead.

## Data flow

```
catalog-source.xlsx ──parse──► Catalog ──┐
                                          ├──► composeCatalog ──► catalog in play
desk additions (state) ───────────────────┘
                                                     │
                       state.draft (snapshot) ────────┼──► calcEstimate ──► EstimateResult
                                                     │                          │
                                                     └──────────────► schedule ─┴──► Schedule
```

Every screen reads `catalog`, `estimate` and `plan` from `useApp()`; they are memoised once in the
provider rather than recomputed per component.

## Scoping

Estimations, requests, desk-added solutions and custom bundles all carry a `plat` field, and every
list is filtered by the platform in play. Nothing mixes platforms. When you add a feature that
stores records, give it a `plat` too, and filter it — the selectors in `reducer.ts` show the
pattern.

## Adding things

**A platform or practice** → `src/data/practices.ts`. Add a `platforms` entry, with a `catalog`
built from the `cat()` / `B()` helpers or none at all to start empty.

**A field on a solution** → `types.ts`, then the alias list in `lib/catalogSheet.ts` so the sheet
column is recognised, then wherever it should show.

**A field on an estimation or request** → `types.ts`, then `server/schema.ts` (a column and its
read-back), then a test case in `tests/schema.test.ts`. The schema test fails loudly if a field is
lost, which is the point.

**A storage provider** → a file in `server/providers/` implementing `FileProvider` or
`SheetProvider`, then a case in `server/store.ts` and a block in `.env.example`.

**A screen** → a component under `src/components/`, a branch in `src/App.tsx`, and a case in
`parseRoute`/`formatRoute` plus `routeOfState` so it has a URL. The round-trip test in
`tests/router.test.ts` fails if the two disagree.

**The builder is a three-column app shell**, not a page that scrolls as one. At ≥1320px the grid
is `280px minmax(0,1fr) 400px` at `calc(100vh - 62px)`, so the rail and the running total stay
put while the catalog scrolls; 1020–1320px narrows to `238px / 344px`; below 1020px it collapses
to one column and the rail becomes a wrapping row of chips. The breakpoints live in
`Builder.tsx` and read from `useViewport()` — inline styles cannot use media queries.

**Branded chrome.** The sales screens render `SiteHeader` above and `SiteFooter` below, and the
builder opens with `Hero`. This is deliberate: sales screen-share this tool with clients, so it has
to look like edly.io, not like an internal admin panel. `verify-app.html` asserts all of it —
if you restructure the shell, keep those four steps green.

## What is deliberately not here

- **No server-side auth.** The sign-in is a client-side demo gate. Put a proxy in front.
- **No optimistic concurrency.** Last write wins on the whole workbook.
- **No i18n.** Copy is inline English.
