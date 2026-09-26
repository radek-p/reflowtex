# reflowtex/companion

The browser side of the companion package ([reflowtex.sty](../latex/reflowtex.sty)).
It is one ES module with its stylesheet. Load it on a page and the package's
kinds are drawn by it: the accordion, the hint, the Lean widgets, and the
looks of notes and boxed theorems. Import from it to draw kinds of your own –
blocks, margin notes and widgets in a line of text, all the same way.

```html
<script type="importmap">{ "imports": { "reflowtex/companion": "/companion/companion.js" } }</script>
<link rel="stylesheet" href="/companion/companion.css">
<script type="module">import 'reflowtex/companion';</script>
```

The Hugo site does this on every page ([partials/companion.html](../../website/layouts/partials/companion.html)).

## A kind of your own

In LaTeX, declare an environment of your kind, with its print form beside
it. Any `key=value` goes to the page, as written:

```latex
\NewWebEnvironment{warning}{warning}{\par\noindent\textbf{Warning.} }{\par}

\begin{warning}[title=Careful]
Dividing by $x$ assumes $x \neq 0$.
\end{warning}
```

In the page, draw it with a component:

```js
import { define, Typeset, html } from 'reflowtex/companion';

define('warning', ({ attrs }) => html`
  <p class="warning-title">${attrs.title || 'Warning'}</p>
  <${Typeset} />`);
```

`define` draws a kind wherever it stands: in the flow, in the margin when
it is a `\webaside[place=margin]{kind}` (props.host.type is `'margin'`; the
viewer puts its first line on the line of its mark), or in the popover a
glyph opens (`'popover'`: a footnote, drawn your way). `<Typeset />` is
the instance's body, typeset by TeX and laid out by the viewer at the width
of the element it stands in. That width is followed as
it changes, and the text is broken again. The viewer still spaces the block
as TeX would, from the body's first and last lines. The block's height is
whatever your component makes it, and the text below moves when it changes.

### What a component gets

| | |
|---|---|
| `props.instance`, `useInstance()` | the instance: `id`, `kind`, `attrs`, `parts`, `children`, `parent` |
| `props.attrs`, `useAttrs()` | the author's parameters |
| `useInstanceState(key, initial)` | a signal belonging to the instance. It outlives redraws, so a choice the reader made (the pane they opened) stands |
| `useAction(verb, fn)` | the reader pressed a `\webaction{verb:arg}{…}` in this instance's text or an instance inside it, wherever shown. `fn({ verb, arg, source, instance })`; return `false` to leave it to an enclosing instance |
| `useHost()` | where the instance is drawn: `host.type` is `'block'`, `'margin'`, `'popover'` or `'piece'` |
| `useBlockHost()`, `useNoteHost()` | a block in the flow (`setFrame`, `setEdges`, `spacing()`); a margin note or popover (`setEdges`) |
| `instance.part(role)` | the instance's parts: `body`, and those the author wrote with `\webpart{role}{…}` (a `TypesetPart` for `<Typeset part={…}>`, or a `DataPart` with `.data`) |
| `usePiece()` | in a widget's piece: `host.piece`, `host.env` |
| `<Typeset part of width edge onMetrics />` | a part (`'body'` by default) of this instance or of a child (`of`), at `'container'` width (default), `'natural'` or px. `edge` makes its lines the block's edges for TeX's spacing |
| `readMotion(el, name, fallback, attr)` | duration, easing and style from CSS (`--rtx-NAME-*`), honouring reduced motion |

Preact, htm and Preact Signals are re-exported (`h`, `render`, `useState`,
`signal`, `html`, …), so your components use the same copy as the package's.

A component that throws is replaced by the plain body, with the error on the
console. `define` returns a function that undoes it. Defining a kind
again, including one of the package's own, redraws what is already on the
page.

### Frames

A block with a border or padding is *framed*. Across a framed edge, TeX's
interline glue gives way to the author's explicit space, as a box in print
would. `define` reads this from the element's CSS (`frame: 'auto'`) and
follows it as it changes. Pass `frame: true` or `false` to decide yourself.

## Styling

[companion.css](companion.css) has three layers. Each can be set from a
stylesheet or, per block, from the LaTeX source.

