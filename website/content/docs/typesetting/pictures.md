---
title: Pictures
weight: 40
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Pictures}
\bigskip

A TikZ picture --- or a \texttt{tikz-cd} diagram, or an included PDF --- is
captured as \TeX{} finished it and drawn as inline SVG with \TeX{}'s own
metrics, so it sits anywhere a box can, even inside an alignment. Its colours
follow the theme like the text's.
{{< /latex >}}

{{< latex file="04-tikz-picture.tex" show-source="true" />}}

