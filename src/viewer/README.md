# Viewer – DOM contract

`latex-viewer.js` renders every Reflow TeX block on a page. It has no build step
and no dependency beyond `protobuf.min.js`, which must load first (it exposes the
global `protobuf`). Both files are framework-agnostic – the integrations just
arrange the DOM below.

> **`latex-viewer.min.js`** is the same file minified (about a third of the
> size, a third again over gzip). The integrations ship it *as* `latex-viewer.js`
> whenever its header records the SHA-256 of the current source, and fall back
> to the source otherwise, so the served name and the DOM contract never change.
> After editing the viewer, maintainers run `make minify-viewer` (needs Node;
> site builders do not) to regenerate it.

> **`protobuf.min.js`** is [protobuf.js](https://github.com/protobufjs/protobuf.js)
> v8.7.1, vendored (BSD-3-Clause – see [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md)).
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
| `data-display-min-space` | Minimum space (pt) kept between two pieces of a display – an align's columns, or an equation and its number – as the measure decreases, before the display freezes and scrolls (default `10`; `0` permits zero). A display's *outer* space (centring, margin) is not covered by this and always closes to zero first |
| `data-display-overflow-tolerance` | Tiny horizontal overhang ignored before adding a display scrollbar (default `2` CSS px) |
| `data-line-penalty`, `data-adj-demerits`, `data-double-hyphen-demerits`, `data-pretolerance`, `data-tolerance`, `data-tolerance2`, `data-emergency-tolerance`, `data-last-line-min`, `data-last-line-penalty`, `data-max-expand`, `data-max-shrink`, `data-min-gap`, `data-pad`, `data-protrusion`, `data-expansion` | Knuth–Plass knobs (sensible defaults if omitted) |

## Fonts

The viewer injects `@font-face` rules that load each font from a **`fonts/`
directory next to `latex-viewer.js` itself** – resolved from the script's own
URL (`new URL('fonts/', <script src>)`), not a fixed absolute path. That keeps
it working unmodified under a domain root, an arbitrary subpath, a different
domain, and a page opened straight off disk over `file://`. The build pipeline
provisions the OTF files there (and patches their cmaps) – place them next to
wherever `latex-viewer.js` is served from.

A page can override this with an optional `data-fonts-base` attribute on the
`#latex-font-map` script (below) – a relative value is still resolved against
the script's own URL the same way, so this only matters for pointing fonts at
somewhere else entirely, e.g. a CDN.

A block refers to a font by its *original* name. If the page ships a font map –
an optional `<script id="latex-font-map" type="application/json">` island of
`{ "original.otf": "served.otf" }` – the viewer fetches from the served name
instead. The pipeline uses this to serve a **modified** font (one whose cmap it
patched) under a renamed, content-hashed file, leaving unmodified fonts verbatim.
Without the island, the original name is used as-is.

If a font file cannot be downloaded, the block still lays out (the metrics
travel with it) but draws in a stand-in face, and the symbol fonts of
mathematics may draw nothing. So the viewer shows a bar at the bottom of the
window naming the fonts, with Reload and Dismiss. Style it with
`.latex-font-warning`, or switch it off before the viewer runs:
`window.reflowtex = { fontWarning: false }`.

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
its position in the flow. The viewer turns the first into a `data-link` group –
hovering or pressing any glyph lights the whole reference, including one broken
across two lines – and the second into a zero-height `.latex-anchor` element with
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

3. a label in neither is **not rendered as a link** – it keeps its text and its
   ordinary colour, so a reference whose target was never published cannot
   masquerade as something to click.

The Hugo integration generates that island: `prebuild.py` writes
`data/latex_link_map.json` mapping each label to the content page whose block
defined it – taken from the compilation itself, not from scanning sources – and
the viewer partial turns pages into URLs, which is the only step that needs to
know about permalinks.

Style the three states with `--latex-link`, `--latex-link-hover` and
`--latex-link-active`; give `.latex-anchor` a `scroll-margin-top` if your page
has a sticky header.

## What a resize costs

Painting is lazy: a segment (a run of paragraphs, or one display) gets its SVG
glyphs placed only when it comes within a viewport of the screen, and a resize
repaints the visible segments at once and the rest as they scroll into view.

Layout is cached per segment. Each segment remembers, for every width it has
been laid out at, the geometry its neighbours need – height, first ascent,
last depth – and keeps the full layout for the last three widths. Heights are
taken to be monotone in the width, so once two observed widths give the same
height, every width between them is answered from the cache. On a resize, a
segment near the viewport is always laid out for real; one that is off screen
is laid out only if its geometry is not cached, otherwise its layout is
*deferred* and runs the moment it scrolls into view. Dragging a window edge
therefore re-breaks the paragraphs on screen and little else; returning to a
recent width re-breaks nothing. If a deferred segment's real height turns out
to differ from the cached one, the content below it moves at that moment and
the cache is corrected. The console line printed on each re-render reports
how many segments were laid out, reused, or deferred.

The browser's own scroll anchoring survives a reflow: on a window resize the
content at the top of the viewport stays where it was, as on any ordinary
page. This depends on how segments are mounted – a spacer for the space
above, then a plain wrapper holding the `<svg>`, with the spacer, the `<svg>`
and any display scroll box marked `overflow-anchor: none` so the browser
anchors on the wrapper, whose style never changes. Pages that style
`.latex-block svg` should keep `position`, `transform`, margins and padding
off it and off the wrapper's ancestors, or anchoring is suppressed again.

## Outline (optional)

A block whose document has sections or theorem-like environments carries an
*outline*. It is captured at compile time from what enters the table of
contents, and from every theorem, lemma and so on. Once the block is laid out,
the viewer fires a bubbling event on the block element, and leaves the same
list on the element as `el.reflowtexOutline`:

```js
document.addEventListener('reflowtex:outline', e => {
  for (const { kind, env, level, number, title, id } of e.detail.entries) …
});
```

`level` is 1–3 for sections, subsections and subsubsections, and 9 for a
theorem-like environment (`env` names it: `thm`, `lem`, …). `title` is plain
text, and `id` is the id of an anchor element at the entry's place in the
flow, to scroll to or observe. The website's Showcase page builds its sticky
table of contents from this.

## Plugging in another paragraph breaker

The viewer breaks paragraphs with its own Knuth–Plass implementation. A page
can substitute another one – a TeX engine's line-breaking code compiled to
WebAssembly, say – by defining, before or after the viewer loads:

```js
window.reflowtexBreak = function (nodes, availSp, params, helpers) {
  // return [{nodes, ratio, fitness, leftProtrusion, exact?, expand?}, …] or null
};
```

It is called for every paragraph on every layout with the paragraph's node
list, the available width in scaled points, the block's Knuth–Plass
parameters, and `helpers`:

- `gW/gH/gD` – glyph-metric accessors;
- `align`, `bskip`, `lskip` – the paragraph's alignment and interline glue;
- `font(id)` – the font's record: `quad` (sp), `expand`
  (`{stretch, shrink, step}` as `\expandglyphsinfont` set them, thousandths,
  or `null`) and `codes`, a `Map` from character to `{lp, rp, ef}`
  (`\lpcode`/`\rpcode` in thousandths of the quad, `\efcode` in thousandths
  of the width) – what microtype configured when the document was typeset;
- `adjustSpacing`, `protrudeChars` – the paragraph's `\adjustspacing` and
  `\protrudechars`.

Return the lines in the same shape the built-in breaker produces, or `null`
to decline for this paragraph, in which case the built-in breaker runs. A
line flagged `exact: true` carries a TeX-exact glue ratio, and the viewer
then applies no glyph expansion of its own on top of it; a line carrying
`expand` (a fraction, `0.012` = glyphs and font kerns 1.2 % wider) was
expanded by the breaker itself and is drawn exactly that much wider. A
`leftProtrusion` in scaled points hangs the line's first glyph into the left
margin by that much; a negative kern at the line's end does the same on the
right. Dispatch a `resize` event once an asynchronously loaded breaker
becomes ready, so already-painted blocks re-lay out with it.

## Streams

A block's content can hold *streams*: separately typeset runs of paragraphs
and displays, each with a `kind` (`Document.streams` in the schema). A
footnote's body is one, pointed at by its marker glyph and shown in the
footnote popover. The companion package's
`\begin{reflowtexstream}{kind}` (see [src/latex/](../latex/)) makes one at the
point where it stands in the flow, and the viewer mounts it as

```html
<div class="latex-stream" data-kind="KIND">
  <div>…the stream's own segments, laid out like a block…</div>
</div>
```

The stream is laid out at the box's inner width (its width minus its CSS
padding) and re-broken whenever the block reflows. Streams nest. Segments a
kind hides (`display: none`) are laid out but painted only once they are shown.

