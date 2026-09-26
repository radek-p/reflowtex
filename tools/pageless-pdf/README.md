# tools/pageless-pdf – the document as one page, and the browser against it

A **pageless PDF** is a LaTeX document typeset by LuaTeX as a single page
as tall as the document: no page breaks, no floats moved, no page glue set.
Every box and glue is where TeX put it on the main vertical list, which is
the geometry the viewer reproduces in the browser. This directory makes one,
and compares the browser's rendering with it, to the hundredth of a point
and pixel by pixel. The website's *Tools › Pageless PDF* page describes it
for users and shows `testmath.tex` made this way (`website/build.sh` builds
it into `static/pageless/`).

## Making a pageless PDF

The tools are TypeScript, run by Node (22.18 or later) straight from the
sources; `npm ci` at the repository root installs what they use (pdf-lib,
MuPDF's WebAssembly build, sharp, Playwright).

```sh
node tools/pageless-pdf/pageless.ts paper.tex -o out/ [--passes 3] \
    [--template T] [--margin 36pt] [--width-extra 0pt] [--tex-pictures]
# → out/pageless.pdf, pageless.json, output.json (+ the run's input.tex/.log/.pdf)
```

The serializer's `capture_flow` already keeps the galley: before the page
builder sees a contribution it deep-copies the node with its real
dimensions (`Serializer.flow_head()`). That copy is the pageless document.
`pageless.ts` compiles the document as the pipeline does – inside the
extraction template (the pipeline's by default; `examples/testmath` has its
own), shell escape off unless `REFLOWTEX_SHELL_ESCAPE=1` – with two lines
added: `pageless_pdf.lua` loaded after the serializer, and a hook at the
end of the document that ships the copy. It compiles once, at the
document's own width; `--width-extra` widens `\textwidth` through the
template's width hook.

`pageless_pdf.lua` first drops what a paged run's output routine would have
removed – LaTeX's empty float marker boxes with their interline glue, and
the `\topskip` the page builder adds after each – and trims the galley to
its first and last non-empty box. It ships the rest at the end of the run as
consecutive pages of at most 16000pt (just under `\maxdimen`), cut only
*inside* a top-level glue or kern: the glue's width is split between the end
of one page and the start of the next, so no box moves and stacking the
pages edge to edge restores every distance TeX computed. Each page's height
is a multiple of 0.5pt, so every boundary falls on a pixel row at 2 px/pt.
Shipping a copy would repeat a shipout's side effects (`\write`s – every
`\label` again into the .aux – late Lua, destinations, annotations), so
those are stripped, with inserts and marks; drawing whatsits (colour,
literals, matrices) stay. Captured TikZ pictures are empty placeholders in
the galley; their positions are recorded in `pageless.json`.

`stack.ts` (pdf-lib) folds the pages into one: each becomes a Form XObject
placed at the sum of the preceding pages' heights, and the TikZ pictures'
private pages are drawn back at their places. The page exceeds Acrobat's
14400-unit limit by design; browsers, Poppler and MuPDF show it, and
`raster.ts` (MuPDF) rasterises any band of it without drawing the rest.

Recompiling LuaTeX with wider dimensions is not an option: `scaled` is
32-bit throughout TeX (glue setting, badness, packaging, the backend's
coordinates). A cut inside glue is exact and needs nothing.

`check-against-paged.ts` checks the strip against the same document
paginated normally: word positions (`pdftotext -bbox`) page by page,
relative to each page's first word. For testmath every word agrees to
0.001bp in y and 0.0102bp in x (the 1/1000 em of PDF text operators) – on
pages TeX did not shrink (a page body of `glue set −0.11` moves headings by
a few tenths; that is the paged PDF's doing, not the strip's).

## Comparing the browser with it

Needs Playwright's Chromium (`npx playwright install chromium`).

```sh
T=tools/pageless-pdf
node $T/site-from-run.ts out/ out/site/                  # serve out/site/, e.g. on :8000
node $T/vector-compare.ts out/ http://localhost:8000/index.html
node $T/compare.ts out/ http://localhost:8000/index.html --ppp 4
node $T/compare.ts out/ http://localhost:8000/index.html --ppp 4 --supersample 4 --out out/compare-ss4
node $T/tiles.ts tiles/ --strip 345 out/compare out/vector/vector.json --fine 345 out/compare-ss4
```

