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
    xlsx.ts             dependency-free .xlsx reader and writer (browser + server), with a style table
    quoteExport.ts      the branded task-breakdown workbook, and the plain-text quote
    catalogSheet.ts     parses the master catalog workbook into a Catalog (forgiving)
    catalogImport.ts    a workbook a person picked: which kind it is, strict checks, the templates
    format.ts           money, hours, ids, dates
  domain/               PURE functions — no React, no I/O, fully unit-tested
    estimate.ts         hours and role-aware cost from a snapshot
    planner.ts          the delivery schedule
    catalog.ts          catalog composition, diffing, bundle guessing, bundles vs estimates, merging
    estimateImport.ts   what an estimates import does: new or updated, and which bundle each lands in
    bundleImport.ts     what a bundles workbook does once reviewed: updates, new bundles, renumbered clashes
    importReview.ts     the review both imports share: groups, decisions, where each row lands
    tender.ts           tender intake: narrowing AI output, ranges, desk drafts
    salesLegal.ts       sales, account and legal items: what a tender offers, what the estimation keeps
    taskBreakdown.ts    the Excel sheet: deliverables per area, lines, totals, column choices
    team.ts             team composition: rate-card role and seniority, people and weeks from the plan
    demo.ts             the demo estimation: built in, held in memory, never stored
  state/
    keys.ts             browser storage keys, and which are synced
    reducer.ts          all workspace state and every transition (pure, exported)
    AppProvider.tsx     context: reducer + persistence + sync + routing + derived values
    useSync.ts          spreadsheet ↔ browser, with the three safety rules
    useRouting.ts       address bar ↔ reducer, in that direction
    useTenderRunner.ts  runs a tender's AI calls and dispatches what comes back
  api/client.ts         the only place the app calls the server
  components/
    Brand.tsx           Quotient's logo, and the slim footer on the working screens
    Nav.tsx             links between screens: AppLink, Breadcrumbs, the logo home, back links
    SiteHeader.tsx      edly.io marketing header, shown while a deal is presented
    SiteFooter.tsx      edly.io footer, likewise
    builder/Hero.tsx    hero, stat cards, credibility row, likewise
    builder/Builder.tsx three-column shell: rail | catalog | dark estimate column
    builder/BundleRail.tsx  the bundle rail (sidebar ≥1020px, wrapping row below) + bundle header
    builder/CatalogTable.tsx  the catalog grid table and its expandable rows
    builder/SheetPanel.tsx    what the downloaded Excel sheet contains: columns, sheets, notes
    builder/KindFilter.tsx    All / Bundles / Estimates on the catalog page, which is also the legend
    builder/SalesLegalPanel.tsx  the deal's sales, account and legal items, in a window: owner, status, due, note
    ImportModal.tsx     Import from Excel: pick the kind, read the checks, review, apply
    ImportReview.tsx    the review step: approve, rename, redirect or leave out each group and row
    tender/             tender intake: upload modal, then requirements, match, apply, and the
                        Sales, account and legal tab beside the steps
    salesLegal/         the status and team pieces the tab, the apply step and the panel share
    …                   remaining screens and primitives
  data/nav.ts           the real edly.io nav tree and links
  data/brand.ts         the product name, Quotient, and its logo files in public/brand/
server/                 runs in Node, never shipped to the browser
  schema.ts             app state ↔ spreadsheet rows
  store.ts              provider selection
  providers/            graph | gsheet | dropbox | blob | local
  handler.ts            one endpoint, two calling conventions
  ai/                   the only code that talks to Anthropic: client, prompts, operations
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
/p/:platform/t/:slug                     one tender, from requirements to desk requests
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

## Bundles and estimates

The catalog holds two kinds of thing that must never be sold as each other. **Bundles** are
features built for a client before and delivered again for less; their hours are a record.
**Estimates** were priced by the desk, or for an earlier client, and never built; their hours are a
forecast. `solutionKind` in `domain/catalog.ts` is the one place that decides which is which (an
estimate is a row with status `Estimation`), and everything violet in the UI means an estimate.
The hero's client-facing stats count bundles only.

They also arrive differently, which is why they are stored differently:

- **A bundles workbook replaces or joins the base catalog**, which is per platform and lives in
  `loadedCatalogs` (the Settings sheet). `mergeCatalogs` adds one to what is in play and refuses a
  Bundle ID that means a different bundle in each file. The imported catalog carries its own
  record in `meta.loaded`, and that is what pins it over the served sheet: the workspace's
  `catalogSource` is cleared whenever a platform is chosen, and every reload chooses one.
