---
title: Accordion
weight: 20
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Accordion}
\bigskip
A \texttt{webaccordion} shows one of its panes at a time, and the reader moves
between them with links placed in the panes themselves. Anything fits in a
pane -- here an ordinary amsthm \texttt{proof}. Every pane is typeset by
\TeX, re-breaks with the column, and starts exactly where the others do.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{theorem}
There are infinitely many primes.
\end{theorem}
\begin{webaccordion}
\begin{webpane}[collapsed]
\noindent\textit{Proof idea.} Multiply them all and add one.
\webnextpane[See the proof]
\end{webpane}
\begin{webpane}[expanded]
\begin{proof}\hfill\webprevpane\par
Suppose $p_1, \dots, p_k$ were all of them, and let
\[ N = p_1 p_2 \cdots p_k + 1 . \]
No $p_i$ divides $N$, since each leaves remainder $1$. Yet $N > 1$ has a
prime factor, and it is none of the $p_i$ -- a contradiction.
\end{proof}
\end{webpane}
\end{webaccordion}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{Panes and links}
The example's two panes are named \texttt{collapsed} and \texttt{expanded}.
There can be any number of panes, \verb|\begin{webpane}[name]|, and links switch
between them: \cs{webnextpane} goes to the next pane and \cs{webprevpane} to
the previous one (the text is optional: \emph{See more} and \emph{See less} by
default). A third, \verb|\webpanelink{|\emph{target}\verb|}{|\emph{text}\verb|}|, goes to a
pane by name or number, or to \texttt{next}, \texttt{prev}, \texttt{first} or
\texttt{last}. Accordions nest.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{webaccordion}[initial=short]
\begin{webpane}[short]
\noindent\textbf{Why is $\sqrt 2$ irrational?} Because a fraction for it
would have to be reducible forever. \webpanelink{longer}{Say more}
\end{webpane}
\begin{webpane}[longer]
\noindent\textbf{Why is $\sqrt 2$ irrational?} If $\sqrt 2 = p/q$ in lowest
terms, then $p^2 = 2q^2$, so $p$ is even; then $q$ is even as well, and the
fraction was not in lowest terms after all.
\webpanelink{full}{The full argument} \textperiodcentered{} \webpanelink{short}{Less}
\end{webpane}
\begin{webpane}[full]
\noindent\textbf{Why is $\sqrt 2$ irrational?} Suppose $\sqrt 2 = p/q$ with
$p, q$ positive integers sharing no factor. Squaring,
\[ p^2 = 2q^2 , \]
so $p^2$ is even, hence $p$ is even: $p = 2r$. Then $4r^2 = 2q^2$, so
$q^2 = 2r^2$ is even and $q$ is even too -- contradicting that $p$ and $q$
share no factor. \webpanelink{first}{Back to the short answer}
\end{webpane}
\end{webaccordion}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{In print}
A PDF prints one pane: the last, the fullest, unless \texttt{print=} names
another. The links are dropped there, since they have nothing to do on paper,
but a line break around one stays -- \verb|\hfill\webprevpane\par| still
ends the proof's first line in print; wrap it in \texttt{webonly} if the PDF
should run on. Printing the web page shows the same pane as the PDF.
The option \texttt{initial=} picks the pane shown first (default: the first).
{{< /latex >}}

