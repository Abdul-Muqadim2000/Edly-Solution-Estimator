# Verification

Two browser-based test runners that need **no toolchain** — no `bun install`, no compiler. They
fetch the real `src/` and `server/` TypeScript, transpile it with Babel standalone, and run it.

They exist because they caught two real bugs that static review and type-checking both missed.
Keep them working; they are the cheapest end-to-end check in the repo.

## Running them

They must be served by a **plain static file server**, not Vite — they do their own transpiling,
and Vite would hand them pre-transformed modules.

```bash
python3 -m http.server 8080 --directory .
# then open:
#   http://localhost:8080/public/verify-domain.html
#   http://localhost:8080/public/verify-app.html
```

Any static server works (`npx serve`, `caddy file-server`, etc.) as long as the document root is
this directory.

## verify-domain.html — the logic and the schema

Runs `tests/domain.test.ts` and `tests/schema.test.ts` against the real sources, with a small
`describe/it/expect` shim. **102 assertions**, all green on 2026-09-29 (81 on 2026-09-27, 59 on 2026-09-26). Same code Vitest runs, so a
green run here and a green `bun run test` mean the same thing. The shim covers `toMatchObject` and
`.not` since that date, and `toMatch` and `toHaveProperty` since 2026-09-27; before each, some
assertions failed on the shim rather than on the code.

Both runners stopped loading anything between 2026-09-26 and 2026-09-27, when server files began
importing each other by their `.js` names for Node on Vercel: the loaders asked for
`format.js.ts`. They now drop the `.js` before trying `.ts` and `.tsx`. If a runner shows
"cannot resolve module", look there first.
Chrome caches the page between runs, so add a query string (`?fresh=1`) after editing it.

Covers the estimate maths (buffer ordering, role-aware cost, PM/QA overhead, double-billing
guard), the planner (duration from staffing, the headcount cap, pinning, reordering), catalog
composition and diffing, and the full spreadsheet round-trip including a 112 KB catalog that has
to chunk across cells.

## verify-app.html — the app, mounted and driven

Mounts the real `<App />` and walks a full session: sign in → practice → platform → estimation
desk → tab switches → role swap → create an estimation → parse the catalog workbook → select
solutions → rate card → assign a role → planner → staffing → presentation mode → back to the hub.
**29 steps**, with a final check that nothing threw. On 2026-09-26, 26 of the 29 passed on both the
committed code and the tender-intake branch, and on 2026-09-27 the same 26 passed on `main` and on
the bundles-and-estimates branch: the desk's "Add to catalog" and "Estimations" tab steps
and the timed hover probe fail on both, so they predate the tender work and are still to be looked into.
On 2026-09-29, 25 of the 29 passed on both `main` (ca52a16) and the sales, account and legal
branch: the two desk steps, "Interactive elements are wired for hover" and "Focus styling applies to
form fields" fail on both, so the fourth failure predates that branch too.

Six of those steps guard the *design and the feel*, not the logic. Two drive real `mouseover`
and `focus` events and assert the computed style changes — React synthesises `onMouseEnter` from a
delegated `mouseover`, so a synthetic `mouseenter` is ignored, and the probe retries because the
first dispatch after a re-render can land before React re-attaches. The other four: the edly.io marketing header and its nav
tree, the hero with its stat cards and credibility row, the sticky `Bundle Builder` bar, and the
footer with all four link columns and the legal row. They exist because the first port shipped
without any of it.

Calls to `/api/state` fail by design here — nothing is running behind them. That is itself worth
watching: the sync pill should go red and say *nothing will be saved*, never fail silently.

Two notes on reading the results:

- The step **"Adding people shortens that task"** can pass via an "already at the 0.5-week floor"
  escape hatch, which proves nothing. The per-task duration maths is properly covered by
  `tests/domain.test.ts` → *derives duration from staffing*. Trust that one.
- Watching the **project** end date get *longer* when you add people to one task is correct
  behaviour, not a bug: a task hogging the headcount cap starves the rest and pushes them later.
