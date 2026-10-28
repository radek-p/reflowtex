# tests/linebreak – paragraph-breaking fixtures

Ground truth for test (a) of the test suite: does a paragraph breaker pick
**exactly** the lines TeX picks?

`capture.lua` hooks LuaTeX's `pre_linebreak_filter` and
`post_linebreak_filter` during an ordinary `lualatex` run and writes one
fixture per paragraph the engine breaks:

| File | Content |
|---|---|
| `par-NNNN.txt` | the exact input of the breaker: the 27 `\hsize`-and-friends parameters, every font the paragraph uses (`F font quad stretch shrink step`: the quad and `\expandglyphsinfont`'s arguments) with every `(font, char)` it uses (`C font char width height depth lp rp ef`: the metrics and the `\lpcode`/`\rpcode`/`\efcode` protrusion and expansion codes), and the post-hyphenation, post-ligature node list ending in `\parfillskip` |
| `par-NNNN.expected` | what the engine produced: each line as an `hlist` with its `glue_set` (as exact float bits), `glue_sign`/`glue_order`, its children (a glyph hz expanded carries its expansion factor as a fourth field; a margin kern protrusion inserted is a `marginkern`), the interline glue and penalties between lines, and the resulting `prev_depth` / `prev_graf` |

Both halves are written in one canonical text format, and a breaker under
test must re-serialize its own result the same way so the comparison is a
byte-for-byte file diff – no tolerance, no parsing. The format's source of
truth is `capture.lua` itself.

## Capturing

```sh
cd <directory with the document>
REFLOWTEX_FIXDIR=fixtures lualatex -interaction=nonstopmode \
  '\directlua{dofile("path/to/capture.lua")}\input{testmath.tex}'
```

Capture at several `\textwidth` settings to exercise the second pass and
hyphenated breaks; 150–500 pt plus the document default is a good matrix.
Capture with and without `microtype` loaded: protrusion and expansion take
the breaker down paths a plain document never reaches.

## Replaying

`replay.ts` runs a fixture's paragraph through the viewer's breaker
(`src/viewer/src/engine/breaker.ts`) and writes the result in the same
format; `tests/unit/linebreak.test.ts` compares it with the `.expected` file
for every fixture set in a directory here. The breaker chooses the breaks and
sets each line's glue; the replay does the rest of LuaTeX's
`post_line_break` around them – the end of each line by the kind of break,
what a break discards, the line packed to `\hsize`, the interline glue and
penalties. It replays what the viewer models: no stretch in `\leftskip` or
`\rightskip`, no protrusion, expansion or directions; a fixture with any of
them is refused. A `\parshape` or `\hangindent` reaches the breaker as the
serializer records it, one measure per line (`shapeOf`), and each line is
packed to its own width and shifted by its own indent.

| Set | Source | What it holds |
|---|---|---|
| `tolerance/` | `tolerance.tex` | `\sloppy` paragraphs, long unbreakable words and links, TeX's third pass with `\emergencystretch`, `\tolerance 10000`, no first pass, the demerits and hyphenation penalties, each at several measures |
| `fills/` | `fills.tex` | glue of infinite stretch inside a paragraph: `\hfill` between boxes, boxes joined by `\hskip 1em plus .17fil` (LaTeX's `\and`), `\hfill` and `\hfil` between words, a break at a penalty before an `\hfill`, `\\` in mid-paragraph, each at several measures |
| `shapes/` | `shapes.tex` | paragraphs whose lines differ in measure: `\hangindent` with `\hangafter` positive, negative and zero, on either side, explicit `\parshape` (the lines beside a wrapped figure on either side, shapes shorter and longer than the paragraph), a shape with `\leftskip` and `\rightskip`, a shape resumed after a display, numbered section titles that wrap (`\@hangfrom`), each at several measures |
| `math/` | `math.tex` | inline formulas where lines break, with `\mathsurround` 0.1 pt, 2 pt and 0: formulas opening with `\,` at a line's start (TeX discards the math node with its surround and the glue after it), breaks after formulas, rows of short formulas, words opening with an `\accent` (whose kern TeX keeps at a line's start), each at several measures |
| `negative-glue/` | `negative-glue.tex` | paragraphs ending in negative glue (`\hspace{-1cm}` before a blank line), where a start whose line has become overfull must be dropped in every pass, and a break at that glue leaves an empty last line with no `\parfillskip` stretch; paragraphs ending in `\\` and `\break`; each at several measures |

A new set is a directory of fixtures captured from its source, in the CI
image (lualatex from TeX Live).
