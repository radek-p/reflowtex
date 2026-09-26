---
title: Accordion
weight: 20
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Companion package]{Accordion}
\bigskip
A \texttt{webaccordion} shows one of its panes at a time, and the reader moves
between them with links placed in the panes themselves. A pane can hold
anything; here it is an ordinary amsthm \texttt{proof}. Each pane is typeset
by \TeX, re-breaks with the column, and starts where the others do.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
Euclid's proof that the primes never run out is over two thousand years old.
\begin{theorem}
There are infinitely many primes.
\end{theorem}
\begin{webaccordion}
\begin{webpane}[collapsed]
\noindent\textit{Proof idea.} Suppose there were only finitely many
primes. Multiply them all and add one: the result is divisible by none of
them, yet it has a prime factor -- a contradiction.
\webnextpane[See the proof]
\end{webpane}
\begin{webpane}[expanded]
\begin{proof}[\proofname\webpanelink{prev}{ (hide)}]
Suppose $p_1, \dots, p_k$ were all of them, and let
\[ N = p_1 p_2 \cdots p_k + 1 . \]
No $p_i$ divides $N$, since each leaves remainder $1$. Yet $N > 1$ has a
prime factor, and it is none of the $p_i$ -- a contradiction.
\end{proof}
\end{webpane}
\end{webaccordion}
The same idea shows that there are infinitely many primes of the form
$4k + 3$, though not, without more work, of the form $4k + 1$.
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
\section*{Looks and motion}
Switching panes is animated: the accordion's height eases from one pane to
the next, the old pane fades out and the new one slides in. The text after
the accordion moves with it. Readers who ask their system for less motion
get a plain switch.
The look is chosen in the source. \texttt{variant=card} draws a filled box,
\texttt{outline} a box with an edge only, and \texttt{accent} a coloured bar
with a tint. \texttt{motion=} is \texttt{slide} (the default),
\texttt{fade} or \texttt{none}. A CSS custom property can be set in the same
place, such as the accent colour.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{webaccordion}[variant=accent, motion=fade, --rtx-accent=#c2410c]
\begin{webpane}[question]
\noindent\textbf{Is every even number above 2 a sum of two primes?}
Nobody knows. \webnextpane[What is known]
\end{webpane}
\begin{webpane}[answer]
\noindent\textbf{Is every even number above 2 a sum of two primes?}
This is Goldbach's conjecture, checked by computer up to $4 \cdot 10^{18}$.
Every odd number above 5 is a sum of three primes (Helfgott, 2013).
\webprevpane[Less]
\end{webpane}
\end{webaccordion}
{{< /latex >}}

The same settings work from a stylesheet, for a whole site or one kind of
block. The companion's stylesheet defines a few tokens that everything else
is made of:

```css
:root {
  --rtx-accent: #2f6fdb;          /* the accent bar */
  --rtx-radius: 6px;              /* corners of every box */
  --rtx-duration: 200ms;          /* every movement */
}
.latex-stream[data-kind="accordion"] {
  --rtx-accordion-motion: fade;   /* slide · fade · none */
  --rtx-box-padding: .6em 1em;    /* this kind's boxes only */
}
/* The pane showing, and each pane's state, are on the elements: */
.rtx-accordion[data-pane="answer"] { … }
.rtx-pane[data-state="open"] { … }
```

{{< latex preamble="webfirst" >}}
\section*{In print}
A PDF prints one pane: the last, the fullest, unless \texttt{print=} names
another. The links are left out, and so is anything inside them: the proof
above puts its link in its heading, \verb|[\proofname\webpanelink{prev}{ (hide)}]|,
with the space inside the link, so the PDF reads \emph{Proof.} and nothing
more. Printing the web page shows the same pane as the PDF.
The option \texttt{initial=} picks the pane shown first (default: the first).
{{< /latex >}}