What a kind looks like is CSS on `.latex-stream[data-kind=…]`. What it does is
a behaviour a page registers, in a script that runs before or after the viewer:

```js
window.reflowtex ??= { streamKinds: {} };
reflowtex.streamKinds.hint = {
  mount(box, ctx) { … },   // once per box, after its first layout
};
```

`ctx` carries `kind`, `index` (1-based, into `Document.streams`), `stream` and
`state`. `state` is an object kept per stream for the life of the page. Boxes are
rebuilt when web fonts arrive, so a behaviour stores what it must remember
there and restores it in `mount`. A page's entry replaces a built-in one of the
same name. A kind with no behaviour is still rendered, as a plain box.

### Stream parameters and actions

`\begin{reflowtexstream}[key=value, …]{kind}` gives a stream parameters. Each
one is set on the box as `data-KEY="value"` and passed to `mount` as
`ctx.attrs`. For example, an accordion's box carries `data-initial` and
`data-print`.

`\webaction{action}{text}` makes text inside a paragraph a *control*. Its
glyphs are grouped like a `\ref` and coloured with the same `.latex-link`
rules, plus `.latex-action`. They take `role="button"` and one tab stop. A
click, Enter or Space sends a bubbling DOM event from the glyph:

```js
new CustomEvent('reflowtex:action', { bubbles: true, detail: { action, source } })
```

