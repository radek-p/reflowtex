# Reflow TeX – Hugo integration

Render LaTeX in a [Hugo](https://gohugo.io) site with a `{{</* latex */>}}`
shortcode. The snippet is compiled to a binary node list at build time and drawn
in the browser by `latex-viewer.js`.

This directory is also a **runnable example site** – try it first:

```sh
cd integrations/hugo
node prebuild.ts . --demos-dir ../../examples/demo   # compile the shared demos
hugo server                                            # open the printed URL
```

(or just `make hugo-demo` from the repo root)

## Add it to your own site

1. **Copy two files** into your site's `layouts/`:
   - `layouts/shortcodes/latex.html`
   - `layouts/partials/reflowtex-viewer.html`

2. **Include the viewer** once per page that can contain blocks – add this near
   the end of your `baseof.html`, before `</body>`:

   ```go-html-template
   {{ partial "reflowtex-viewer.html" . }}
   ```

3. **Write LaTeX** in your content with the shortcode, either inline:

   ```markdown
   {{</* latex */>}}
   \[ e^{i\pi} + 1 = 0 \]
   {{</* /latex */>}}
   ```

   or as a **reference to a `.tex` file** (self-closing), so one snippet source
   can feed several integrations:

   ```markdown
   {{</* latex file="01-inline-math.tex" /*/>}}
   ```

   File references resolve against `prebuild.py --demos-dir` (default:
   `<site>/latex-src/`), share that directory's `preamble.tex`, and are looked up
   through `data/latex_files.json` – the shortcode never reads across
   directories. The example site points `--demos-dir` at the shared
   `../../examples/demo` (see the Makefile's `hugo-demo` target), which is exactly
   the set the vanilla integration renders.

4. **Run `prebuild.py` before every build.** Point it at your site root
   (defaults to the current directory):

   ```sh
   node /path/to/reflowtex/integrations/hugo/prebuild.ts .
   hugo
   ```

   It writes `data/latex_blocks/`, `data/latex_schema.json`, provisions fonts
   into `static/fonts/`, and copies the viewer scripts into `static/`. A good
   habit is to wire it into your build: `node prebuild.ts . && hugo`.

## Options

The shortcode forwards attributes to the renderer, e.g. layout width, alignment,
and the Knuth–Plass knobs:

```markdown
{{</* latex width="360" align="left" */>}} … {{</* /latex */>}}
```

`show-source="true"` presents a block as an example: the rendered result beside
its LaTeX, highlighted, or behind Result / LaTeX tabs when the space is narrow.
It works for both forms; a file ref's text comes from `data/latex_sources.json`,
which `prebuild.py` writes. The result's right edge is a handle: drag it, or
focus it and use the arrow keys, to narrow the result and watch it re-break
(double-click or Home restores the full width). The partial carries the behaviour; style
`figure.latex-example` to taste (this project's website is an example).

A block that uses `\ref`, `\eqref` or a similar reference command is compiled twice, so the
numbers resolve.

### The companion package (optional)

`reflowtex.sty`'s own kinds – the accordion, hints, the Lean widgets, the
looks of boxed theorems – and the examples' preview options are drawn by
the companion package's browser side, an ES module that `prebuild` installs
into `static/companion/`. A site turns it on in its config:

```toml
[params]
reflowtexCompanion = true
```

The partial then loads it, with an import map naming it
`reflowtex/companion`, so a page's own scripts can import from it too (after
the partial: an import map must come before the modules that use it).
Without it everything else works as before; only what the companion draws
is not drawn. A site that wants the preview options without the companion
writes its own on the viewer's API (`reflowtex.host`).

`themes="light,dark"` with `show-source` puts preview options above the
result – a text size and the named themes – for that example alone (the
companion's `<PreviewOptions>`).

### Books in parts: `batch` and `weight`

Blocks with the same `batch="name"` are compiled together as one LaTeX
document, in ascending `weight` order (ties by page, then position), and each
then shows only its own part. A book's chapters can sit on separate pages or
in tabs and keep the book's numbering, the macros earlier chapters defined,
and cross-references between chapters (resolved to the right page through
the link map):

```markdown
{{</* latex batch="mybook" weight="1" file="chapter1.tex" preamble="book" */>}}
{{</* latex batch="mybook" weight="2" file="chapter2.tex" preamble="book" */>}}
```

All blocks of a batch share one `preamble`, which may start with its own
`\documentclass` (e.g. `book`). It is a name from `latex-preambles/`, or a
path to a `.tex` file relative to the site root, which may lie outside the
site: the website's example book names `../examples/book/preamble.tex`,
beside its chapters. Changing, adding or reordering any part
recompiles the whole batch. The vanilla build does the same for a directory
with `--batch`.

A part may be shown in more than one place – the same `file=` (or the same
text) twice in one batch. It is still one part of the book, compiled once, at
the lowest `weight` given to it, and every place shows that result; its labels
link to the page of that lowest-weight place. The same file in *different*
batches is compiled once per batch.

Named preambles let blocks share macros/packages. Put them in
`latex-preambles/<name>.tex` and reference one with `preamble="<name>"`; editing
a preamble recompiles the blocks that use it.

Named colour maps let blocks share a recolouring palette (see
[src/viewer/README.md](../../src/viewer/README.md)'s Theming section for what
they can express). Put them in `latex-color-maps/<name>.json` and reference one
with `color-map="<name>"`:

```markdown
{{</* latex file="intro.tex" preamble="book" color-map="my-book-colors" */>}}
```

Unlike a preamble, a colour map is not part of what gets compiled; the browser
reads it at render time. Either name it on every shortcode call that wants it
(even several calls referencing the same `file="…"`), or make one the site's
default in your config, which every block without its own `color-map` then uses:

```toml
[params]
  latexColorMap = "site"     # latex-color-maps/site.json
```

`prebuild.py` embeds every map in `latex-color-maps/`, so a default needs no
other registration. This project's own website uses `site.json`, which maps
TeX's black, red and blue (and tints of them) for the dark, sepia and contrast
themes. It is a reasonable starting point to copy.

An inline block can register itself as a named lookup the same way a
`file="…"` ref does, via `as="<name>"`, for a snippet with no natural `.tex`
file of its own that another template still wants to find by name later – a
page's own short title, or a handful of one-line labels a sidebar looks up
from every page:

```markdown
{{</* latex preamble="book" as="menu-01-introduction.tex" */>}}\noindent Introduction{{</* /latex */>}}
```

One `.md` page of nothing but such blocks (`render = "never"` in its front
matter keeps it out of the site) replaces what would otherwise need a whole
`--demos-dir` of tiny single-purpose files, one per label.

## What prebuild.py generates

| Path | Contents | Commit? |
|---|---|---|
| `data/latex_blocks/<hash>.json` | one compiled block (base64 protobuf) | optional |
| `data/latex_schema.json` | the schema the browser parses | optional |
| `data/latex_files.json` | `file="…"` → block-hash map for the shortcode | optional |
| `data/latex_color_maps.json` | `name` → parsed colour-map JSON, for every `color-map="…"` in use | optional |
| `static/fonts/*.otf` | provisioned fonts; the ones Reflow TeX modified are cmap-patched and subset to the site's characters (`--no-font-subset` serves them whole) | optional |
| `static/{latex-viewer.js,protobuf.min.js}` | viewer scripts | no |
| `static/companion/{companion.js,companion.css}` | the companion package, loaded with `params.reflowtexCompanion` | no |
| `.reflowtex-build/<hash>/` | per-block LaTeX build artefacts | no |

All of it is reproducible from content, so the `.gitignore` here ignores it.
Commit the `data/` outputs instead if you want to build the site without a TeX
installation on the deploy host.

## Requirements

The build host needs the Reflow TeX pipeline prerequisites: `lualatex`, `gs`,
`dvisvgm` and Node 22.18+ (with `npm ci` run in the repository). See the
[top-level README](../../README.md).
