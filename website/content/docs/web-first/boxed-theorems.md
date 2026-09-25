---
title: Boxed theorems
weight: 40
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Companion package]{Boxed theorems}
\bigskip
The declaration \cs{DeclareWebBox} makes an environment a box on the web,
with a coloured left border; the source of the environment's uses does not
change, and in print \cs{DeclareWebBox} changes nothing. This example's preamble boxes
every theorem and proof, and makes one boxed copy of \texttt{theorem} with a
colour of its own:
{{< /latex >}}

```latex
\usepackage[boxed]{reflowtex}
\DeclareWebBox[keytheorem]{theorem}[accent=#c2410c, class=key]
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
A nested box, like the claim inside the proof, is a little narrower at each
level; the space \LaTeX{} puts around an environment stays outside its box,
and a proof's QED box stays inside.
\section*{Three ways to use it}
{{< /latex >}}

```latex
\DeclareWebBox{theorem}                  % every theorem in the document
\DeclareWebBox[keytheorem]{theorem}      % a boxed copy; theorem itself stays plain
\DeclareWebBox{lemma}[accent=#3b8a55]    % with options
```

{{< latex preamble="webfirst" >}}
Without the optional first argument the environment itself is boxed,
everywhere. With it, \cs{DeclareWebBox} defines a new environment, a copy that
shares the original's counter and heading, and boxes only the copy. This is
for the few theorems that should stand out, like Wedderburn's above. The package
option \texttt{boxed} boxes every environment made with
\cs{newtheorem} and every \texttt{proof}.
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
