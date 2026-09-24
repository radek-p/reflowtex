# Reflow TeX inspector

A floating panel that shows the boxes and glue behind the Reflow TeX blocks
on a page, much as a browser's element inspector shows the DOM: a tree of
blocks → segments → lines → nodes (hbox, vbox, glyph, glue, kern, penalty,
discretionary, math, rule, picture, widget). The page highlights the node you
hover or select.

The project's website includes it on every page. Press **Alt+Shift+I**
(**⌥⇧I** on a Mac), click **Inspect** on an example's result, or choose
**Inspect boxes and glue** in the reading options panel.

## What it shows

- **Tree.** Expand a block to its segments (text, display, stream – a
  stream's own segments sit below it), a segment to its lines, a line to its
  nodes, a box to its children, and a discretionary to its replace list.
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
  to select it in the tree. Esc cancels.
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

Drag the title bar to move the panel, and its corner to resize it. The
browser remembers both.

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
| `open(blockEl?)` | Open the panel. Given a block element, it expands and selects that block. |
| `close()`, `toggle()` | Close or toggle the panel. |
| `shortcut` | The shortcut's label, for a tooltip. |

The website's [`layouts/partials/inspector.html`](../../website/layouts/partials/inspector.html)
adds its **Inspect** buttons this way.

## How it works

- **The viewer** exposes `window.reflowtex.inspect` (see its README,
  "Inspection"). `replay()` re-runs the drawing of one segment through a sink
  that records every node's position and advance, without touching the DOM.
  So the geometry is the renderer's own, including the Knuth–Plass breaks,
  glue setting, font expansion, and displays evaluated at the current width.
- **`agent.js`** runs in the page and installs `window.__rtxInspector`:
  - ids for blocks, segments, lines and nodes, and a summary of each as plain
    JSON;
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
- A glue or kern is outlined at its enclosing box's (or line's) height and
  depth; a running rule takes its box's.
