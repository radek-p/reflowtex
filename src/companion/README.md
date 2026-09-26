# reflowtex/companion

The browser side of the companion package ([reflowtex.sty](../latex/reflowtex.sty)).
It is one ES module with its stylesheet. Load it on a page and the package's
kinds (the accordion, so far) are drawn by it. Import from it to draw kinds
of your own.

```html
<script type="importmap">{ "imports": { "reflowtex/companion": "/companion/companion.js" } }</script>
<link rel="stylesheet" href="/companion/companion.css">
<script type="module">import 'reflowtex/companion';</script>
```

The Hugo site does this on every page ([partials/companion.html](../../website/layouts/partials/companion.html)).

## A kind of your own

In LaTeX, open a stream of your kind. Any `key=value` goes to the page:

```latex
\newenvironment{warning}[1][]{\begin{webstream}[#1]{warning}}{\end{webstream}}

\begin{warning}[title=Careful]
Dividing by $x$ assumes $x \neq 0$.
\end{warning}
```

In the page, draw it with a component:

```js
import { defineBlock, Typeset, html } from 'reflowtex/companion';

defineBlock('warning', ({ attrs }) => html`
  <p class="warning-title">${attrs.title || 'Warning'}</p>
  <${Typeset} />`);
```

`<Typeset />` is the environment's body, typeset by TeX and laid out by the
viewer at the width of the element it stands in. That width is followed as
it changes, and the text is broken again. The viewer still spaces the block
as TeX would, from the body's first and last lines. The block's height is
whatever your component makes it, and the text below moves when it changes.

### What a component gets

| | |
|---|---|
| `props.instance`, `useInstance()` | the instance: `id`, `kind`, `attrs`, `parts`, `children`, `parent` |
| `props.attrs`, `useAttrs()` | the author's parameters |
| `useInstanceState(key, initial)` | a signal belonging to the instance. It outlives redraws, so a choice the reader made (the pane they opened) stands |
| `useAction(verb, fn)` | the reader pressed a `\webaction{verb:arg}{…}` inside. `fn({ verb, arg, source })`; return `false` to leave it to an enclosing instance |
| `useBlockHost()` | the element in the flow (`host.el`), `setFrame`, `setEdges` |
| `<Typeset part of width edge onMetrics />` | a part (`'body'` by default) of this instance or of a child (`of`), at `'container'` width (default), `'natural'` or px. `edge` makes its lines the block's edges for TeX's spacing |
| `readMotion(el, name, fallback, attr)` | duration, easing and style from CSS (`--rtx-NAME-*`), honouring reduced motion |

Preact, htm and Preact Signals are re-exported (`h`, `render`, `useState`,
`signal`, `html`, …), so your components use the same copy as the package's.

A component that throws is replaced by the plain body, with the error on the
console. `defineBlock` returns a function that undoes it. Defining a kind
again, including one of the package's own, redraws what is already on the
page.

### Frames

A block with a border or padding is *framed*. Across a framed edge, TeX's
interline glue gives way to the author's explicit space, as a box in print
would. `defineBlock` reads this from the element's CSS (`frame: 'auto'`) and
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

## The first version's API

`widget`, `Aside`, `InlineButton`, `Popover` and `marginNote` still work, as
before ([src/legacy.ts](src/legacy.ts)). They move onto the host API with
inline kinds; new code should not start there.

## Building

The sources are TypeScript in [src/](src/). `make build-companion` bundles
them into `companion.js`, which is committed, so site builders need no Node.
`make typecheck` checks them against the viewer's host API
([src/viewer/src/host/types.ts](../viewer/src/host/types.ts)). Tests:
`tests/web/test_accordion_v2.py`, `test_companion.py`.
