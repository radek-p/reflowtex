---
title: Examples
---

## Reflow TeX in the wild

{{< latex >}}
Two complete documents -- a book and a research paper -- are already published
on the open web with Reflow\,\TeX{}. They are the best place to see it at work
on real, long, theorem-heavy material; the snippets further down show the
individual pieces.
{{< /latex >}}

- [**Transducers**](https://mimuw.edu.pl/~bojan/books/transducer) — a book by Mikołaj Bojańczyk
- [**Scoped MSO, Register Automata, and Expressions: Equivalence over Data Words**](https://radekp.com/scoped-mso-svg/) — a paper by Radosław Piórkowski

## Demo snippets

{{< latex >}}
Each block below is a real \texttt{.tex} snippet from the repository's
\texttt{examples/demo/} set -- the \emph{same} sources the vanilla and Hugo
integrations render -- compiled once by \texttt{prebuild.py} and re-flowed here.
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
\texttt{amsmath} sample paper --- renders as one re-flowable document, set in
classic Computer Modern through the same legacy 8-bit Type1 font path as the
math above. Being real, dense, cross-referenced, and theorem-heavy, it doubles
as a stress test of that path at a much larger scale than the curated snippets
above.
{{< /latex >}}

<p class="demo-link"><a href="{{< siteurl "testmath/" >}}">Open the full testmath.tex demo →</a></p>
