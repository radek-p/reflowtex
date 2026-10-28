# Viewer – DOM contract

`latex-viewer.js` renders every Reflow TeX block on a page. It has no dependency
beyond `protobuf.min.js`, which must load first (it exposes the global
`protobuf`). Both files are framework-agnostic – the integrations just arrange
the DOM below.

> **Source and build.** The viewer is written as TypeScript modules in `src/`
> (`index.ts` is the entry; `engine/` breaks lines, lays out and paints,
> `runtime/` runs blocks on the page, `host/` is what pages and packages use,
> `defaults/` renders footnotes and margin notes). `latex-viewer.js` is a
> bundle of them, one classic script, and is not committed: the integrations
> (and the website's build, and the tests) build it with esbuild when it is
> missing or was built from other modules (src/pipeline/bundles.ts), so a
> site's build needs only `npm ci`. The bundle's header names its version
> and the SHA-256 of what it was built from. esbuild drops ordinary
> comments, so read the modules, not the bundle.
>
> **Getting it:** `make build-viewer` writes `latex-viewer.js` and
> `latex-viewer.min.js` here; or download both, versioned, from a
> [release](https://github.com/radek-p/reflowtex/releases), with their
> SHA-256 sums. A release's files are built from its tag, which is their
> source (AGPL-3.0 §13).

> **`latex-viewer.min.js`** is the same bundle minified (about a third of
> the size, a third again over gzip). The integrations ship it *as*
> `latex-viewer.js`, so the served name and the DOM contract never change.

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

On `DOMContentLoaded` (or at once, when the script runs after it: added by a
loader, say) the viewer parses the schema, finds every
`[data-nodelist-b64]`, lays each out at its measured pixel width, and paints
inline SVG. It re-breaks lines on resize and repaints on theme change. Blocks far
below the fold are laid out immediately but painted lazily as they approach the
viewport.

## Per-block options (data attributes)

| Attribute | Meaning |
|---|---|
| `data-latex-width` | layout width in pt, fractions allowed (default: the element's own pixel width ÷ 2); `natural`: the width of its text set on one line, like an `\hbox`, which the viewer also gives the element as its CSS width – for a word in the page's own HTML |
| `data-align` | `justify` (default) · `left` · `right` · `center` |
| `data-latex-selection` | How selected text looks, on `<html>` or a block (the nearest wins): `native` (default), the browser's own highlight, glyph by glyph; `bands`, the viewer's, drawn as a mark's band is: one even rect per line (`rect.latex-selection`, coloured `var(--latex-selection-color, Highlight)`), spaces included, over marks and under the text; a selection that starts or ends in a word space (or at a glyph's far edge) reaches that edge, so a space can be selected, alone or with the words around it. The selection itself stays the browser's (copy, keyboard, `getSelection()`); only its look changes. [host/selection.ts](src/host/selection.ts) |
| `data-latex-layout` | `sliced` (default) or `sync`, on a block or any element above it (`<html>` for the page; the nearest wins): whether a re-break lays out at once only what is on the screen and the rest in slices of idle time, or everything at once (see What a resize costs); `host.mount(el, { layout })` and `host.setLayout` set it from a script |
| `data-latex-scope` | The scope its live texts are looked up in first (see Live text: scopes); `host.mount(el, { scope })` wins over it |
| `data-color-map` | name of an entry in the page's `#latex-color-maps` island whose themes this block takes (see Theming below); omitted = the viewer's built-in map. In the theme `default` no map applies: TeX's colours as they are |
| `data-display-min-space` | Minimum space (pt) kept between two pieces of a display – an align's columns, or an equation and its number – as the measure decreases, before the display freezes and scrolls (default `10`; `0` permits zero). A display's *outer* space (centring, margin) is not covered by this and always closes to zero first |
| `data-display-overflow-tolerance` | Tiny horizontal overhang ignored before adding a display scrollbar (default `2` CSS px) |
| `data-line-penalty`, `data-adj-demerits`, `data-double-hyphen-demerits`, `data-final-hyphen-demerits`, `data-pretolerance`, `data-tolerance`, `data-emergency-stretch` (pt), `data-protrusion`, `data-expansion` | Knuth–Plass knobs; the defaults are LaTeX's, and the built-in breaker then breaks as LuaTeX does, protruding and expanding by the document's own microtype settings. A paragraph TeX broke with other values (`\sloppy`, as in every bibliography) keeps its own |
| `data-tex-final-pass` | How a paragraph is broken when nothing fits `data-tolerance`. By default the viewer runs TeX's final pass, and keeps its breaks unless they hold an overfull line (a line that runs past the right edge). Then it tries its gentler fallbacks – `data-tolerance2`, then `data-emergency-tolerance`, which leave a loose line instead – and uses TeX's breaks only if those find nothing. `strict` always keeps TeX's breaks, overfull lines included (to compare with TeX); `false` skips the final pass and goes straight to the fallbacks, then any line |
| `data-last-line-min`, `data-last-line-penalty` | Not TeX: a last line shorter than this fraction of the measure costs this many demerits (default `0`, off) |
| `data-max-expand`, `data-max-shrink` | Font expansion for an external breaker's lines that report none of their own |

## Fonts

The viewer makes one face per font file (a `FontFace`, added to
`document.fonts` by script, not an `@font-face` rule: in Chromium a new style
sheet makes every rule's face load again, which blanked finished blocks as
new ones arrived). Each face loads from a **`fonts/`
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
patched, or a Type 1 font it converted) under a renamed, content-hashed file,
leaving unmodified fonts verbatim. A modified font is also cut down to the
characters the site uses: no other site fetches that file, so it need hold
nothing more. An unmodified one is served whole, so a browser that has it
cached from another site can use it. Without the island, the original name is
used as-is.

A page that has a font's file itself – an editor that typesets in the
browser, say – gives it with `host.fonts.provide(file, bytes | url)`, by the
font's original name. Given before any block uses the font, the face is made
from it; given again later, the face is replaced only once the new file has
loaded, and the blocks are drawn again, so nothing shows blank or in a stand-in
meanwhile. `host.fonts.loaded(file)` says whether a face has loaded, and
`host.fonts.ready()` settles once every face asked for has.

If a font file cannot be downloaded, the block still lays out (the metrics
travel with it) but draws in a stand-in face, and the symbol fonts of
mathematics may draw nothing. So the viewer logs it (`font-load-failed`, an
error, naming every font that failed so far: `details.fonts` by their own
names, the TeX name of a Type 1 font and the file's stem of an OpenType one,
and `details.files` by their original file names, as `host.fonts` takes
them; each a comma-separated list), and by default shows it to readers in
the notice bar at the bottom of the window, with Reload and Dismiss (see The
log; style it with `.latex-notice`). A failed font whose file loads later,
given with `host.fonts.provide` (the same URL again is fetched again), is
failed no more: an `info` record, `font-loaded-after-failure` (`details.font`,
`details.file`), says so, and the notice bar's line names only the fonts
still failed, or goes with the last. To show it no more, leave `font-load-failed` out of
the log's `show`; `window.reflowtex = { fontWarning: false }`, set before
the viewer runs, does the same.

## The log

The viewer keeps one log for the page: every record the build wrote into
the blocks' data (each block carries its `warnings`: a font with no face to
draw it, an error TeX carried on past, say), and the viewer's own (a font
that failed to download, a kind whose component threw). Each record has a
level (`error`, `warning`, `info`, `debug`), a stable `code` for its kind
(`font-load-failed`, `font-loaded-after-failure`, `font-without-face`, `tex-error`, `kind-failed`), its message, its particulars
(`details`, strings by name), where it comes from (`pipeline`, `viewer`,
`companion` or `page`), the block it is about (its key) and its time. The
type is `LogRecord` in [src/shared/log.ts](../shared/log.ts).