- Hover is checked **twice**. "Interactive elements are wired for hover" is deterministic — it
  asserts each element declares a CSS transition, which only happens if it routes through a
  hover-aware primitive. "Hover states observed firing" drives real `mouseover` events and is
  **advisory**: synthetic pointer simulation is unreliable late in a long run because React
  re-renders between probes. Read its detail line, not just the tick.
- This page links `../src/index.css` directly, because it mounts `<App />` without going through
  `main.tsx` (which is where the real app imports the stylesheet).
- **Routing runs in the hash here, and that is correct.** A plain static server has no rewrite to
  serve `index.html` for `/p/openedx/e/…`, so `usesHash` sees a named `.html` document and puts
  routes in the fragment: you will see `verify-app.html#/p/openedx/e/…` in the address bar rather
  than the clean paths production serves. Both are covered by `tests/router.test.ts`.
- The shell assertion prints the viewport it ran at. Under ~1020px the builder is *meant* to be a
  single column with the rail as a wrapping row and no "Std deploy" column — a narrow run is not a
  regression. The preview frame here is usually ~920px, so that is the path you will normally see.

## The tender AI, run for real

Run by hand on 2026-09-29 against the real Anthropic API: Opus 5.5 at `medium` effort, one public
university-system LMS tender as a Word file (75 parts, 93,510 tokens), matched against the Open edX
catalog with 413 imported estimates (500 catalog lines, 47,005 tokens). The dev server ran with the
key, a local pass-through logged each call's usage (never the key or the text), and headless Chrome
drove the screens. There is no script for it in the repo; it spends money, so it is run on purpose.

| Step | Calls | Time per call | Cost | Cache |
|---|---|---|---|---|
| Fit | 1 | 62 s | $0.61 | wrote the tender once (96,014 tokens, five-minute entry) |
| Keep-warm | 1 | 6 s | $0.02 | read all of it, no output billed |
| Extraction | 6 | 10 to 118 s | $1.05 | every call read the tender, none wrote it |
| Matching | 6 | 49 to 66 s | $1.41 | the two first batches both wrote the catalog (fixed since) |

What held:

- The tender's "AI cost" ($3.09) equals every call's usage priced at `src/domain/aiPrice.ts`, to the
  millionth of a dollar. Opus 5.5 answered every call; no refusal fallback ran.
- The fit recommended Open edX (medium confidence, with Canvas, Moodle and Blackboard as the
  alternatives), read the deadline and the client correctly, and planned 51 of 75 parts. It kept
  the delivery obligations inside the legal terms (data security, incident notice, FERPA,
  accessibility, the SLA rider) as sections of their own and skipped the rest.
- 241 requirements: 167 must, 74 should, 11 out of scope, 104 with the tender's own reference.
  236 quotes are verbatim on the part they cite and the other 5 are the tender's words shortened
  with "...". Every page cited is inside a range that was read. About a dozen pairs say the same
  thing twice, because the tender restates its scope in three places; that is what Combine is for.
- Matching returned only catalog ids; 278 of 319 references point at imported estimates.
- The keep-warm is accepted with the tools, adaptive thinking and the fallback beta, and it keeps
  the entry alive: written at 0:00, refreshed at 4:00, still read at 8:30 (a separate $0.02 check).
- The spending limit ($1 a step for the run) stopped a "Read it too" and matching, asked with the
  right figures, and went on by a full step. Matching passed the limit by $0.31, the calls running.
- A call cut off by `EDLY_AI_DEADLINE_MS` (20 s for the test) answers `timeout` with what it read.
- Free failures, each with the message a person can act on: no key, a key Anthropic rejects, a
  model the key cannot use, a file deleted at Anthropic (410), and discard refusing a file the app
  did not upload.
- Apply, on a copy of the store: the estimation picked the accepted solutions with hours from the
  catalog, the desk requests carried the tender deadline, and sending deleted the file at Anthropic.

