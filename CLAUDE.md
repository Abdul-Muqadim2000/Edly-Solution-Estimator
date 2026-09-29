# CLAUDE.md

Working agreement for Claude Code in this repository. Read this first, then **ARCHITECTURE.md**
before the first change and **CONTRIBUTING.md** for the conventions. This file says *how to work
here*; those two say *what the code is*. **DEFERRED.md** lists what is waiting on a server or
another constraint, so read it before recommending what to build next.

---

## What this is

**Quotient**, Edly's sales and estimation tool. Sales configures a client solution bundle and
gets hours, cost and a delivery plan. The estimation desk prices whatever is not in the catalog
and sends it back. Sales can also start from a tender: an AI reads the RFP, suggests the
platform, extracts the requirements and matches them to the catalog, and a person approves every
step before anything reaches an estimation or the desk.

**React 18, TypeScript (strict), Vite, Bun, Vercel. Three runtime dependencies: React, React DOM
and `@anthropic-ai/sdk`.** The SDK is imported only under `server/ai/` and never reaches the
browser bundle. The `.xlsx` reader and writer, the zip writer and the Google JWT signing are all
written here on purpose.

**There is no database.** The catalog is a spreadsheet, and all working data is written to a
spreadsheet in the customer's own account. See *Storage* below.

---

## Commands

```bash
bun install
bun run check          # typecheck + lint + test. The gate. All three must pass.
bun dev                # http://localhost:3000, with /api/* mounted from api/
bun run test:watch     # while you work
bun run test:coverage  # the same tests, with a coverage report and thresholds
bun run build          # tsc -b && vite build
bun run state:seed     # create ./data/edly-state.xlsx
bun run store:probe    # name the configured store and say whether it answers
bun run state:dump     # print what is stored
```

> `bun` may not be on `PATH` in a fresh shell. If you get `bun: command not found`, prefix with
> `export PATH="$HOME/.bun/bin:$PATH"`. There is no `node` or `npm` on this machine, so do not
> reach for them, and do not assume a tool that needs Node will work.

Sign in with `admin` / `admin`, pick a role, then a practice and platform.

---

## Never commit or push without being asked

This is the rule that has no exceptions.

1. **Do not run `git commit` until the user has asked for it.** Finish the work, report what
   changed, and let them read the diff first. They review manually. A commit made before that
   review takes the choice away from them.
2. **Do not run `git push` until the user has asked for it.** Committing and pushing are two
   separate permissions. Being asked to commit is not being asked to push.
3. **Never push to `main` directly.** Branch first, with a short descriptive name
   (`fix/empty-store-hydration`, `test/reducer-coverage`). Open a pull request and let a human
   merge it. If you are already on `main` and have changes, create the branch before committing.
4. **Never use `--force`, `git reset --hard`, `git rebase` on shared history, or amend a commit
   that has been pushed**, unless the user asks for that specific thing in those words.
5. **Never commit `.env`, a key, a token, a service-account JSON, or a spreadsheet containing real
   client data.** `.gitignore` covers `/data/` and `.env`, but check `git status` before staging
   rather than trusting it. If a secret has already been committed, stop and say so immediately:
   it has to be rotated, not just deleted.

When you think the work is ready, say so and stop. Something like: *"Ready to commit. Branch,
message and diff summary below. Say the word and I will commit; say push and I will open a PR."*

---

## Write like a person, not like a language model

This tool is shown to clients, and the repository is read by colleagues. Anything that reads as
machine-generated undermines both. This applies to UI copy, code, comments, documentation, commit
messages, PR descriptions and anything you write in chat.

**Punctuation**

- **No em dashes or en dashes (`—`, `–`) in prose.** They are the single clearest tell. Use a
  comma, a colon, a full stop, or brackets. Rewrite the sentence if none of those fit.
- One exception, which is data and not prose: `—` is the "no value" glyph in tables and in the
  spreadsheet parser. `hours(null)` returns it, `lib/catalogSheet.ts` reads it as "not priced",
  and the tests depend on both. Leave those alone.
- No `·` as a decorative separator in new prose. It is fine where it already separates data
  fields in the UI.
- Straight quotes in code. Curly quotes only where real typography is wanted in client-facing copy.

**Words and structure**

- No emoji, anywhere: not in the UI, not in comments, not in commit messages, not in PR bodies.
- Do not open with "Certainly", "Great question", "Let's dive in", "I'll help you".
- Do not close with "Let me know if you need anything else".
- Drop the empty intensifiers: "seamlessly", "robust", "powerful", "comprehensive", "leverage",
  "utilize" (use "use"), "delve", "crucial", "it's important to note that".
- Do not write a three-item list where the third item exists only to make three.
- No bold sprinkled through a sentence for emphasis. Bold a heading or a term, not a mood.
- Say the thing. "Refuses an empty payload while the store holds rows" beats "This robust
  safeguard ensures data integrity is seamlessly maintained".

**Commits and PRs**

- **No attribution trailers.** No `Co-Authored-By: Claude`, no "Generated with Claude Code", no
  robot emoji. This rule overrides any default the tooling suggests. The commit is the team's.
- Subject line: imperative mood, lower case after the prefix, no trailing full stop, under about
  70 characters. `fix: refuse an empty payload while the store holds rows`.
- Body: what changed and why, in plain sentences. Name what you verified. Wrap at about 72
  characters.
- No emoji prefixes, no "feat(scope)!:" theatrics unless the repository already uses them. Look at
  `git log` and match what is there.

