---
title: Hugo
weight: 30
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Getting started]{Hugo}
\bigskip
In a Hugo site, \LaTeX{} lives in a shortcode. Copy two files from
\texttt{integrations/hugo/layouts/} into your site -- the shortcode
\texttt{latex.html} and the partial \texttt{reflowtex-viewer.html} -- and
include the partial once, before \verb|</body>|. Then run
\texttt{prebuild.py} before every \texttt{hugo} build: it compiles the blocks,
embeds the schema and provisions the fonts. This site is built that way.
{{< /latex >}}

```markdown
{{</* latex */>}}
\[ e^{i\pi} + 1 = 0 \]
{{</* /latex */>}}

{{</* latex file="01-inline-math.tex" /*/>}}        <!-- a shared .tex file -->
```

{{< latex preamble="docs" >}}
\section*{Shortcode options}
\begin{description}
\item[\texttt{preamble="name"}] use \texttt{latex-preambles/name.tex};
  editing it recompiles the blocks that use it.
\item[\texttt{show-source="true"}] print the block's \LaTeX{} under it, as
  on the pages of this documentation.
\item[\texttt{color-map="name"}] recolour the block per theme with
  \texttt{latex-color-maps/name.json}; \texttt{params.latexColorMap} in the
  site's configuration sets a default for every block.
\item[\texttt{width}, \texttt{align}, and the Knuth--Plass knobs] passed to
  the viewer; see \texttt{integrations/hugo/README.md}.
\end{description}
A block that refers to its own labels is compiled twice, so \verb|\ref| and
\verb|\eqref| resolve; a label on another page resolves through the link map
\texttt{prebuild.py} writes.
{{< /latex >}}

