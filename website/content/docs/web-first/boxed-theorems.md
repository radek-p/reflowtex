---
title: Boxed theorems
weight: 40
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Boxed theorems}
\bigskip
The command \cs{makeboxed} draws an environment as a box with a coloured left border.
The source of the environment's uses does not change. A box inside a box ---
a claim inside a proof --- is a little narrower per level; the space
\LaTeX{} puts around the environment stays outside the box, and a proof's QED
box stays inside. In print \cs{makeboxed} changes nothing.
\section*{Three ways to use it}
{{< /latex >}}

```latex
\makeboxed{theorem}                  % every theorem in the document
\makeboxed[keytheorem]{theorem}      % a boxed copy; theorem itself stays plain
\makeboxed{lemma}[accent=#3b8a55]    % with options
```

{{< latex preamble="webfirst" >}}
Without the optional first argument the environment itself is boxed,
everywhere. With it, \cs{makeboxed} defines a new environment, a copy that
shares the original's counter and heading, and boxes only the copy --- for the
few theorems that deserve to stand out. The package option
\texttt{boxedtheorems} boxes every environment made with \cs{newtheorem} and
every \texttt{proof}; this page uses it, and also defines a copy:
{{< /latex >}}

```latex
\usepackage[boxedtheorems]{reflowtex}
\makeboxed[keytheorem]{theorem}[accent=#c2410c, class=key]
```

{{< latex preamble="webfirst" show-source="true" >}}
\begin{theorem}
Every finite integral domain is a field.
\end{theorem}
\begin{proof}
Let $D$ be a finite integral domain and $a \neq 0$ in $D$.
\begin{claim}
The map $x \mapsto ax$ is a bijection of $D$.
\end{claim}
\begin{proof}
If $ax = ay$ then $a(x-y) = 0$, so $x = y$, as $D$ has no zero divisors.
An injective map of a finite set to itself is onto.
\end{proof}
So some $x$ has $ax = 1$, and $a$ is invertible.
\end{proof}
\begin{keytheorem}[Wedderburn]
Every finite division ring is a field.
\end{keytheorem}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{Options}
\begin{description}
\item[\texttt{kind=}] the look: \texttt{theorem} (the default),
  \texttt{proof} (the default for an environment named \texttt{proof}),
  \texttt{note}, or a kind of your own page's CSS.
\item[\texttt{accent=}] the border colour, as \texttt{\#hex}.
\item[\texttt{background=}] the fill, as \texttt{\#hex}; by default a light
  tint of the accent.
\item[\texttt{class=}] CSS classes for the box, for anything else.
\end{description}
Each box also carries its environment's name as \texttt{data-env}, and the
defaults are custom properties a page can set:
{{< /latex >}}

```css
:root { --latex-theorem-accent: #7a4fb3; --latex-proof-accent: #8a8f98; }
.latex-stream[data-env="definition"] { --latex-box-accent: #3b8a55; }
.latex-stream.key { box-shadow: 0 1px 6px rgb(0 0 0 / 0.08); }
```
