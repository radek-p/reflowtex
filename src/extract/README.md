# Extract — LaTeX → node list

This stage turns a LaTeX snippet into `output.json`, the finished node list.

- **`template.tex`** wraps each snippet. It sets up the fonts, the classic
  Computer Modern fraction geometry, the serializer, the TikZ picture capture, and
  the shipout hook — then substitutes two markers the pipeline fills in: the
  caller's preamble and the snippet body. All the infrastructure is loaded
  *before* the preamble, so a preamble can `\usepackage` and `\usetikzlibrary` on
  top of it and override the default fonts.
- **`serializer.lua`** walks LuaTeX's node list and writes `output.json`.

## Placeholders

The pipeline (`src/encode/pipeline.py`) does a plain text substitution of two
markers in `template.tex` — each is the word `PREAMBLE` or `CONTENT` wrapped in
double percent signs. Because the replacement is literal, those exact tokens must
appear **only** at their two real sites; the template's own comments deliberately
avoid spelling them out.

## Hooks the template installs

| Hook | Purpose |
|---|---|
| `\directlua{dofile("serializer.lua")}` | loads the node-list exporter |
| `\pgfincludeexternalgraphics` (wrapped) | stamps each externalised TikZ picture with an id and records its file via `Serializer.note_picture`, so the picture node can later be matched to its PDF |
| `shipout/before` → `Serializer.shipout` | gives the serializer the finished page so it learns the document order of paragraphs and displays (displays never reach `pre_linebreak_filter`) |

If you replace the template, preserve these three hooks — the encode stage relies
on them (a missing picture hook, in particular, makes drawings vanish with no
other symptom).

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
  "pictures":   [ … ]                                // filled in by the encode stage
}
```

A section heading is just a paragraph (its own font and size), so it rides
through as a `paragraph` item and renders like any other text. The vertical space
a heading opens — and any `\vspace`/`\vskip` the author writes — is captured as
`vspace` items.

Ordinary interline leading (the per-line baselineskip glue) is *not* emitted as
`vspace`, because it depends on where the browser re-breaks each line. Instead,
each paragraph records TeX's `\baselineskip`, `\lineskip`, and `\lineskiplimit`,
and the renderer applies TeX's baseline-to-baseline rule as it stacks the
re-broken lines — so lines land at exactly the LaTeX distance, and a heading sits
the LaTeX distance above its body regardless of its descender depth.

Node types: `glyph`, `glue`, `kern`, `rule`, `hlist`, `vlist`, `disc`, `penalty`,
`math`, `picture`. Children hang off `children` / `pre` / `post` / `replace` /
`leader`. The authoritative field list is the schema,
[`../schema/latex.proto`](../schema/latex.proto).

`output.json` is an intermediate: the encode stage transforms it in place (glyph
normalisation, picture conversion) before serialising to protobuf.
