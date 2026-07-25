# Viewer — DOM contract

`latex-viewer.js` renders every Reflow TeX block on a page. It has no build step
and no dependency beyond `protobuf.min.js`, which must load first (it exposes the
global `protobuf`). Both files are framework-agnostic — the integrations just
arrange the DOM below.

> **`protobuf.min.js`** is [protobuf.js](https://github.com/protobufjs/protobuf.js)
> v8.7.1, vendored (BSD-3-Clause — see [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md)).
> It is committed so the browser side needs no Node and works offline. Refresh it
> with `make vendor-protobuf` (bump `PROTOBUFJS_VERSION` in the Makefile first);
> the target fetches the pinned version from npm, so users building sites never
> need npm themselves.

```html
<!-- 1. The schema, embedded once per page (schema/latex.proto as base64 text). -->
<div id="latex-schema" data-schema-b64="…" hidden></div>

<!-- 2. One element per block, carrying the base64 protobuf node list. -->
<div class="latex-block" data-nodelist-b64="…"></div>

<!-- 3. protobuf runtime first, then the viewer. -->
<script src="protobuf.min.js"></script>
<script src="latex-viewer.js"></script>
```

On `DOMContentLoaded` the viewer parses the schema, finds every
`[data-nodelist-b64]`, lays each out at its measured pixel width, and paints
inline SVG. It re-breaks lines on resize and repaints on theme change. Blocks far
below the fold are laid out immediately but painted lazily as they approach the
viewport.

## Per-block options (data attributes)

| Attribute | Meaning |
|---|---|
| `data-latex-width` | layout width in pt (default: the element's own pixel width ÷ 2) |
| `data-align` | `justify` (default) · `left` · `right` · `center` |
| `data-bleed-px` | horizontal bleed allowed before a line is considered overfull |
| `data-line-penalty`, `data-adj-demerits`, `data-double-hyphen-demerits`, `data-pretolerance`, `data-tolerance`, `data-tolerance2`, `data-emergency-tolerance`, `data-last-line-min`, `data-last-line-penalty`, `data-max-expand`, `data-max-shrink`, `data-min-gap`, `data-pad`, `data-protrusion`, `data-expansion` | Knuth–Plass knobs (sensible defaults if omitted) |

## Fonts

The viewer injects `@font-face` rules that load each font from **`/fonts/<file>`**
— an absolute path, so the page must be **served from the site root**. The build
pipeline provisions those OTF files (and patches their cmaps); place them at
`/fonts/`. (Opening the HTML via `file://` won't find them.)

A block refers to a font by its *original* name. If the page ships a font map —
an optional `<script id="latex-font-map" type="application/json">` island of
`{ "original.otf": "served.otf" }` — the viewer fetches from the served name
instead. The pipeline uses this to serve a **modified** font (one whose cmap it
patched) under a renamed, content-hashed file, leaving unmodified fonts verbatim.
Without the island, the original name is used as-is.

## Overflow

A display wider than its column is wrapped by the viewer in a `.latex-display`
scroll box. Because setting `overflow-x` forces `overflow-y: auto` (which would
clip ascenders/descenders), the viewer measures the vertical overhang and reserves
it as padding. Give `.latex-display` `overflow-x: auto` in your CSS; the minimal
rule set is in each integration's page template/partial.

## Theming (optional)

Colour substitution is keyed off a class on `<html>` (`dark`, `sepia`,
`contrast`; default is light). Switching the class restyles already-rendered SVG
via CSS custom properties — no re-render. Glyphs TeX left black carry no inline
fill and inherit `currentColor`, so basic dark mode works even without a theme
class as long as your page sets a light text colour.

## Citations (optional)

If a page includes `<script id="lr-citations" type="application/json">…</script>`
mapping citation numbers to reference metadata, and the LaTeX marked citation
digits (via an integration-specific macro), the viewer wires hover/click popovers
to them. This is opt-in and unused by the core examples.
