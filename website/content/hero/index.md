---
title: hero
# Headless: never rendered to its own URL, but its .Content is pulled into the
# home layout's hero by partials/hero.html (site.GetPage "/hero"). prebuild.py
# still scans and compiles the LaTeX block below.
build:
  render: never
  list: never
---

{{< latex >}}
\fontsize{15}{20}\selectfont
Reflow\,\TeX{} shows \LaTeX{} documents in the browser. \TeX{} typesets
the text and formulas such as $e^{i\pi}+1=0$; the browser breaks each
paragraph into lines with the Knuth--Plass algorithm, again whenever the
width changes.
{{< /latex >}}
