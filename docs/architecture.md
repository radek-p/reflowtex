# Architecture

## The idea

Web math rendering usually falls into two camps: rasterise/SVG the whole formula
at build time (faithful, but a fixed-size image that can't reflow and whose text
isn't selectable in context), or re-implement TeX's typesetting in JavaScript
(reflowable, but an approximation that drifts from what LaTeX actually does).

Reflow TeX splits the work differently:

- **TeX does the typesetting.** LuaTeX lays out every glyph, kern, rule, fraction,
  accent and box exactly as it would for print, and we capture the finished node
  list – positions and all.
- **The browser does the line breaking.** The node list is shipped to the client,
  which runs Knuth–Plass over it to choose breakpoints for the *current* column
  width and paints the lines as inline SVG.

So the intra-line microtypography is genuine TeX, while the one decision that
depends on the viewport – where lines break – is deferred to the browser. That is
what lets a paragraph reflow without giving up fidelity.

## Pipeline stages

### 1. Extract (`src/extract`)

`template.tex` wraps each snippet and loads `serializer.lua`, which copies LuaTeX's
main-vertical-list contributions before pagination and writes `output.json`:
paragraphs and display boxes as trees of glyph/glue/kern/rule/hlist/vlist/…
nodes, plus a font table. A completed TikZ box is copied to a tightly sized
private page in the job PDF and replaced in the captured flow by a
metric-identical picture placeholder. This works for ordinary `tikzpicture` and
front ends such as `tikz-cd`; their PDF drawing operators are opaque to the node
renderer and are not reproduced individually.

The template loads the serializer and TikZ before substituting the caller's
preamble, so the preamble can add packages and TikZ libraries on top. It installs
the final picture and footnote wrappers after the preamble, ensuring package
redefinitions are observed. Fonts and the classic Computer Modern fraction
geometry are defaults a preamble can override.

The extraction stream is genuinely pageless rather than a `\maxdimen`-tall
page. The serializer retains a copy with the real geometry while zeroing only
the top-level vertical dimensions presented to the page builder. Consequently
ordinary content never reaches the page-height threshold, without inheriting
TeX's finite dimension limit; explicit `\newpage` commands can still ship a
page, but do not split the retained stream.

Some content is typeset in the document but belongs somewhere other than the
main flow, so it is collected into separate *streams* (`Document.streams`),
each with a kind. A footnote's insertion becomes a `footnote` stream. Its
in-text marker points at it, so the viewer can reflow the fully typeset
footnote (mathematics and citations included) in an accessible hover/focus
popover, rather than give it an artificial place in the pageless flow. The
companion package's `\begin{webstream}{kind}` (src/latex/reflowtex.sty)
stamps everything typeset inside it with LuaTeX attribute 911. The walk sends
those items to a stream of that kind and leaves a `stream` item in the parent
flow where the block stood. Streams nest. The viewer mounts each one in its own
element, and page CSS and JavaScript decide per kind what it looks like and
does: an accordion of panes, framed notes, and so on. `\webaction` adds in-text controls: link glyphs whose `Link.action` the viewer sends to the enclosing streams as a DOM event. See the Streams section of
[src/viewer/README.md](../src/viewer/README.md).

Display-bearing snippets are sampled at additive widths
`W`, `W + 128pt`, `W + 256pt`, …. The pipeline matches the complete finished
display trees, not environment-specific boxes or glues. A sliding three-sample
window must have identical topology and affine geometry for every corresponding
field. If it does not, the smallest width is rejected and sampling continues at
the next wider measure. Two samples determine all per-field `a W + b` laws
simultaneously; the third verifies them (up to scaled-point rounding). This is
generic across `equation`, `\[...\]`, `align`, `gather`, `multline`, nested
alignment environments, and package-defined displays whose finished topology is
stable. The accepted tree stores sparse derivatives only for fields that vary, and marks
which of them are *gaps* – a glue's set width, a kern, a math node's surround –
as opposed to box widths, which are whatever their contents came to.

At runtime each gap that stayed nonnegative across the accepted samples is
classified by where the ink around it falls. A gap with ink on both sides is
internal to the formula: it separates an align's columns, or an equation from its
number, and closing it would run the two together, so it stops at
`data-display-min-space` (10pt by default). A gap with ink on one side only is
outer – centring glue, or the display's own `display_shift` in the column – and
closes all the way to zero, so a display is never held wider than its own ink.
The classification is geometric rather than environment-specific, and is computed
once per display from the compiled tree.

Every row of one alignment is evaluated at a single measure, so its columns stay
in step; the display freezes as one at the first gap to reach its floor, never
narrower than its ink and never wider than the measure it was compiled at, and
becomes horizontally scrollable. Reflow TeX does not reproduce amsmath's
print-oriented fallback of moving an equation number onto another line.

### 2. Encode (`src/pipeline`)

After display-width modelling, three transforms run on `output.json` before it
is encoded:

- **strip** nodes the schema/renderer don't model (colour-stack whatsits, etc.);
- **normalise glyph addressing** – some glyphs LuaTeX places (GSUB variants,
  combining accents, unencoded variants) can't be addressed by their Unicode
  codepoint in the served font, so they are rewritten to private-use codepoints
  and the served font's cmap is patched to match;
- **convert pictures** – each captured TikZ page or included PDF page becomes
  inline SVG (ids prefixed per picture, colours mapped to CSS custom properties
  for theming). Ghostscript first normalises ordinary included PDFs to DeviceRGB:
  Figma encodes all its fills with ICC `scn`, which current `dvisvgm` otherwise
  drops and renders as black. An exact white or legacy fill-less full-viewBox page
  rectangle is then removed wherever it occurs in the page group. Generated TikZ
  pages are deliberately exempt from both operations.

Then `encode.ts` serialises the result to Protocol Buffers against
`schema/latex.proto`, interning per-glyph metrics into a shared table (see
[binary-format.md](binary-format.md)). `fonts/fonts.ts` provisions and cmap-patches the
OTF files the page will serve, and subsets the ones it modified (patched or
converted) to the characters the blocks draw; unmodified fonts are served whole. `pipeline.ts` ties these together into one
`compile(snippet) → bytes` call that the integrations drive.

### 3. View (`src/viewer`)

`latex-viewer.js` finds each embedded block, decodes the protobuf against the
embedded schema, runs Knuth–Plass line breaking at the block's measured width,
and paints inline SVG – re-breaking on resize and repainting on theme change. See
[src/viewer/README.md](../src/viewer/README.md) for the DOM contract.

## Why a schema-bound binary format

The node list is large and finicky, and it crosses three languages (Lua producer,
TypeScript encoder, JavaScript consumer). A schema (`latex.proto`) that all three bind
to keeps them from drifting: change a field in one place and the others are
generated or validated against it, rather than silently disagreeing. Protocol
Buffers gives that plus a compact wire form. See [binary-format.md](binary-format.md).

## Design boundaries

- **`src/` never imports from `integrations/`.** The core knows nothing about any
  site generator. Integrations depend only on `src/`.
- **One snippet → one `build/<hash>/` directory.** Intermediate artefacts
  (`input.tex`, the lualatex run, `output.json`, `nodelist.pb`) are kept so a
  rebuild can skip unchanged snippets and so failures are inspectable.
- **Everything is reproducible from source**, so generated data (compiled blocks,
  provisioned fonts) is safe to `.gitignore` – though committing it lets a site
  build without a TeX installation on the deploy host.
