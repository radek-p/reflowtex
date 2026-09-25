# Reflow TeX inspector

A floating panel that shows the boxes and glue behind the Reflow TeX blocks
on a page, much as a browser's element inspector shows the DOM: a tree of
blocks → segments → lines → nodes (hbox, vbox, glyph, glue, kern, penalty,
discretionary, math, rule, picture, widget). The page highlights the node you
hover or select. A second view, **Resources**, lists what the blocks draw
with: fonts and their glyphs, pictures, streams (footnotes among them),
links, citations, anchors and slots.

The project's website includes it on every page. Press **Alt+Shift+I**
(**⌥⇧I** on a Mac), click **Inspect** on an example's result, or choose
**Inspect boxes and glue** in the reading options panel.

## What it shows

- **Tree.** Expand a block to its segments (text, display, stream – a
  stream's own segments sit below it), a segment to its lines, a line to its
  nodes, a box to its children, and a discretionary to its replace list.
  A block's footnotes follow its segments, as *footnote n (popover)*: once
  its popover has been opened, the body the viewer laid out there, segment by
  segment, like the rest.
  Each row sums up its node:
  - a box: `w × h + d`, its shift and its glue setting;
  - a glue: its specification, its TeX name and the width it was set to on
    this line (`\spaceskip 3.33pt plus 1.66pt minus 1.11pt → 3.43pt`);
  - a line: its glue ratio, font expansion, and badness (100·r³, as TeX
    rates it) with its fitness class;
  - a vertical space, between paragraphs or around a heading or a display:
    its total. Its children are the glue TeX put there: an explicit skip
    (`\vspace`, a heading's skip), `\parskip`, a display skip, and the
    interline `\baselineskip` or `\lineskip` glue as it comes out for these
    lines.
- **Hover** a row to outline its node on the page, with a label. **Select**
  a row to keep the outline; a box or line also outlines its children one
  level down: glyphs blue, glue green and hatched, kerns purple, math orange,
  penalties red. The arrow keys move through the tree.
- **Details:** every field of the node, dimensions in sp and pt, the width it
  was set to, and its rectangle on screen.
- **Width-dependent nodes (↔).** A display is compiled at several widths,
  and the fields that vary carry a rate. The viewer evaluates each at the
  reader's measure w as `v₀ + rate × (w − w₀)`, where w₀ is the width TeX
  compiled at. Such a node is marked ↔, and its details show that formula
  with today's numbers. They also show which floor applies: a gap with ink on
  both sides stops at the minimum space, and the display then freezes and
  scrolls; outer space may close to 0. The node stays selected while the width
  changes, and its values follow in real time.
- **Copy XML:** the selected fragment – a node and all it holds, a line, a
  vertical space, a segment, a block – as compact XML (the button in the
  details, or ⌘C / Ctrl+C in the tree). A run of glyphs in one font is one
  `<t>`, each other node one element, and boxes nest; dimensions are in pt, a
  glue's `set` is the width it came out at, and a width-dependent field
  carries its rate (`w-rate`).
- **Context menu:** right-click a row (or a letter of a run), or press the
  menu key or Shift+F10: *Copy XML*, *Copy text* (the characters, a space per
  glue, a line break per line), *Copy row* (its label and summary).
- **Pick:** hover the page to highlight the node under the pointer, and click
  to select it in the tree. Esc cancels. Over an open footnote popover, it
  picks from the popover.
- **Baselines**, **Badness** and **Springs** (toolbar): the baseline of
  every line on screen; a bar past every line's end coloured by its badness
  (green decent, ≤ 12; amber loose or tight; red 100 or more; purple
  overfull); and every display glue whose width the display model recomputes,
  drawn as a spring.
- **A display's band.** A display row's box need not fill the band the
  display occupies (`display_indent` to `display_indent + display_width`).
  An amsmath alignment ends every row with a tag column that opens with
  `\kern-\tagshift@` and backs the box up over the right margin, even with
  no tag. Hovering or selecting such a row continues its outline dotted over
  the rest of the band, and its details say how much the box leaves out.
- **Reflow:** after a resize re-breaks the lines, the open branches refresh.

## Resources

The **Resources** switch in the title bar shows what the blocks draw with,
for the whole page. A font file several blocks use is listed once. Hover a
resource to outline its uses on the page; select it to keep them outlined.
**Show in tree** selects its first use in the Boxes view, then the next one
each time you press it. The filter above the list matches names and notes.
Click a heading to collapse or expand that kind of resource, or ⌥-click
(Alt-click) to show that kind alone. The browser remembers which are
collapsed. While the filter has text, every kind with a match is expanded.

- **Fonts**, in two groups: the *originals*, served as TeX had them, and
  those *modified by Reflow TeX*. The pipeline modifies a font in one of two
  ways. It *converts* a classic Type 1 font to OpenType
  (`cmmi10.reflowtex-<hash>.otf`). Or it *patches* an OpenType font's cmap
  with code points LuaTeX used but the font did not map, and serves it
  renamed. Either way, a glyph with no code point of its own (a variant, a
  size of a delimiter) gets a private-use one. Each font is listed with its
  sizes, how many distinct characters the documents use (for a modified font,
  how many of them are private-use) and how many glyphs they set. The switch
  beside the filter orders them by name or by use (most glyphs set first).
  A modified font is served subset to the site's characters, so its table
  holds only those. Selecting one reads the
  file the page loaded it from (the viewer's `@font-face` rule) and shows a
  table of all its glyphs, used or not, by code point. Glyphs with no code
  point come after them, and then any character the documents use that the
  file lacks. Search by the character itself (`→`), a code point (`U+2192`,
  `0x2192`), a glyph index (`#12`), a decimal number (read as either), or
  part of a glyph's name (from the CFF charset: `parenleft`,
  `angbracketrightbigg`). Choose *Used here*, *Not used* or *Private use* to
  narrow it. A glyph's details give its index, name, code points, advance,
  the box TeX gave it at each size, its ink (as the browser measures the
  outline, and how far it goes past TeX's box) and its microtype codes. It is
  drawn large, whole, inside TeX's box (dashed) and on its baseline. In the
  table, glyphs share a size and a baseline, and one too big for its cell is
  shrunk to fit.
- **From a glyph in the tree:** its details in the Boxes view have
  **In its font**, which opens its font's table with that glyph selected.
- **Pictures.** Each TikZ drawing or included PDF page (SVG by now): a
  preview, its box, viewBox and size. **Copy SVG** puts it on the clipboard
  as a standalone file.
- **Streams.** Every `webstream` and footnote, with its kind, parameters,
  where it stands (in the flow, in another stream, or behind a marker) and
  its text (a Lean block's source). For a footnote, **Open popover** opens it
  as its marker does, pinned. **Its boxes** shows the popover's boxes and
  glue in the Boxes view. Clicks in the panel do not reach the page, so a
  pinned popover stays open while you inspect it.
- **Links, citations, anchors, slots.** Each `\ref` (with whether its label
  is on this page), URL and `\webaction`; each `\lrcite` number, with its
  entry from the page's `#lr-citations`; each `\label`; each `\webtext`
  and `\webwidget` slot.

The panel floats over the page, or docks to the left, right or bottom edge
of the window: the buttons at the end of its bar choose. Floating, drag the
title bar to move it and its corner to resize it; docked, the page keeps the
rest of the window and scrolls on its own, and the edge facing the page is
dragged to resize. The browser remembers the place and the sizes.

## Adding it to a page

Serve the three files together, and include the script after the viewer:

```html
<script src="latex-viewer.js"></script>
<script src="inspector/inspector.js"></script>
```

Until opened, it only listens for the shortcut. The panel,
`inspector.css` and `agent.js` load from beside the script on first use,
with the script's own `?v=` query. A page's controls open it through
`window.reflowtex.inspector`:

| Call | Effect |
|---|---|
| `open(blockEl?, { dock }?)` | Open the panel. Given a block element, it expands and selects that block. `dock` is where this page would have the panel – `'left'`, `'right'`, `'bottom'`, `'float'`, or `'auto'` (right, or bottom in a portrait window) – until the reader chooses a place; floating if not given. `scroll: false` leaves the page where it is rather than scrolling to the block. |
| `setDock(mode)` | Dock the panel to an edge (`'left'`, `'right'`, `'bottom'`) or let it float (`'float'`), and remember that. |
| `close()`, `toggle()` | Close or toggle the panel. |
| `shortcut` | The shortcut's label, for a tooltip. |

The website's [`layouts/partials/inspector.html`](../../website/layouts/partials/inspector.html)
adds its **Inspect** buttons this way.

Docked, the panel makes room with padding on `<html>` on its side, and sets
`--rtx-dock-left`, `--rtx-dock-right` or `--rtx-dock-bottom` there to its
size. Anything the page fixes to the window can keep clear with them:

```css
#my-button { right: calc(1rem + var(--rtx-dock-right, 0px)); }
```

## How it works

- **The viewer** exposes `window.reflowtex.inspect` (see its README,
  "Inspection"). `replay()` re-runs the drawing of one segment through a sink
  that records every node's position and advance, without touching the DOM.
  So the geometry is the renderer's own, including the Knuth–Plass breaks,
  glue setting, font expansion, and displays evaluated at the current width.
- **`agent.js`** runs in the page and installs `window.__rtxInspector`:
  - ids for blocks, segments, lines and nodes, and a summary of each as plain
    JSON;
  - the resources, keyed by strings (`font:FILE`, `pic:BLOCK:N`, …), and
    the ids of each one's nodes on the current layout. A font's glyph table
    comes from reading its OpenType file (`cmap`, `hmtx`, the CFF charset).
  - box extents from the nodes' own dimensions, mapped to the viewport with
    `getScreenCTM()`;
  - the overlay layer, pick mode, and element → node lookup through the
    viewer's element cache.

  Because it answers in JSON, a browser's devtools panel could drive it as
  well, by evaluating the file in the page.
- **`inspector.js` and `inspector.css`** make the floating panel, in a shadow
  root so the page's styles and the panel's never meet. It talks to the agent
  only through `window.__rtxInspector`.

## Limitations

- Only blocks in the page itself are inspected; blocks in iframes are not
  found.
- A segment whose layout is deferred (far off screen, never painted) has no
  lines yet. Scroll to it.
- Leader copies (`\cleaders`) are drawn from clones, and do not map back to
  their leader glue.
- A glyph with no code point in its font's `cmap` cannot be drawn in the
  glyph table: the browser draws text only by code point. A TrueType font's
  glyph names (in `post`) are not read. The pipeline makes CFF fonts.
- A font file on a `file://` page cannot be fetched. The glyph table then
  lists only the characters the documents use.
- A glue or kern is outlined at its enclosing box's (or line's) height and
  depth; a running rule takes its box's.
