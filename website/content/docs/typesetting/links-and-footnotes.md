---
title: Links and footnotes
weight: 60
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Links and footnotes}
\bigskip
Cross-references and hyperlinks -- \verb|\ref|, \verb|\eqref|,
\verb|\autoref|, \verb|\cref| and \verb|\href| -- become links, lit as a whole on hover even when a line break splits them, and
each \verb|\label| becomes an anchor on the page. A footnote is typeset by
\TeX{} in full and opens in a popover from its marker.
{{< /latex >}}

{{< latex preamble="docs" show-source="true" >}}
\begin{equation}\label{eq:euler}
  e^{i\pi} + 1 = 0
\end{equation}
Equation~\eqref{eq:euler} links back to itself: hover over the number, or
press it to jump.\footnote{A footnote is set by \TeX{} like the text, and
re-broken to fit the popover: $\sum_{n \ge 1} n^{-2} = \pi^2/6$.}
The marker at the end of the last sentence opens a footnote.
{{< /latex >}}

{{< latex preamble="docs" >}}
A label on another page of the same site resolves through the link map the
Hugo integration writes; a reference whose target was never published stays
plain text rather than a link to nowhere.
{{< /latex >}}

