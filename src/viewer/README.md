# Viewer — DOM contract

`latex-viewer.js` renders every Reflow TeX block on a page. It has no build step
and no dependency beyond `protobuf.min.js`, which must load first (it exposes the
global `protobuf`). Both files are framework-agnostic — the integrations just
arrange the DOM below.

> **`latex-viewer.min.js`** is the same file minified (about a third of the
> size, a third again over gzip). The integrations ship it *as* `latex-viewer.js`
> whenever its header records the SHA-256 of the current source, and fall back
> to the source otherwise, so the served name and the DOM contract never change.
> After editing the viewer, maintainers run `make minify-viewer` (needs Node;
> site builders do not) to regenerate it.

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
| `data-color-map` | name of an entry in the page's `#latex-color-maps` island to recolour this block with (see Theming below); omitted = TeX/tikz colours render as-is |
| `data-display-min-space` | Minimum space (pt) kept between two pieces of a display — an align's columns, or an equation and its number — as the measure decreases, before the display freezes and scrolls (default `10`; `0` permits zero). A display's *outer* space (centring, margin) is not covered by this and always closes to zero first |
| `data-display-overflow-tolerance` | Tiny horizontal overhang ignored before adding a display scrollbar (default `2` CSS px) |
| `data-line-penalty`, `data-adj-demerits`, `data-double-hyphen-demerits`, `data-pretolerance`, `data-tolerance`, `data-tolerance2`, `data-emergency-tolerance`, `data-last-line-min`, `data-last-line-penalty`, `data-max-expand`, `data-max-shrink`, `data-min-gap`, `data-pad`, `data-protrusion`, `data-expansion` | Knuth–Plass knobs (sensible defaults if omitted) |

## Fonts

The viewer injects `@font-face` rules that load each font from a **`fonts/`
directory next to `latex-viewer.js` itself** — resolved from the script's own
URL (`new URL('fonts/', <script src>)`), not a fixed absolute path. That keeps
it working unmodified under a domain root, an arbitrary subpath, a different
domain, and a page opened straight off disk over `file://`. The build pipeline
provisions the OTF files there (and patches their cmaps) — place them next to
wherever `latex-viewer.js` is served from.

A page can override this with an optional `data-fonts-base` attribute on the
`#latex-font-map` script (below) — a relative value is still resolved against
the script's own URL the same way, so this only matters for pointing fonts at
somewhere else entirely, e.g. a CDN.

A block refers to a font by its *original* name. If the page ships a font map —
an optional `<script id="latex-font-map" type="application/json">` island of
`{ "original.otf": "served.otf" }` — the viewer fetches from the served name
instead. The pipeline uses this to serve a **modified** font (one whose cmap it
patched) under a renamed, content-hashed file, leaving unmodified fonts verbatim.
Without the island, the original name is used as-is.

## Overflow

A display wider than its column (beyond the configurable rounding tolerance) is
wrapped by the viewer in a `.latex-display` scroll box. The supplied CSS lets it
peek up to 100px into each available page margin and fades the currently hidden
edge; scroll-state classes remove each cue when that end is reached. Override
`--latex-display-peek` to change the visual allowance.

Whatever that allowance is, the box always pans by exactly the distance the
display overflows the column, so its last glyphs can be brought level with the
text edge. That is why the trailing peek is a `::after` flex item rather than
padding on the scroll box: a scroll container's end padding is not part of the
scrollable overflow in every engine (WebKit drops it), and where it is dropped
the pan comes up short by that much. Keep the spacer if you rewrite these rules.

Because setting
`overflow-x` forces `overflow-y: auto` (which would clip ascenders/descenders),
the viewer measures the vertical overhang and reserves it as padding. The full
minimal rule set is in each integration's page template/partial.

## Cross-references (optional)

`\ref`, `\eqref` and `\autoref` are captured at compile time: every glyph a
reference printed carries the same link id, and each `\label` leaves a marker at
its position in the flow. The viewer turns the first into a `data-link` group —
hovering or pressing any glyph lights the whole reference, including one broken
across two lines — and the second into a zero-height `.latex-anchor` element with
the label as its `id`.

Resolving a label to a URL is *not* done here, because one LaTeX document may be
published as one page or as one page per chapter. Instead:

1. a label defined by some block **on this page** resolves in-page, with no
   configuration at all;
