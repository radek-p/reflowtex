---
title: Pictures
weight: 70
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Pictures}
\bigskip

TikZ pictures, \texttt{tikz-cd} diagrams and included PDFs are captured
once \TeX{} has finished them, and drawn as inline SVG with \TeX's metrics.
They can go anywhere a box can, even inside an alignment, and their colours
follow the theme like the text.
A \texttt{nicematrix} environment is drawn with PGF as well \textendash{}
its rules, blocks and dotted lines \textendash{} so the whole environment is
captured as one picture, after a second \TeX{} run has given its cells'
positions.

An \verb|\includegraphics| of a PNG or JPEG file is drawn as that image,
at the size \TeX{} gave it. The file goes into the page as it is, neither
recompressed nor resized, so a large photograph makes a large page: scale
it down before including it.
{{< /latex >}}

{{< latex file="04-tikz-picture.tex" show-source="true" />}}

