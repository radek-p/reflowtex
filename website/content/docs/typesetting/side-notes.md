---
title: Side notes
weight: 66
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Side notes}
\bigskip
A \verb|\marginpar| is set in the margin, level with the line it was written
on, and typeset by \TeX{} at the margin's width. Where the window leaves no
margin, a small mark in the line opens it instead.
{{< /latex >}}

{{< latex preamble="docs" show-source="true" class="with-margin" >}}
The harmonic series $\sum_{n \ge 1} 1/n$ diverges, though very
slowly.\marginpar{\footnotesize Its partial sums grow like $\ln N$.} Its
terms tend to zero, which is not enough.
{{< /latex >}}

{{< latex preamble="docs" >}}
A page styles side notes with CSS, by \verb|.latex-margin-note|, and
\verb|[data-kind="marginpar"]| for these. It may also set the margin's
width and its distance from the text, as this example does, with
\verb|--latex-margin-width| and \verb|--latex-margin-gap| on the block.
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{DIY: a side note of your own}
With the companion package, \verb|\usepackage{reflowtex}|, a side note can
be a command of its own, drawn as the page likes. Any \cs{webaside} with the
parameter \verb|place=margin| goes in the margin like a \verb|\marginpar|;
the companion package's \verb|marginNote| then draws its kind with a
component. Here \cs{mysidenote} numbers its notes, puts the number in the
text, and the page draws the note with the number beside it.
{{< /latex >}}

{{< latex preamble="sidenote" show-source="true" class="with-margin" >}}
The sum of the reciprocals of the squares, $\sum_{n \ge 1} 1/n^2$, was
an open question for almost a century before Euler settled it in
1734.\mysidenote{The Basel problem, posed by Pietro Mengoli in 1650 and
named after Euler's home town.} He treated $\sin x / x$ as if it were a
polynomial with roots at $\pm\pi, \pm 2\pi, \dots$, compared coefficients,
and found the sum to be $\pi^2/6$. The argument was not rigorous at the
time, and Euler knew it.\mysidenote{He gave a rigorous proof in 1741.} The
same method gives the sums of $1/n^4$, $1/n^6$ and every even power; for
odd powers no such closed form is known, and whether $\sum 1/n^5$ is
irrational is still open.
{{< /latex >}}

{{< latex preamble="webfirst" >}}
The preamble:
{{< /latex >}}

{{< source preamble="sidenote" >}}

{{< latex preamble="webfirst" >}}
The page's script and its style:
{{< /latex >}}

{{< include file="examples/sidenote.js" >}}

{{< include file="examples/sidenote.css" >}}

{{< include file="examples/sidenote.css" as="style" >}}
{{< include file="examples/sidenote.js" as="module" >}}
