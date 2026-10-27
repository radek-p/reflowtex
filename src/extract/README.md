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

The LuaTeX backend (`src/pipeline/backend/luatex.ts`) does a plain text
substitution of two markers in `template.tex` – each is the word `PREAMBLE` or
`CONTENT` wrapped in double percent signs. Because the replacement is literal,
those exact tokens must appear **only** at their two real sites; the template's
own comments deliberately avoid spelling them out.

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
shipout, but they do not divide the captured flow.

A forced break (a penalty of −10000 or less: `\newpage`, `\clearpage`,
`\cleardoublepage`, LaTeX's requests to its output routine for floats and
multicol) still runs TeX's output routine as on paper; in the copy it is a
*seam*, from the last visible item before it to the first one after it. In a
seam the copy leaves out what paging made – the breaks, empty boxes (LaTeX's
marker `\vbox{}` before an output request, a blank page's `\hbox{}`, but not a
`\label`'s anchor), page-filling glue such as `\vfil`, `\topskip` and `\splittopskip` glue and
interline glue – and sets the interline glue of the first item after the seam
again, by TeX's rule, from the depth of the last one before it: the line after
`\clearpage` stands where it would in the middle of a page. The author's glue,
kerns and everything that draws stay. On paper TeX discards glue at the top of
a page (a `\vspace` after `\newpage` vanishes, a `\vspace*` stays); in the
continuous column both are kept, as the author's spacing. A break inside a box
(a minipage, a `\parbox`) never reaches the main vertical list and acts in
its box as always.

Footnotes arrive as `ins` nodes rather than as children of the paragraph that
contains their marker. The template gives the marker and insertion a shared id;
the flow walker stores the insertion as a separate `footnotes` content stream,
and the browser renders that stream in a tooltip/popover from the marker. It is
not appended to the pageless main stream.

## output.json shape (informal)

```jsonc
{
  // "filename" only for a font loaded from a file (OpenType); a classic font,
  // loaded from its TFM, has none, and the pipeline gives it its face
  // (src/shared/font-face.ts)
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
the LaTeX distance above its body regardless of its descender depth. Where TeX
set that glue from a `\prevdepth` that is not the depth of the line above – one
the document assigned, `\nointerlineskip`, the edges of a `\vbox` or `\vtop` whose
lines the walk takes into the stream – the paragraph item carries it as
`prev_depth`, and the renderer applies the rule with it.

Node types: `glyph`, `glue`, `kern`, `rule`, `hlist`, `vlist`, `disc`, `penalty`,
`math`, `picture`, `transform`, `adjust`. An `adjust` is a paragraph's `\vadjust` (the space
of `\\[len]`, and of `\vspace` inside a paragraph): its height, and its list when that
draws something; the renderer sets it below the line it ends up in (above it for
`\vadjust pre`), and the walk of the vertical list leaves it out of the space
between items. Children hang off `children` / `pre` / `post` / `replace` /
`leader`. The authoritative field list is the schema,
[`../schema/latex.proto`](../schema/latex.proto).

`output.json` is an intermediate: the encode stage transforms it in place (glyph
normalisation, picture conversion) before serialising to protobuf.
