---
title: Reflow TeX – Hugo example
---

Every block below is the **same `.tex` file** the vanilla demo renders, pulled in
by `file="…"`. One set of snippets (`examples/demo/`) feeds both integrations:
`prebuild.py` compiles each once and the shortcode looks it up by name. Each
snippet carries its own `\section` heading, typeset by TeX.

{{< latex file="01-inline-math.tex" />}}

{{< latex file="02-display-equations.tex" />}}

{{< latex file="03-aligned-systems.tex" />}}

{{< latex file="04-tikz-picture.tex" />}}

{{< latex file="05-sections-and-spacing.tex" />}}