1. **Tokens** on `:root`: `--rtx-accent`, `--rtx-surface`, `--rtx-border`,
   `--rtx-radius`, `--rtx-padding`, `--rtx-shadow`, `--rtx-duration`,
   `--rtx-easing`. Everything else is made of these.
2. **Variants** for any stream: `variant=card` (filled, lifted), `outline`,
   `accent` (a bar in the accent colour). They read `--rtx-box-background`,
   `-border`, `-radius`, `-padding` and `-shadow`, so one kind can be
   restyled alone:
   `.latex-stream[data-kind="accordion"] { --rtx-box-radius: 4px }`.
3. **Parts and states** of each kind: `rtx-…` classes, and `data-*`
   attributes for state.

From LaTeX, parameters become attributes: `variant=card` becomes
`data-variant`, `class=faq` adds a class, and `--rtx-accent=#c2410c` sets a
custom property on that block. `\begin{webaccordion}` passes on every key
it does not use itself.

## The accordion

`\begin{webaccordion}[initial=…, print=…, variant=…, motion=…]` with
`\begin{webpane}[name]` inside. Links in the panes switch them:
`\webnextpane`, `\webprevpane` and `\webpanelink{target}{text}`.

- **Motion.** The height eases between panes while the old pane fades out
  and the new one fades in (`slide` also moves it a little). Set it with
  `motion=` or CSS `--rtx-accordion-motion: slide | fade | none`, together
  with `--rtx-accordion-duration` and `--rtx-accordion-easing`. With
  `prefers-reduced-motion`, panes switch without it.
- **State for CSS.** `.rtx-accordion[data-pane=NAME]`, and
  `.rtx-pane[data-state=open|closed|leaving][data-name=NAME]`.
- **Keyboard.** A link pressed from the keyboard hands focus to the first
  link of the pane it opens.
- **Print.** The `print=` pane (by default the last) is printed, whatever is
  open on screen.

## Lean beside a proof

`leantheorem[decl=, url=, show=]` and `leanproof[decl=, url=, show=]`
(with `leancode` inside) have Proof and Lean switches, which open either
part, or both. The parts sit side by side when the widget is at least
44rem wide, and one under the other below that.

- **Motion.** Opening a part fades it in while the widget's height eases to
  fit; closing fades it out, then the height eases shut. Set it with
  `--rtx-lean-motion` (`slide`, `fade` or `none`), `-duration`, `-easing`,
  or `motion=`.
- **Space around.** While the proof is hidden, the space after the widget
  is the space TeX put after the statement (or before the widget), not the
  space after the hidden proof.
- **State for CSS.** `.rtx-lean[data-proof][data-lean]` and
  `.rtx-lean-part[data-part=tex|code][data-state=open|closed]`.
- **Code.** The code is highlighted (`.lean-kw`, `.lean-com`, `.lean-str`,
  `.lean-num`, coloured by `--code-*`), and the frame colour is
  `--latex-lean-accent`.
- **Print.** Both parts are printed, without the switches.

The building blocks it uses are exported for kinds of your own:
`animateHeight(el, fromPx, motion)`, `fadeIn(el, motion)` and
`fadeOut(el, motion)`.

## A widget in a line of text

`\webwidget{kind:key}` is an inline instance: the line breaker needs its
size first, so `defineInline` takes a `size` beside the component, which is
drawn once for each piece – the whole widget, or its part on each line it is
broken across (props.piece). State the pieces share belongs to the instance.

```js
import { defineInline, InlineButton, Popover, Typeset, useState, html } from 'reflowtex/companion';

defineInline('popover', {         // \webwidget{popover}\webpart{label}{…}\webpart{note}{…}
  size: (instance, env) => InlineButton.size(env, instance.part('label').naturalWidth()),
  View: ({ env }) => {
    const [button, setButton] = useState(null);
    return html`
      <${InlineButton} env=${env} pressed=${!!button} onPress=${e => setButton(button ? null : e.currentTarget)}>
        <${Typeset} part="label" width="natural" />
      </${InlineButton}>
      ${button && html`<${Popover} anchor=${button} onClose=${() => setButton(null)}>
        <${Typeset} part="note" /></${Popover}>`}`;
  },
});
```

