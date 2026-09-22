# Legacy builds

Nothing in this folder is built, tested, linted or deployed. It is kept for reference only —
`eslint.config.js` ignores it, and it is outside the `tsconfig.json` include list.

**The maintained app is at the repository root.** Read `../README.md`.

These are the two generations that came before it. Both implement the same product; the React and
TypeScript version at the root replaced them.

| Folder | What it is |
|---|---|
| `v1-bundled/` | The previous deployment: the app as one self-contained `public/index.html` (915 KB, markup, logic, styles and catalogs inlined), plus the Bun/Vercel storage layer in `lib/` and `api/`. Its `src/` holds the four plain-JS files that were inlined into that build. |
| `v1-source/` | The v1 authoring artifacts — the Claude artifact source (`.dc.html`), the two HTML builds, the standalone export, and the same four `.js` files. These were byte-identical duplicates of `v1-bundled/src/`. |

## Why they are still here

`v1-bundled/src/SOURCE.md` ends by saying that component-level source would be "a port rather than
an extraction… ask and it can be produced as a second archive." The app at the root **is** that
port, so these are superseded rather than merely old.

They stay because they are the only record of two things:

- **the v1 storage layer**, which the root app's `server/providers/` was ported from;
- **the original design**, which the root app was rebuilt against — `v1-source` is where the
  `style-hover` and `style-focus` states, the three-column builder shell and the branded chrome
  were read back out when the first port was found to have dropped them.

`src/data/practices.ts` at the root was also recovered from `v1-source/edly-practices.js`, and is
verified to carry exactly the same 6 practices, 20 platforms and 19 benchmark catalogs.

## Before deleting

The v1 files are the fallback if a question comes up about what the original did. Once the root app
has been in production long enough that nobody needs to check, this whole folder can go — it is in
git history either way.