- **An estimates workbook adds records**, the same `AddedSolution` rows the desk makes, marked with
  the file they came from. `planEstimateImport` decides new versus updated (by Estimate ID, else by
  Feature and client) and where each lands (Bundle ID, else the bundle its Area names, else a new
  bundle, else Unassigned for the desk to file). The preview and the reducer call the same function.

Neither saves anything until a person has reviewed it. The file's proposals become groups (an
existing bundle, a new one, a same-ID clash, Unassigned); each is approved or left out, can be
renamed or sent to another bundle, and single rows can be moved or dropped. Import is disabled
while a group is pending. The review is plain data (`ImportReview`), and the same pure function
turns it into both the preview and the result, so what a person approves is what lands.

Both go through `readImport` in `lib/catalogImport.ts` first, which is strict where
`catalogSheet.ts` is forgiving: the served sheet must load whatever someone did to it, but a file a
person chose to import is refused with a reason when it would load differently from how it reads.

## Tender intake

A salesperson uploads an RFP and gets an estimation and a set of desk requests out of it, with a
person approving every step. Four decisions shape it, and each is expensive to undo:

- **The AI proposes; people write.** The model is given five tools and all five only report:
  a platform fit, the requirements in a page range, the catalog matches for a batch, the team each
  out-of-scope item is for, and the key legal and commercial terms of a document. Nothing it
  returns changes state. Each change is a reducer action a click dispatches, which is how "ask
  before acting" is enforced rather than requested in a prompt that a tender could override.
- **Hours come from the catalog, never the model.** A match carries catalog ids; `readMatches`
  drops any id the catalog does not have, and hours are looked up by id when shown. Unmatched work
  goes to the desk with no hours, as a hand-typed request does.
- **One cached copy of the tender, read in slices.** The fit call reads the whole tender once and
  caches it for five minutes, kept warm while the person reads the recommendation (`nextKeepWarm`,
  a `max_tokens: 0` request every four minutes, a twentieth of the tender each on Opus 5.5); extraction then runs one call per page range over that cached copy, so no
  single call outlives a Vercel function and a failed range retries on its own. Matching needs the
  catalog, not the tender, so it sends the catalog (cached) and the requirements in batches.
- **Each tender has a spending limit, and a person decides to go past it.** The server prices
  every call from its usage at the published rate of the model that ran each attempt
  (`src/domain/aiPrice.ts`), and the tender keeps the running total. Before any call starts, the
  runner, the intake and the keep-warm check `canSpend`; at the limit nothing new starts and the
  screen asks whether to continue for another step (`EDLY_AI_TENDER_LIMIT_USD`, $4 by default).
  Calls already running finish, because stopping one part way is billed all the same.
  Documents go converted text first and PDFs last, with a cache marker at each document's end, so a
  call about a spreadsheet carries the documents up to it and not the PDF after it.
- **Only the pages worth reading are read.** Nothing tells a page is irrelevant without reading
  it, so the fit call reads every page once. It also marks the sections that hold nothing to
  deliver (cover, bid instructions, scoring, blank forms, standard legal terms) as `skip`, the person sees and can change
  that before continuing, and the ranges cover the rest, less a page of margin at each edge
  (`planRanges`). A skipped section can still be read later from the requirements step. A
  spreadsheet is read in rows rather than pages: each sheet starts its own part, every row keeps its
  row number, and its ranges are three parts of 20 rows, because a row is nearly always a
  requirement and a 20-part range of rows cannot be answered inside the time limit. Legal and
  commercial terms and bid paperwork are not extracted at all; out of scope means work that is not
  software but costs money to meet (hardware, staff on site, vetting).
- **The browser drives the steps.** `/api/tender` keeps no state; the tender lives in the reducer
  and the `Tenders` sheet like everything else, so a half-reviewed tender survives a reload. A tab
  claims a range (`running`, with a time) before reading it, so a second tab on the same tender
  does not pay for the same call; a claim older than six minutes belongs to a tab that went away.
  A match that comes back after a person changed the requirement is dropped, not applied.

```
upload ─► Files API id ─► fit (platform, header, outline, sections to skip) ─► person picks platform and what is read
      ─► extract, one call per range ─► person reviews requirements
      ─► match, batches of 40 ─► person accepts matches
      ─► person creates the estimation ─► person sends the desk requests ─► files deleted
```

## Sales, account and legal

