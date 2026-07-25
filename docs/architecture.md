# Architecture

## The idea

Web math rendering usually falls into two camps: rasterise/SVG the whole formula
at build time (faithful, but a fixed-size image that can't reflow and whose text
isn't selectable in context), or re-implement TeX's typesetting in JavaScript
(reflowable, but an approximation that drifts from what LaTeX actually does).

Reflow TeX splits the work differently:

- **TeX does the typesetting.** LuaTeX lays out every glyph, kern, rule, fraction,
  accent and box exactly as it would for print, and we capture the finished node
  list — positions and all.
- **The browser does the line breaking.** The node list is shipped to the client,
  which runs Knuth–Plass over it to choose breakpoints for the *current* column
  width and paints the lines as inline SVG.

So the intra-line microtypography is genuine TeX, while the one decision that
depends on the viewport — where lines break — is deferred to the browser. That is
what lets a paragraph reflow without giving up fidelity.

## Pipeline stages

### 1. Extract (`src/extract`)

`template.tex` wraps each snippet and loads `serializer.lua`, which walks LuaTeX's
node list at `shipout` and writes `output.json`: paragraphs and display boxes as
trees of glyph/glue/kern/rule/hlist/vlist/… nodes, plus a font table. TikZ
pictures are externalised to per-picture PDFs (they are opaque drawing operators,
not something we reproduce).

The template sets up everything the pipeline depends on — the serializer, the
picture-capture hook, the shipout hook — *before* substituting the caller's
preamble, so a preamble is free to load its own packages and TikZ libraries on
top. Fonts and the classic Computer Modern fraction geometry are defaults a
preamble can override.

### 2. Encode (`src/encode`)

Three transforms run on `output.json` before it is encoded:

- **strip** nodes the schema/renderer don't model (colour-stack whatsits, etc.);
- **normalise glyph addressing** — some glyphs LuaTeX places (GSUB variants,
  combining accents, unencoded variants) can't be addressed by their Unicode
  codepoint in the served font, so they are rewritten to private-use codepoints
  and the served font's cmap is patched to match;
- **convert pictures** — each externalised PDF becomes inline SVG (ids prefixed
  per picture, colours mapped to CSS custom properties for theming).

Then `encode_pb.py` serialises the result to Protocol Buffers against
`schema/latex.proto`, interning per-glyph metrics into a shared table (see
[binary-format.md](binary-format.md)). `fonts.py` provisions and cmap-patches the
OTF files the page will serve. `pipeline.py` ties these together into one
`compile(snippet) → bytes` call that the integrations drive.

### 3. View (`src/viewer`)

`latex-viewer.js` finds each embedded block, decodes the protobuf against the
embedded schema, runs Knuth–Plass line breaking at the block's measured width,
and paints inline SVG — re-breaking on resize and repainting on theme change. See
[src/viewer/README.md](../src/viewer/README.md) for the DOM contract.

## Why a schema-bound binary format

The node list is large and finicky, and it crosses three languages (Lua producer,
Python encoder, JavaScript consumer). A schema (`latex.proto`) that all three bind
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
  provisioned fonts) is safe to `.gitignore` — though committing it lets a site
  build without a TeX installation on the deploy host.
