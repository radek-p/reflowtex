---
title: The AMS testmath.tex
linkTitle: testmath.tex
weight: 110
latexTitle: true
toc: true
widthControl: true
hideInNav: true
aliases: ["/testmath/"]
---

{{< latex preamble="about" >}}
\pagetitle[Showcase]{The AMS \texttt{testmath.tex}}
\bigskip
The sample paper of the \texttt{amsmath} package, unchanged, with its own
preamble, Computer Modern fonts, cross-references and a footnote. The file
is a complete document, so it is compiled as one. How closely the browser
follows LuaTeX's own PDF of it, glyph by glyph, is measured on
\href{../accuracy/}{How close to the PDF?}

This page shows it with one line of source, plus a one-line preamble that
adds microtype:
{{< /latex >}}

```markdown
{{</* latex file="testmath.tex" preamble="microtype" /*/>}}
```

```latex
% latex-preambles/microtype.tex
\usepackage{microtype}
```

{{< inspect label="Inspect its boxes and glue" >}}
{{< latex file="testmath.tex" preamble="microtype" />}}
