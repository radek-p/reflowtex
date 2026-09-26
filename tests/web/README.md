# Web tests

What a site built with Reflow TeX does in its readers' browsers: the
viewer's features, the companion package's browser side, and the
integrations – not this project's own website, and not the typesetting.

## Why a suite of its own

The render tests (`tests/render`) ask *is every glyph where TeX put it?*:
one document at a time, geometry against a PDF, pass or fail by a
hundredth of a point. These ask *does the page behave?*: a footnote opens
and closes, a hint is blurred until pressed, the text breaks again when the
column narrows and nothing runs past its edge, a note sits in the margin
beside its line, the reader keeps their place when the window is resized,
a page's own stylesheet does not break the viewer, a Hugo site served under
a subpath finds its fonts. They need clicks, keys, window sizes and media,
several pages and a Hugo site; they fail for other reasons and are fixed in
other places. Both are TypeScript on Node, and share the container image
and CI's conventions.

## How it is built

- **Fixture pages** (`pages/<name>/`): a few LaTeX snippets each, built by
  the vanilla integration into one page, as a site without a framework
  gets it; then, as a site would, the page's own code is added
  (`head.html`, `body.html`) and, where there is a `companion` file, the
  companion plugin with an import map.
- **A Hugo site** (`hugo-site/`), built as a Hugo user builds theirs – the
  integration's shortcode and partial copied in, `prebuild.ts`, `hugo` –
  and served under `/hugo/`, as a project site on GitHub Pages is.
- **The tests** (`*.spec.ts`, Playwright Test) open pages in Chromium and in
  WebKit (Safari's engine; Firefox does not start under Playwright here yet)
  and drive them. `setup.ts` builds every page and the Hugo site once, at
  the start, and serves `build/`; `fixtures.ts` has `openPage`.
  Every test also fails if the page reports an error: an uncaught exception,
  a `console.error`, a failed or 4xx/5xx request – or the viewer talking
  (`[latex-viewer] …` on the console outside debug mode).

Builds go to `build/` (ignored). Run them with `make test-web`, or
`npx playwright test -c tests/web -g footnote` for some (`--project webkit`
for one engine). On GitHub,
`.github/workflows/web-tests.yml` runs them in the container image on every
push and pull request.

Two habits make them reliable: measure a glyph by its SVG coordinates
(WebKit gives a `<tspan>`'s box as its whole line's), and change a column's
width by its `.latex-block`'s style, then wait for the resize to settle
(the viewer finishes off-screen lines 150 ms after a width stops changing).

## What is tested

| Feature | Tests |
|---|---|
| Every page loads at 1200 and 360 px, no sideways scroll | `pages.spec.ts` |
| Reflow: a narrower block breaks into more lines, none too wide | `pages.spec.ts`, `regressions.spec.ts`: nothing past the edge |
| Footnotes: hover, click to pin, Escape, keyboard, ARIA | `footnotes.spec.ts` |
| Hints: blurred with a label, click and Enter, `--latex-hint-label`, print | `hints.spec.ts`, `regressions.spec.ts` |
| Cross-references: `\eqref` goes to its anchor | `links.spec.ts` |
| Live text: `reflowtex.setText`, and back to the default | `live.spec.ts` |
| Live marks and the highlighter: selection to ranges, bands through a reflow, two blocks, saved and restored, re-found by text, eraser, recolour | `highlighter.spec.ts` |
| The selection as bands (flag): off by default, even bands per line, through a reflow, a block kept native, beside marks, the reader's switch | `selection.spec.ts` |
| Widgets: drawn, split across lines, `invalidate()` | `live.spec.ts`, `regressions.spec.ts` |
| Asides: query, natural width, `render`, `anchor()`, `reflowtex:layout` | `asides.spec.ts` |
| Side notes: in the margin on their line, no overlap, marks without a margin | `asides.spec.ts` |
| Host API: instances, parts, surfaces; block kinds (TeX spacing kept, one render, edges, frames, fallback); actions routed; nested frames flush, rtl; mount and destroy; the popover drawn by a kind | `host.spec.ts` |
| What the author declares: widget parameters, `\webpart`, marks, `\NewWebEnvironment`, `\NewWebAside` | `parts.spec.ts` |
| Companion accordion: animation, reduced motion, keyboard, styling from LaTeX, nesting, print; a throwing component | `accordion-v2.spec.ts` |
| Companion Lean widgets: switches, motion, side by side, the code, print, the space after a hidden proof | `lean-v2.spec.ts` |
| Reading options: corner button, panel, card, the page following theme, width and size | `reading.spec.ts` |
| Companion: `InlineButton` fits its label on the baseline, `Popover` | `companion.spec.ts` |
| Themes: the typeset ink follows the page's | `themes.spec.ts` |
| Hugo: subpath, references, a reference to another page, an example's controls | `hugo.spec.ts` |

## Regressions

Problems found and fixed before, from the project's history (the git log
and past sessions), each kept fixed by a test named after it – or still to
be written. Known failures run as expected failures (`test.fail()`): the
day one passes, the suite says so, to have the mark taken off.