**A page from the same run.** The pipeline compiles a document with
displays at several widths, so its bundle is not the strip's compilation.
`site-from-run.ts` builds the page from the output.json `pageless.ts` left
beside the PDF: the pipeline's encode stages, the display model sampled
from that same run (sample 0 is the strip's own run), and index.html as
`examples/testmath/build.ts` writes it. `--extra-script FILE` adds a script
after the viewer.

**Geometry first: `vector-compare.ts`.** No pixels. MuPDF's device trace
gives every glyph and rule in the strip with its origin; `dom-dump.ts` gives
every glyph and rule the viewer drew in the same frame, through any
transform (`\rotatebox`) – a picture's glyphs too (TikZ labels, drawn by
dvisvgm as `<use>` of an outline; reported as ◊ in the font "picture"). Each viewer glyph is matched to the nearest strip
glyph within `--window` (0.7pt). Reported: the vertical residual along the
document (a drift is height lost or gained in stacking), per text line the
offset at its start and the slope along it (a glue or expansion ratio
different from TeX's), and the rules – each as its four corners, at any
angle, matched to the strip rule whose corners are nearest, with TeX's
rules the viewer did not draw. Whatever
it reports is geometry, not rasterisation, so run it first.

**Pixels: `compare.ts`.** Both sides are drawn at `--ppp` pixels per TeX
point in one frame – the column of `\hsize` with `--margin` of white either
side: the strip by MuPDF, the browser by `capture.ts`,
which strips the page to its `.latex-block`, forces the light theme with
TeX's black for text (a theme's text colour, often a dark grey, would tint
every glyph) and without macOS's stem-thickening font smoothing, pins
the column to `\hsize`, paints every segment and photographs the document
in viewport-high bands. Rows are paired line by line (ink bands matched by
position and shape, so a gap that differs shows as a *spacing* step rather
than throwing everything after it off), and each pair compared pixel for
pixel: *equal* when at most `--frac` of its pixels differ by more than
`--tol`, else *differing*. A differing run is then tested for being the
same ink elsewhere (normalised cross-correlation of blurred ink, piece by
piece): *shifted*, with the displacement in the report, or the same ink in
place within a pixel – rasterisation.

Outputs in `--out`: `strip.png`, `browser.png`; `diff.png` (strip left,
browser right, rows aligned, and between them a bar: green equal, red
differing, blue shifted, grey a line with no counterpart, amber blank rows
the other side does not have); `heat.png` (the same rows, white where the
pair agrees, red by how much each pixel differs); `overview.png`;
`report.json` and `rows.tsv`. `--region X0 Y0 X1 Y1` zooms in on part of
the strip; `--reuse` keeps the browser screenshots.

**Rasterisation.** The two renderers never agree exactly: MuPDF puts each
glyph on a whole pixel row where Chromium does not, and glyph stems come
out a little lighter in Chromium at large sizes. Drawing both through one
library does not help (Chromium's print-to-PDF writes web fonts as Type 3
paths; Linux Chromium's FreeType settings are further from Poppler than
macOS CoreText is). macOS Chromium against MuPDF is the closest pair found;
`heat.png` and the shifted verdict tell that residue from a misplaced
glyph.

**Drawn finer: `--supersample K`.** Both sides drawn K times finer (MuPDF
in bands, the browser at K times the device scale) and each K×K block
averaged, the same way on both sides, so a pixel is close to the share of
it the ink covers whichever program drew it. It takes out most of what the
two anti-aliasers do differently, and MuPDF's snapping of each glyph to a
pixel row. For testmath at 4 px/pt, K = 4 cuts the pixels that differ by more
than half by a fifth, but more rows differ slightly: at 8 device pixels per
CSS pixel Chromium draws glyphs a little differently again (a spread of
0.3 px in each line's vertical ink offset, against 0.075 px at K = 1). Chromium caps a
screenshot at 16384 px, so keep ppp × K ≤ 16 (and `--band` × ppp × K / 2
under the cap); the strip at 16 px/pt takes about 6 GB.

**Tiles: `tiles.ts`.** Cuts the strip into tiles of `--tile-pt` points and,
for each, writes the heat map and the two sides of `diff.png` for the rows
that pair with it (WebP, full resolution), plus the heat map of a
supersampled run (`--fine`) of the same rows; `manifest.json` has the counts
of both checks, the share of pixels differing by more than half, and per
tile how many rows differ – what the website's comparison page loads.

**Publishing: `publish-compare.ts`.** The tiles are too big for git (25 MB,
and new at every run), so the website takes them from a GitHub release.
`publish-compare.ts <tiles out dir> --upload` copies them into the site,
packs them into `pixel-compare-<hash>.tar` (the same pictures give the same
file), creates the release with `gh`, and writes `website/pixel-compare.lock`,
the file's URL and SHA-256. Commit the lock; `website/build.sh` fetches the
file it names (`website/tools/fetch-pixel-compare.ts`) and unpacks it into
`static/pixel-compare/` and `data/pixel_compare.json`, which git ignores.
Without `--upload` it prints how to make the release by hand.

## Files

    pageless.ts            document → pageless.pdf, in one command
    pageless_pdf.lua       the shipper (loaded after serializer.lua)
    stack.ts               chunk pages → one page (pdf-lib)
    raster.ts              one band of the strip → PNG (MuPDF)
    check-against-paged.ts the strip against the paginated PDF, word by word
                           (poppler's pdftotext)
    site-from-run.ts       a viewer page from the strip's own run
    vector-compare.ts      glyph positions, strip vs browser (+ dom-dump.ts)
    compare.ts             pixels, strip vs browser (+ capture.ts, images.ts)
    tiles.ts               compare.ts's pictures as web tiles + manifest
    publish-compare.ts     the tiles as a release file the website fetches
    ../lib/tar.ts          reproducible tar files, for publishing and fetching
