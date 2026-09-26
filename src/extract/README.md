# Extract – LaTeX → node list

This stage turns a LaTeX snippet into `output.json`, the finished node list.

- **`template.tex`** wraps each snippet. It sets up the fonts, the classic
  Computer Modern fraction geometry, the serializer, the TikZ picture capture, and
  then substitutes two markers the pipeline fills in: the
  caller's preamble and the snippet body. Dependencies are loaded before the
  preamble, while wrappers that must see package redefinitions are installed
  after it. A preamble can `\usepackage` and `\usetikzlibrary` on top and override
  the default fonts.
- **`serializer.lua`** walks LuaTeX's node list and writes `output.json`.

## Placeholders

The pipeline (`src/pipeline/pipeline.ts`) does a plain text substitution of two
markers in `template.tex` – each is the word `PREAMBLE` or `CONTENT` wrapped in
double percent signs. Because the replacement is literal, those exact tokens must
appear **only** at their two real sites; the template's own comments deliberately
avoid spelling them out.

## Hooks the template installs

| Hook | Purpose |
|---|---|
| `\directlua{dofile("serializer.lua")}` | loads the node-list exporter |
| `\tikzpicture` / `\endtikzpicture` (wrapped) | captures the completed box to a private job-PDF page and leaves a metric-identical picture placeholder; low-level users such as `tikz-cd` work without source externalisation; only the outermost of nested pictures is captured (pgfplots nests one) |
| `buildpage_filter` → `capture_flow` | copies main-vertical-list contributions before pagination and presents zero-height originals to the page builder, preserving document order without page boundaries |

If you replace the template, preserve the serializer and picture hooks – the
encode stage relies on them (a missing picture hook, in particular, makes
drawings vanish with no other symptom).

This is not implemented by setting `\vsize=\maxdimen`: that would merely move
the automatic break to TeX's finite dimension limit. The serializer keeps an
unmodified copy of the flow and zeroes the top-level vertical dimensions seen by
the page builder. Explicit source breaks such as `\newpage` may still trigger a
shipout, but they do not divide or alter the captured flow.

Footnotes arrive as `ins` nodes rather than as children of the paragraph that
contains their marker. The template gives the marker and insertion a shared id;
the flow walker stores the insertion as a separate `footnotes` content stream,
and the browser renders that stream in a tooltip/popover from the marker. It is
not appended to the pageless main stream.

## output.json shape (informal)

```jsonc
{
  "fonts": { "<id>": { "name", "size_sp", "filename" }, … },
  "paragraphs": [ { "nodes": [ …node tree… ] }, … ],
  // The document-order content stream. Each item is one of:
  //   { "kind": "paragraph", "para": N }   → paragraphs[N], re-broken in the browser
  //   { "kind": "display",   "box": {…} }  → a display (\[..\], align*) drawn as-is
  //   { "kind": "vspace",    "amount": sp} → explicit vertical space (see below)
  "content":    [ … ],
  "footnotes":  [ { "id": N, "content": [ … ] }, … ],
  "pictures":   [ … ]                                // filled in by the encode stage
}
```

A section heading is just a paragraph (its own font and size), so it rides
through as a `paragraph` item and renders like any other text. The vertical space
a heading opens – and any `\vspace`/`\vskip` the author writes – is captured as
`vspace` items.

Ordinary interline leading (the per-line baselineskip glue) is *not* emitted as
`vspace`, because it depends on where the browser re-breaks each line. Instead,
each paragraph records TeX's `\baselineskip`, `\lineskip`, and `\lineskiplimit`,
and the renderer applies TeX's baseline-to-baseline rule as it stacks the
re-broken lines – so lines land at exactly the LaTeX distance, and a heading sits
the LaTeX distance above its body regardless of its descender depth.

Node types: `glyph`, `glue`, `kern`, `rule`, `hlist`, `vlist`, `disc`, `penalty`,
`math`, `picture`. Children hang off `children` / `pre` / `post` / `replace` /
`leader`. The authoritative field list is the schema,
[`../schema/latex.proto`](../schema/latex.proto).

`output.json` is an intermediate: the encode stage transforms it in place (glyph
normalisation, picture conversion) before serialising to protobuf.