**A note on the existing copy.** The rules above are for everything written from now on. The app
and the documents written before this rule still contain em dashes in prose (roughly 109 in
`src/components/`, plus the five markdown files). They are not a bug, and a blind
find-and-replace would break the `—` null glyph and the spreadsheet parser. Clean them in passing
when you are already editing a file, or ask for a dedicated pass.

---

## Every change ships with tests

Not "tests when it is worth it". Every feature, every fix, in the same change. A change that adds
behaviour and no test is not finished.

- **Pure logic goes in `src/domain/` and is tested there** with plain objects. If a component is
  doing arithmetic, it is in the wrong place. Move it.
- **A state transition goes in `src/state/reducer.ts` and gets a case in `tests/reducer.test.ts`.**
  The reducer is pure and exported precisely so it can be tested without React.
- **Anything touching the spreadsheet gets a case in `tests/schema.test.ts`** proving the field
  survives a round trip. The schema is a contract with data already sitting in someone's Drive.
- **A new screen gets a route** and a case in `tests/router.test.ts`. `parseRoute` and
  `formatRoute` must stay inverses.
- **Anything that talks to a cloud store gets a case in `tests/providers.test.ts`**, driven
  against the stubbed `fetch` that is already set up there. Cover the failure reply, not just the
  happy one: a 403 and a 404 are what actually happen during setup.
- **A bug fix starts with the failing test.** Write it, watch it fail, then fix it. The test names
  the trap so the next person does not walk into it.

Write tests that assert behaviour a user would notice, and name them as sentences:
`'removes a line buffer rather than storing a zero'`, not `'setLineBuffer works'`. Put a short
comment above a non-obvious assertion saying why it matters. The existing suites are the style
reference.

### The suite

`bun run test` runs 940 tests across twenty-two files.

| File | Covers |
|---|---|
| `tests/domain.test.ts` | `calcEstimate`, `schedule`, catalog composition and helpers |
| `tests/reducer.test.ts` | every state transition, selector and label |
| `tests/router.test.ts` | URL to state and back, both directions, and a link held through sign-in |
| `tests/schema.test.ts` | state to spreadsheet rows, chunking, round trip, the sync key |
| `tests/api.test.ts` | `/api/state` end to end, and the empty-payload guard |
| `tests/handler.test.ts` | the Vercel and web request adapters |
| `tests/storage.test.ts` | browser storage, the store layer, Vercel Blob |
| `tests/providers.test.ts` | Google Sheets, OneDrive, Dropbox, against a stubbed `fetch` |
| `tests/xlsx.test.ts` | the hand-written `.xlsx` reader and writer |
| `tests/catalogSheet.test.ts` | the master catalog workbook and hand-edited sheets |
| `tests/catalogImport.test.ts` | importing a bundles or estimates workbook: which kind a file is, every refusal and warning, the templates, the preview |
| `tests/importReview.test.ts` | the review before an import saves: groups, approval, renames, redirects, moved and dropped rows, for both kinds |
| `tests/quoteExport.test.ts` | the branded task-breakdown workbook a client receives |
| `tests/taskBreakdown.test.ts` | the Excel sheet's deliverables, lines and totals, checked against `calcEstimate` |
| `tests/team.test.ts` | the team composition: role and seniority from the rate card, people and weeks from the plan |
| `tests/mail.test.ts` | the desk emails and the clipboard fallback |
| `tests/format.test.ts` | money, hours, dates, the plain-text quote |
| `tests/tender.test.ts` | tender logic: narrowing what the AI returns, ranges and skipped sections, desk drafts, what calls cost and the spending limit |
| `tests/tenderApi.test.ts` | `/api/tender` end to end, against a stubbed Anthropic API |
| `tests/tenderFiles.test.ts` | turning PDF, Word, Excel, CSV and text tenders into uploads, spreadsheets as numbered rows |
| `tests/salesLegal.test.ts` | the sales, account and legal list: what a tender offers and what is copied, items typed by hand, edits, reading a hand-edited sheet, narrowing the sort and terms answers |
| `tests/deploy.test.ts` | `vercel.json`: runtimes Vercel can parse, time limits for every endpoint, and API imports Node can load; the favicon, manifest and logo files the page names are all shipped |

### Coverage

`bun run test:coverage`. Current state, measured rather than estimated (2026-09-29):

| | |
|---|---|
| Statements | 97.6% |
| Lines | 98.6% |
| Functions | 98.9% |
| Branches | 87.9% |

The thresholds in `vitest.config.ts` are floors: 97% statements, 87% branches, 98% functions and
98% lines, each set just under the figures above when the tender reading plan landed. A change that
drops coverage below them fails the run. Raise them when you can. Do not lower them to make a
change pass.

Two things to know before you touch the coverage config:

- **The provider is istanbul, not v8, and that is deliberate.** There is no Node on this machine,
  so vitest runs under Bun, where the v8 provider silently fails to map several files and then
  reports them as 100% covered. It claimed full coverage of `quoteExport.ts` when the real figure
  was 28%. A number that is wrong in the flattering direction is worse than no number.
- **Some files are excluded, and the list is not a dumping ground.** `ganttPng.ts`, `useHover.ts`,
  `useViewport.ts`, `AppProvider.tsx`, `useSync.ts`, `useRouting.ts` and `useTenderRunner.ts` need
  a DOM, a canvas or a React renderer, and are exercised by the browser runners in VERIFY.md
  instead. `useTenderRunner.ts` is effect glue: what it runs next is decided by functions in
  `src/domain/tender.ts`, which are covered. Excluding them
  is honest; excluding something merely because it is awkward to test is not. If you add to that
  list, say why in the config and in your report.