2. otherwise the viewer consults an optional page-supplied island

   ```html
   <script id="latex-link-map" type="application/json">
     {"thm:main": "/03-chapter/#thm:main"}
   </script>
   ```

3. a label in neither is **not rendered as a link** — it keeps its text and its
   ordinary colour, so a reference whose target was never published cannot
   masquerade as something to click.

The Hugo integration generates that island: `prebuild.py` writes
`data/latex_link_map.json` mapping each label to the content page whose block
defined it — taken from the compilation itself, not from scanning sources — and
the viewer partial turns pages into URLs, which is the only step that needs to
know about permalinks.

Style the three states with `--latex-link`, `--latex-link-hover` and
`--latex-link-active`; give `.latex-anchor` a `scroll-margin-top` if your page
has a sticky header.

## Plugging in another paragraph breaker

The viewer breaks paragraphs with its own Knuth–Plass implementation. A page
can substitute another one — a TeX engine's line-breaking code compiled to
WebAssembly, say — by defining, before or after the viewer loads:

```js
window.reflowtexBreak = function (nodes, availSp, params, helpers) {
  // return [{nodes, ratio, fitness, leftProtrusion}, …] or null
};
```

It is called for every paragraph on every layout with the paragraph's node
list, the available width in scaled points, the block's Knuth–Plass
parameters, and `helpers` (`gW/gH/gD` glyph-metric accessors, `align`, and
the paragraph's `bskip`/`lskip`). Return the lines in the same shape the
built-in breaker produces, or `null` to decline for this paragraph, in which
case the built-in breaker runs. A line flagged `exact: true` carries a
TeX-exact glue ratio, and the viewer then applies no glyph expansion of its
own on top of it. Dispatch a `resize` event once an asynchronously loaded
breaker becomes ready, so already-painted blocks re-lay out with it.

## Theming (optional)

reflowtex ships no colour palette of its own — a block with no `data-color-map`
renders TeX's own colours as-is, and glyphs TeX left black carry no inline fill
and inherit `currentColor`, so basic dark mode already works with zero
configuration as long as your page sets a light text colour per theme.

Recolouring beyond that is entirely page-supplied data, read from an optional
JSON island:

```html
<script id="latex-color-maps" type="application/json">
  { "my-map": {
      "colors": { "dark": { "#eb5757": "#ff8585" }, … },
      "tints":  { "#ffcccc": ["#ff0000", 20] }
  } }
</script>
```

A block opts in with `data-color-map="my-map"`, naming one entry. Nothing
stops a page from embedding several named maps and giving different blocks
different ones — e.g. two documents sharing a page, each with its own palette.

- **`colors`** — flat substitution per theme, keyed by the hex TeX/tikz
  produced. `'#000000'` is special: it is the *default* text colour (glyphs
  TeX left black carry no inline fill), so mapping it recolours all
  default-coloured text in that theme.
- **`tints`** — colours TeX baked by mixing a base colour into the page (e.g.
  `red!20!white` resolves to flat RGB at compile time, with no trace of how it
  was built). Re-derived at runtime as `baked-hex: [base-hex, percent]`, so
  the tint follows the *current* background rather than staying stuck to
  whatever page colour was live when TeX compiled it.

A theme is matched by a class name on `<html>` (`dark`, `sepia`, `contrast`;
unclassed is the implicit `light`) — switching the class restyles
already-rendered SVG via CSS custom properties, no re-render. Adding a theme
to a map is just a new key plus a class your page switcher sets; reflowtex
doesn't hardcode which themes exist.

`tints` reads the ambient `--latex-page-bg` custom property (falling back to
the CSS `Canvas` system colour), which is deliberately *not* part of the
colour-map data — TeX has no notion of the page's colour, so that's the page's
own theme CSS to set, typically right where it already sets its background
per theme: `:root.dark { --latex-page-bg: #0c0a09; }`.

The Hugo integration generates the island from `<site>/latex-color-maps/<name>.json`
files, referenced with `color-map="<name>"` on the shortcode — see
[integrations/hugo/README.md](../../integrations/hugo/README.md).

## Citations (optional)

If a page includes `<script id="lr-citations" type="application/json">…</script>`
mapping citation numbers to reference metadata, and the LaTeX marked citation
digits (via an integration-specific macro), the viewer wires hover/click popovers
to them. This is opt-in and unused by the core examples.
