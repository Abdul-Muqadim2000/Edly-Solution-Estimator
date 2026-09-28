# Deferred

Work we have agreed is worth doing but cannot do yet, and what is in the way. Most of it waits on
a real server, because today there is no database and every save rewrites a whole spreadsheet.
The rest waits on credentials, on data we do not have, or on an agreement with a supplier.

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

`/api/tender` makes this more urgent than it was. Anyone who finds the URL can upload files to
Anthropic under Edly's key and run up its bill, and the endpoint has no rate limit (entry 3 is why).
Deployment protection covers it along with everything else, so nothing in the code needs to change;
it has to be switched on before `ANTHROPIC_API_KEY` is set on a public deployment. The user asked
for this to be noted rather than built on 2026-09-26.

Two things limit the damage in the meantime, and neither is sign-in. `op=discard` deletes only
files whose name carries the `edly-tender-` prefix this endpoint gives its uploads, so it cannot be
used to delete other files in the workspace. And the key should belong to an Anthropic workspace of
its own with a monthly spend limit set in the Anthropic console: that caps what an open endpoint
can cost, and keeps the tender files apart from anything else the organisation stores there.

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

### 8. A real tender through the AI

**Blocked by:** there is no `ANTHROPIC_API_KEY` on this machine. `tests/tenderApi.test.ts` drives
`/api/tender` against a stubbed `fetch` that answers the way the Messages and Files APIs do,
including a refusal, a cut-off answer, a 401, a 404 and a 429, and the screens were driven against a
stand-in API. Neither proves how the model reads a real tender.

**When unblocked:** put a key in `.env`, run one real tender through intake, extraction, matching
and apply, and check four things. The extraction calls after the fit call should report
`cacheRead` tokens close to the tender's size in the token line at the top of the tender; if they
read zero, something is breaking the shared prefix (see the comment at the top of
`server/ai/prompts.ts`). No single call should come near the 300 s limit; if one does, lower
`RANGE_PAGES` in `src/domain/tender.ts`. Every quoted passage should be findable on the page it
cites. And the platform recommendation should be the one a salesperson would have chosen. Build a
small eval of three or four invented tenders with known requirements before tuning the prompts, so
a change can be measured rather than eyeballed.

**Now:** a fictional tender with known answers exists and has been run through the real code
against a stand-in API that bills the way Anthropic's does (2026-09-28): a 45-page ITT, a
250-row requirements matrix with a hidden sheet and Won't-have rows, and a Word annex, plus a
115-page variant padded with standard terms and response templates. The stand-in's model answers
from the known requirements, so it proves the plumbing, the cache layout and the cost arithmetic,
not how well the real model reads. Its numbers assume 3,000 tokens a PDF page and 60 output
tokens a second.

The real run should also check what the reading plan, the spreadsheet path and the five-minute
cache rely on:

- The outline's pages are physical pages, not the numbers printed on them, and every section the
  fit call marks `skip` really holds nothing to deliver. A wrong skip loses requirements silently.
- A spreadsheet extraction call's `cacheRead` is small (the converted text only) and a PDF call's
  is the whole tender, with no cache writes after the fit call. A spreadsheet call that writes
  instead means the inner cache markers are not being read; that costs cents, but say so.
- How long a spreadsheet range (60 rows, `SHEET_SPAN`) and a 20-page range take, since both sizes
  assume the model writes about 60 tokens a second. Raise them if calls finish well inside the limit.
- The same tender at the default effort (`medium`) and at `EDLY_AI_EFFORT=low`: compare the
  requirement lists and the output tokens. Thinking is billed as output, and it is most of what extraction costs.

- The keep-warm (`/api/tender?op=warm`, `max_tokens: 0`) is accepted with these tools, the thinking
  setting and the fallback beta, and reports a `cacheRead` the size of the tender. Then wait six
  minutes on the fit screen and continue: the first extraction call must read the tender, not write
  it. Built on 2026-09-28 against the stand-in only; if the API refuses it, each keep-warm fails
  quietly and the first extraction writes the tender again, which is dearer than the hour-long
  cache it replaced whenever the person takes over about three minutes.

### 9. Tenders over 4 MB

**Blocked by:** Vercel refuses a function request body over 4.5 MB before the function runs, so a
file has to fit in one request. Getting round that needs somewhere to stage the upload, and the
natural place is Vercel Blob, which needs a `BLOB_READ_WRITE_TOKEN`. The user chose on 2026-09-26 to
keep tenders under the limit for now.

**Now:** the limit is enforced with a readable message in `src/lib/tenderFiles.ts` and again in
`api/tender.ts`. Word and Excel files are converted to text in the browser first, so only their text
counts, and a 20 MB Word file with images usually fits.

**When unblocked:** the browser uploads the file to Blob in parts (Blob's multipart API, written by
hand like the existing Blob provider), `/api/tender?op=upload` takes the Blob URL instead of the
bytes, fetches the file server to server, uploads it to the Files API and deletes the Blob copy.
Nothing downstream changes, because everything after upload works with the Files API id.

## Waiting on data

### 7. Client-proven catalogs for the other 19 platforms

**Blocked by:** only Open edX has hours from real deliveries. The other 19 platforms ship benchmark
hours from `src/data/practices.ts`, flagged `sample: true` and labelled *Sample* in the UI.

**When unblocked:** load each platform's real catalog sheet through the in-app Catalog panel, then
drop its `sample` flag in `practices.ts`. Until then, do not present those numbers as delivery
records.

## Waiting on an agreement

### 10. Zero data retention for tender documents

**Blocked by:** a zero-data-retention agreement with Anthropic, which is a contract between Edly and
Anthropic rather than a setting in the code. Without one, tender files and the requests that read
them are kept by Anthropic for a limited period under its commercial terms, though not used for
training. The user decided on 2026-09-26 to use the API under the standard terms for now and to
consider zero retention later.

**Now:** the code keeps what it sends to the minimum. Files are uploaded with a 72-hour expiry, are
deleted when the desk requests go out, when the tender is deleted, and when intake is abandoned, and
can be removed from the tender screen at any time. Nothing logs document contents or model output.
The intake screen tells the person where the files go.

**When unblocked:** no code change is needed for the agreement itself. Check which models it covers
before relying on it, because some models require retention (the model is set by `EDLY_AI_MODEL`),
and record the agreement's date and scope here, then delete this entry.
