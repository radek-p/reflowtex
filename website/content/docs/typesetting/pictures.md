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

An EPS figure, named as \verb|figure.eps| or as \verb|figure|, is
converted to PDF and drawn as that PDF. \LaTeX{} converts such a figure by
running a program from \TeX{} (\texttt{epstopdf}), which needs shell
escape. The build runs \TeX{} with shell escape off, so that a document
cannot run programs, and does not turn it on for this. Instead it converts
every \texttt{.eps} and \texttt{.ps} file in the document's directories
itself, before \TeX{} runs, with the same converter (\TeX{} Live's
\texttt{repstopdf}, which needs Ghostscript), and puts each PDF where
\LaTeX{} looks for it. The figure comes out the size it has in a \LaTeX{}
run of your own. A figure that does not convert is reported by name, with
the reason, and a document that includes it stops, as for a missing file.
{{< /latex >}}

{{< latex file="04-tikz-picture.tex" show-source="true" />}}

