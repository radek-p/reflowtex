---
title: How close to the PDF?
linkTitle: Against the PDF
weight: 120
latexTitle: true
hideInNav: true
---

{{< latex preamble="about" >}}
\pagetitle[Showcase]{How close to the PDF?}
\bigskip
The AMS sample paper \texttt{testmath.tex}, typeset twice from one run of
LuaTeX: as a PDF, and in the browser by Reflow\,\TeX, which breaks every
paragraph again for the column it is given. Here the column is exactly as
wide as in the PDF, so the browser should reproduce the PDF, line for line.
To compare the whole document at once, LuaTeX set it without page breaks, as
one page as tall as the paper: a
\href{../../tools/pageless-pdf/}{pageless PDF}, made and compared with the
tools described there.

The comparison is made twice. First without pixels: the position of every
glyph in the PDF against the position the browser gave it. Then with pixels:
both are drawn at 4 pixels per point, and the two pictures are matched line
by line. The browser is photographed with its text in \TeX's black rather
than the site's dark grey, and without the smoothing macOS adds to thicken
letters, so that it draws glyphs the way a PDF renderer does. Then LuaTeX typeset the paper again with its column 85\,pt wider,
and the same browser page, built from the 345\,pt run, was set at 430\,pt:
there every paragraph is broken in the browser for a width the page was
never compiled at.

In the pictures below, white means the two agree and red marks pixels that
differ, the more they differ the darker, on a scale that keeps a pixel
partly off paler than one wholly off, so a glyph that is not where it should
be stands out in full red. The pink along edges is rasterisation: the PDF
renderer and the browser smooth the edges of glyphs differently, and the
PDF renderer puts each glyph on a whole pixel row. The bar above the picture
has a cell for every 500\,pt of the paper, red where rows are out of place
rather than just drawn differently. Switch between \emph{PDF} and
\emph{Browser} to see the two at the same place.

\emph{Drawn finer} shows the same comparison with both the PDF and the
browser drawn at 16 pixels per point and averaged down to 4, the same way on
both sides. That takes out the PDF renderer's snapping of each glyph to a
pixel row, and fewer pixels differ strongly. But at that scale the browser
draws its glyphs a little differently again, so more rows differ slightly;
the table has both.
{{< /latex >}}

{{< pixel-compare >}}
