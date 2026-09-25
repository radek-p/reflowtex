---
title: Footnotes
weight: 65
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Typesetting]{Footnotes}
\bigskip
A \cs{footnote} is typeset by \TeX{} like the text around it, and opens in
a panel by its marker when you point at the marker or press it. The note is
broken into lines again at the width of the panel.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
The series $\sum_{n \ge 1} n^{-2}$ converges,\footnote{Its partial sums
are bounded: $\sum_{n=1}^{N} n^{-2} < 1 + \sum_{n=2}^{N}
\frac{1}{n(n-1)} = 2 - \frac{1}{N}$.} and Euler found its sum in
1734.\footnote{The problem was posed by Pietro Mengoli in 1650.}
{{< /latex >}}

{{< latex preamble="links" >}}
A note can also stand in the margin, beside its line: see
\href{../side-notes/}{Side notes}. Or it can wait behind a button in the
text, which the companion package lets a page build: see
\href{../../web-first/inline-buttons/}{Inline buttons}.
{{< /latex >}}
