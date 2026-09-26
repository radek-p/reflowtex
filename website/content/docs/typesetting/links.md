---
title: Links
weight: 60
latexTitle: true
aliases: ["/docs/typesetting/links-and-footnotes/"]
---

{{< latex preamble="links" >}}
\pagetitle[Typesetting]{Links}
\bigskip
Cross-references and hyperlinks become links: \verb|\ref|, \verb|\eqref|
and \verb|\autoref| to a \verb|\label|, \verb|\href| or \verb|\url| to
an address, and with hyperref loaded, every other link it makes: a
\verb|\cite| to its entry in the bibliography, \verb|\hyperref| to a label,
\verb|\hyperlink| to a \verb|\hypertarget|. A link lights up as a whole when
you point at it, even when it is split across lines, and each \verb|\label|
becomes an anchor on the page.
{{< /latex >}}

{{< latex preamble="links" show-source="true" >}}
\section{The Basel problem}\label{sec:basel}
\begin{theorem}[Euler]\label{thm:basel}
$\displaystyle \sum_{n \ge 1} \frac{1}{n^2} = \frac{\pi^2}{6}$.
\end{theorem}
Euler's argument starts from the product
\begin{equation}\label{eq:sine}
  \frac{\sin x}{x} = \prod_{n \ge 1} \Bigl(1 - \frac{x^2}{n^2 \pi^2}\Bigr).
\end{equation}
The coefficient of $x^2$ on the left of~\eqref{eq:sine} is $-1/6$; on the
right it is $-\sum_{n \ge 1} 1/(n^2\pi^2)$, and \autoref{thm:basel} follows.
\autoref{sec:basel} is Section~\ref{sec:basel}, and \autoref{eq:sine} the
product formula. More on
\href{https://en.wikipedia.org/wiki/Basel_problem}{the Basel problem} on
Wikipedia; displayed formulas in general on the page
\href{../displays/}{Displays}.
{{< /latex >}}

{{< latex preamble="links" show-source="true" >}}
\section*{Citations}
Euler summed the reciprocals of the squares~\cite{euler1740}; a modern
proof is in~\cite{aigner2018}, and the \hyperlink{note}{note below} says
where.

\hypertarget{note}{Note.} The chapter ``Three times $\pi^2/6$''
of~\cite{aigner2018} gives three proofs.

\begin{thebibliography}{9}
\bibitem{aigner2018} M.~Aigner and G.~M.~Ziegler.
  \emph{Proofs from THE BOOK}, 6th edition. Springer, 2018.
\bibitem{euler1740} L.~Euler. De summis serierum reciprocarum.
  \emph{Commentarii academiae scientiarum Petropolitanae} 7 (1740), 123--134.
\end{thebibliography}
{{< /latex >}}

{{< latex preamble="links" >}}
Point at a reference to see where it goes; press it to jump. A label on
another page of the same site resolves through the link map the Hugo
integration writes. A reference to a label that is not published anywhere
stays plain text, and so does a link to a page number, since a page
without pages has nowhere to send it. An address with no scheme, like
\verb|../displays/|, is relative to the page. All of it together, in one
short paper: \href{../../showcase/citations/}{Citations and links}.
{{< /latex >}}