A kind listens for it on its box. It handles the actions it understands and
calls `stopPropagation()`, so that an enclosing stream of another (or the
same) kind does not act as well. Actions nobody handles do nothing.

A kind may also declare `alternatives: true` next to `mount`. Its child
streams then replace one another rather than follow each other, as an
accordion's panes do. The viewer lays them out with no space between them.
Each one gets the spacing TeX would give it if it alone stood there: the
interline glue from the line above to its own first line, and from its own
last line to the line below. So switching panes never moves the first
baseline.

`ctx.paint()` paints the stream's visible segments at once. Call it after
revealing hidden content, instead of waiting for the IntersectionObserver.

Built in:

- **`accordion`**: shows one of its child streams of kind `pane` at a time.
  It understands the actions `pane:next`, `pane:prev`, `pane:first`,
  `pane:last`, `pane:NAME` (a pane's `data-name`) and `pane:N` (from 1).
  - The current pane gets `latex-pane-active`, and the box gets
    `data-pane` (its name or number).
  - `data-initial` picks the first pane shown.
  - In print only the `data-print` pane shows (default: the last), and
    action text is transparent.
  - When the reader switches with the keyboard, focus moves to the first
    control of the new pane.
  - If a switch leaves the box's top above the viewport, it is scrolled back
    into view.
- **`leantheorem`** / **`leanproof`**, with parts **`leanstatement`**,
  **`leantex`** and **`leancode`**: reflowtex.sty's theorem or proof with its
  Lean code. `leancode` carries the code as `Stream.text` and draws it as
  highlighted, selectable text, under the declaration's name (`data-decl`,
  linked by `data-url`). Both widgets have two switches, Proof and Lean
  (initially `data-show`: proof, lean, both or none), toggling their parts
  independently; both parts stand side by side from 44rem, stacked below it.
  `leantheorem` hangs the switches under the theorem's frame, from its left edge; `leanproof` puts
  them on a row above its parts. The code has a frame like a proof's, in
  `--latex-lean-accent` (a muted teal by default). While the proof is hidden, the
  widget's bottom margin takes back the space TeX left after the proof.
  Every change lays the block out again through `ctx.relayout()`, which
  re-lays out the whole block at its current width, for any behaviour that
  changes a stream's width.
