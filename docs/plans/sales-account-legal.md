# Sales, account and legal items: plan

Status: decided on 2026-09-29 (the user's answers are at the end), and built the same day in the
order below on the branch `feat/sales-account-legal`, not committed yet. Names settled in the build:
the record is `SalesLegalItem` in the `salesLegal` collection (working name `CommitmentItem`), and
its link to the tender is `tender` plus `tenderItem`, which holds a requirement (R-14) or a term
(T-03), rather than `tenderReq`. The real `op=sort` and `op=terms` calls on `TND-multa391` below are
still to run, after a yes (CLAUDE.md, Worth adding next 20).

## The problem

A tender's out-of-scope requirements are obligations someone still has to meet, but today they go
nowhere. They stay on the tender record (inside the `detailJson` cell of the Tenders sheet) and show
only under the "Out of scope" filter on the match step. Creating the estimation carries only the
accepted catalog solutions, and only custom and partial matches go to the desk. So the sales,
account and legal teams never see them, and the estimation forgets them.

The first real tender (UT System LMS RFP, `TND-multa391` in the local store) had 50 of them:

| Group | Count | Examples |
|---|---|---|
| Sales and commercial | about 13 | quarterly spend, rebate and off-contract price reports; the 2% admin fee; invoice and pricing accuracy; service credits for missed SLAs |
| Account management | about 10 | account managers, a contract manager, business reviews and KPI reporting, satisfaction surveys, per-institution work plans, outreach and VetHUB events |
| Legal and compliance | 18 | confidentiality of records and FERPA records, breach notice within a day, subcontractor flow-down, Public Information Act, records retention, state AI ethics code, certified data deletion |
| People and staffing | 6 | background checks, state cybersecurity training, campus rules, a designated representative, staff for parallel rollouts |
| Certification | 3 | TX-RAMP certification, and evidence of it for subcontracted cloud services |

Several carry real cost or bid risk even though they are not software: TX-RAMP (a go/no-go for the
bid), a six-month transition period after expiry (hosting and support), fixing accessibility
failures at no cost, service credits, and no secondary use of their data (which constrains the AI
features). That is why the team needs to see them.

Separately, and on purpose since 2026-09-28, standard legal and commercial terms (insurance,
liability, indemnity, payment, IP, warranties, termination) are not extracted at all. The list above
holds only obligations the extraction kept. The user chose (decision 6) to let the person decide per
tender, at the start: see "Key legal and commercial terms, by choice" below.

## What the team gets

1. **On the tender page, a "Sales, account and legal" tab** beside the three steps. It is not a step
   and blocks nothing. It lists the out-of-scope items grouped by category, each with the AI's reason,
   where it came from (`sourceLabel`: document, part or page, the tender's own reference) and its
   priority. A person can change an item's category, leave it out, or turn it into custom work (which
   the match step already allows, so it goes to the desk). The tab shows a count.
2. **When the estimation is created, the items go with it.** The apply step gains a third section,
   "Sales, account and legal: N items go with the estimation", with the same leave-out tick as the
   desk drafts. This mirrors the desk: drafts computed by a pure function, records made by the
   reducer when a person clicks.
3. **On the estimation page, a "Sales & legal" tab in the builder's top bar,** beside Excel sheet
   (the bar holds Catalog, Rates, Present, Display and Excel sheet), showing the open count and
   opening a panel like the others. The user asked for it there, where the downloads and bundles are.
   Each item has an owner (Sales, Account, Legal, Delivery, or a name), a status (Open, Handled, Not
   for us), an optional due date and a note. Items can be added by hand, on any estimation, not only
   one made from a tender. **Hidden in Present to client mode,** like Rates and Excel sheet, because
   sales screen-shares the builder and "must hold TX-RAMP" is not for the client's eyes.
4. **On the hub, an estimation card shows "7 open sales and legal items"** when it has any.
5. **In the spreadsheet, a new tab with one readable row per item,** so the legal and account teams
   can filter and assign them in Google Sheets without opening the app.

Never in the client quote, the printed quote or the Excel task breakdown (decision 7: never).
`tests/quoteExport.test.ts` should prove it, the way it proves no money leaks when the Excel sheet
panel unticks it.

## Data model

A new record type in `src/types.ts`, name to settle (working name `CommitmentItem`):

`id` (`SL-01`, from `highestId`/`serialId`), `plat`, `estId`, `tender` and `tenderReq` (blank when
added by hand), `category`, `kind` (`obligation` for an out-of-scope requirement, `term` for a key
legal or commercial term, below), `text`, `quote`, `source` (the label, frozen at apply so it survives
the tender being deleted), `priority`, `owner`, `status`, `due` (optional, yyyy-mm-dd), `note`,
`at`, `up`. The sheet tab is `SalesAccountLegal`, scalar columns only, readable in Google Sheets.

It is its own collection and its own sheet, not part of the estimation snapshot, for three reasons:

- The snapshot is one cell and is not chunked (only Settings and Tenders rows are). A tender with 150
  such items would run past Excel's cell limit, which truncates silently.
- The teams who need these rows filter columns; a JSON cell cannot be filtered.
- Status and owner change often and independently of the estimation's numbers.

Before apply the items are still tender requirements (`match.kind === 'out'`), and the category and
leave-out choice live on the match (`RequirementMatch.category`, `skip` already exists), exactly as a
desk draft's edits live on `match.draft`. At apply they are copied into the new collection; from then
on the collection is the source of truth and the tender tab links to the estimation. Applying twice
must not copy twice (`sentRequirementIds` is the pattern).

### Touch-points for a new persisted collection (from the 2026-09-26 map)

`PersistedState` in `types.ts`; `SHEETS`, `COLUMNS`, `stateToSheets`, `sheetsToState`, `coerceState`,
`countRows` in `server/schema.ts`; `populated()` in `server/store.ts` (miss it and a store holding
only these rows reads as empty); the `counts` block in `api/state.ts`; `toPersisted` in the reducer;
the `persisted` memo, `onHydrate`, the localStorage writes, the `storage` handler and
`hydrateFromStorage` in `AppProvider.tsx`, and `changedSlices`; `SYNCED_DATA_KEYS` in `state/keys.ts`;
the `incoming` object in `useSync.pull`. Data-safety rule 5 applies: a payload with no key for the
new collection (a tab on an older build) keeps what is stored. Every write still goes through one
`saveState`.

## Categories and the AI

Five categories, names to confirm: Sales and commercial, Account management, Legal and compliance,
People and staffing, Certification.

Recommended: one small AI call per tender after matching, `op=sort`, that sorts every out-of-scope
item without a category. It sends only the items' text and the matcher's reason (no documents, no
catalog), about 50 items for roughly $0.05, and it answers through a new strict tool,
`report_categories`, with an enum. It passes `canSpend` like every other call. The same call serves
tenders matched before this feature (a "Sort them" button, which is how `TND-multa391` would get
categories). A person can change any category; the AI only proposes, as everywhere else.

Why a separate call rather than a field on `report_matches`: the 11 items flagged at extraction never
reach the matcher (`outOfScopeMatches` settles them locally), so a field there would leave those
without a category and need a second mechanism anyway. Adding a tool changes the shared prefix once
(`server/ai/prompts.ts`: every call sends the same tools), which costs one cache write per tender
after the deploy and nothing after.

No keyword guessing in the browser: it would be wrong often enough to be ignored.

## Key legal and commercial terms, by choice

Decided: ask at the start of each tender. The upload screen gains a tick, off by default:
"Also list the key legal and commercial terms for the legal team (about $0.10 more)". It is kept on
the tender (`Tender.readTerms`, a Tenders column defaulting to false for older rows) and cannot be
changed after the tender is created without a deliberate "Read the terms now" button on the tender
tab (the same call, run later).

When ticked, the runner makes one extra call per document after extraction, `op=terms`, through a
new strict tool `report_terms`. The documents are already cached, so reading costs cents; only the
short answer is billed. It lists the key terms, each with a quote and its clause: insurance types and
amounts, liability caps, indemnities, payment terms and invoicing, IP ownership, warranties,
termination and exit, term and renewals, service credits, governing law. They join the register as
`kind: 'term'` under Legal and compliance (payment and service credits under Sales and commercial),
and go to the estimation at apply like the rest. It passes `canSpend`, counts into the tender's AI
cost, and the extraction prompt itself does not change, so a tender without the tick costs exactly
what it does today.

Measure on `TND-multa391` before calling it done (ask first; about $0.10).

## Tests (CLAUDE.md "Every change ships with tests")

- `tests/schema.test.ts`: the new sheet round-trips; a workbook without it loads with none; a store
  holding only these rows is not empty (`populated`).
- `tests/api.test.ts`: a payload without the new key keeps the stored rows (rule 5).
- `tests/reducer.test.ts`: apply creates the items once, a second apply adds none, left-out items are
  not copied, owner, status and note edits, adding by hand, deleting the tender keeps the items.
- `tests/tender.test.ts`: the drafts function (grouping, leave-out, counts); `readCategories`
  narrowing (an unknown category or an id not asked about is dropped).
- `tests/tenderApi.test.ts`: `op=sort` and `op=terms` end to end against the stubbed API, including
  a refusal and the tools being strict; the documents first and cached in `op=terms`, as in the
  other calls.
- `tests/quoteExport.test.ts` and `tests/format.test.ts`: none of it reaches the Excel sheet or the
  plain-text quote.
- `tests/router.test.ts` if the tender tab or the builder panel gets its own URL.
- Headless drive: apply a tender, see the items on the estimation, present mode hides them, the three
  builder breakpoints, a second tab picks up an owner change.

One real `op=sort` call on `TND-multa391` checks the categories against the table above (about $0.05,
ask first).

## Order of work

1. Types, schema, reducer, domain drafts, their tests.
2. Tender tab and the apply section.
3. Builder panel, present mode, hub count.
4. The `op=sort` call and the "Sort them" button.
5. The terms tick at intake and the `op=terms` call.

## Decisions (answered by the user, 2026-09-29)

1. **Where it shows:** a tab in the builder's top bar, beside Excel sheet, where the downloads and
   bundles are ("the best place you can suggest"), plus the tender tab and the hub count. Yes to all.
2. **Names:** left to the build. Section "Sales, account and legal", tab label "Sales & legal",
   categories Sales and commercial, Account management, Legal and compliance, People and staffing,
   Certification.
3. **Its own spreadsheet tab:** yes, `SalesAccountLegal`.
4. **Fields:** owner, status (Open, Handled, Not for us), note, and an optional due date (the user
   said yes to all; read as yes to the due date too).
5. **Categories from the AI:** yes, one small call per tender, a person can change them.
6. **Key legal and commercial terms:** the person chooses at the start of each tender; if ticked,
   they are read and listed (above).
7. **Client-facing:** never.
8. **Items added by hand on any estimation:** yes.