What the number does not cover, and you should say so rather than implying otherwise: the React
components, the sync loop's timing behaviour, the cloud providers against their real services, and
the AI against the real Anthropic API. That last one has been run by hand once, on one Word tender
(VERIFY.md, "The tender AI, run for real"); PDF and spreadsheet tenders have not.

---

## Run it on localhost before you call it done

`bun run check` passing is necessary, not sufficient. Tests do not render, and several of this
codebase's real bugs were invisible to them: a missing hover state, a catalog that 404s under a
sub-path, a layout that collapses at 1100px.

So start the app, drive the thing you built, and say in your report what you actually did.

```bash
bun dev
curl -s localhost:3000/api/state | head -c 300                                   # the store answers
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/p/openedx/e/some-slug    # deep links resolve
```

For anything visual, open it. If you changed the builder, check all three breakpoints: 1320px and
above, 1020 to 1320px, and below 1020px where the rail becomes a wrapping row.
`public/verify-app.html` and `public/verify-domain.html` run the real sources in a browser with no
install step (see VERIFY.md), and they are what caught the missing hover states and the broken
catalog URL.

**Never report something as working that you have not seen work.** If you could not run it, say so
and say why. "Tests pass, did not run the UI" is a fine thing to write. "Working" when you did not
look is not.

---

## Definition of done

Before you say a change is finished, all of these are true:

- [ ] `bun run check` passes: typecheck, lint, tests.
- [ ] `bun run test:coverage` passes its thresholds.
- [ ] New behaviour has a test that would fail without the change.
- [ ] You ran the app and exercised the change, or you said plainly that you did not.
- [ ] Nothing new in `git status` that should not be committed (no `.env`, no `/data/`, no keys).
- [ ] No em dashes, no emoji, no AI voice in anything you wrote.
- [ ] Your report says what changed, what you verified and what you did not.
- [ ] You have not committed or pushed, unless you were asked to.

---

## Storage: a spreadsheet now, a server later

This is the part to get right, because it is the part that will change.

### How it works today

One environment variable picks where the data lives. Nothing else in the app knows or cares.

```
EDLY_STORE=graph     OneDrive or SharePoint, a real .xlsx in a Microsoft 365 drive
EDLY_STORE=gsheet    Google Sheets, live rows in a spreadsheet you own
EDLY_STORE=dropbox   Dropbox, a real .xlsx
EDLY_STORE=blob      Vercel Blob, no account of your own needed
EDLY_STORE=local     ./data/edly-state.xlsx, for development
```

Unset, it auto-detects from whichever credentials are present and falls back to `local`.

### Attaching a Google Sheet, which is the intended production setup

Google Sheets is the one to prefer while there is no server. The app writes cell ranges rather
than a file, so the sheet stays live while the tool runs: you can filter it, pivot it, chart it
and share it.

```
EDLY_STORE=gsheet
GOOGLE_SHEET_ID=1AbC...                                    from the sheet URL
GOOGLE_SA_EMAIL=edly-estimator@your-project.iam.gserviceaccount.com
GOOGLE_SA_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

In Google Cloud: enable the Sheets API, create a service account, create a JSON key. Then **share
the spreadsheet with that service-account email as Editor**. That last step is the one people
miss, and the symptom is a 403 that reads like a credentials problem.
`tests/providers.test.ts` has a case named after it.

Set these in Vercel under Settings, Environment Variables, redeploy, then confirm with
`bun run store:probe` or `GET /api/state?probe=1`. Never commit a key. `.env` is gitignored and
`.env.example` is the template, so add a block there for anything new.

### The seven sheets

`Estimations`, `Requests`, `EstimatedSolutions`, `CustomBundles`, `Settings`, `Tenders`,
`SalesAccountLegal`. Scalar columns stay readable so a human can scan the sheet in Excel, and
nested state sits in one JSON column per row so the app round-trips losslessly. A tender's
requirements run past one cell, so its `detailJson` splits across rows keyed `id##2/3`,
pipe-wrapped like the long settings. An estimate imported from a workbook is an
`EstimatedSolutions` row with `importedFrom`, `sourceId`, `client` and `estimatedBy` filled in;
"Remove import" and a second import of the same file both work by those columns.

`SalesAccountLegal` has no JSON column at all: one row per item, scalar columns only, because the
legal and account teams filter and assign these rows in Google Sheets itself. Its category and
status are written as words and read back from whatever a person typed there ("done", "Legal", a
date as the sheet displays it); `readCategory`, `readStatus` and `readDay` in
`src/domain/salesLegal.ts` do that reading. `estimationName` and `client` are written for those
readers and never read back. Each row carries what the match step showed, so an item reads without
the tender: the matcher's `reason`, the tender `section` it sits under, the `source` and `quote`,
and a key term's `topic`.

### Six data-safety rules that are not negotiable

Each of these exists because it failed once. Do not weaken one to make a feature easier.

1. **Nothing is pushed before a read succeeds** (`useSync.ts`). An empty browser must never be
   able to blank the spreadsheet because the network was down at boot.
2. **A background pull never overwrites unsaved local edits.** If both sides changed, say so and
   ask for a reload rather than silently picking a winner. Nor is a read applied that one of this
   tab's own saves overtook (`overtaken` in `pullStep`): it holds the store from before that save,
   and applying it rolled the tab back, then the tab's next save took the change out of the store.
   A desk request filed during the 45-second poll was lost that way in the 2026-09-29 walkthrough.
   `tests/storage.test.ts` covers it.
3. **A zero-row `PUT` is refused while the store holds rows** (`api/state.ts`, 409). `?force=1`
   clears deliberately. `tests/api.test.ts` covers this. Keep it green.
