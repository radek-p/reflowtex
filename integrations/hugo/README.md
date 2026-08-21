# Reflow TeX — Hugo integration

Render LaTeX in a [Hugo](https://gohugo.io) site with a `{{</* latex */>}}`
shortcode. The snippet is compiled to a binary node list at build time and drawn
in the browser by `latex-viewer.js`.

This directory is also a **runnable example site** — try it first:

```sh
cd integrations/hugo
python prebuild.py . --demos-dir ../../examples/demo   # compile the shared demos
hugo server                                            # open the printed URL
```

(or just `make hugo-demo` from the repo root)

## Add it to your own site

1. **Copy two files** into your site's `layouts/`:
   - `layouts/shortcodes/latex.html`
   - `layouts/partials/reflowtex-viewer.html`

2. **Include the viewer** once per page that can contain blocks — add this near
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
   through `data/latex_files.json` — the shortcode never reads across
   directories. The example site points `--demos-dir` at the shared
   `../../examples/demo` (see the Makefile's `hugo-demo` target), which is exactly
   the set the vanilla integration renders.

4. **Run `prebuild.py` before every build.** Point it at your site root
   (defaults to the current directory):

   ```sh
   python /path/to/reflowtex/integrations/hugo/prebuild.py .
   hugo
   ```

   It writes `data/latex_blocks/`, `data/latex_schema.json`, provisions fonts
   into `static/fonts/`, and copies the viewer scripts into `static/`. A good
   habit is to wire it into your build: `python prebuild.py . && hugo`.

## Options

The shortcode forwards attributes to the renderer, e.g. layout width, alignment,
and the Knuth–Plass knobs:

```markdown
{{</* latex width="360" align="left" */>}} … {{</* /latex */>}}
```

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

Unlike a preamble, a colour map is not part of what gets compiled — it's read
by the browser at render time — so it must be repeated on every shortcode call
that wants it, even multiple calls referencing the same `file="…"`.

An inline block can register itself as a named lookup the same way a
`file="…"` ref does, via `as="<name>"`, for a snippet with no natural `.tex`
file of its own that another template still wants to find by name later — a
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
| `static/fonts/*.otf` | provisioned + cmap-patched fonts | optional |
| `static/{latex-viewer.js,protobuf.min.js}` | viewer scripts | no |
| `.reflowtex-build/<hash>/` | per-block LaTeX build artefacts | no |

All of it is reproducible from content, so the `.gitignore` here ignores it.
Commit the `data/` outputs instead if you want to build the site without a TeX
installation on the deploy host.

## Requirements

The build host needs the Reflow TeX pipeline prerequisites: `lualatex`, `gs`,
`dvisvgm`, `protoc`, and the Python packages in `../../src/encode/requirements.txt`. See the
[top-level README](../../README.md).
