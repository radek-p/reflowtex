# The TypeScript migration

Every hand-written JavaScript file of the project is TypeScript now, but for
the two examples below. Lua (the serializer), TeX, shell and configuration
are as they were.

## What is generated, what is vendored, what stays JavaScript

- **Generated, not committed:** `src/viewer/latex-viewer.js` and `.min.js`
  (from `src/viewer/src/`), `src/companion/companion.js` and the
  inspector's `inspector.js`, `agent.js` and `panel/*.js` (from
  `src/inspector/src/`), built by src/pipeline/bundles.ts wherever they are
  needed, when missing or stale (each records on its second line what it was
  built from; `make build-viewer` and the others build on demand, and a
  release attaches them); the render report's `app.js` (built from
  `tests/render/report/app.ts` when served, and for the site) and the
  website's `static/privacy-notice.js` (from `website/browser/`), both by
  esbuild in passing.
- **Vendored:** `src/viewer/protobuf.min.js` (typed by
  `src/viewer/src/runtime/protobuf.d.ts`, from the npm package) and
  `src/inspector/vendor/preact.js` (typed by `src/inspector/src/vendor/preact.d.ts`).
- **JavaScript on purpose:** `website/examples/sidenote.js` and `popover.js`.
  The documentation shows them as the code a reader copies into a page, so
  they stay what a page would have.

## Checking

`npm run typecheck` checks both configurations: `tsconfig.json` (Node: the
pipeline, the tools, the tests, the render report's page) and
`tsconfig.browser.json` (the viewer, the companion, the inspector, the
website's script), strict, reading no JavaScript. CI runs it
(`.github/workflows/ci.yml`).

## How it was done

- **Order:** the modules many others import first, so that their types
  reach the rest: the document model and `engine/core`, then `runtime/page`,
  `pending`, `params`, `decode`, `colour`, `copy`, `fonts`, then the engine
  (`render`, `breaker`, `layout/lines`, `sink`, `paint`, `layout/display`,
  `text`, `stream`, `document`), then the runtime (`blocks`, `block-data`,
  `visibility`, `settle`, `a11y`, `init`) and the host modules (`links`,
  `widgets`, `slots`, `inspect`, `defaults/footnotes`), the entry module last;
  then the inspector (its build first, then the agent, then the panel and
  the loader), the render report and the website's script.
- **No change of behaviour:** after each step the viewer's bundle was
  compared with the previous one, module paths aside. Most steps left it
  identical; where a type needed it, the code changed to an equivalent
  expression (`(x ?? 0) > 0` for `x > 0` where x may be absent, `String(n)`
  for a number given to `setAttribute`), each read in the comparison. The
  inspector's agent was compared by its answers: on ten fixture pages, every
  row, detail, XML, text, resource and overlay, before and after, the same.
  The panel's built modules, the companion and the report's script were
  compared as built. The web, render and unit tests ran along the way.
- **Splits**, each a commit of its own with the code moved unchanged:
  `engine/paint.js` into `render` (walking a node list for any sink),
  `sink` (the painter's DOM reconciler) and `paint` (a segment's paint),
  which ended a cycle between the display layout and the painter;
  `runtime/a11y.js` into `a11y` (switches and placement), `a11y-runs` (the
  layer's text read off the drawn lines) and `a11y-fit` (fitting it onto the
  drawing); the inspector's agent, one closure of 2,100 lines, into modules
  by its sections, with the state the overlay draws from in one object.

## Decisions

- **The document model** (`src/viewer/src/engine/model.ts`) is a union of
  node types: a field a node of its type always has is required, the rest
  optional, as protobuf.js decodes them. Reading a node through the union, a
  field may be absent; narrowed by its type, it is there.
- **The layout's shapes** are in `engine/layout/types.ts`; a block's data in
  `runtime/block-data.ts`. The host modules use these instead of their own
  partial types.
- **The public API** stays in `host/types.ts`: `window.reflowtex`
  (`ReflowTeX`: the host and the documented switches), the paragraph
  breaker a page may plug in (`ParagraphBreaker`), a block's outline
  (`OutlineItem`). `inspect` is typed as the viewer's own, outside the
  contract, as before.
- **The inspector's protocol** (`src/inspector/src/protocol.ts`) types what
  the agent answers the panel; the panel's `call(method, …)` takes and gives
  what it says.
- **`any`:** none in the migrated code. Two remain in the companion, as
  they were: `ComponentType<any>` in `mount.ts`, a registry of components
  whose props differ (no other type admits them all).

## Found on the way

- `Block.revealInDisplay(element)` threw in a block with a stream before the
  display (fixed, tested).
- The inspector agent's `elementOf` threw for a vertical space row (fixed,
  tested).