- **`footnote`**: shown in the popover from its marker, never in the flow.

## Live text (optional)

`\webtext{name}{default}` (the companion package, `src/latex/reflowtex.sty`)
marks a run of running text a page may replace. Every glyph and space of the
default carries the slot's index (`Node.slot` → `Document.slots`, which also
records the name and the interword glue of the font the default was set in).

```js
reflowtex.setText('clock', '12:04');   // every \webtext{clock}, in every block
reflowtex.setText('clock', null);      // TeX's default again
reflowtex.getText('clock');            // the text last given, or undefined
```

A given text is set as a browser sets it: split at breakable white space
(not at a no-break space), each word one node measured with the canvas in the
default's font and colour, with no kerning, ligatures or font expansion across
words; between words, the font's interword glue (`\fontdimen2–4`), so the
line justifies with the rest. The words keep the default's height and depth.
Changes within one animation frame are applied together, and only the
segments holding an affected paragraph are laid out and painted again. A text
set before its block is initialised is applied when the block is. A slot
inside a box (`\mbox`) is left as its default.

## Theming (optional)

reflowtex ships no colour palette of its own – a block with no `data-color-map`
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
different ones – e.g. two documents sharing a page, each with its own palette.

- **`colors`** – flat substitution per theme, keyed by the hex TeX/tikz
  produced. `'#000000'` is special: it is the *default* text colour (glyphs
  TeX left black carry no inline fill), so mapping it recolours all
  default-coloured text in that theme.
- **`tints`** – colours TeX baked by mixing a base colour into the page (e.g.
  `red!20!white` resolves to flat RGB at compile time, with no trace of how it
  was built). Re-derived at runtime as `baked-hex: [base-hex, percent]`, so
  the tint follows the *current* background rather than staying stuck to
  whatever page colour was live when TeX compiled it.

A theme can also be scoped to part of a page: `data-latex-theme="dark"` on any
element gives the blocks inside it that theme's colours, whatever the page's
theme is. That is how an example can preview each theme in place. Every colour
the map remaps is declared in the scoped rules, so a scoped `light` also undoes
the page's dark substitutions. Set `--latex-page-bg` on that element too, so
tints mix with its background.

A theme is matched by a class name on `<html>` (`dark`, `sepia`, `contrast`;
unclassed is the implicit `light`) – switching the class restyles
already-rendered SVG via CSS custom properties, no re-render. Adding a theme
to a map is just a new key plus a class your page switcher sets; reflowtex
doesn't hardcode which themes exist.

`tints` reads the ambient `--latex-page-bg` custom property (falling back to
the CSS `Canvas` system colour), which is deliberately *not* part of the
colour-map data – TeX has no notion of the page's colour, so that's the page's
own theme CSS to set, typically right where it already sets its background
per theme: `:root.dark { --latex-page-bg: #0c0a09; }`.

The Hugo integration generates the island from `<site>/latex-color-maps/<name>.json`
files, referenced with `color-map="<name>"` on the shortcode – see
[integrations/hugo/README.md](../../integrations/hugo/README.md).

## Citations (optional)

If a page includes `<script id="lr-citations" type="application/json">…</script>`
mapping citation numbers to reference metadata, and the LaTeX marked citation
digits (via an integration-specific macro), the viewer wires hover/click popovers
to them. This is opt-in and unused by the core examples.
