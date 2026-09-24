---
title: Notes and hints
weight: 30
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Notes and hints}
\bigskip
Two small environments for teaching material. In a PDF both are ordinary
paragraphs.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{webnote}
\textbf{Note.} A \texttt{webnote} sets a passage off from the text around
it, re-broken at the width of its box.
\end{webnote}
\begin{webhint}
\textbf{Hint.} A \texttt{webhint} stays blurred until the reader clicks it,
or focuses it and presses Enter, and another click blurs it again --- for
exercises whose hint should not be read by accident.
\end{webhint}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
Their colours are custom properties a page can set:
\texttt{--latex-note-accent} for the note's border and tint.
{{< /latex >}}