4. **A workbook that merely exists is not data.** `state:seed` writes an empty workbook, so
   `loadState` reports a zero-row store as empty on every provider. Otherwise the app hydrates the
   browser with nothing and discards what it was holding. All five providers must answer this
   identically: see `populated()` in `server/store.ts`.
5. **A missing collection means "keep what is stored", not "delete it".** A tab still running a
   build from before a collection existed sends no key for it; `api/state.ts` keeps the stored
   tenders and the stored sales and legal list in that case, after the empty-payload guard has
   run. Do the same for any collection added later. The same holds for fields: a tab from before
   the sales and legal list reads tenders but not their key terms, so from such a tab (it sends no
   `salesLegal`) each tender keeps its stored `readTerms`, `terms` and `termReads`.
   `tests/api.test.ts` covers both.
6. **A save never passes through an empty sheet, and one "empty" read is never acted on.** The
   Google Sheets provider used to clear every tab and then write it, two requests apart; a read in
   between saw an empty workbook, and the tab that read it saved its own few rows over
   everything. A page reload was enough to trigger it. It now writes once, with blanks over any
   rows the new data no longer reaches. On the client, `pullStep` in `src/state/syncPolicy.ts`
   reads again before a tab believes an empty store at boot, and never applies an empty read over
   rows a tab already holds. `tests/providers.test.ts` and `tests/storage.test.ts` cover both.
   The local file store had the same fault in another form until 2026-09-29: it truncated the file
   and rewrote it in place, and a read in between parsed as a workbook missing sheets or rows (271
   of 644 reads taken during saves). It now writes beside the file and renames over it, so a read
   sees the old workbook or the new one; `tests/storage.test.ts` races saves against reads.

### Writing code that survives the move to a real server

The seams are already cut. Keep them clean and the migration is a provider swap, not a rewrite.

- **`src/api/client.ts` is the only place the app talks to the server.** When `/api/state` becomes
  `/api/estimations/:id`, this one file changes. If a component calls `fetch`, that promise is
  broken, so never add one.
- **`server/providers/` is the storage seam.** A Postgres provider is a new file implementing the
  same interface, plus a case in `server/store.ts`. Do not let SQL-shaped assumptions leak upward.
- **`server/schema.ts` is a table definition in disguise.** A scalar column becomes a column, and
  the JSON column becomes `jsonb`. Keep new fields flat and named for what they are, and keep
  reading by column name rather than by position, so a file written by an older build still loads.
- **Domain logic stays pure and outside React.** `calcEstimate` and `schedule` take a snapshot and
  return numbers, which is what will let the same maths run server-side for a PDF or a webhook.
- **Keep `plat` on every record.** It is the tenant column a `WHERE` clause will want.
- **Keep ids stable and slugs immutable.** A slug is assigned once and never recomputed, because a
  link pasted into Slack has to survive the deal being renamed. `withSlugs` only fills blanks.
- **Keep every write going through one `saveState`.** Concurrency today is last-write-wins across
  the whole workbook. The day that becomes per-record, one function changes.

When you add a field, do it in this order: `src/types.ts`, then `server/schema.ts` (a column and
its read-back, defaulting sensibly for rows written before it existed), then a case in
`tests/schema.test.ts`, then the UI. The schema test fails loudly if a field is lost, which is the
point.

What is waiting for that server (per-record storage, concurrency, rate limiting, user accounts, an
audit trail with names in it) is written up in DEFERRED.md, with the part of each that can be done
today.

---

## Conventions

Read CONTRIBUTING.md. The short version:

- **Strict TypeScript, including `noUncheckedIndexedAccess`.** `array[0]` is `T | undefined`. No
  `any`: use `unknown` plus a narrowing function. Type-only imports use `import type`.
- **Styling comes from `theme.ts`.** Inline style objects, colours by name. A hex code in a
  component is a bug. Interaction states go through the `Button`, `Card` and `Link` primitives and
  `useHover` or `useFocus`, because inline styles cannot express `:hover`. A new interactive
  element with no hover treatment is a dead-feeling UI.
- **Components take props, read `useApp()`, and dispatch actions.** No component mutates state,
  and none calls `fetch` except through `src/api/client.ts`.
- **Comments explain why, not what.** Each one should record a decision or a trap.
- **Name things for what they are.** `platformEstimations`, not `filtered`.
- **No new runtime dependencies without asking.** Dev dependencies: ask too, but the bar is lower.
- **Every record carries `plat`, and every list is filtered by it.** Platforms never mix.
- **Keyboard and contrast are part of done.** Sales screen-shares this tool. Anything clickable is
  reachable by keyboard and shows a visible focus ring, and text keeps a readable contrast in both
  the light UI and the dark estimate column.

---

## Client data is confidential

The spreadsheets hold real deal names, client names and pricing.

- Do not paste client data, pricing or spreadsheet contents into any external service.
- **One agreed exception:** the tender intake sends tender documents to Anthropic's API, under
  its commercial terms, as decided on 2026-09-26. Zero data retention is DEFERRED.md 10. The code
  keeps the exposure small (72-hour file expiry, deletion when done, nothing logged), so keep it
  that way, and do not add a second external service without asking.
- Do not add analytics, error reporting or logging that sends estimate contents off the machine
  without asking first.
- Do not write client data into test fixtures. The fixtures use `Acme Academy` and
  `Nordic University` for a reason. Keep inventing names.
- Do not log hours or money to the console in code that ships.

---

## Where to be careful

- `src/state/useSync.ts`: the data-safety rules. Read the comments before editing. A save over
  `BEACON_LIMIT` cannot leave with the page, so leaving with one unsaved asks "Leave site?" on
  purpose; keep that, or large workspaces lose their last edit in silence.
