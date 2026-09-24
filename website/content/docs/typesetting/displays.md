---
title: Displays
weight: 20
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Displays}
\bigskip

Displayed equations keep \TeX{}'s spacing, operator sizes and limits. A
display is not re-broken. Instead, the build runs \TeX{} at several widths
to learn how the space around and inside the display shrinks, and the
viewer uses this to fit it to a narrower column. A display scrolls only when
its ink does not fit.
{{< /latex >}}

{{< latex file="02-display-equations.tex" show-source="true" />}}

{{< latex file="06-display-families.tex" show-source="true" />}}

{{< latex preamble="docs" >}}
The model is built from the finished boxes, not from the environment's
name, so displays defined by packages work too. The smallest
space kept between the pieces of a display is a viewer option,
\texttt{data-display-min-space}.
{{< /latex >}}

