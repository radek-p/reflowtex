# testmath.tex — third-party demo input

This directory bundles **`testmath.tex`**, the American Mathematical Society's
sample paper for the `amsmath` package, used here as a rendering demo.

- **Work:** `testmath.tex`, version 2.0a (2023/08/24)
- **Author:** American Mathematical Society
- **Copyright:** © 1995, 1999 American Mathematical Society; © 2023 LaTeX Project
- **License:** LaTeX Project Public License (LPPL) version 1.3c —
  <https://www.latex-project.org/lppl/lppl-1-3c/>. The full text is bundled here
  as [`LPPL-1.3c.txt`](LPPL-1.3c.txt).
- **Source:** distributed with the `amsmath` package on CTAN —
  <https://ctan.org/pkg/amsmath> (file `testmath.tex`).

## What we distribute, and how we comply

`testmath.tex` is included **verbatim and unmodified**, byte-for-byte as received,
with its own copyright and license header intact — this is a *complete, unmodified
copy of the Work*, which the LPPL permits redistributing. We add nothing to the
file and remove nothing from it.

The demo build (`build.py`) does **not** modify the file. At build time it reads
the pristine file and splits it into its preamble and its body as in-memory
strings, then assembles a wrapper document: the document's own preamble is used
verbatim (its `amsmath`/`amsthm` setup, macros, and theorem definitions), Liquid
TeX's serializer hook from [`template.tex`](template.tex) is inserted *after* that
preamble, and the body follows `\begin{document}`. That assembled wrapper is
written to a throwaway, git-ignored build directory (`build/…/input.tex`) and
compiled there — it is a transient build artifact, never committed and never
distributed. What ships in the built site is the rendered *output* of running the
Work (node-list data, analogous to a compiled PDF), not any `.tex` source. So the
only `testmath.tex` that is committed or distributed is the verbatim original.

The rendered page and this notice both keep the AMS attribution visible (the
document's own `\title`/`\author` also print "American Mathematical Society").

## A note on fonts

`testmath.tex` is a classic `amsmath` document written for the Computer Modern
fonts, so this demo renders it that way — no `fontspec`, no `unicode-math`. The
classic 8-bit Type1 math fonts (`cmmi`, `cmsy`, `cmex`, …) have no OpenType form,
so Reflow TeX converts them to web fonts on the fly (`src/encode/t1_convert.py`).
Those converted fonts, and any Latin Modern faces the build serves, carry their
own licenses — see the repository's `THIRD-PARTY-LICENSES.md`.