`size` returns `{ width, height, depth }` in px, or where it may break
(`splits`, or `segments` with gaps between them: the viewer's README,
Widgets). `env.measure(html)` measures HTML at the text's size;
`env.invalidate()` measures again when the content changes.
`<InlineButton>` is a pill in the line around anything; `<Popover>` a panel
below an element.

The same through the viewer alone, without Preact: `reflowtex.host.define(kind,
{ measure, render })` ([src/viewer/src/host/types.ts](../viewer/src/host/types.ts)).

## Reading options

The reader's text size, colour theme and column width, as a round "Aa"
button in the corner of the window that opens them in a panel, or as a
card set into the page. Declare them in HTML, and the companion draws them:

```html
<div data-rtx="reading-button" data-width="true"></div>   <!-- the corner button -->
<div data-rtx="reading-options"></div>                     <!-- the card -->
```

With `data-selection="true"` they also offer how selected text looks:
*Browser*, the browser's own highlight, or *Even*, the viewer's bands (its
`data-latex-selection="bands"`: one even rectangle per line). The choice is
`data-latex-selection` on `<html>`, remembered as `reflowtex-selection`; a
page's own `data-latex-selection` is the default until the reader picks.

Or use the components: `<ReadingButton width selection inspect themes />` and
`<ReadingOptions … />`. The state is `reading`, a set of signals with
setters: `reading.theme`, `.zoom` and `.width`, and `reading.setTheme(t)`,
`.zoomBy(±1 | 0)` and `.setWidth(w)`. The page follows it through `<html>`:
- the theme is a class (none for light) plus `data-theme`;
- the text size is `--rtx-zoom` (1 for 100%);
- the width is `data-width`.

Every change also sends a window resize, so the viewer lays the text out
again. Choices are remembered in `localStorage` (`reflowtex-theme`,
`reflowtex-zoom`, `reflowtex-width`). To avoid a flash before the module
loads, a page sets the saved state itself first, as the website's
`head.html` does. The inspector's entry shows when the page has the
inspector (`inspect={false}` hides it). The look uses `--rtx-glass`,
`--rtx-accent`, `--rtx-surface-solid` and the swatches'
`[data-t=…] .rtx-swatch`.

## The highlighter

The reader selects text, and a small bar over the selection offers colours
to mark it with; pressing highlighted text offers the colours again and a
button that removes the highlight, and the bar's eraser over a selection
takes that part out of any highlight it touches. Declare it once on a page:

```html
<div data-rtx="highlighter"></div>
<div data-rtx="highlighter" data-colours="yellow green" data-store="false"></div>
```

A highlight is a live mark (the viewer's `host.addMark`): drawn as an
author's `\webclass` is, a band behind each of its lines, kept as the text
breaks again. Its bands carry `rtx-highlight rtx-highlight-NAME` in
`data-mark`, and look like the Marks page's example: filled with
`--rtx-highlight-NAME` and padded by a stroke of the same colour
(`--rtx-highlight-pad`), with darker colours in a dark theme
([companion.css](companion.css)). The colours are yellow (the example's),
green, pink and blue. Highlights across two blocks are
one highlight. A highlight over one of the same colour merges with it; over
one of another colour, it takes only the text selected, and the rest keeps
its colour. They are remembered per
page in `localStorage` (`reflowtex-highlights:` and the path, or
`data-store="key"`), by glyph positions and text, and come back on the next
visit. From a script: `highlight(host, ranges, colour)` and
`erase(host, ranges)`, with ranges from `host.rangesOf(range)`.

`data-rtx` works for components of your own too:
`registerElement('name', Component)` draws every
`<div data-rtx="name" data-key="value">`, with each `data-*` as a prop
(`"true"` and `"false"` become booleans, and numbers become numbers).

## Building

The sources are TypeScript in [src/](src/). `make build-companion` bundles
them into `companion.js`, which is committed, so site builders need no Node.
`make typecheck` checks them against the viewer's host API
([src/viewer/src/host/types.ts](../viewer/src/host/types.ts)). Tests:
`tests/web/test_accordion_v2.py`, `test_companion.py`.
