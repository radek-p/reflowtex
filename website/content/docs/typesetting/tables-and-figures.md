---
title: Tables and figures
weight: 42
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Tables and figures}
\bigskip

A table or figure stays where it is in the source: a page has no bottom
for it to float to. Its caption is numbered and spaced as the document
class sets it.

A table or picture whose width follows the column, such as a
\verb|tabular*| of width \verb|\linewidth| or an \verb|\includegraphics|
with \verb|width=\linewidth|, follows the reader's column too. The build runs \TeX{} at several widths, as for displays, and records
how each box changes with the width.
{{< /latex >}}

{{< latex file="09-flexible-table.tex" show-source="true" />}}

{{< latex preamble="docs" >}}
The space between the columns of this table comes from
\verb|\extracolsep{\fill}|, so it grows and shrinks with the column. Below
the table's natural width it stops shrinking, and the table scrolls
sideways instead.
{{< /latex >}}

{{< latex file="10-scaled-figure.tex" show-source="true" />}}

{{< latex preamble="docs" >}}
A picture scaled to the column scales with it, height included. Pictures
are drawn as inline SVG, so a scaled picture stays sharp.
{{< /latex >}}
