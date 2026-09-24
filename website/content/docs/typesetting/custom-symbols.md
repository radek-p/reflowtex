---
title: Symbols of your own
weight: 45
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Typesetting]{Symbols of your own}
{{< /latex >}}

{{< latex preamble="../examples/symbol/preamble.tex" >}}
\noindent A symbol no font has can still be typeset: draw it as a glyph, save it as a
font, and use it like any other symbol. Here it is $\segment$, from a paper
on register automata: a single glyph, drawn to match the stroke weight of
$\exists$, which \TeX{} sets as a quantifier, subscript and all. The browser
draws the same outline.
{{< /latex >}}

{{< latex file="segment.tex" preamble="../examples/symbol/preamble.tex" />}}

{{< latex preamble="docs" >}}
\section*{How the example is made}
Three files: the font, a preamble that declares the symbol, and the text
that uses it.
{{< /latex >}}

```text
website/                               the Hugo site
├── latex-fonts/
│   └── SegmentSymbol.otf              the glyph, at U+01A7
└── content/docs/typesetting/
    └── custom-symbols.md              this page
examples/symbol/                       --demos-dir: where file="…" is found
├── preamble.tex                       declares \segment
└── segment.tex                        the text above
```

{{< tabs >}}
{{< tab "SegmentSymbol.otf" >}}{{< glyph-outline "glyphs/segment-symbol.svg" >}}{{< /tab >}}
{{< tab "preamble.tex" >}}{{< source file="../examples/symbol/preamble.tex" >}}{{< /tab >}}
{{< tab "segment.tex" >}}{{< source file="segment.tex" >}}{{< /tab >}}
{{% tab "custom-symbols.md" %}}
```markdown
{{</* latex file="segment.tex" preamble="../examples/symbol/preamble.tex" /*/>}}
```
{{% /tab %}}
{{< /tabs >}}

{{< latex preamble="docs" >}}
\section*{How it works}
\begin{description}
\item[The font.] One glyph, in OpenType, with the outline shown above:
  cubic curves on a 1000-unit em, 555 units wide. It sits at a real
  character, U+01A7, rather than a private one, so copying the symbol out of
  the page gives a character that means something elsewhere too.
\item[Found by name.] Every \texttt{.otf} in the site's
  \texttt{latex-fonts/} is placed next to each document the build compiles,
  so the preamble loads it by its file name alone, and the same file is
  served to the browser.
\item[A math symbol.] Declared as a symbol font, the glyph takes its script
  sizes from the math machinery, so it works in a subscript or a
  superscript as well.
\item[One outline.] \TeX{} sets the symbol with the font's metrics, and the
  browser draws it from the same file: nothing is traced again, and nothing
  is approximated.
\end{description}
{{< /latex >}}
