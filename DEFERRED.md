# Deferred

Work we have agreed is worth doing but cannot do yet, and what is in the way. Most of it waits on
a real server, because today there is no database and every save rewrites a whole spreadsheet.
The rest waits on credentials or on data we do not have.

This is not the to-do list. Anything that can be done today belongs in *Worth adding next* in
CLAUDE.md. When a blocker goes away, move what it unblocks back there (or just do it) and delete
the entry here.

## How an entry reads

- **Blocked by:** the constraint, stated concretely enough that you can tell when it has gone.
- **Now:** the part that can be done today, if there is one. Do it. It usually makes the later
  part cheaper.
- **When unblocked:** what to build and where it lands in the code.

Entries are numbered so they can refer to each other. Do not renumber when one is removed.

---

## Waiting on a real server

"Server" here means storage that can read and write one record at a time, such as Postgres. The
Vercel functions in `api/` already run code server-side. What they lack is anywhere to keep state
other than the spreadsheet.

### 1. Per-record storage and a per-estimation API

**Blocked by:** a spreadsheet has no per-row writes. `saveState` rewrites every sheet, and
`/api/state` takes the whole workspace in one `PUT`.

**When unblocked:**

- A Postgres provider in `server/providers/` and a case in `server/store.ts`. It can start behind
  the existing interface (whole state in, whole state out), which moves the data without touching
  the app. Per-record endpoints come after.
- `server/schema.ts` becomes the table definitions. Each scalar column becomes a column,
  `snapshotJson` becomes `jsonb`, and `plat` becomes the tenant column every query filters on.
- `/api/state` becomes `/api/estimations/:id` and its siblings. On the browser side only
  `src/api/client.ts` changes.
- Keep the spreadsheet as an export. `/api/state?format=xlsx` already produces one, so the people
  who read the sheet today keep a sheet.

### 2. Optimistic concurrency per estimation

**Blocked by:** entry 1. Two people editing different deals can still overwrite each other,
because the last `PUT` wins for the whole workbook. Refusing a stale write needs a compare-and-swap
on one record, which a spreadsheet cannot do.

**Now:** add a `rev` counter or a server-set `updatedAt` to `Estimation`, in the usual order:
`src/types.ts`, `server/schema.ts`, `tests/schema.test.ts`. The existing `up` field is a date with
no time, so two edits on the same day look identical. One column today saves a migration later.
This part is listed in CLAUDE.md.

**When unblocked:** the per-estimation `PUT` sends the `rev` it read, the server answers 409 if
the stored one is newer, and `useSync.ts` shows the conflict the way it already does when a
background pull meets unsaved edits.

### 3. Rate limiting on `/api/state`

**Blocked by:** Vercel function instances do not share memory, so a counter kept in one instance
never sees the requests another one handles. Rate limiting needs a shared counter (a Redis-style
store) or Vercel's firewall rules, and either is a new service to ask about first.

**Now:** a payload size cap needs no shared state. `server/handler.ts` reads the whole request body
with no limit today, so answering 413 above a set size is doable now and is listed in CLAUDE.md.

Do not ship an in-memory limiter as a stopgap. It reads as protection and gives none.

### 4. Per-user accounts and roles the server enforces

**Blocked by:** accounts need somewhere to live, and sessions need a server to check them. Today
sign-in is `admin` / `admin` checked in the browser, and the sales or desk role is a toggle anyone
can flip.

**Now:** put Vercel Authentication or an SSO proxy in front of the whole deployment, `/api/state`
included. That needs no server and is item 1 in CLAUDE.md. It answers "may this person open the
app", not "who is this" or "may they change desk pricing".

**When unblocked:** a users table, a session check in `server/handler.ts` before any store call,
and the role checked on the server for every write. When choosing the proxy, check whether it
forwards a verified identity header. If it does, part of this entry and the "who" in entry 5 can
come earlier.

### 5. An audit trail that records who

**Blocked by:** entry 4 for the "who". With one shared login, every change is by `admin`. There is
also a storage cost: on the file stores (OneDrive, Dropbox, Blob, local) the whole `.xlsx` is
rewritten on every save, so an audit sheet that only grows makes every save slower and the file
larger.

**Now:** record what changed and when, as a sixth sheet, computed in `api/state.ts` by comparing
the incoming state with the stored one. Bound it (keep the last 90 days, say) so the file does not
grow without limit. This part is listed in CLAUDE.md.

**When unblocked:** an append-only `audit` table carrying the user id from entry 4. The sheet can
stay as a readable view of it.

---

## Waiting on credentials

### 6. The cloud stores, run against the real services

**Blocked by:** there are no Google, Microsoft, Dropbox or Vercel Blob credentials on this machine.
`tests/providers.test.ts` drives every provider against a stubbed `fetch`, including the 403 and
404 replies, but a stub only proves we handle the replies we thought of.

**When unblocked:** put one store's variables in `.env` (never committed), run
`bun run store:probe`, then save and reload an estimation in the app and look at the sheet itself.
Do this once per provider before anyone relies on it, and record in VERIFY.md which providers have
been run for real and when.

---

## Waiting on data

### 7. Client-proven catalogs for the other 19 platforms

**Blocked by:** only Open edX has hours from real deliveries. The other 19 platforms ship benchmark
hours from `src/data/practices.ts`, flagged `sample: true` and labelled *Sample* in the UI.

**When unblocked:** load each platform's real catalog sheet through the in-app Catalog panel, then
drop its `sample` flag in `practices.ts`. Until then, do not present those numbers as delivery
records.
