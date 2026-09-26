---
title: Citations and links
linkTitle: Citations and links
weight: 115
latexTitle: true
hideInNav: true
---

{{< latex preamble="links" >}}
\pagetitle[Showcase]{Citations and links}
\bigskip
Every link hyperref makes is a link on the page: a citation goes to its
entry in the bibliography, a reference to its theorem, equation or section,
\verb|\hyperref| and \verb|\hyperlink| to where they point. Point at a link
to see where it goes; press it to jump.
{{< /latex >}}

{{< latex preamble="links" show-source="true" >}}
\section{Sums of reciprocals}\label{sec:sums}
Euler found the sum of the reciprocals of the squares in
1734~\cite{euler1740}. \autoref{thm:basel} states it; a modern account is
in~\cite{aigner2018}, and the story of the problem in~\cite{dunham1999}.
The proof in \autoref{sec:proof} rests on the product
formula~\eqref{eq:product}.

\begin{theorem}[Euler~\cite{euler1740}]\label{thm:basel}
$\displaystyle \sum_{n \ge 1} \frac{1}{n^2} = \frac{\pi^2}{6}$.
\end{theorem}

\section{The proof}\label{sec:proof}
The sine is the product
\begin{equation}\label{eq:product}
  \frac{\sin x}{x} = \prod_{n \ge 1} \Bigl(1 - \frac{x^2}{n^2 \pi^2}\Bigr).
\end{equation}
Comparing the coefficients of $x^2$ on both sides gives the theorem; the
\hyperlink{last-step}{last step} is written out below. Why the problem has
the name it has is in \hyperref[sec:name]{the last section}.

\hypertarget{last-step}{The coefficient} of $x^2$ is $-1/6$ on the left
of~\eqref{eq:product} and $-\sum_{n \ge 1} 1/(n^2 \pi^2)$ on the right.

\section{The name}\label{sec:name}
Basel was the home of the Bernoullis, who made the problem
known~\cite{dunham1999}. More at
\url{https://en.wikipedia.org/wiki/Basel_problem}.

\begin{thebibliography}{9}
\bibitem{aigner2018} M.~Aigner and G.~M.~Ziegler.
  \emph{Proofs from THE BOOK}, 6th edition. Springer, 2018.
\bibitem{dunham1999} W.~Dunham.
  \emph{Euler: The Master of Us All}. MAA, 1999.
\bibitem{euler1740} L.~Euler. De summis serierum reciprocarum.
  \emph{Commentarii academiae scientiarum Petropolitanae} 7 (1740), 123--134.
\end{thebibliography}
{{< /latex >}}

{{< latex preamble="links" >}}
Nothing here is special to Reflow\,\TeX: the source is ordinary \LaTeX{} with
hyperref, and the links are the ones hyperref puts in the PDF. A link to a
page number has nowhere to go on a page without pages, so it stays text.
{{< /latex >}}