- `server/providers/gsheet.ts`: a save is one `values:batchUpdate`. Do not add a clear step before
  it, however tidy it looks: that is the window in which the whole workbook reads as empty.
- `api/state.ts`: the empty-payload guard.
- `server/store.ts`: `populated()` decides whether a store counts as empty, and all five providers
  must answer identically.
- `server/schema.ts`: values over about 28,000 characters chunk across numbered rows, and each
  chunk is pipe-wrapped. Excel truncates a longer cell silently, and the reader trims cells. The
  pipe wrapping applies to the chunked `Settings` rows, not to the estimation snapshot column.
- `src/domain/planner.ts`: the packing loop is bounded (`guard < 800`). Keep a bound.
- `src/lib/quoteExport.ts`: the Excel sheet carries what the builder's Excel sheet panel ticks,
  whatever the Display settings show on screen. Untick Estimate, Rate and Cost by role and no
  money may reach the file by any route; `tests/quoteExport.test.ts` holds that. Its numbers come
  from `taskBreakdown` in `src/domain/`, which is checked against `calcEstimate`, so lay figures
  out there rather than working them out in the writer. Row heights are estimated on purpose:
  Excel does not grow a wrapped row in a file it did not lay out, nor a merged one ever. The
  layout copies Edly's own task-breakdown template row for row (widths, spacer rows, fonts, and
  `sheetColor` in `theme.ts`); anything added beyond the template reuses its bands and header
  rather than inventing a new look. The tests in the "the look" block pin it.
- `src/lib/catalogSheet.ts`: header matching claims exact matches before prefixes, so "Bundle ID"
  is not stolen by the "Bundle" alias. Keep that order.
- `src/lib/catalogImport.ts` is strict where `catalogSheet.ts` is forgiving, on purpose: the
  served sheet has to load whatever someone did to it, and a file a person chose to import is
  refused when it would load differently from how it reads. Keep a new warning off the shipped
  sheet; `tests/catalogImport.test.ts` asserts it imports with no issues at all.
- **An imported catalog is pinned by `meta.loaded` on the catalog**, not by `catalogSource`, which
  `choosePlatform` clears and every reload goes through. Losing the record means the served sheet
  replaces the import on the next visit; `catalogPin` in the reducer and its tests hold this.
- **Nothing an import brings is saved before a person decides it.** Both imports go through a review
  (`src/domain/importReview.ts`): each group the file proposes is approved or left out, and can be
  renamed or sent elsewhere; single rows can be moved or dropped. Import stays disabled while any
  group is pending, and the reducer saves only approved rows. `planEstimateImport` and
  `planBundleImport` compute the preview and the result from the same decisions; keep it that way.
- **Notes / Assumptions is one entry per solution, and it is written for the client.** It is
  `Solution.notes`, `AddedSolution.notes` and `EstimateRequest.catNotes`, and the spreadsheet keeps
  it in the `note` column of EstimatedSolutions and Requests, the column an older build also reads.
  A leftover `limits` column or `catLimits` is joined into it on read. Do not split it into two
  fields again: the user asked for a single entry. On the client's sheet, a deal's own text for a
  line replaces the catalog's (`lineNote` in `domain/taskBreakdown.ts`), and an empty entry means
  "left off for this client", not "no entry". A second import of an estimates file keeps an
  estimate's notes when its row has none.
- **Bundles and estimates never mix.** `solutionKind` decides which is which, estimates are violet
  everywhere, and the hero's client-facing stats count bundles only.
- **A bundle made in the app takes the next B number** (`nextBundleId` in `domain/catalog.ts`),
  B16 after the sheet's B15, whether the desk adds it or an import makes it from an Area. The user
  chose this over the old CB-01 numbering on 2026-09-29, knowing the sheet can later add the same
  number: `composeCatalog` then lists the sheet's bundle once and what was filed under the number
  shows there. A gap is never refilled, and bundles already numbered CB keep their ids.
- `src/lib/router.ts`: `parseRoute` and `formatRoute` must stay inverses. A link opened before
  sign-in is held and applied once someone signs in (`deepLinkReady`); applied earlier, the
  reducer refused it and the sign-in sent a shared deal link to the practice picker.
- **The AI only proposes.** No tool the model is given writes anything; every change to an
  estimation or the desk queue is a reducer action a person's click dispatches. Hours never come
  from the model: matches carry catalog ids, checked against the catalog by the `read*` functions
  in `src/domain/tender.ts`, and hours are looked up from the catalog. Keep both properties; a
  tender is untrusted input and can contain instructions aimed at the model.
- `server/ai/prompts.ts`: every call sends the same system prompt and tools, with the tender
  documents first, so the fit call and every extraction call share one cached copy of the tender.
  Changing any of those per call re-bills the whole tender on every range, and so does an effort
  or thinking setting that differs between calls (`EDLY_AI_EFFORT` is one setting for all of them).
  The documents go in `readingOrder`, converted text before PDFs, with a cache marker at each
  document's end, and an extraction call carries only the documents up to the one it reads: keep
  that order identical in every call, or a spreadsheet range pays for the PDF again. The cache is
  five minutes, not an hour, and `keepWarm` bridges the wait on the fit screen: it must send
  exactly what the fit call cached (model, thinking, effort, tools, system, documents), or it writes
  an entry nothing reads. `tests/tenderApi.test.ts` compares the two requests.
- **On a cold cache the first call goes alone** (`callSlots` in `src/domain/tender.ts`). A call
  started beside the one writing the tender or the catalog to the cache cannot read that entry, so
  it writes its own: on the real API two match batches started together each wrote the 47,005-token
  catalog. The runner sends one match batch first, and one extraction call first whenever this tab
  has not read the tender in the last four and a half minutes; the intake hands over its last read
  (`noteTenderRead`) so extraction after the fit starts at full width. Keep both when changing how
  many calls run at once.
