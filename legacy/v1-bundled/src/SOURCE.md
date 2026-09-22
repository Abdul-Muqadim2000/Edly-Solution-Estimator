# Source files

`public/index.html` is the **built** app — one self-contained file, 915 KB, with markup, logic,
styles, fonts and the benchmark catalogs inlined. That is what deploys, and it is not meant to be
edited by hand.

The files in this folder are the plain-JavaScript parts that are worth editing, and they are the
ones you will actually want to change. They are *already inlined* into the build, so editing them
here does nothing until the app is rebuilt — see **Rebuilding** below.

| File | What it controls | Change it when |
|---|---|---|
| `edly-practices.js` | The practice → platform registry, and the benchmark catalog for all 19 non-Open edX platforms | Adding a practice or platform, or replacing sample hours with real ones |
| `edly-sheet-import.js` | Reads the master `.xlsx` in the browser: header matching, bundle assembly, diffing against what was loaded before | Your sheet's column names change, or you add a column the app should read |
| `edly-xlsx.js` | Writes the branded `.xlsx` the Download button produces | Changing the export layout or styling |
| `edly-bundles-data.js` | A frozen snapshot of the Open edX catalog, used only as a fallback before `catalog-source.xlsx` loads | Almost never — edit the spreadsheet instead |

## The most common edits

**Add a platform.** In `edly-practices.js`, add an entry to the relevant practice's `platforms`
array. Give it a `catalog:` built with the `cat(...)` / `B(...)` helpers already in that file, or
omit `catalog` to start it empty.

```js
{ id: 'vue', name: 'Vue / Nuxt', catalog: vue }
```

**Replace benchmark hours with real ones.** Either edit the `B(...)` rows in `edly-practices.js`,
or — better — keep the code alone and load a real sheet for that platform through the in-app
**📚 Catalog** panel. That path stores the catalog per platform and needs no rebuild.

**Support a new sheet column.** `edly-sheet-import.js` has an `ITEM_SPEC` / `BUNDLE_SPEC` map of
field → accepted header names. Add your header text to the relevant list; matching is
case- and punctuation-insensitive, and exact matches win over prefix matches.

## Rebuilding

The UI itself — screens, layout, the estimation logic, the planner — lives in the built file as one
large component. There is no `src/App.jsx` in this package because the app was authored as a single
component and bundled, not assembled from a module tree.

If your team needs component-level source to maintain, that is a port rather than an extraction:
the component would be split into a Vite + React project with the screens as separate files. It is
a known, bounded piece of work — ask and it can be produced as a second archive. Nothing about the
Excel persistence layer, the API or the storage providers would change; those are already ordinary
modules in `lib/` and `api/`.

Until then, the supported way to change behaviour is:

- **Data and catalogs** → the spreadsheets, or the files in this folder
- **Persistence, storage, endpoints** → `lib/` and `api/`, which are plain modules with no build step
- **Anything in the UI** → ask for the change, or take on the port