| # | Problem (commit) | Test (in `regressions.spec.ts` unless named) |
|---|---|---|
| 1 | After a resize the reader lost their place: scroll anchoring defeated (fde0a25) | “a resize keeps the reader in place” |
| 2 | The page scrolled sideways during a resize (a25c334) | “a resize keeps the reader in place”; frame times: to do |
| 3 | Resizing rotated text made every paint throw (e9db719) | “resizing rotated text raises nothing” |
| 4 | A host's `svg{max-width:100%}` shrank the text for a frame (e9db719) | “host CSS does not scale the text” |
| 5 | Fonts 404 on the deployed site (527a0e5, a97ba43) | any 404 fails every test; a build from cache: to do |
| 6 | Blank text: the served font lacked the glyphs (36f8365, bbd5c0d) | to do: no zero-width glyphs |
| 7 | A font that failed left text silently missing: now a bar (970f543) | “a font failure is shown and dismissed” – **known failure**: Dismiss does not hide it |
| 8 | Fonts assumed `/fonts/`: broke under a subpath and from disk (8de3e92) | “works from a file”, `hugo.spec.ts` |
| 9 | Two blocks' pictures shared ids (04e81e7) | “picture ids do not collide” |
| 10 | The footnote popover in the OS's colours, not the page's (92d4a2d) | “popover readable: OS …, page …” |
| 11 | Coloured text not recoloured in the dark theme (b7d65b3) | to do |
| 12–13 | Link underline per word; left behind after a reflow (b7d65b3, c5a01f4) | to do |
| 14 | The gap between a link's words not on the link (e9db719) | “the gap in a link is hoverable” |
| 15–16 | ToC entries not links; starred sections missing from the outline | to do |
| 17 | The console flooded with timing lines (e49074d) | every test: the viewer stays quiet |
| 18 | 404 for `protobuf.min.js.map` (ff96946) | every test: no 404s |
| 19–20 | Stale cached scripts; an out-of-date minified viewer | to do (build-level) |
| 21 | Lines ran past the column at narrow widths (ff96946) | “nothing past the edge” |
| 22–23 | Ragged lines without microtype; ragged headings stretched | to do |
| 24 | Accordion panes on different baselines; actions in print (b7d65b3) | “accordion panes share a baseline”, “print shows hints and hides actions” |
| 25 | Hint could not be blurred again; label; print (77a7f87) | `hints.spec.ts`; print: **known failure**, the label still shows |
| 26 | Boxed theorem frame on a fraction; boxes past a phone's edge | to do |
| 27–28 | Widget above the baseline; split widget in pieces, hover on one (6433a47) | “a widget sits on the baseline”, “a split widget is whole and hovers as one” |
| 29 | A button's typeset label pushed out by a host's margin (cec397b) | “host CSS keeps a label in its button” |
| 30 | Aside anchor wrong in WebKit (d99df5f) | `asides.spec.ts` (both engines) |
| 31 | Margin notes lost when fonts load late; below the block (d99df5f) | “margin notes when fonts come late” |
| 32 | Hugo example: text size changed by every click (1d3a850) | `hugo.spec.ts`: example controls |
| 33 | Hugo: `\ref` printed ?? (b7d65b3) | `hugo.spec.ts`: references resolve |
| 34 | Hugo batch: a chapter used twice, numbered wrongly (1adde61) | to do |
| 35 | Hugo example handle (1adde61) | `hugo.spec.ts`: example handle |
| 36 | Inspector would not close; lost clicks | to do (the inspector has its own tests to come) |
| 37 | Pictures silently missing (406247a, e896243) | to do |
| 38 | Relative `\href` lost its link (ff96946) | to do |
| 39–40 | One-word first lines; Lean badge and panes | to do |

Found while writing these, not yet fixed (see the `test.fail()` reasons): the font
warning bar's Dismiss does nothing (`display:flex` overrides `[hidden]`),
and in print a hint's "Click to reveal" still shows (the print rule is less
specific than the one showing it). The companion `Popover` missed an Escape
pressed as soon as it opened; fixed with these tests (its listeners now
before the first paint). The viewer draws every block again once its fonts
load, which can take the keyboard focus from a hint pressed in that moment;
the tests wait for fonts, and this is still to look into.
