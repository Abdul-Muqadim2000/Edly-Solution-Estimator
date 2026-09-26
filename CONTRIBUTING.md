# Contributing

## Before you commit

```bash
bun run check    # typecheck + lint + tests. All three must pass.
```

CI should run exactly that. `bun run test:watch` while you work.

## Conventions

**TypeScript is strict, including `noUncheckedIndexedAccess`.** `array[0]` is `T | undefined`, so
handle it. No `any` — `unknown` plus a narrowing function instead. Type imports use
`import type`.

**Name things for what they are, not what they hold.** `platformEstimations`, not `filtered`.
`ownedCatalogIds`, not `map2`.

**Comments explain why, not what.** The codebase has very few, and each one records a decision or a
trap: why chunks are pipe-wrapped, why unassigned bars are slate, why ids come from the highest
number. Add that kind; delete the other kind.

**Pure logic goes in `src/domain/` with a test.** If a component is doing arithmetic, it is in the
wrong place. Anything in `domain/` must be callable from a test with plain objects.

**Components take props, read `useApp()` for shared state, and dispatch actions.** No component
mutates state directly, and none talks to `fetch` except through `src/api/client.ts`.

**Styling comes from `theme.ts`.** Inline style objects, colours by name. A hex code in a component
is a bug.

**Interaction states go through the primitives.** Inline style objects cannot express `:hover`, so
`Button`, `Card` and `Link` track it with `useHover`, and `Field`/`Select`/`TextArea` track focus
with `useFocus`. Use those. For a bespoke clickable row, `useRowHover(hoveredStyle)` gives you the
handlers and the merged style in two lines. Do not add a new interactive element with no hover
treatment — `verify-app.html` asserts this, and a dead-feeling UI is what those checks exist to
catch.

**No new runtime dependencies without a conversation.** The app ships React and React DOM. The
`.xlsx` reader, the zip writer, the JWT signing for Google — all written here, all small, all
testable. That is a deliberate trade: fewer supply-chain surprises, and no build-time surprises on
Vercel.

## Changing the spreadsheet schema

`server/schema.ts` is a contract with data that already exists in someone's OneDrive.

1. Add the column to `COLUMNS` and write it in `stateToSheets`.
2. Read it back in `sheetsToState`, defaulting sensibly for rows written before it existed.
3. Add it to the fixture in `tests/schema.test.ts` and assert it survives.

Never remove or reorder a column: read by name, not by position. A file written by an older build
must still load.

Three specific traps, all covered by tests:

- An **un-estimated request must round-trip with no hours at all**, not `0`. Zero reads as
  "estimated at nothing" and joins the totals.
- Any value that can exceed ~28,000 characters must chunk. Loaded catalogs do.
- **An estimation's `slug` is never recomputed.** It is what deep links are built from, so a
  renamed deal keeps the slug it was created with. `withSlugs` only ever fills a blank one, and
  only uniquely within a platform.

## Pull requests

Small, one concern each. In the description, say what changed and what you verified — "ran
`bun run check`, added a case for X, clicked through desk → estimation page" is enough.

If you touched persistence, say so explicitly and name the test that covers it.

## Where to be careful

- `useSync.ts` — the three data-safety rules. Read the comments before editing.
- `api/state.ts` — the empty-payload guard.
- `domain/planner.ts` — the packing loop is bounded (`guard < 800`); keep a bound.
- `lib/catalogSheet.ts` — header matching claims exact matches before prefixes, so "Bundle ID" is
  not stolen by the "Bundle" alias. Keep that order.
- `lib/router.ts` — `parseRoute` and `formatRoute` must stay inverses; `tests/router.test.ts`
  round-trips every route and will tell you when they drift.
- `index.html` — the `<base href>` is load-bearing. Without it a deep link makes every relative
  URL resolve against the route rather than the mount point, and the catalog sheet 404s.
