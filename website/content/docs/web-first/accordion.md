---
title: Accordion
weight: 20
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Accordion}
\bigskip
An \texttt{accordion} shows one of its panes at a time, and the reader moves
between them with links placed in the panes themselves. Anything fits in a
pane -- here an ordinary amsthm \texttt{proof}. Every pane is typeset by
\TeX, re-breaks with the column, and starts exactly where the others do.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{theorem}
There are infinitely many primes.
\end{theorem}
\begin{accordion}
\begin{collapsedpane}
\noindent\textit{Proof idea.} Multiply them all and add one.
\expandlink[See the proof]
\end{collapsedpane}
\begin{expandedpane}
\begin{proof}\hfill\collapselink\par
Suppose $p_1, \dots, p_k$ were all of them, and let
\[ N = p_1 p_2 \cdots p_k + 1 . \]
No $p_i$ divides $N$, since each leaves remainder $1$. Yet $N > 1$ has a
prime factor, and it is none of the $p_i$ -- a contradiction.
\end{proof}
\end{expandedpane}
\end{accordion}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{Panes and links}
The environments \texttt{collapsedpane} and \texttt{expandedpane} are two
panes with names.
There can be any number of panes, \verb|\begin{pane}[name]|, and links switch
between them: \cs{expandlink} goes to the next pane and \cs{collapselink} to
the previous one (the text is optional: \emph{See more} and \emph{See less} by
default). A third, \verb|\panelink{|\emph{target}\verb|}{|\emph{text}\verb|}|, goes to a
pane by name or number, or to \texttt{next}, \texttt{prev}, \texttt{first} or
\texttt{last}. Accordions nest.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{accordion}[initial=short]
\begin{pane}[short]
\noindent\textbf{Why is $\sqrt 2$ irrational?} Because a fraction for it
would have to be reducible forever. \panelink{longer}{Say more}
\end{pane}
\begin{pane}[longer]
\noindent\textbf{Why is $\sqrt 2$ irrational?} If $\sqrt 2 = p/q$ in lowest
terms, then $p^2 = 2q^2$, so $p$ is even; then $q$ is even as well, and the
fraction was not in lowest terms after all.
\panelink{full}{The full argument} \textperiodcentered{} \panelink{short}{Less}
\end{pane}
\begin{pane}[full]
\noindent\textbf{Why is $\sqrt 2$ irrational?} Suppose $\sqrt 2 = p/q$ with
$p, q$ positive integers sharing no factor. Squaring,
\[ p^2 = 2q^2 , \]
so $p^2$ is even, hence $p$ is even: $p = 2r$. Then $4r^2 = 2q^2$, so
$q^2 = 2r^2$ is even and $q$ is even too -- contradicting that $p$ and $q$
share no factor. \panelink{first}{Back to the short answer}
\end{pane}
\end{accordion}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{In print}
A PDF prints one pane: the last, the fullest, unless \texttt{print=} names
another. The links are dropped there, since they have nothing to do on paper,
but a line break around one stays -- \verb|\hfill\collapselink\par| still
ends the proof's first line in print; wrap it in \texttt{webonly} if the PDF
should run on. Printing the web page shows the same pane as the PDF.
The option \texttt{initial=} picks the pane shown first (default: the first).
{{< /latex >}}

