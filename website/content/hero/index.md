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
Reflow\,\TeX{} sets real \LaTeX{} in your browser -- every glyph, kern, and
$e^{i\pi}+1=0$ from a genuine \TeX{} run -- then re-breaks each paragraph
\emph{live}, with the Knuth--Plass algorithm.
{{< /latex >}}
