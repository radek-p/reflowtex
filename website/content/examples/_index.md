---
title: Examples
---

{{< latex >}}
Each block below is a real \texttt{.tex} snippet from the repository's
\texttt{examples/demo/} set --- the \emph{same} sources the vanilla and Hugo
integrations render --- compiled once by \texttt{prebuild.py} and re-flowed here.
Resize the window, or use the width and text-size controls, to see them break
live.
{{< /latex >}}

{{< latex file="01-inline-math.tex" />}}

{{< latex file="02-display-equations.tex" />}}

{{< latex file="03-aligned-systems.tex" />}}

{{< latex file="04-tikz-picture.tex" />}}

{{< latex file="05-sections-and-spacing.tex" />}}

## A full paper

{{< latex >}}
Beyond the snippets above, the entire AMS \texttt{testmath.tex} --- the
\texttt{amsmath} sample paper --- renders as one re-flowable document. It is set
in \emph{classic} Computer Modern through the legacy 8-bit Type1 font path (not
the default New Computer Modern), so it doubles as a stress test of that path on
a dense, cross-referenced, theorem-heavy paper.
{{< /latex >}}

<p class="demo-link"><a href="{{< siteurl "testmath/" >}}">Open the full testmath.tex demo →</a></p>

