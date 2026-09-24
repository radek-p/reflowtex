---
title: Colours and themes
weight: 70
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Colours and themes}
\bigskip
Text \TeX{} left black takes the page's own text colour, so a dark theme
works with no configuration. Colours the author chose are kept -- and can be
remapped per theme by a \emph{colour map}, so that \verb|\textcolor{blue}|
stays readable on a dark page. The switch above the example previews each
theme on the example alone; the one in the corner switches the whole page.
{{< /latex >}}

{{< latex preamble="docs" show-source="true" themes="light,dark,sepia,contrast" >}}
A \textcolor{blue}{blue remark}, a \textcolor{red}{red warning}, and
colour inside mathematics:
\[
  \textcolor{blue}{a^2} + \textcolor{red}{b^2} = c^2 .
\]
And \emph{tints} -- \verb|blue!20!white|, \verb|red!20!white| -- shading a
picture: a wave tunnelling through a barrier.
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
A colour map is a small JSON file: for each theme, which colours to replace,
and \emph{tints} -- colours \TeX{} mixed with the page, like
\verb|blue!20!white| -- re-mixed with whatever the page's background is now.
This site's map, \texttt{latex-color-maps/site.json}, is the default for
every block. Drawn, for the blue and the red of the example:
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
A theme is a class on the page's \verb|<html>| element -- \texttt{dark},
\texttt{sepia}, \texttt{contrast} -- so switching it restyles what is already
drawn, with no re-render. The Theming section of \texttt{src/viewer/README.md}
has the details.
{{< /latex >}}

