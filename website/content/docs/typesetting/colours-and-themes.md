---
title: Colours and themes
weight: 70
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Colours and themes}
\bigskip
Text \TeX{} left black takes the page's own text colour, so a dark theme
works with no configuration. Colours the author chose are kept --- and can be
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
{{< /latex >}}

{{< latex preamble="docs" >}}
A colour map is a small JSON file: for each theme, which colours to replace,
and \emph{tints} --- colours \TeX{} mixed with the page, like
\verb|blue!20!white| --- re-mixed with whatever the page's background is now.
This site's map, \texttt{latex-color-maps/site.json}, is the default for
every block:
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
A theme is a class on the page's \verb|<html>| element --- \texttt{dark},
\texttt{sepia}, \texttt{contrast} --- so switching it restyles what is already
drawn, with no re-render. The Theming section of \texttt{src/viewer/README.md}
has the details.
{{< /latex >}}