A tender commits the supplier to more than software: spend reports, fees, account reviews,
background checks, certifications, contract terms. Those go to the teams who own them, never to
the client. Decided with the user on 2026-09-29; the plan and its eight answers are in
`docs/plans/sales-account-legal.md`.

- **On the tender they are still requirements.** An out-of-scope item is an approved requirement
  with an `out` match; its team is `match.category` and its leave-out is `match.skip`. Key terms,
  read only when a person ticked for them at the start (or pressed "Read the terms now"), are
  `Tender.terms`. The tab beside the three steps lists both, by team, and blocks nothing.
- **At apply they are copied, once.** Creating the estimation copies every accepted, kept item
  into the `salesLegal` collection (`salesLegalItems`), with where it came from frozen so it
  outlives the tender, and with the matcher's reason and the tender section, so the estimation
  shows each item as fully as the match step did. Anything accepted later is offered as new
  (`copiedItems`). From then on the collection is the record: owner, status, due date and note,
  edited in the builder's Sales & legal window, and on any estimation items can be added by hand.
- **Its own sheet, one row per item.** `SalesAccountLegal` has scalar columns only, so the legal
  and account teams can filter and assign in Google Sheets; the app reads back what they type.
  It is not part of the estimation snapshot, which is one cell and is not chunked.
- **Two small AI calls, both through `canSpend`.** `op=sort` puts out-of-scope items in teams from
  their words alone, after this tab's matching run or when asked; only the asking may give a team
  to an item already on the estimation, which the AI never writes to unasked. `op=terms` reads one
  document's key terms after the extraction, through the same cached prefix, and splits like a
  range when one call cannot finish.
- **Never client-facing.** Hidden while presenting, and absent from the Excel sheet and both
  quotes, which have no input that could carry them.

```
extract (outOfScope) ─► match (kind out) ─► sort (team) ─┐
tick at the start ─► after extraction: terms per document ─┴─► tab: accept, re-team, leave out
      ─► create the estimation ─► items copied ─► builder panel: owner, status, due, note ─► SalesAccountLegal sheet
```

## The demo estimation

Every Open edX hub opens with one finished deal to learn from, tagged Demo: 34 solutions from 14
bundles, six custom requests the desk has priced, a seven-role rate card with every line assigned,
a pinned nine-and-a-half-week plan, and the Excel sheet's cover and notes written. Decided with the
user on 2026-09-30, and built in rather than stored.

- **In memory beside the real records.** Its estimation, requests, desk estimates and sales and
  legal items sit in the same collections as everything else, so every screen works on it without
  knowing. The reducer adds them on the first `hydrate` and keeps them through every later read.
- **Out of everything that is written.** `toPersisted` (browser storage and the store) and the
  server's `coerceState` drop every record whose id is a demo id, and anything made inside the demo
  takes one. A reload, or Reset, brings back the prepared version.
- **Its estimates stay in the demo.** They join the catalog only while it is open, and an estimates
  import never matches one, so a real deal cannot quote an invented hour.
- **Dated from today.** Its deadline is three weeks out and its plan starts the Monday after five,
  so it never goes overdue.

## Scoping

Estimations, requests, desk-added solutions, custom bundles, tenders and sales and legal items all carry a `plat` field, and every
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
is `280px minmax(0,1fr) 400px`, and the bar and the shell share one frame the height of the
window, so the shell takes whatever height the bar leaves when it wraps. The rail and the running
total stay put while the catalog scrolls; 1020–1320px narrows to `238px / 344px`; below 1020px it collapses
to one column and the rail becomes a wrapping row of chips. The breakpoints live in
`Builder.tsx` and read from `useViewport()` — inline styles cannot use media queries.

**Branded chrome.** The tool is Quotient: every working screen carries its logo in the header and
a slim `AppFooter` below. What a client sees is Edly: while a deal is presented in the builder,
`SiteHeader` goes above it, `Hero` opens it and `SiteFooter` replaces the slim footer, so a
screen-share looks like edly.io rather than an internal admin panel. `showsSiteChrome` in the
reducer decides it, and the hub, the tender screen and the desk never show it: the hub lists every
client, and the other two are internal. `verify-app.html` asserts both states. If you restructure
the shell, keep those steps green.

## What is deliberately not here

- **No server-side auth.** The sign-in is a client-side demo gate. Put a proxy in front.
- **No optimistic concurrency.** Last write wins on the whole workbook.
- **No i18n.** Copy is inline English.
