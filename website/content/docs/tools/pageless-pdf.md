---
title: Pageless PDF
weight: 20
latexTitle: true
---

{{< latex preamble="about" >}}
\pagetitle[Tools]{Pageless PDF}
\bigskip
A pageless PDF is a \LaTeX{} document typeset by LuaTeX as one page as
tall as the document: no page breaks, no floats moved to the top of a page,
no space stretched to fill one. Every box and every glue is where \TeX{} put
it on the main vertical list. It is the geometry the browser reproduces, so
it is the PDF to compare the browser with, line by line and down to the
glyph.

Below is the AMS sample paper \texttt{testmath.tex} as a pageless PDF,
345\,pt wide and nearly 20\,000\,pt tall.
{{< /latex >}}

<div class="pageless-pdf">
<iframe src="{{< siteurl "pageless/testmath.pdf" >}}#view=FitH&amp;navpanes=0" title="testmath.tex as a pageless PDF" loading="lazy"></iframe>
<p><a href="{{< siteurl "pageless/testmath.pdf" >}}">Download the PDF</a> (one page, 415 × 19,742 bp). Some PDF readers refuse pages taller than 14,400 bp; browsers show it.</p>
</div>
<style>
  .pageless-pdf iframe { display: block; width: 100%; height: 80vh; border: 1px solid var(--lt-hair); border-radius: 4px; background: #fff; }
  .pageless-pdf p { font-size: .9rem; margin: .5rem 0 2rem; }
</style>

{{< latex preamble="about" >}}
\section*{How it is made}
The pipeline already keeps the galley: before the page builder sees
anything, the serializer copies each item \TeX{} adds to the main vertical
list, with its real dimensions. \texttt{pageless.py} compiles the document
the way the pipeline does, inside the extraction template, and adds two
things: \texttt{pageless\_pdf.lua}, which at the end of the run ships that
copy as a few pages of up to 16\,000\,pt (the largest a \TeX{} dimension
allows), and \texttt{stack.py}, which stacks those pages into one.

Pages are cut only inside vertical glue or a kern, so nothing \TeX{} placed
moves, and stacking them edge to edge gives every distance back exactly.
What a page's output routine would have removed goes too: empty float
markers, and the \verb|\topskip| added after them. TikZ pictures are drawn
back in their places.

\section*{Making one}
The tool is in \texttt{tools/pageless-pdf/}. It needs LuaTeX and the
pipeline's Python packages, plus \texttt{pikepdf}:
{{< /latex >}}

```sh
.venv/bin/pip install -r tools/pageless-pdf/requirements.txt
.venv/bin/python3 tools/pageless-pdf/pageless.py paper.tex -o out/
# → out/pageless.pdf, and out/output.json from the same run
```

{{< latex preamble="about" >}}
\noindent Options: \texttt{--passes N} (2 by default; a document with
references needs 2 or 3), \texttt{--margin} (white either side of the
column, 36\,pt by default), \texttt{--template} (the extraction template;
\texttt{testmath.tex} has its own), and \texttt{--width-extra} (added to the
document's \verb|\textwidth|, to typeset it wider than its own column).

\section*{Comparing with the browser}
The same directory holds the comparison. \texttt{site\_from\_run.py} builds
a page from the run's own \texttt{output.json}, so the PDF and the page come
from one compilation. Two checks then compare them at the PDF's column
width:
\begin{description}
\item[\texttt{vector\_compare.py}] No pixels: the position of every glyph
  in the PDF (from MuPDF's trace) against the position the browser gave it,
  to a hundredth of a point. Run it first; whatever it reports is geometry,
  not rasterisation.
\item[\texttt{compare.py}] Pixels: both drawn at the same scale, the rows
  paired line by line, each pair counted as identical, differing in place,
  or the same ink moved. It writes a side-by-side picture, a heat map and a
  report. \texttt{tiles.py} cuts them into tiles for a web page.
\end{description}
The results for \texttt{testmath.tex} are on
\href{../../showcase/accuracy/}{How close to the PDF?}
{{< /latex >}}

```sh
(cd tools/pageless-pdf && npm install playwright && npx playwright install chromium)
T=tools/pageless-pdf; PY=.venv/bin/python3        # needs MuPDF (mutool) or Poppler too
$PY $T/site_from_run.py out/ out/site/            # then serve out/site/, e.g. on port 8000
$PY $T/vector_compare.py out/ http://localhost:8000/index.html
$PY $T/compare.py out/ http://localhost:8000/index.html --ppp 4
```
