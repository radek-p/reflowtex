---
title: Lean beside a proof
weight: 45
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Lean beside a proof}
\bigskip
A theorem, its proof and the Lean code that checks it, in one place. The
reader sees the theorem; two switches hanging under its frame, \emph{Proof}
and \emph{Lean}, open either one beneath it, or both --- side by side on a wide
screen, one under the other on a narrow one. Try them.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{leantheorem}[decl=sum_odd]
\begin{theorem}
The sum of the first $n$ odd numbers is $n^2$.
\end{theorem}
\begin{proof}
By induction on $n$. For $n = 0$ both sides are $0$. If the sum of the
first $k$ odd numbers is $k^2$, adding the next one gives
\[ k^2 + (2k + 1) = (k + 1)^2 . \]
\end{proof}
\begin{leancode}
theorem sum_odd (n : ℕ) :
    ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := by
  induction n with
  | zero => simp
  | succ k ih =>
    rw [Finset.sum_range_succ, ih]  -- peel off the last term
    ring
\end{leancode}
\end{leantheorem}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
The environment \texttt{leantheorem} wraps an ordinary theorem, its proof and a
\texttt{leancode} block; everything before \verb|\begin{proof}| is the
statement. The Lean code sits in a frame like the proof's, in a colour of its
own. It is never typeset: it is read verbatim, indentation and all, and shown
as text --- highlighted, and selectable, so it can be copied into an editor.
Three keys set it up: \texttt{decl=} names the declaration above the code,
\texttt{url=} makes that name a link (to its documentation, say), and
\texttt{show=} sets what is open at first: \texttt{none} (the default here),
\texttt{proof}, \texttt{lean} or \texttt{both}.
\section*{A proof on its own}
When a proof stands away from its theorem --- after a discussion, say ---
\texttt{leanproof} gives it the same switches, on a line of their own
above it. It starts with the proof shown.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
\begin{leanproof}[decl=two_add_two]
\begin{proof}
Both sides are the numeral $4$ once the addition is carried out.
\end{proof}
\begin{leancode}
example : 2 + 2 = 4 := rfl
\end{leancode}
\end{leanproof}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{In print}
A PDF shows the theorem and the proof as usual, followed by the code as a
verbatim listing. The package option \texttt{leanprint=false} leaves the
code out:
{{< /latex >}}

```latex
\usepackage[leanprint=false]{reflowtex}
```

{{< latex preamble="webfirst" >}}
Lean's Unicode symbols ($\mathbb{N}$, $\sum$, $\in$) need a monospaced font
that has them, as with any listing: compile with Lua\LaTeX{} and a font such
as DejaVu Sans Mono (\verb|\setmonofont| from \texttt{fontspec}).
\section*{Blueprints}
Formalisation projects often describe their progress with Patrick Massot's
\texttt{leanblueprint}, whose macros tie a statement to a Lean declaration:
\verb|\lean{Nat.sum_odd}|, \verb|\leanok|, \verb|\uses{thm:a,lem:b}|,
\verb|\proves{…}|, \verb|\notready|, \verb|\mathlibok|. The package defines
them, as markers with no output, when a document has not, so a blueprint's
sources compile here unchanged; \texttt{leantheorem} and \texttt{leanproof}
then add the code itself wherever it should show.
{{< /latex >}}
