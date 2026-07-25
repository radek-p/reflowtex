---
title: Reflow TeX
---

{{< latex >}}
\textbf{The problem.} A PDF is set once, at one width. To view it on a screen you pan and
zoom. Web math typesetting, meanwhile, re-implements
LaTeX and never quite matches it. Reflow\,\TeX{} takes a third path.
{{< /latex >}}

<div class="feature-grid">

{{< latex >}}
\textbf{Genuine TeX.} A real \LaTeX{} run sets your source; a Lua hook
exports the node list --- every glyph, kern, ligature, rule, and math box, with
TeX's own positions.
{{< /latex >}}

{{< latex >}}
\textbf{Auto re-flowed.} \texttt{latex-viewer.js} re-breaks each
paragraph with the Knuth--Plass algorithm, so lines fill the column at \emph{any}
width --- resize the window and watch.
{{< /latex >}}

{{< latex >}}
\textbf{Real math fonts.} Inline and display math, \texttt{align},
theorem environments, and TikZ pictures, set in Latin Modern and New Computer
Modern and drawn as inline SVG.
{{< /latex >}}

{{< latex >}}
\textbf{Selectable and searchable.} Text is real text, not an image: select it,
search it, and let it recolour for dark, sepia, or high-contrast reading.
{{< /latex >}}

</div>

{{< latex >}}
\textbf{How it fits together.} A build step (\texttt{lualatex} $\to$ node list
$\to$ Protocol Buffers) runs once, offline; the browser ships no TeX, only a
small viewer and the fonts your document used. It drops into a plain HTML page or
a Hugo site. Jekyll integration is planned, too.
{{< /latex >}}
