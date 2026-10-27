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
penalties. It replays what the viewer models: no `\parshape` or
`\hangindent`, no stretch in `\leftskip` or `\rightskip`, no protrusion,
expansion or directions; a fixture with any of them is refused.

| Set | Source | What it holds |
|---|---|---|
| `tolerance/` | `tolerance.tex` | `\sloppy` paragraphs, long unbreakable words and links, TeX's third pass with `\emergencystretch`, `\tolerance 10000`, no first pass, the demerits and hyphenation penalties, each at several measures |

A new set is a directory of fixtures captured from its source, in the CI
image (lualatex from TeX Live).
