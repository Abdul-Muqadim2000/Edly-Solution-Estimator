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
`describe/it/expect` shim. **33 assertions.** Same code Vitest runs, so a green run here and a
green `bun run test` mean the same thing.

Covers the estimate maths (buffer ordering, role-aware cost, PM/QA overhead, double-billing
guard), the planner (duration from staffing, the headcount cap, pinning, reordering), catalog
composition and diffing, and the full spreadsheet round-trip including a 112 KB catalog that has
to chunk across cells.

## verify-app.html — the app, mounted and driven

Mounts the real `<App />` and walks a full session: sign in → practice → platform → estimation
desk → tab switches → role swap → create an estimation → parse the catalog workbook → select
solutions → rate card → assign a role → planner → staffing → presentation mode → back to the hub.
**29 steps**, with a final check that nothing threw.

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
- The shell assertion prints the viewport it ran at. Under ~1020px the builder is *meant* to be a
  single column with the rail as a wrapping row and no "Std deploy" column — a narrow run is not a
  regression. The preview frame here is usually ~920px, so that is the path you will normally see.

## What these do not cover

- **`tsc --noEmit`.** Babel strips types without checking them. Run `bun run typecheck`.
- **ESLint.** Run `bun run lint`.
- **The storage providers.** `server/providers/graph|gsheet|dropbox` talk to real APIs and can only
  be verified against real credentials — use `bun run store:probe` once the env vars are set.
- **The Vercel build.** `bun run build` is the check for that.

So: green here plus a green `bun run check` is the real gate.
