---
title: Getting started
---

{{< latex >}}
Reflow\,\TeX{} has two halves: a \textbf{build step} that runs a real \TeX{} pass
and encodes the result, and a \textbf{viewer} (\texttt{latex-viewer.js}) that
re-flows it in the browser. You author LaTeX; the toolchain does the rest.
{{< /latex >}}

## Prerequisites

{{< latex >}}
A working \TeX{} installation (\texttt{lualatex}, \texttt{dvisvgm}),
\texttt{protoc}, and Python 3.10+ with the packages in
\texttt{src/encode/requirements.txt}. Run \texttt{make check} to verify them.
{{< /latex >}}

## The vanilla integration

{{< latex >}}
Point the reference build at a directory of \texttt{.tex} snippets and it emits a
self-contained static site --- one HTML page, the viewer, and the fonts:
{{< /latex >}}

```sh
python integrations/vanilla/build.py examples/demo -o site
python -m http.server -d site
```

## In a Hugo site

{{< latex >}}
Copy two files into your \texttt{layouts/}, include the viewer partial once per
page, and write LaTeX in a shortcode. Run \texttt{prebuild.py} before every
\texttt{hugo} build. This very site is built that way.
{{< /latex >}}

```markdown
{{</* latex */>}}
\[ e^{i\pi} + 1 = 0 \]
{{</* /latex */>}}
```

{{< latex >}}
See the \texttt{integrations/} directory in the repository for the Hugo and
Jekyll guides, and \texttt{docs/architecture.md} for how the pipeline works.
{{< /latex >}}
