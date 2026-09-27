---
title: Accuracy
weight: 50
latexTitle: true
aliases:
  - /docs/showcase/accuracy/
---

{{< latex preamble="about" >}}
\pagetitle[Getting started]{Accuracy}
\bigskip
How closely does the browser follow \TeX? To find out, a document is
typeset by LuaTeX twice from one run: as a
\href{../../tools/pageless-pdf/}{pageless PDF} -- one page as tall as the
document, so that nothing is moved to another page -- and in the browser by
Reflow\,\TeX, with its column exactly as wide as the PDF's. The two are then
compared in two ways, each with a tool to see the results.
{{< /latex >}}

<div class="accuracy-tools">
<a href="{{< siteurl "render-tests/" >}}" class="primary">Render tests</a>
<a href="../../tools/pixel-compare/">Pixel comparison</a>
</div>
<style>
  /* the home page's buttons (layouts/partials/head.html): square; the first
     filled with the accent, the second outlined */
  .accuracy-tools { display: flex; gap: .7rem; flex-wrap: wrap; margin: 1.5rem 0 1rem; }
  .accuracy-tools a { text-decoration: none; padding: .5rem 1.1rem; font-weight: 600; color: inherit;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent); transition: background .15s ease; }
  .accuracy-tools a:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
  .accuracy-tools a.primary { background: var(--lt-primary); color: #fff; border-color: transparent; }
  html.dark .accuracy-tools a.primary { color: #0c0a09; }
  .accuracy-tools a.primary:hover { background: var(--lt-primary-strong); }
</style>

{{< latex preamble="about" >}}
\section*{Where each glyph is}
The first comparison uses no pixels. The position of every glyph and rule
in the PDF is read from the PDF, and the position the browser gave it from
the page, and the two are matched. This is what the render tests do on every
change to Reflow\,\TeX: a short document for each feature (paragraphs,
inline mathematics, displays, alignments, lists, footnotes, microtype,
rules, TikZ pictures) and all of the AMS sample paper
\texttt{testmath.tex}. The short documents are also typeset 100\,pt narrower
and 85\,pt wider, and compared with the page as the browser breaks it again
for those widths. In the short documents no glyph is more than 0.014\,pt
from where \TeX{} put it; in \texttt{testmath.tex}, no more than 0.1\,pt.

\emph{Render tests} opens every test: the PDF beside the page, anything
that does not match marked on both, and the inspector open on the page.
\href{../../tools/render-tests/}{Tools, Render tests} says more.

\section*{How it looks}
The second comparison draws \texttt{testmath.tex} both ways, as a PDF
renderer and as the browser draw it, and compares the two pictures pixel by
pixel, line by line. As the glyphs are in the same places, what differs is
the drawing: the two smooth the edges of glyphs differently, and the PDF
renderer puts each glyph on a whole pixel row.

\emph{Pixel comparison} shows the pictures for the whole paper, with the
rows that differ marked.
{{< /latex >}}
