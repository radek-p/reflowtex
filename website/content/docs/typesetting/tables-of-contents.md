---
title: Tables of contents
weight: 55
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Tables of contents}
\bigskip

A \verb|\tableofcontents| is typeset by the document class, as in print.
Each entry links to its heading. There are no pages, so the page numbers
and the dotted leaders are left out. The build runs \TeX{} as many times
as the contents need to settle, up to three.
{{< /latex >}}

{{< latex file="08-table-of-contents.tex" show-source="true" />}}