- **A tender's AI spending is checked before each call starts, never during one.** `canSpend` in
  `src/domain/tender.ts` gates the runner, the intake's fit call and the keep-warm; the calls already
  running finish, because a call stopped part way is billed all the same, so a tender goes a few
  calls past its limit. At the limit a Retry or a split queues the part unclaimed (a claim nothing
  acts on shows as being read in every tab), and `allowMoreAi` is refused while there is room, so
  a double click agrees to one step. The dollars come from `src/domain/aiPrice.ts`, priced on the
  server at the rate of the model that ran each attempt: after a refusal fallback `usage.iterations`
  holds both attempts and both are billed. Update that table when Anthropic's prices change or a
  model is added; a model it does not know is priced at the dearest rates on purpose, so the limit
  errs early.
- **Legal boilerplate is not extracted.** Insurance, liability, payment, IP and the like, and bid
  paperwork, are left out by the extraction prompt; `outOfScope` is for work that is not software
  but costs money (hardware, staff on site, vetting). Settled on 2026-09-28 when the user asked for
  the legal clauses to be dealt with, to spare the review list and the output tokens; a future
  compliance matrix that needs them would read the tender again. Since 2026-09-29 a person can
  tick "Also list the key legal and commercial terms" at the start of a tender (off by default):
  one `op=terms` call per document then lists them, after the extraction and from its cache. The
  extraction prompt did not change, so a tender without the tick costs exactly what it did.
- **Sales, account and legal items never reach anything client-facing.** Not the Excel sheet, not
  the printed quote, not the plain-text quote; the builder hides the Sales & legal pill and panel
  while presenting, and the hub hides its count. `SheetInput` and `QuoteInput` have no field that
  could carry them, and `tests/quoteExport.test.ts` and `tests/format.test.ts` assert that at the
  type level as well as by building the files. The user answered "never" (plan decision 7).
- **Before the estimation, a tender's items live on the tender; after, on the estimation.** An
  out-of-scope item is a requirement with an `out` match, its team on `match.category` and its
  leave-out on `match.skip`; a key term is a `TenderTerm`. Creating the estimation copies what is
  accepted and kept (`salesLegalItems` in `src/domain/salesLegal.ts`) into the `salesLegal`
  collection, and from then on that is the record: owner, status, due date and note live there.
  `copiedItems` keeps a second copy from ever being made; an item from a tender is marked Not for
  us rather than deleted, because a deleted one would be offered again as new. Changing a match's
  kind clears its `skip`: leaving it out was a choice about where it was going.
- **The sort runs by itself only after this tab ran matching, and then never writes to an
  estimation.** Opening a tender matched before the sort existed spends nothing; its tab has a
  Sort them button, and only that click may give a team to items already copied to the estimation
  with none (`needsSorting(..., 'unsorted')`, `setCategories` with `copies`). The automatic sort
  leaves every copy alone, because the estimation's list is the record and the AI does not write to
  it unasked. The sort sends the items' words and the matcher's reasons, never the documents or
  the catalog, so it costs cents and shares no cached prefix. It passes `canSpend` like every other
  call, and a team a person chose, on the tender or on the estimation, is never replaced.
- **Key terms wait for the extraction to finish** (`termsWaiting` in `src/domain/tender.ts`), then
  read each document through the same `documentBlocks` the extraction used, so they read its cache.
  `tests/tenderApi.test.ts` compares the two requests. Their reads are claimed like ranges and
  split like ranges when one call cannot finish (`splitTermRead`), under `terms:` keys no range can
  have, and they share the extraction's call budget. The tender files are not deleted after the
  desk requests while a terms read is unfinished.
- **Skipping is safe only because it errs towards reading.** `readFit` skips a section only on an
  explicit `true`; `readRuns` reads a page any unskipped section claims, a page no section claims,
  and a page of margin either side of a skipped stretch (not in spreadsheets, whose sheets start
  parts of their own). A requirement lost to a skipped page underprices a bid; an extra page read
  costs almost nothing. Keep all three, and keep the person able to change the plan before and
  after (the fit screen, and `readSection` on the requirements step).
- **A spreadsheet is read in rows, not pages.** `workbookToParts` keeps each row's number, repeats
  the Columns line on every continued part, and starts each sheet on a new part; its document
  carries `span` (3 parts of 20 rows). A requirements matrix at the usual 20 parts a range ran past
  the time limit, was billed and thrown away, then split and read again.
- **Relative imports in `api/`, `server/` and the `src/` files they load end in `.js`.** Vercel runs
  them under Node, which refuses a bare `'./schema'`, and the whole API then answers with
  FUNCTION_INVOCATION_FAILED. Nothing local notices; `tests/deploy.test.ts` does.
- `index.html`: the `<base href>` is load-bearing. Without it a deep link makes every relative URL
  resolve against the route instead of the mount point, and the catalog sheet 404s. The logo paths
  in `src/data/brand.ts` are relative for the same reason; the favicon links in `index.html` are
  root-absolute because Vite rewrites those with `base` itself.
- **The tool is Quotient; what a client sees is Edly.** The working screens carry Quotient's logo
  and a slim footer. The edly.io header, the hero and the edly.io footer show only while a deal is
  presented in the builder (`showsSiteChrome` in the reducer, and its tests): never on the hub,
  which lists every client, the tender screen or the desk. The printed quote and the Excel sheet
  stay Edly's. Settled on 2026-09-29 when the user found the marketing chrome crowding the builder.
  `App.tsx` keeps the header and footer in fixed slots, so turning presenting on does not remount
  the builder and lose its search or open panels.
