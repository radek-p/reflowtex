# Reflow TeX – vanilla integration

The reference integration. It depends only on [`../../src`](../../src) – no site
generator – so it's the clearest example of how to drive the pipeline, and the
quickest way to get LaTeX onto a page.

## Use

```sh
node build.ts <dir> -o site/ [--snippet]
node ../../scripts/serve.ts site     # then open http://localhost:8000
```

Serve the output directory from anywhere – a domain root, a subpath, or a
page opened straight from disk: fonts resolve relative to `latex-viewer.js`.

## Input

A directory of LaTeX snippets:

- Each `*.tex` file becomes **one block** on the page, in filename order, headed
  by its filename stem.
- A file named **`preamble.tex`** is not a block – it is the setup every
  snippet is set in: its `\documentclass` (and `\DocumentMetadata` before it, if
  any), packages, macros, TikZ libraries, fonts. Without one, snippets are set in
  the pipeline's default (article, mathtools, amssymb, TikZ).
- Each `*.tex` file is a complete document, compiled as it is (`preamble.tex`, if
  any, is then read at the end of each one's own preamble); with `--snippet`
  (and `--batch`), each is a snippet set in `preamble.tex`.
  See [`docs/documents.md`](../../docs/documents.md).
- Repo-local OTF fonts (faces not installed into TeX) go in a **`fonts/`**
  subdirectory of the snippets dir, or pass `--local-fonts`.

[`../../examples/demo`](../../examples/demo) is a working input directory.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `-o, --out` | `site/` | output directory |
| `--title` | `Reflow TeX` | page `<title>` and heading |
| `-j, --jobs` | `1` | snippets compiled in parallel |
| `--local-fonts` | `<source>/fonts` if present | repo-shipped OTF fonts |
| `--log-alert` | the viewer's: `error` | the viewer's messages at this level or above go to the browser's console and as a `reflowtex:log` event: `none`, `error`, `warning`, `info` or `debug` |
| `--log-show` | the viewer's: `font-load-failed` | which of the viewer's messages readers are shown on the page: codes (`font-load-failed`, `missing-char`) or level names (that level and above), separated by commas or spaces; `none` shows nothing |
| `--fail-on-tex-error` | off | a TeX error that TeX carries on past fails the block (see below) |

### The viewer's log

With `--log-alert` or `--log-show`, the page carries the viewer's log
configuration, as a JSON island after `#latex-font-map`:

```html
<script id="latex-log-config" type="application/json">{"alert":"warning","show":["error","missing-char"]}</script>
```

(from `--log-alert warning --log-show error,missing-char`). A flag not given is
left out of it, and the viewer uses its default; with neither, the page has no
island at all.

### TeX errors

A block fails only where lualatex itself gives the author nothing: TeX
stopped (an emergency stop – a missing class or file –, a full memory, a
hundred errors) or wrote no output. An error TeX reports and carries on past
in nonstopmode – an undefined control sequence, a package's error – leaves
the document plain lualatex would give the author, with that error in it: the
block is built as TeX set it, and each distinct error is a warning with the
code `tex-error`, in the build's log and in the page's (its details: `error`,
TeX's `! …` line; `file` and `line` where the log gives them; `context`,
what TeX had read of the line; `pass` and `count`). `--log-alert warning`
sends them to the browser's console, and the inspector's Log tab lists them.
With `--fail-on-tex-error` such an error fails the block instead.

## Output

```
site/
├── index.html          the page (schema + all blocks embedded)
├── latex-viewer.js     the renderer
├── protobuf.min.js     its only dependency
├── fonts/              provisioned OTF files (modified ones cmap-patched + subset)
└── _build/             per-snippet build artefacts (inspect on failure)
```

`index.html` and the assets are self-contained; everything under `_build/` is
scratch you can delete.

Serve it compressed: GitHub Pages and most static hosts gzip or brotli
transparently, and it matters here – the inline node lists and the viewer
shrink about three-fold in transit. No precompressed sidecar files are
emitted, since such hosts ignore them and simple dev servers cannot serve them.

## Embedding blocks in your own HTML

`page.template.html` shows the whole contract – the `#latex-schema` element, the
`.latex-block[data-nodelist-b64]` blocks, the two scripts, and the minimum CSS the
rendered SVG needs. See [../../src/viewer/README.md](../../src/viewer/README.md)
for the full DOM contract if you want to hand-author pages rather than generate
them.