Found and fixed: two match batches started together each wrote the catalog to the cache, about
$0.23 wasted per tender at this catalog size. The first call on a cold cache now goes alone
(`callSlots`). And some matches named two solutions that do the same job (the built badge feature
and an unbuilt badge service together, 340 h for 180 h of work), which the estimation would have
priced twice. The match instruction now asks for every part a requirement needs but only one of two
alternatives, the built one first. Checked on the real API with ten of the tender's requirements
($0.37 for two runs): the five with alternatives each came back with one, and the five whose parts
go together kept them (migration kept its three steps, notifications its engine, providers and SMS).
A first wording, "name only the solutions the requirement needs", also dropped needed parts, so
keep the instruction aimed at alternatives. Found and not fixed, in CLAUDE.md *Worth adding next*: a cut-off call's output is
not counted (18), and Word's automatic clause numbers are lost in conversion (19). Not yet run for
real: a PDF tender, a spreadsheet tender, a refusal, a rate limit (17).

## Sales, account and legal, driven end to end

Driven on 2026-09-29 in headless Chrome against a stand-in Anthropic API (every tool answered in
the real streamed wire format, and each call logged with the documents and cache markers it
carried, never their text), on test servers at :3002 to :3004 with their own stores. The first
real tender's store was driven on a copy, from where it was left (241 approved, 50 out of scope,
nothing accepted). No money was spent; the real calls are CLAUDE.md *Worth adding next* 20.

- The tab: 50 items listed unsorted, one sort call with no documents sorted all 50, a team changed
  by hand, one left out, one made custom work, the rest accepted at once, the match step showing
  and changing an out-of-scope item's team, and "Read the terms now" reading three terms from the
  cached document into their teams (23 checks).
- Apply and the builder: the third section counted and ticked, creating the estimation copied the
  kept items once each into the `SalesAccountLegal` sheet, one kept afterwards was added once, and
  the Sales & legal window showed each item with its reason, tender section, source and wording
  and took owner, status, due date and note, a team's owner at once, an item by hand and its
  deletion. It fits at 1440, 1150 and 900 px; presenting hides the pill, the window and the hub
  count; a second tab showed an owner change without a reload; a reload kept it all (45 checks).
- The client's files: with a solution picked, the downloaded task breakdown and the printed quote
  carried none of 104 phrases from the deal's 51 items (4 checks).
- A new tender with the terms ticked: the terms read after the extraction, from the same cached
  prefix, and the sort ran by itself once matching ended, never again on a later visit (17 checks).
- At a $0.02 limit, the terms read and then the sort each waited for Continue, the question named
  them, and the tender's cost matched the stand-in's bill to the millionth of a dollar (8 checks).
- A failed terms read showed Retry, kept the tender files at Anthropic when the desk requests went,
  and Retry read them into the estimation from the tab (9 checks).
- A tender applied before it was sorted: nothing was spent on the way, and Sort them, pressed on
  the tab, gave the estimation's 50 items their teams in one call (7 checks).

All the checks passed again on the final code (111 after the window replaced the dropdown), after a review pass that made the automatic sort
leave the estimation alone, split a terms read that times out, kept a tender's key terms when a tab
on the previous build saves it, and let items of a deleted tender be deleted.

Found on the way, and fixed: the local file store rewrote its file in place, and a read that landed
mid-write parsed as a workbook missing sheets or rows (271 of 644 reads during saves). It now
writes beside the file and renames over it (`server/providers/builtin.ts`). Also fixed: the tab
said nothing about requirements read as out of scope and not yet approved.

## What these do not cover

- **`tsc --noEmit`.** Babel strips types without checking them. Run `bun run typecheck`.
- **ESLint.** Run `bun run lint`.
- **The storage providers.** `server/providers/graph|gsheet|dropbox` talk to real APIs and can only
  be verified against real credentials — use `bun run store:probe` once the env vars are set.
- **The Vercel build.** `bun run build` is the check for that.

So: green here plus a green `bun run check` is the real gate.
