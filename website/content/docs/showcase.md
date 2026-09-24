---
title: Showcase
weight: 100
latexTitle: true
toc: true
widthControl: true
aliases: ["/examples/", "/testmath/", "/docs/showcase/in-the-wild/", "/docs/showcase/testmath/"]
---

{{< latex preamble="docs" >}}
\pagetitle{Showcase}
\bigskip
Whole documents published with Reflow\,\TeX.
\section*{On other sites}
Documents published from their \LaTeX{} source, oldest first.
{{< /latex >}}

<ul class="showcase-list">
<li><a href="https://radekp.com/scoped-mso-svg/"><strong>Scoped MSO, Register Automata, and Expressions: Equivalence over Data Words</strong></a> – a paper by Radosław Piórkowski</li>
<li><a href="https://mimuw.edu.pl/~bojan/books/transducer"><strong>Transducers</strong></a> – a book by Mikołaj Bojańczyk</li>
<li><a href="https://laxarchive.org/lax-242665/paper.html"><strong>An Introduction to Lax</strong></a> – from the Lax archive, which is experimenting with Reflow TeX</li>
</ul>

{{< latex preamble="docs" >}}
\section*{The AMS \texttt{testmath.tex}}
The sample paper of the \texttt{amsmath} package, unchanged, with its own
preamble, Computer Modern fonts, cross-references and a footnote. The file
is a complete document, so it is compiled as one. This page shows it with
one line of source, plus a one-line preamble that adds microtype:
{{< /latex >}}

```markdown
{{</* latex file="testmath.tex" preamble="microtype" /*/>}}
```

```latex
% latex-preambles/microtype.tex
\usepackage{microtype}
```

{{< inspect label="Inspect its boxes and glue" >}}
{{< latex file="testmath.tex" preamble="microtype" />}}
