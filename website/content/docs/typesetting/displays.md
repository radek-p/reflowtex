---
title: Displays
weight: 20
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Displays}
\bigskip

Displayed equations keep \TeX{}'s spacing, operator sizes and limits. A
display does not re-break; instead its width model --- recovered from
several real \TeX{} runs at different widths --- lets the space around and
inside it shrink as the column narrows, and only a display genuinely wider
than its ink scrolls.
{{< /latex >}}

{{< latex file="02-display-equations.tex" show-source="true" />}}

{{< latex file="06-display-families.tex" show-source="true" />}}

{{< latex preamble="docs" >}}
Each family above is modelled from its finished boxes, not from the name of
the environment, so package-defined displays work the same way. The smallest
space kept between the pieces of a display is a viewer option,
\texttt{data-display-min-space}.
{{< /latex >}}

