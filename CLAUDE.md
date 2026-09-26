# CLAUDE.md

Working agreement for Claude Code in this repository. Read this first, then **ARCHITECTURE.md**
before the first change and **CONTRIBUTING.md** for the conventions. This file says *how to work
here*; those two say *what the code is*.

---

## What this is

Edly's sales and estimation tool. Sales configures a client solution bundle and gets hours, cost
and a delivery plan. The estimation desk prices whatever is not in the catalog and sends it back.

**React 18, TypeScript (strict), Vite, Bun, Vercel. Two runtime dependencies: React and React
DOM.** The `.xlsx` reader and writer, the zip writer and the Google JWT signing are all written
here on purpose.

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

`bun run test` runs 343 tests across thirteen files.

| File | Covers |
|---|---|
| `tests/domain.test.ts` | `calcEstimate`, `schedule`, catalog composition and helpers |
| `tests/reducer.test.ts` | every state transition, selector and label |
| `tests/router.test.ts` | URL to state and back, both directions |
| `tests/schema.test.ts` | state to spreadsheet rows, chunking, round trip |
| `tests/api.test.ts` | `/api/state` end to end, and the empty-payload guard |
| `tests/handler.test.ts` | the Vercel and web request adapters |
| `tests/storage.test.ts` | browser storage, the store layer, Vercel Blob |
| `tests/providers.test.ts` | Google Sheets, OneDrive, Dropbox, against a stubbed `fetch` |
| `tests/xlsx.test.ts` | the hand-written `.xlsx` reader and writer |
| `tests/catalogSheet.test.ts` | the master catalog workbook and hand-edited sheets |
| `tests/quoteExport.test.ts` | the workbook a client receives |
| `tests/mail.test.ts` | the desk emails and the clipboard fallback |
| `tests/format.test.ts` | money, hours, dates, the plain-text quote |

### Coverage

`bun run test:coverage`. Current state, measured rather than estimated:

| | |
|---|---|
| Statements | 94.7% |
| Lines | 96.5% |
| Functions | 96.2% |
| Branches | 79.2% |

The thresholds in `vitest.config.ts` are floors set just under those numbers, so a change that
drops coverage fails the run. Raise them when you can. Do not lower them to make a change pass.

Two things to know before you touch the coverage config:

- **The provider is istanbul, not v8, and that is deliberate.** There is no Node on this machine,
  so vitest runs under Bun, where the v8 provider silently fails to map several files and then
  reports them as 100% covered. It claimed full coverage of `quoteExport.ts` when the real figure
  was 28%. A number that is wrong in the flattering direction is worse than no number.
- **Some files are excluded, and the list is not a dumping ground.** `ganttPng.ts`, `useHover.ts`,
  `useViewport.ts`, `AppProvider.tsx`, `useSync.ts` and `useRouting.ts` need a DOM, a canvas or a
  React renderer, and are exercised by the browser runners in VERIFY.md instead. Excluding them
  is honest; excluding something merely because it is awkward to test is not. If you add to that
  list, say why in the config and in your report.

What the number does not cover, and you should say so rather than implying otherwise: the React
components, the sync loop's timing behaviour, and the cloud providers against their real services.

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

### The five sheets

`Estimations`, `Requests`, `EstimatedSolutions`, `CustomBundles`, `Settings`. Scalar columns stay
readable so a human can scan the sheet in Excel, and nested state sits in one JSON column per row
so the app round-trips losslessly.

### Four data-safety rules that are not negotiable

Each of these exists because it failed once. Do not weaken one to make a feature easier.

1. **Nothing is pushed before a read succeeds** (`useSync.ts`). An empty browser must never be
   able to blank the spreadsheet because the network was down at boot.
2. **A background pull never overwrites unsaved local edits.** If both sides changed, say so and
   ask for a reload rather than silently picking a winner.
3. **A zero-row `PUT` is refused while the store holds rows** (`api/state.ts`, 409). `?force=1`
   clears deliberately. `tests/api.test.ts` covers this. Keep it green.
4. **A workbook that merely exists is not data.** `state:seed` writes an empty workbook, so
   `loadState` reports a zero-row store as empty on every provider. Otherwise the app hydrates the
   browser with nothing and discards what it was holding. All five providers must answer this
   identically: see `populated()` in `server/store.ts`.

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
- Do not add analytics, error reporting or logging that sends estimate contents off the machine
  without asking first.
