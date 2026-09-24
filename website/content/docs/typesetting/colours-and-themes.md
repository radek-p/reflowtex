---
title: Colours and themes
weight: 70
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Colours and themes}
\bigskip
Black text takes the page's text colour, so a dark theme works without any
configuration. Colours chosen by the author are kept, and a \emph{colour
map} can replace them per theme, so that \verb|\textcolor{blue}| stays
readable on a dark background. The switch above the example changes the
theme of the example only; the one in the corner changes the whole page.
{{< /latex >}}

{{< latex preamble="docs" show-source="true" themes="light,dark,sepia,contrast" >}}
A \textcolor{blue}{blue remark}, a \textcolor{red}{red warning}, and
colour inside mathematics:
\[
  \textcolor{blue}{a^2} + \textcolor{red}{b^2} = c^2 .
\]
And \emph{tints}, \verb|blue!20!white| and \verb|red!20!white|, shading a
picture of a wave tunnelling through a barrier.
\begin{center}
\begin{tikzpicture}[x=1cm, y=1cm]
  % where the wave may travel, and the barrier it tunnels through
  \fill[blue!20!white] (0,0) rectangle (3,1.7);
  \fill[red!20!white]  (3,0) rectangle (4.2,1.7);
  \fill[blue!20!white] (4.2,0) rectangle (7,1.7);
  % the potential, and the wave's energy
  \draw[red, thick] (0,0.25) -- (3,0.25) -- (3,1.35) -- (4.2,1.35) -- (4.2,0.25) -- (7,0.25);
  \draw[black!50, dashed] (0,0.8) -- (7,0.8) node[right] {$E$};
  % the wave function: oscillating, decaying inside the barrier, and out again smaller
  \draw[blue, thick, smooth, samples=90, domain=0:3]   plot (\x, {0.8+0.4*sin(deg(4*\x+2.137))});
  \draw[blue, thick, smooth, samples=30, domain=3:4.2] plot (\x, {0.8+0.4*exp(-1.6*(\x-3))});
  \draw[blue, thick, smooth, samples=90, domain=4.2:7] plot (\x, {0.8+0.059*sin(deg(4*(\x-4.2))+90)});
  \node[blue] at (1.1,1.45) {$\psi$};
  \node[red]  at (3.6,1.52) {$V_0$};
\end{tikzpicture}
\end{center}
{{< /latex >}}

{{< latex preamble="docs" >}}
A colour map is a small JSON file. For each theme it lists the colours to
replace. It also lists \emph{tints}: colours mixed with white, like
\verb|blue!20!white|, which are mixed again with the current background.
This site's map, \texttt{latex-color-maps/site.json}, is the default for
every block. Here is what it does to the blue and red of the example:
{{< /latex >}}

{{< color-map map="site" colors="#0000ff,#ff0000" >}}

{{< latex preamble="docs" >}}
In the file:
{{< /latex >}}

```json
{
  "colors": {
    "dark":     { "#0000ff": "#79c0ff", "#ff0000": "#ff7b72" },
    "sepia":    { "#0000ff": "#155e97", "#ff0000": "#c02d0c" },
    "contrast": { "#0000ff": "#0000b3", "#ff0000": "#b30000" }
  },
  "tints": { "#ccccff": ["#0000ff", 20], "#ffcccc": ["#ff0000", 20] }
}
```

{{< latex preamble="docs" >}}
A theme is a class on the page's \verb|<html>| element (\texttt{dark},
\texttt{sepia} or \texttt{contrast}), so switching themes only changes
styles; nothing is drawn again. The Theming section of \texttt{src/viewer/README.md}
has the details.
{{< /latex >}}

