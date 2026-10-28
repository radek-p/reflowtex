---
title: Colours and themes
weight: 130
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Colours and themes}
\bigskip
In the default theme every colour is TeX's own, as in the PDF: black text is
black, and links have the colours the document gave them. The other themes,
light, dark, sepia and contrast, each replace some colours by a
\emph{colour map}, so that \verb|\textcolor{blue}| stays readable on a dark
background, and give links a colour of their own. The options above the
example set its text size and theme, for the example only; the same options
in the corner set them for the whole page. There, \emph{System} follows the
system: one theme while it is light and another while it is dark, by default
the default theme and dark.
{{< /latex >}}

{{< latex preamble="docs" show-source="true" themes="default,light,dark,sepia,contrast" >}}
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
A colour map is a small piece of JSON. For each theme it lists the colours
to replace and how links look. It also lists \emph{tints}: colours mixed
with white, like \verb|blue!20!white|, which are mixed again with the
current background. The viewer has one built in, \texttt{reflowtex}, which
this site uses. Here is what it does to the blue and red of the example:
{{< /latex >}}

{{< color-map map="reflowtex" colors="#0000ff,#ff0000" >}}

{{< latex preamble="docs" >}}
A site can give its own, in \texttt{latex-color-maps/}; a theme it gives
replaces the built-in one. In the file:
{{< /latex >}}

```json
{
  "colors": {
    "dark":     { "#0000ff": "#79c0ff", "#ff0000": "#ff7b72" },
    "sepia":    { "#0000ff": "#155e97", "#ff0000": "#c02d0c" },
    "contrast": { "#0000ff": "#0000b3", "#ff0000": "#b30000" }
  },
  "links": {
    "dark":     { "color": "#9d9bff", "hover": "#c3c2ff", "underline": "hover" }
  },
  "tints": { "#ccccff": ["#0000ff", 20], "#ffcccc": ["#ff0000", 20] }
}
```

{{< latex preamble="docs" >}}
A theme is a class on the page's \verb|<html>| element (\texttt{light},
\texttt{dark}, \texttt{sepia} or \texttt{contrast}; none for the default
theme), so switching themes only changes styles; nothing is drawn again. The Theming section of \texttt{src/viewer/README.md}
has the details.
{{< /latex >}}