- Do not write client data into test fixtures. The fixtures use `Acme Academy` and
  `Nordic University` for a reason. Keep inventing names.
- Do not log hours or money to the console in code that ships.

---

## Where to be careful

- `src/state/useSync.ts`: the data-safety rules. Read the comments before editing.
- `api/state.ts`: the empty-payload guard.
- `server/store.ts`: `populated()` decides whether a store counts as empty, and all five providers
  must answer identically.
- `server/schema.ts`: values over about 28,000 characters chunk across numbered rows, and each
  chunk is pipe-wrapped. Excel truncates a longer cell silently, and the reader trims cells. The
  pipe wrapping applies to the chunked `Settings` rows, not to the estimation snapshot column.
- `src/domain/planner.ts`: the packing loop is bounded (`guard < 800`). Keep a bound.
- `src/lib/catalogSheet.ts`: header matching claims exact matches before prefixes, so "Bundle ID"
  is not stolen by the "Bundle" alias. Keep that order.
- `src/lib/router.ts`: `parseRoute` and `formatRoute` must stay inverses.
- `index.html`: the `<base href>` is load-bearing. Without it a deep link makes every relative URL
  resolve against the route instead of the mount point, and the catalog sheet 404s.
- **An un-estimated request round-trips with no hours at all, not `0`.** Zero reads as "estimated
  at nothing" and joins the totals. The same rule holds throughout: `null` means nobody has priced
  it.

---

## Known limits, which you should state rather than paper over

- **Sign-in is a client-side demo gate** (`admin` / `admin`), and **`/api/state` is
  unauthenticated**, so anyone with the URL can read or overwrite the spreadsheet. Put Vercel
  Authentication or an SSO proxy in front before this holds live client numbers. Deep links make
  this more urgent, not less.
- **Concurrency is last-write-wins** across the whole workbook.
- **Only Open edX has a client-proven catalog.** The other 19 platforms ship benchmark hours and
  are labelled *Sample* in the UI. Do not present them as delivery records.
- **No i18n.** Copy is inline English.

---

## Worth adding next

Roughly in order of what would prevent the most damage.

1. **Real authentication** in front of the app and `/api/state`. Everything else on this list
   matters less than this one, because the tool holds client pricing.
2. **CI running `bun run check` and `bun run test:coverage`** on every push, so the gate is not a
   matter of memory. A branch protection rule on `main` would enforce the no-direct-push rule that
   is currently only written down here.
3. **Component tests.** Needs `@testing-library/react` and `jsdom` as dev dependencies, so ask
   first. The domain and the server are well covered now; the components are covered only by the
   browser runners.
4. **Per-estimation concurrency.** Add a `rev` or a server-side `updatedAt` to `Estimation` now,
   while the schema is cheap to change, so optimistic concurrency is possible later without a
   migration.
5. **An audit trail**, as a sixth sheet recording who changed what and when. Cheap now, impossible
   to reconstruct afterwards, and the first thing anyone asks when a number changes.
6. **Backup rotation**, a dated copy of the workbook per day. Last-write-wins plus no history is
   one bad `?force=1` away from a bad afternoon.
7. **Rate limiting and a payload size cap** on `/api/state`.
8. **Error reporting for the browser**, so a failed sync in the field is visible rather than just
   a red pill nobody screenshots. Check the privacy rules above before choosing a service.
9. **A runbook for `EDLY_CATALOG_URL`.** Updating the catalog without a redeploy is supported and
   almost undocumented.
10. **A prose lint** (for example a `rg` check in CI for `—` outside the known null-glyph uses),
    if the voice rules turn out to need enforcing rather than remembering.

---

## Reporting your work

Say what changed, what you verified, and how. Name the tests you added and the paths you clicked.
This is the right shape: *"added `setLineBuffer` cases to `tests/reducer.test.ts`, ran
`bun run check` (343 pass) and `bun run test:coverage` (94.7% statements), drove builder to
planner to export on localhost at 1280px. Not committed."*

If something is broken, blocked or unverified, say that plainly instead of rounding it up to done.
If you touched persistence, say so explicitly and name the test that covers it.