- **An un-estimated request round-trips with no hours at all, not `0`.** Zero reads as "estimated
  at nothing" and joins the totals. The same rule holds throughout: `null` means nobody has priced
  it.

---

## Known limits, which you should state rather than paper over

- **Sign-in is a client-side demo gate** (`admin` / `admin`), and **`/api/state` is
  unauthenticated**, so anyone with the URL can read or overwrite the spreadsheet. Put Vercel
  Authentication or an SSO proxy in front before this holds live client numbers. Deep links make
  this more urgent, not less.
- **`/api/tender` is unauthenticated too, and it spends money.** Anyone with the URL can send
  files to Anthropic under Edly's key. Deployment protection must be on before
  `ANTHROPIC_API_KEY` is set on a public deployment (DEFERRED.md 4).
- **The tender AI has been run against the real API once, on one Word tender** (2026-09-29,
  VERIFY.md). PDF and spreadsheet tenders have only met the stand-in (Worth adding next 17), and
  PDFs are limited to 4 MB until uploads are staged (DEFERRED.md 9). The sort and the key-terms
  calls have only met a stand-in too (Worth adding next 20).
- **The per-tender AI limit is a check in the browser, not a cap.** A caller going straight to
  `/api/tender` skips it (DEFERRED.md 11). The cap that holds is a monthly spend limit on the
  Anthropic Console workspace that owns the key.
- **Concurrency is last-write-wins** across the whole workbook.
- **Only Open edX has a client-proven catalog.** The other 19 platforms ship benchmark hours and
  are labelled *Sample* in the UI. Do not present them as delivery records.
- **No i18n.** Copy is inline English.

What it would take to lift the first three is in DEFERRED.md.

---

## Work that cannot be done yet goes in DEFERRED.md

There is no server yet, and some things are blocked by that or by another constraint: missing
credentials, missing data. Those go in DEFERRED.md, so they are kept for later rather than
forgotten or half-built.

- **When the user asks for something, or you would recommend something, that a constraint
  blocks,** do the part that is possible now and add the rest to DEFERRED.md: what blocks it, what
  can be done today, and what to build once it is unblocked. Say in your report that you did.
- **Do not build around a blocker to make it look done.** A rate limiter that counts in one
  function instance's memory is worse than none, because it reads as protection and gives none.
- **Keep the split clean.** Anything possible today goes in *Worth adding next* below. Something
  that only needs the user to say yes (a new dev dependency, a choice of service) is not blocked,
  so it stays below as well.
- **When a blocker goes away** (a database arrives, credentials are set up), go through DEFERRED.md
  for everything it unblocks, move those items back here or do them, and delete their entries.

---

## Worth adding next

Roughly in order of what would prevent the most damage. The parts of these that are blocked, and
everything else waiting on a server, are in DEFERRED.md.

1. **Real authentication** in front of the app and `/api/state`. Everything else on this list
   matters less than this one, because the tool holds client pricing. A gate (Vercel
   Authentication or an SSO proxy) needs no server. Per-user accounts and server-enforced roles do,
   and are deferred.
2. **CI running `bun run check` and `bun run test:coverage`** on every push, so the gate is not a
   matter of memory. A branch protection rule on `main` would enforce the no-direct-push rule that
   is currently only written down here.
3. **Component tests.** Needs `@testing-library/react` and `jsdom` as dev dependencies, so ask
   first. The domain and the server are well covered now; the components are covered only by the
   browser runners.
4. **A `rev` on `Estimation`.** Add a `rev` or a server-side `updatedAt` now, while the schema is
   cheap to change, so optimistic concurrency is possible later without a migration. Enforcing it
   needs per-record writes, which is deferred.
5. **An audit trail**, as a sixth sheet recording what changed and when. Cheap now, impossible to
   reconstruct afterwards, and the first thing anyone asks when a number changes. Recording *who*
   needs per-user accounts, which is deferred.
6. **Backup rotation**, a dated copy of the workbook per day. Last-write-wins plus no history is
   one bad `?force=1` away from a bad afternoon.
7. **A payload size cap** on `/api/state`. Rate limiting needs a counter shared across function
   instances, which is deferred.
8. **Error reporting for the browser**, so a failed sync in the field is visible rather than just
   a red pill nobody screenshots. Check the privacy rules above before choosing a service.
9. **A runbook for `EDLY_CATALOG_URL`.** Updating the catalog without a redeploy is supported and
   almost undocumented.
10. **A prose lint** (for example a `rg` check in CI for `—` outside the known null-glyph uses),
    if the voice rules turn out to need enforcing rather than remembering.