The inspector's **Log** tab lists every record. What else becomes of one is
the page's to configure, with two settings:

- **`alert`, the alerted level**: `none`, `error`, `warning`, `info` or
  `debug`. A record at that level or above is *alerted*: written to the
  browser's console (`[latex-viewer] …`) and sent as `reflowtex:log` on
  `document` (`event.detail.record`), for a site that reports them its own
  way. Below it, a record is only in the log. The default is **`error`**: an
  author or a site's developer sees what is broken in the console, as before,
  while what the build merely noticed – a character a font lacks, a font
  drawn as boxes – stays in the inspector, where an author looks for it,
  rather than filling every reader's console (or a site's error reporting)
  on every page.
- **`show`, what readers are shown**: a list of codes, and of level names
  (meaning that level and above). Each record it selects is shown in the
  notice bar, a line per code (its latest message). The default is
  **`["font-load-failed"]`**: readers learn that text may be missing, and
  nothing else. `[]` shows nothing; `["error"]` every error;
  `["font-load-failed", "missing-char"]` adds characters a font lacks.

Both are set by the page, in a JSON island read once the page has loaded:

```html
<script id="latex-log-config" type="application/json">
  { "alert": "warning", "show": ["font-load-failed", "font-without-face"] }
</script>
```

(`show` may also be a string of codes and levels, separated by spaces or
commas; `none` is nothing.) The integrations write it from their own settings
(the Hugo params `reflowtexLogAlert` and `reflowtexLogShow`, the vanilla
build's `--log-alert` and `--log-show`). A page's script may set either
instead, which wins over the island, through the host API:

```js
const { log } = reflowtex.host;
log.records();                         // every record so far, oldest first
log.subscribe(r => …);                 // every record from now on, alerted or not
log.setAlertLevel('warning');          // null: back to the island's, or the default
log.setShown(['error', 'missing-char']);
log.report('warning', 'my-code', 'Something the page noticed', { id: 'x' });
document.addEventListener('reflowtex:log', e => myReporter(e.detail.record));
```

`log.alertLevel()` and `log.shown()` say what is in force. Debug records
(the viewer's timings) are made only while `window.reflowtex.debug` is on
(or with `?reflowtex-debug`), and are then printed too.

## Overflow

A display wider than its column (beyond the configurable rounding tolerance) is
wrapped by the viewer in a `.latex-display` scroll box. The supplied CSS lets it
peek up to 100px into each available page margin and fades the currently hidden
edge; scroll-state classes remove each cue when that end is reached. Override
`--latex-display-peek` to change the visual allowance. While a segment waits
for its slice after a width change (see What a resize costs), its box clips
it sideways, so a surface laid out for a wider column never widens the page. A page can turn the
fade off – for one block or view, or by default – through the host API
(`setDisplayFade`, below): the block element then carries `latex-no-fade`,
and the viewer's own rule takes the mask away. It can also have a display's
box fitted to the display rather than the column (`setDisplayFit('natural')`,
below): the box widens into the room beside the column, up to the edges of
the element the block sits in, and scrolls only when the display is wider
than that – with no peek, spacer or fade; the block element carries
`latex-fit-natural`, and the viewer's own rules size each box.

Whatever that allowance is, the box always pans by exactly the distance the
display overflows the column, so its last glyphs can be brought level with the
text edge. That is why the trailing peek is a `::after` flex item rather than
padding on the scroll box: a scroll container's end padding is not part of the
scrollable overflow in every engine (WebKit drops it), and where it is dropped
the pan comes up short by that much. Keep the spacer if you rewrite these rules.
And size the peek by the column in `cqw`, not `%` (the default is
`clamp(0px, calc(50vw - 50cqw), 100px)`): the viewer makes the box around a
scroll box a size container, so `100cqw` is the column wherever the peek is
used, while a `%` in it is the column in the scroll box's margins but the
box's content in the `::after`, whose peek then comes out short – on a phone
by half, and the display can no longer be panned to the column's edge.

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

## What a document cannot do

A block's links and pictures come from its TeX source, which may be anyone's,
so neither runs script in the page ([engine/safe.ts](src/engine/safe.ts)). A
URL from `\href` or `\url` is a link only when it is relative, a fragment, or
`http:`, `https:`, `mailto:`, `tel:` or `ftp:`; a `javascript:` or `data:`
address leaves its text plain. A picture's SVG is parsed in an inert
`<template>` and loses `<script>`, `<foreignObject>` (and `<iframe>`,
`<embed>`, `<object>`), event-handler attributes, animations that set an
address or a handler, and addresses of other schemes (a `data:` image stays)
before it is inserted. The pipeline cleans a picture the same way where it
makes it (`src/pipeline/pictures.ts`), so the page's own data is clean too.

How a link looks – its colour at rest, pointed at and pressed, and an
underline – is its theme's, in the colour map (Theming); in the theme
`default` a link is drawn as TeX drew it. Give `.latex-anchor` a
`scroll-margin-top` if your page has a sticky header.

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
the cache is corrected. With debugging on, a console line on each re-render
reports how many segments were laid out, reused, or deferred. The viewer's
timing lines are off by default; turn them on with `window.reflowtex.debug =
true` (from the console, at any time) or by adding `?reflowtex-debug` to the
page URL. They are logged at the debug level, so the console's Verbose level
must be on too.

**Sliced.** A long block re-broken whole is one long task: a block some
1,600 px tall, of many segments, took 35–60 ms, and a test block of 480 segments
(`tests/web/pages/huge`) over 100 ms on a resize and 250 ms on its first
layout. So, unless a block asks for `sync` (`data-latex-layout`), a
re-break lays out at once only the segments on the screen (by their boxes'
places before it, or, for a new block, by the heights above them). Every
other segment it would have laid out is *pending*: it keeps the geometry it
had, its `<svg>` as it was (clipped sideways meanwhile, so an old, wider
surface cannot widen the page), or, laid out for the first time, a height
estimated from its paragraphs' natural widths. The pending segments are then
laid out in slices of idle time (`requestIdleCallback`; WebKit has none,
and gets a task after each frame), nearest the screen first, each slice
within 8 ms; the segments within a screen's height of the window are drawn
in slices too, as is what the IntersectionObserver finds near the window
when the reader scrolls somewhere new (what is on the screen is drawn at
once, as before). A segment the reader reaches before its slice is laid out
and drawn then. After a window resize the slices begin once the width has
held still for 150 ms, so a drag does not start them on every frame. When
none is left, the block is laid out once more with every segment from its
cache, so that the spacing between segments, rounded onto the layout grid
down the block, is exactly what a synchronous layout gives; the web tests
check it bit for bit, glyph by glyph, on every page they have and on the
demo and testmath pages when built. Heights change as slices land: above
the reader, the browser's scroll anchoring holds the reading point; the
viewer never scrolls the page itself. Decoding a block's data is not
sliced: on the 480-segment block it is most of the first layout's time.

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
parameters, and `helpers` – but for a paragraph whose lines differ in measure
(`\parshape`, `\hangindent`), which the built-in breaker always breaks:

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

## Host API

`window.reflowtex.host` is what pages and packages (the companion) build on;
its contract, with every type, is [src/host/types.ts](src/host/types.ts). It
exists once the viewer script has run; a module that may load first waits for
`reflowtex:host` on `document`. There is one model and one registry for
everything a page draws:

- **Blocks**: `host.blocks()`, `host.block(el)`, `host.onBlock(fn)` (now for
  each block already there, then for each new one), `block.on('layout', fn)`.
  `host.mount(el)` renders a block element added after the page loaded (a
  framework's), and `block.destroy()` undoes everything drawn for one and
  forgets it.
- **Fonts**: `host.fonts.provide(file, source)`, `host.fonts.loaded(file)`,
  `host.fonts.ready()` (see Fonts).
- **The log**: `host.log.records()`, `subscribe(fn)`, `report(…)`, the
  alerted level and what readers are shown (see The log).
- **The drawing as data**, for a host that places a caret or tests a click
  itself: `block.segments()` lists a block's segments in drawing order
  (`kind` 'text', 'display' or 'stream'; `svg`, the element drawn in;
  `painted`; a stream's own `segments()`), and `segment.walk({ line, node })`
  gives each line's nodes and each node's position, in the svg's user units,
  without touching the DOM (map them to the screen with the svg's CTM).
  The nodes are objects of `block.document`, the block's decoded document
  (latex.proto's), so a glyph found by a click can be looked up there; sizes
  in it are TeX's scaled points, `host.spToPx` px each. `block.layout()` is
  the measure and alignment it was last laid out at and the width TeX set it
  at; `block.relayout()` lays it out again. `host.mount` resolves once the
  block's faces have loaded and its segments within a window's height of the
  viewport are painted (in a rendered element: `visibility: hidden` counts),
  so a new result can be mounted out of sight and swapped in at once.
  `host.idle()` resolves once the viewer has nothing still to come.
- **Views**: one block shown in several elements at once, a split view say.
  `host.mount(el, { of, view? })` makes an empty `el` another view of a
  block on the page (`of`: a `Block`, its element or its key; `view`: a
  name, unique among its views, `v2`, `v3`, … by default). Each view is a
  block of its own in the API (its own `key`, instances and outline), laid
  out and broken at its own width, re-laid out alone when its width
  changes, with its own drawing, selection and accessible layer (a copy of
  the block's, laid over its own lines; its drawing then `aria-hidden`).
  What the views share is only what nothing changes: the compiled data,
  fonts, glyph metrics and pictures. `block.views()` / `host.views(of)`
  list them in the order mounted, `block.view` is the name, and
  `el.dataset.latexView` marks a view's element. State is per view unless
  asked otherwise: `host.setText(name, …)` reaches every view,
  `instance.setText(text)` its view only, `instance.setText(text, { mirror:
  true })` that instance in every view (those mounted later too);
  `host.addMark(ranges)` marks the view the ranges name, `{ mirror: true }`
  every view. A widget is an instance in each view (state shared between
  them is the page's, by `attrs.key` say), its pieces drawn on that view's
  own lines and ended when the view is unmounted; its size is its
  content's, so `env.invalidate()` measures it again and re-breaks it in
  every view, whichever view's env is asked. A view's anchors' ids end in `--<its key>` (the block's own
  element keeps the plain ones), and a reference in a view goes to its own
  anchor. `block.unmount()` (the same as `destroy()`) takes one view away
  and leaves the others as they are, the block's own element included; a
  mark shown in no view is then removed, and a mirrored mark whose ranges
  named the view names another. Mounting and unmounting views leaves
  nothing behind.
- **Scopes**: a page showing several documents at once, whose live-text
  names (a label's number, a counter) may clash, mounts each document's
  blocks in a scope of its own: `host.mount(el, { scope: 'doc-1' })` (or
  `data-latex-scope` on the element), `host.setText(name, text, { scope })`.
  Such a block takes a name's text from its scope first, then from the
  page-wide texts (`host.setText` without a scope); a block mounted with
  none sees the page-wide texts only, as before. See Live text.
- **Sliced layout**: a re-break (a block's first layout, a new width, new
  live text) lays out at once only the segments on the screen, and the
  rest in slices of idle time, nearest the screen first (see What a resize
  costs). `block.on('layoutstart' | 'layoutslice' | 'layoutcomplete', fn)`
  follow it (`layoutslice` gets `{ left }`, the segments still to come;
  one start and one complete per run, however often the width changes
  under way), and `block.layoutDone()` resolves once nothing is left. The
  events come in the same task as the change they report, before the
  browser draws it, so a host that keeps the reader's place itself can
  correct it there; otherwise the browser's scroll anchoring does, as for
  any reflow. `block.flushLayout()` does what is left at once.
  `host.mount(el, { layout: 'sync' })`, `data-latex-layout="sync"` or
  `host.setLayout('sync')` (the page's default) lay out whole, as before:
  for a host that measures the whole block at once. Print lays out and
  draws everything first either way.
- **Wide displays**: a display too wide for its column scrolls sideways
  and fades where its box cuts it off (see Overflow). A host that needs a
  formula shown whole turns the fade off: `block.setDisplayFade(false)`
  for that block, or that view only (each view is a block, so a split view
  can show one side whole), or `host.mount(el, { of, view, displayFade:
  false })` to mount it so; `block.setDisplayFade(null)` follows the
  host's default again, which is `host.setDisplayFade(on)` (on unless set;
  `host.displayFade()` reads it, `block.displayFade()` what a block
  does now). Off, the display shows all its box holds, still scrolling
  sideways when it is wider, with no mask. Either way only a class changes:
  nothing is laid out again or repainted, and the scroll position stays.
  `block.revealInDisplay(display, x?, { margin? })` scrolls a display so
  that a point of it is in view, a caret say: `display` is its index among
  the block's displays (top-level, in document order, whether they overflow
  now or not) or a glyph element drawn in it, `x` px from its left edge
  (its `<svg>`'s user units); without `x`, the element whole. In view
  is within the column while the display fades, anywhere in its box when it
  does not, less `margin` on each side; it moves only as far as needed,
  and returns false when there is no such display.
  A host with room beside the column can show a wide display at its own
  width instead: `block.setDisplayFit('natural')` (that block or view;
  `host.mount(el, { of, view, displayFit: 'natural' })` to mount it so;
  `null` follows the host again, `host.setDisplayFit('natural' |
  'column')` sets the default, `'column'` unless set; `displayFit()` on
  either reads it). Each wide display's box then widens to the display's
  natural width, centred on the column as far as the room on each side
  allows, up to the padding box of the element the block sits in and never
  past the window; only a display wider than that scrolls, and none fades.
  The room is measured when the fit is set, when the block is laid out at a
  new width, and when the window or that element is resized (a host that
  moves a block some other way sets the fit again). `'column'` is the
  scroll box the column's width, with the page's peek and the fade.
  Switching changes only classes and styles: no line is broken or laid out
  again, nothing else on the page moves, and each display's glyphs stay
  where they were on screen as far as its box lets them (its scrollLeft
  follows).
- **Instances**: everything the companion package makes, and the footnotes
  and `\marginpar`s the pipeline makes, one instance each – `{ id, kind,
  attrs, presentation, placement, parts, parent, children, spaceBefore,
  anchor(), onAction(), setText() }`. `placement` is `block` (a stream in the
  flow), `inline` (a widget), `text` (a `\webtext`) or `detached` (an aside,
  a footnote). Ids are stable for the life of the page. Query with
  `host.instances(q)` / `block.instances(q)`, a kind or `{ kind, placement,
  …attrs }`; `host.find(id)`.
- **Parts**: an instance's content by role – a stream's own content is
  `body`; the author declares others with `\webpart{role}{text}` (of the
  widget before it in text, or of the environment around it), and the
  package's own environments name theirs (Lean: `statement`, `tex`, and the
  data part `code`). A part carries `spaceBefore`, the space TeX put before
  it in its owner's text. The package's own keys in a stream's parameters
  (`aside`, `rtx-part`, `rtx-owner`, …) never reach `attrs`. A typeset part is laid
  out into any element with `part.mount(el, { width })` – a number of px,
  `'natural'`, or `'container'` (the default: el's width, followed as it
  changes) – returning a surface: `metrics()`, `setWidth()`, `onChange(fn)`,
  `dispose()`. A part may be mounted in several places at once; one in a
  hidden element is painted when shown.
- **Kinds**: `host.define(kind, { render(instance, host), measure? })` says
  how every instance of a kind is drawn, whatever its placement; it returns
  what undefines it, and a kind defined late draws the instances already
  there anew. `render` is called once per host, never again on relayout,
  resize or font load, and may return what undoes it, called when the host
  goes for good. State belongs to the instance, never to a host. A render
  that throws leaves its instance drawn by default. `host.kinds()` lists
  the kinds defined now.
  - *block* (`host.type === 'block'`): `host.el` is the stream's element in
    the flow (below). The flow still spaces it as TeX would, from its
    *edges* – the first and last lines of the body's surface inside it by
    default; `host.setEdges({ top, bottom })` names others, or `null` for no
    line of text – with no glue across a framed edge where the author left
    explicit space (`host.setFrame({ top, bottom })`). Its height is its
    content's: open or close something and what follows moves.
    `host.spacing()` is the space the flow put above and below it.
  - *margin* and *popover* (a `NoteHost`, `'margin'` or `'popover'`): a
    detached instance the viewer shows in the margin (`place=margin`, below)
    or in the popover a glyph opens (a footnote, or any stream a glyph refers
    to); `host.el` is the note or the popover's content, and `setEdges` names
    the surface whose first line stands on the mark's line.
  - *inline* (`'piece'`): a widget; see Widgets.
- **Actions** and **text**: see below.
- **Marks**: `\webspan[id=…, class={…}]{…}` (short forms `\webid{id}{…}`,
  `\webclass{classes}{…}`) mark glyphs
  (`Node.mark` → `Document.marks`), drawn with `data-rtx-id` and the classes;
  `host.mark(id)` gives `{ elements(), rects() }`, one rect per drawn line.
  Each mark also has a band on every line it is on, drawn under the text,
  as tall as the line (its tallest glyph, and at least a parenthesis:
  0.75 em up, 0.25 em down):
  `rect.latex-mark` with the classes in `data-mark` and the id in
  `data-rtx-id`, transparent until a page styles it (a highlighter:
  `rect.latex-mark[data-mark~="key"] { fill: #fff176 }`; a stroke of the
  same colour pads it).
- **Live marks**: the same, made while the page is open (a reader's
  highlight). A `TextRange` is `{ block, from, to, text }`: the block's key
  and the positions of its first and last glyph, every glyph of the block
  numbered in reading order (footnotes and boxes included; a disc's hyphen
  too, without text), which is the same on every load of the same document.
  `host.rangesOf(range)` turns a DOM `Range` (the selection) into them;
  `host.addMark(ranges, { id, classes })` marks them, a band on every line
  as above, kept through every reflow (glyphs get the id in
  `data-rtx-marks`); a saved range whose text has moved is found again by
  its text. `host.liveMarks(at?)` lists them (all, on a glyph element, or
  touching ranges); each has `setClasses`, `remove`, `ranges` and the
  handle's `elements()`/`rects()`. Every change sends `reflowtex:marks` on
  `document`. The marks live in [host/marks.ts](src/host/marks.ts); the
  painter asks `liveOn(node)` for every glyph it draws.
- **Colour maps**: `host.colorMaps()` gives the maps in force (the
  built-in `reflowtex`, with the page's of that name over it, and the
  page's others: its island, or what was set last), `host.setColorMaps(maps)`
  replaces the page's;
  the page's colours follow at once, with no layout (see Theming). Maps set
  before the viewer reads its island (at its first block) are kept over the
  island's, map by map.
- **The reader's theme**: `reflowtex.theme()`, `reflowtex.themes()`,
  `reflowtex.setTheme(choice)` (a theme, or `'system'`) and
  `reflowtex.setSystemThemes({ light, dark })` and
  `reflowtex.rememberTheme()`, with `reflowtex:theme` on `document`; see
  Theming.

## Streams

A block's content can hold *streams*: separately typeset runs of paragraphs
and displays, each with a `kind` (`Document.streams` in the schema). A
footnote's body is one, pointed at by its marker glyph and shown in the
footnote popover. The companion package's `\begin{webstream}[key=value]{kind}`
(see [src/latex/](../latex/)) makes one at the point where it stands in the
flow, a block instance. Its element is

```html
<div class="latex-stream" data-kind="KIND" data-instance="ID" data-KEY="value">…</div>
```

with every parameter as `data-KEY`, except `class` (classes) and `--name` (a
CSS custom property). A kind the page defines draws in it; any other kind is
drawn by default: the stream laid out inside, like a block, at the element's
inner width (its width minus its CSS padding), re-broken whenever the block
reflows. Padding or a border on a side makes that side a frame, which TeX's
interline glue does not cross where there is explicit space. Streams nest.
The viewer sets `--latex-first-ascent` and `--latex-last-depth` on the
element, for CSS that sizes a frame around the ink. What a kind looks like is
CSS on `.latex-stream[data-kind=…]`; the companion package's kinds' looks are
its stylesheet.

## Actions

`\webaction{verb:arg}{text}` makes text inside a paragraph a *control*. Its
glyphs are grouped like a `\ref` and drawn as a link is (the theme's link
look), with `.latex-link` and `.latex-action`. They take `role="button"` and one tab stop. A
click, Enter or Space goes to the instance whose text holds the control –
the nearest `[data-instance]` around it, a stream's element or a surface's –
and then outward through its parents, the tree the TeX made rather than the
DOM, so a control in a part shown in a popover still reaches its owner. The
first handler for the verb that does not return `false` takes it:

```js
instance.onAction('pane', ({ verb, arg, action, instance, source }) => { … });
```

Then, handled or not, the glyph sends a bubbling DOM event for page scripts:
`reflowtex:action`, `detail: { action, verb, arg, source, instance, handled }`.
In print, control text is transparent.

## Live text (optional)

`\webtext{name}{default}` (the companion package, `src/latex/reflowtex.sty`)
marks a run of running text a page may replace: a text instance. Every glyph
and space of the default carries the slot's index (`Node.slot` →
`Document.slots`, which also records the name and the interword glue of the
font the default was set in).

```js
reflowtex.host.setText('clock', '12:04');   // every \webtext{clock}, in every block
reflowtex.host.setText('clock', null);      // TeX's default again
instance.setText('12:05');                  // one of them; wins over its name's
```

Every glyph of a slot, TeX's default or a given text, is drawn with
`data-slot="name"`, so a page can find where it stands or style it.

A given text is set as a browser sets it: split at breakable white space,
each word one node measured with the canvas in the default's font and colour,
with no kerning, ligatures or font expansion across words; between words, the
font's interword glue (`\fontdimen2–4`), so the line justifies with the rest.
A no-break space (U+00A0) is TeX's `~`: it splits the words too, and stands
as the same glue after a penalty 10000, so it never breaks and is exactly as
wide as TeX's tie. The narrow no-break space (U+202F), the figure space
(U+2007), the word joiner (U+2060) and U+FEFF stay inside their word, at the
browser's fixed advance, and do not break. The words keep the default's
height and depth.

A slot inside a box – an `\hbox`, maths' `\text{…}`, an equation's tag, a
one-line caption – is replaced in the same way, and the box is packed
again with its new contents, as TeX packs one: a box at its natural width
grows or shrinks by the change, and so does every box around it, up to the
line, which is then broken with its new width; a box set to a width (glue
stretched or shrunk in it, as in `\hbox to`, a centred caption or a line of
a `\parbox`, or a width that follows the measure) keeps it, and its glue
takes the change. Heights and depths stay, so no baseline moves. An
equation's tag is placed again from its new width, as at any measure. A
widget (`\webwidget`) is replaced only in a paragraph's own line.

Changes within one animation frame are applied together, and only the
segments holding an affected paragraph or display are laid out and painted
again. A text set before its block is initialised is applied when the block
is.

**Scopes.** Several documents on one page may use the same names (two
papers each with `\label{thm:main}`). A host mounts each document's blocks
in a scope of its own and sets their texts there:

```js
await reflowtex.host.mount(el, { scope: 'paper-2' });   // or data-latex-scope="paper-2"
reflowtex.host.setText('thm:main', '3.1', { scope: 'paper-2' });
reflowtex.host.text('thm:main', { scope: 'paper-2' });  // '3.1': what its blocks show (null: TeX's default)
reflowtex.host.clearTexts({ scope: 'paper-2' });        // every text of that scope forgotten
```

A block in a scope resolves a name in this order: its instance's own text
(`instance.setText`, or a mirrored one), its scope's, the page-wide one,
TeX's default. Its scope is applied before its first layout, so a block
mounted into a scope whose texts are already set is drawn with them from its
first frame, never with TeX's defaults first. Setting a scope's text lays
out only that scope's blocks. A view (`host.mount(el, { of })`) has its
block's scope unless given one (`scope: null`: none); `block.scope` says
which. Mounting a block already on the page with a scope moves it into
that scope. A scope's texts are the host's: they are kept when its last
block is unmounted, for one mounted again, until `clearTexts`. A slot
inside a box (`\mbox`) is left as its default.

## Widgets (optional)

`\webwidget[default]{kind:key}` marks a place in running text where the page
draws HTML: an inline instance of `kind` (with `attrs.key`). Its kind says how
big it is and where it may break, as a word has hyphenation points, and draws
each piece:

```js
reflowtex.host.define('lean', {
  measure(instance, env) {        // px, at the text's size and baseline
    return { width, height, depth,
             splits: [{ first: {width, height, depth, overhang}, second: {…}, penalty: 100 }] };
  },
  render(instance, host) {        // host.piece: 'whole' or { split: i, piece: 'first' | 'second' }
    host.el.innerHTML = …;
    return () => { … };           // when this piece goes for good
  },
});
```

For a widget that should break across any number of lines, `measure`
describes it as segments instead:

```js
measure(instance, env) {
  return {
    segments: [{ width, height, depth }, …],          // the content, in order
    gaps: [{ width, penalty }, …],                      // between each two: the space
                                                        // shown when not broken there
    ends: { left:  { cap, cut, overhang },              // a closed end and a cut one
            right: { cap, cut, overhang } },
  };
},
render(instance, host) { … },     // host.piece: { from, to, left: 'cap' | 'cut', right: 'cap' | 'cut' }
```

Each break point becomes a discretionary: the line before it ends with the
right cut end, the line after starts with the left one, and unbroken it shows
the gap. A split is one way to break the widget between two lines, as a hyphen
breaks a word (a piece's optional `overhang`, in px, lets it reach past the
margin by that much, as hanging punctuation does): the line breaker weighs
every break (penalty 100 unless given) against the rest of the paragraph, and
`render` is then asked for the piece on each line. `env` carries `fontSize`
and `color` of the text around it, `measure(content)` – the width, height and
depth of some HTML (a string, a node, or a function filling an element) set
at that size against the baseline – and `invalidate()`, which measures again
and re-breaks the paragraph when the widget's content changes; the pieces it
replaces then go (their undo is called). State belongs to the instance: a
widget broken over three lines has three hosts. Each piece is drawn in a
`foreignObject`, its elements aligned by baseline on the line's, so it moves
with the text on every reflow. Pointing at or pressing any piece marks every
piece – `latex-widget-hover` and `latex-widget-active` on each
`foreignObject` – so a split widget can be styled as one. Keep menus and
popovers out of it: open them in the page, where nothing of the text can
cover them.

## Asides and margin notes (optional)

`\webaside[key=value]{kind}{text}` (reflowtex.sty) typesets `text` where it
stands, in running text too, but out of the flow: a detached instance of
`kind`, with a mark where it stood (`instance.anchor()`). A page shows its
body where it likes (`part('body').mount(el)`), in several places at once if
it likes. An aside with `for=KEY` is a part of the widget `kind:KEY` of its
block, under its own kind as role (`\mypopover` on the website: a widget, a
label and a note).

With `place=margin` (and every `\marginpar`) the viewer sets it in the right
margin, its first baseline on the line of its mark, one pushed below another
that would overlap; where the window leaves too little room, the note hides
and its mark becomes a small button opening it in the footnote popover. A
kind the page defines draws it (`host.type === 'margin'`, `host.el` the note
at the margin's width); else its body is laid out there. A page styles notes
by `.latex-margin-note[data-kind=…]`, and may set the margin itself, on the
block, in px: `--latex-margin-width` (0 for marks only) and
`--latex-margin-gap`.

## Theming

### Five themes

| Theme | What it draws |
|---|---|
| `default` | TeX's colours exactly, as the PDF has them: black is `#000000`, every colour the document chose is its own, and a link is drawn as TeX drew it (hyperref's `colorlinks` colours, or black), with no underline. No colour map applies, ever. |
| `light` | the built-in map's light theme: softer black (`#333333`), links in a colour of their own, underlined while pointed at |
| `dark` | the built-in map's dark theme: light text, colours made readable on a dark page |
| `navy` | the built-in map's night blue theme: soft off-white text on a deep blue-green page, a dark theme for reading at length |
| `sepia` | the built-in map's sepia theme |
| `contrast` | the built-in map's high-contrast theme |

A theme is a class on `<html>` – none for `default`, else the theme's name
– and `data-theme` says which. Switching it restyles what is drawn through
CSS custom properties: nothing is laid out or drawn again. hyperref's
`pdfborder` boxes are not drawn in any theme: they are link annotations,
which a PDF viewer may draw on screen, and not part of the page TeX
typeset (they are not printed).

### The reader's choice, and the system mode

The reader picks a theme, or **system**: one theme while the system (the
operating system or the browser) is in light mode and another while it is
dark – the two *slots*, `light` and `dark`. For a reader who has chosen
nothing the viewer starts in the system mode with `default` in the light
slot and `dark` in the dark one: TeX's own colours unless the system is
dark. In the system mode the theme follows the system as it changes.

`reflowtex.setTheme` (below) is the one way the page's theme is set: the
companion's reading options, the inspector and the vanilla page's panel all
call it, and nothing else sets the class or the stored choice.

The viewer sets the page's theme only once asked, so a page that themes
itself is left alone (and stays in `default` until it sets a class). A page
that wants the *reader's* settings asks, and gives the first values for a
reader who has chosen nothing, with attributes on `<html>`:

```html
<html data-latex-theme-choice="system" data-latex-theme-light="default" data-latex-theme-dark="dark">
```

or by calling `reflowtex.rememberTheme()`. Only then are the choice and the
slots remembered in `localStorage` (`reflowtex-theme`: a theme or `system`;
`reflowtex-theme-light`, `reflowtex-theme-dark`), as the reader's other
settings are. Without it the viewer neither reads nor writes those keys: a
host that keeps its own settings (an editor, a CMS plugin) calls
`reflowtex.setTheme`, which then only applies the theme.

The viewer applies the theme when its script runs. A page that styles its
own background per theme sets the class itself before the first paint, from
the same keys, so nothing flashes:

```html
<script>
  (function () {
    var root = document.documentElement, get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var c = get('reflowtex-theme') || root.getAttribute('data-latex-theme-choice') || 'system';
    var t = c !== 'system' ? c : matchMedia('(prefers-color-scheme: dark)').matches
      ? get('reflowtex-theme-dark') || root.getAttribute('data-latex-theme-dark') || 'dark'
      : get('reflowtex-theme-light') || root.getAttribute('data-latex-theme-light') || 'default';
    if (t !== 'default') root.classList.add(t);
    root.setAttribute('data-theme', t);
  })();
</script>
```

A host (a reading-options panel, an editor with a theme setting of its own)
drives it through `window.reflowtex`:

| Call | Does |
|---|---|
| `reflowtex.theme()` | `{ choice, theme, light, dark }`: the reader's choice (a theme or `'system'`), the theme shown now, and the two slots |
| `reflowtex.themes()` | the themes on offer: `default`, then the colour maps' (`light`, `dark`, `navy`, `sepia`, `contrast`, and any theme a page's map adds) |
| `reflowtex.setTheme(choice)` | a theme's name or `'system'`; applied at once (it also makes the viewer set the page's theme from then on), and remembered on a page that keeps the reader's settings |
| `reflowtex.setSystemThemes({ light, dark })` | either slot or both; applied at once when the choice is `system`; remembered as above |
| `reflowtex.rememberTheme()` | keep the reader's settings on this page from now on, as `data-latex-theme-choice` asks at load: the remembered choice and slots are read and applied |

Each change sends `reflowtex:theme` on `document`, with the state of
`reflowtex.theme()` as its `detail`. The companion package's reading options
are such a host.

### A theme for part of a page

`data-latex-theme="T"` on any element – a pane, an example's preview – gives
the blocks inside it theme `T`, whatever the page's theme is
(`data-latex-theme="default"` gives them TeX's own colours). A theme's
colours are declared on the element that carries it (`<html>` with the
theme's class, or the element with the attribute) and reach the blocks by
inheritance, so a block takes the theme of its **nearest** themed ancestor:
two panes in two themes stand side by side, and one inside another wins
inside it. A footnote's popover takes its block's theme, map and
`--latex-page-bg`. Set `--latex-page-bg` on the element too, for tints and
the paper. The reader's choice and the system mode (above) are the page's;
a host themes a pane by setting the attribute.

### The link look for the page's own CSS

Each themed element (`<html>` with a theme's class, or one with
`data-latex-theme`) also carries its theme's link look, from the built-in
map (or the page's map named `reflowtex`), for a host's own link-like marks:

| Property | Value | Unset |
|---|---|---|
| `--latex-link-current` | the link colour at rest | in `default`, and where the theme gives none |
| `--latex-link-current-hover` | while pointed at | `--latex-link-current`'s value |
| `--latex-link-current-active` | while pressed | the hover colour |

```css
.my-mark { color: var(--latex-link-current, inherit); }
.my-mark:hover { color: var(--latex-link-current-hover, inherit); }
```

In `default` they are unset, as links there have each their own colour from
TeX, so give a fallback.

### Colour maps

Every theme but `default` draws the colours of a colour map. The viewer
ships one, `reflowtex`
([runtime/builtin-colour-maps.ts](src/runtime/builtin-colour-maps.ts)), with
the four themes above; every block takes it, so a page needs no map of its
own. A page may give its own maps in an optional JSON island:

```html
<script id="latex-color-maps" type="application/json">
  { "my-map": {
      "colors": { "dark": { "#eb5757": "#ff8585", "#000000": "#e7e5e4" } },
      "links":  { "dark": { "color": "#9d9bff", "hover": "#c3c2ff", "active": "#c2410c", "underline": "hover" } },
      "tints":  { "#ffcccc": ["#ff0000", 20] }
  } }
</script>
```

- **`colors`** – per theme, the hex TeX or TikZ produced and what to draw
  instead: any CSS colour (the built-in draws `#ffffff`, TeX's paper, as
  `var(--latex-page-bg, Canvas)`, the page's background). A colour a theme
  leaves out is drawn as TeX wrote it. `#000000` is TeX's black, the
  colour of all default-coloured text and rules.
- **`links`** – per theme, how a link (`\ref`, `\url`, `\href`, a citation,
  a `\webaction`) is drawn:

  | Key | Meaning | Unset |
  |---|---|---|
  | `color` | its glyphs' colour | TeX's colour for each glyph |
  | `hover` | its colour while pointed at (the whole link, across lines) | `color` |
  | `active` | its colour while pressed | `hover` |
  | `underline` | `"hover"`: a line under it while pointed at, one per line it is on, in its colour; `"none"` | `"none"` |

- **`tints`** – colours TeX baked by mixing a base colour into the page
  (e.g. `red!20!white` resolves to flat RGB at compile time, with no trace
  of how it was built). Re-derived at runtime as
  `baked-hex: [base-hex, percent]`, in every theme but `default`, so the
  tint follows the theme's base colour and the *current* background rather
  than staying stuck to the white page TeX mixed it on.

A block takes a map by name with `data-color-map="my-map"`; nothing stops a
page from giving different blocks different maps (two documents on one
page, each with its own palette). Maps fall back to the built-in theme by
theme: a theme a map gives replaces the built-in's (its colours and its
links separately), and a theme it leaves out is the built-in's. A page's
map named `reflowtex` replaces the built-in's themes it gives for every
block; a map may also add a theme of its own, matched by its class like any
other. A site that wants softer text or its own link colour in a theme sets
it there.

`tints`, and the built-in's paper, read the ambient `--latex-page-bg`
custom property (falling back to the CSS `Canvas` system colour), which is
deliberately *not* part of the colour-map data – TeX has no notion of the
page's colour, so that is the page's own theme CSS to set, typically right
where it already sets its background per theme:
`:root.dark { --latex-page-bg: #0c0a09; }`.

The Hugo integration generates the island from `<site>/latex-color-maps/<name>.json`
files, referenced with `color-map="<name>"` on the shortcode – see
[integrations/hugo/README.md](../../integrations/hugo/README.md).

## Citations (optional)

If a page includes `<script id="lr-citations" type="application/json">…</script>`
mapping citation numbers to reference metadata, and the LaTeX marked citation
digits (via an integration-specific macro), the viewer wires hover/click popovers
to them. This is opt-in and unused by the core examples.

## Inspection (for developer tools)

`window.reflowtex.inspect` exposes each block's decoded document and layout, so
a tool can show the boxes and glue behind what is on screen – which box a
glyph sits in, what a glue was set to on this line – and outline them on the
page:

```js
const { inspect } = window.reflowtex;
const el = inspect.blocks()[0];              // an initialised block element
const { doc, cache } = inspect.state(el);    // the renderer's own state
inspect.replay(el, 0, {                      // segment 0, drawn again with no DOM
  line(j, line, x0, baselineY) {},
  node(n, x, baselineY, advance) {},         // every node on a line, nested ones too
  vnode(n, x, top, advance) {},              // every item of a vertical list
});
```

Coordinates are the segment's `<svg>` user units (`cache.dom.segs[i].svg`);
`getScreenCTM()` maps them to the viewport. `inspect.paints` counts segment
paints, so a tool can poll it to notice a reflow. `await inspect.idle()`
resolves once the viewer has nothing still to come: no frame, timer, block
set-up or face it waits for, the fonts loaded, and no animation running on
the page (the companion's panes and hints ease with Web Animations and CSS
transitions), over three frames. A test
waits for it after acting (a resize, a selection) instead of a fixed time,
which a busy machine can outlast; `inspect.pending()` names what is still to
come. The viewer's deferred work goes through `runtime/pending.ts` for this.
The state objects are
internal and may change between versions; `inspect.version` says which shape
to expect. Nothing here changes what is drawn.

[`src/inspector/`](../inspector/) is a floating panel built on this API: a tree
of boxes and glue for every block on the page, with the page outlining whatever
is hovered or selected.
