---
title: Overview
weight: 10
latexTitle: true
aliases: ["/docs/web-first/"]
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Overview}
\bigskip
Most documents need no changes: a paper or a book written for print is
published as it is. A document written \emph{for} the web can use the
companion package \texttt{reflowtex.sty}. Everything in the package also
compiles with ordinary \LaTeX, to the closest print equivalent, so the same
source still gives a PDF.
{{< /latex >}}

```latex
\usepackage{reflowtex}                  % or [boxed]
```

{{< latex preamble="webfirst" >}}
The package ships in \texttt{src/latex/}, and the build pipeline finds it
automatically. For a PDF of the same source, put \texttt{reflowtex.sty} next to the
document or on \texttt{TEXINPUTS}.
\section*{Web-only and print-only}
\cs{ifreflowtex} is true only when the pipeline compiles the source. Two
environments build on it: \texttt{webonly}, whose body appears only on the
web, and \texttt{printonly}, whose body appears only in the PDF.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{webonly}This sentence is in a \texttt{webonly} environment, so the PDF
of this page would not have it.\end{webonly}
\begin{printonly}And this one would be in the PDF only.\end{printonly}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
The next pages show what the package offers: an \emph{accordion} of panes,
\emph{notes} and \emph{hints}, and \emph{boxed theorems}. \emph{Custom kinds}
explains the two primitives they are all built from, and how to build your
own.
{{< /latex >}}