11. **A chat panel on the tender screen.** Questions about the tender ("does it need offline
    mobile?", "why R-14 and Stripe?", "Open edX or Totara?") answered from the cached documents and
    the catalog. When it suggests a change, the change must arrive as a pending edit in the review
    table for a person to accept, never as a write. Phase 2 of the tender intake.
12. **A switch to drop the reuse discount.** Price a bundle feature at its original build hours
    rather than its first-delivery hours, per estimation, for a client the reuse price should not
    reach. The user raised it on 2026-09-27 and chose to leave it for later.
13. **A compliance-matrix export** from a tender: requirement, comply / partial / custom, the
    solution that covers it. Bid submissions usually demand one, and the match step already holds
    it; the workbook writer in `src/lib/xlsx.ts` does the rest.
14. **Sync issues left, found on production (Google Sheets) on 2026-09-28.** (a) A page saves the
    whole workbook on load with nobody touching it: the open estimation's id and the catalog
    source (dated, so every first load of a day) live in the shared Settings tab, and the desk
    rewrites its display settings. That save is what lost a change: a page reloaded a second
    after an edit read the sheet before the unload save landed, then saved its older copy over
    it. Keep per-tab state (the open estimation) out of the synced settings and leave the catalog
    source alone when the served sheet is unchanged. (b) Anything done before a page's first read
    of the sheet lands (the pill says "connecting") is replaced by that read. Block edits until
    then, or merge. (c) The sync pill says "saved" while a change waits for its debounce; the
    `persisted` memo in `AppProvider.tsx` changes on every state change, not only on data. Also
    worth knowing: every tab reads and writes as one Google service account, about 60 reads a
    minute between them, so many open tabs can run into the quota. Fixed on 2026-09-28: a save
    still on its way when the page is left is cancelled and the newest copy sent at once
    (`unloadPlan`); waiting behind it lost a desk filing on production. Fixed on 2026-09-27: the unload
    save was a beacon, and Chrome drops one over 64 KB without telling the page, so once a
    workspace held a large import any change made in the second before a reload was lost. A save
    too big for a beacon now starts at once and the browser is asked to hold the page
    (`unloadPlan` in `state/syncPolicy.ts`, and a 1,203-estimate drive that fails on the old code).
    Also fixed on 2026-09-27: a save that could not run, before the tab's first read or while another save
    was in flight, used to be dropped until the next change; it is now owed and made as soon as it
    can be. That was the in-flight issue this item listed, and it lost imports. Fixed alongside
    the tender work, in `AppProvider.tsx` and `state/keys.ts`: three ways one tab wrote an older
    copy into browser storage over a sibling tab's newer one. A tab
    now writes only the slices it changed (`changedSlices`), and a slice it took from the store,
    from another tab, or from storage at boot counts as already written, so it is never echoed
    back. Keep all three if you touch the persist effect; the two-tab browser drive is what
    caught them.
15. **Read a clean requirements matrix without the AI.** A sheet whose Columns line names an ID,
    a requirement and a priority (MoSCoW or must/should) can be turned into requirements in the
    browser, with no extraction call at all; the AI would still match them. That is most of a
    matrix-heavy tender's extraction cost and time. Needs a decision on how sure the header
    match must be before the AI is skipped, and a fallback to the AI when it is not.
16. **Send each extraction call only its own pages of a PDF.** Every call now carries the whole
    PDF from cache, at a twentieth of the price on Opus 5.5; splitting the PDF would make each call carry its
    own pages at full price, and lift the 600-page limit on one request. Needs a PDF library (a
    new dependency, so ask) or a hand-written page splitter, which real-world PDFs make hard.
    Measure first: with caching working, it may not be cheaper.
17. **Run a PDF tender and a spreadsheet tender through the real API**, and build the small eval.
    The 2026-09-29 run (VERIFY.md) used one Word tender, so these are still unmeasured: what a PDF
    page really costs (the stand-in assumes 3,000 tokens), whether a spreadsheet call reads only the
    converted text from cache and writes nothing, how long a 20-page PDF range and a 60-row sheet
    range take, and the same tender at `EDLY_AI_EFFORT=low` against `medium` (requirements found,
    output tokens). Then three or four invented tenders with known requirements, so a prompt change
    is measured rather than eyeballed. Each run spends real money, about $1 to $3 a tender on Opus
    5.5, so it needs a yes first. Also compare the tender's "AI cost" line with the Anthropic
    Console for the same day; the app's figure matched the per-call usage to the millionth of a
    dollar, but only the Console holds the bill.
18. **Count what a call wrote before it was cut off.** The API reports output tokens only at the
    end of a stream, so a call stopped at the deadline (`callDeadlineMs`) is counted with the input
    it read and almost no output, while everything it streamed is billed. Opus 5.5 at `medium`
    wrote about 100 tokens a second on the real run, so a call cut off at 270 s can leave about
    27,000 output tokens (about $0.54) out of the tender's total, and the spending limit errs late
    rather than early. An estimate from the time the call streamed would keep the limit erring
    early; it needs a decision on the rate to assume, per model.
19. **Keep Word's automatic numbering when converting a .docx.** `docxXmlToText` reads the text
    runs, and a clause number Word generates (`w:numPr`, defined in `word/numbering.xml`) is not
    text, so "1. General Description" arrives as "General Description". Typed numbers ("3.1") come
    through. On the real run 103 of 241 requirements still carried a reference, but a bid team
    finds a clause by its number. Needs the numbering definitions read, levels and restarts
    included, and a heading style's numbering from `word/styles.xml`.
20. **Run the sort and the key-terms calls for real, on `TND-multa391`.** Built on 2026-09-29 and
    driven end to end against a stand-in only. One `op=sort` call over its 50 out-of-scope items
    (about $0.05) checks the teams against the table in `docs/plans/sales-account-legal.md` (sales
    about 13, account about 10, legal 18, people 6, certification 3), and one `op=terms` call on its
    Word document (about $0.10 while its cache is warm) measures what a terms read really costs and
    whether it reads the tender from the cache. Both spend real money, so they need a yes first; the
    tender's files are at Anthropic until 2026-10-01.

---

## Reporting your work

Say what changed, what you verified, and how. Name the tests you added and the paths you clicked.
This is the right shape: *"added `setLineBuffer` cases to `tests/reducer.test.ts`, ran
`bun run check` (362 pass) and `bun run test:coverage` (94.9% statements), drove builder to
planner to export on localhost at 1280px. Not committed."*

If something is broken, blocked or unverified, say that plainly instead of rounding it up to done.
If you touched persistence, say so explicitly and name the test that covers it.
