# Reflow TeX — vanilla integration

The reference integration. It depends only on [`../../src`](../../src) — no site
generator — so it's the clearest example of how to drive the pipeline, and the
quickest way to get LaTeX onto a page.

## Use

```sh
python build.py <snippets-dir> -o site/
python -m http.server -d site        # then open http://localhost:8000
```

Serve at the **site root**: the viewer loads fonts from `/fonts/`.

## Input

A directory of LaTeX snippets:

- Each `*.tex` file becomes **one block** on the page, in filename order, headed
  by its filename stem.
- A file named **`preamble.tex`** is not a block — its contents are prepended to
  every snippet's preamble (shared macros, packages, TikZ libraries, fonts).
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

## Output

```
site/
├── index.html          the page (schema + all blocks embedded)
├── latex-viewer.js     the renderer
├── protobuf.min.js     its only dependency
├── fonts/              provisioned + cmap-patched OTF files
└── _build/             per-snippet build artefacts (inspect on failure)
```

`index.html` and the assets are self-contained; everything under `_build/` is
scratch you can delete.

## Embedding blocks in your own HTML

`page.template.html` shows the whole contract — the `#latex-schema` element, the
`.latex-block[data-nodelist-b64]` blocks, the two scripts, and the minimum CSS the
rendered SVG needs. See [../../src/viewer/README.md](../../src/viewer/README.md)
for the full DOM contract if you want to hand-author pages rather than generate
them.
