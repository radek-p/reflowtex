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
\texttt{protoc}, and Python 3.9+ with the packages in
\texttt{src/encode/requirements.txt}. Run \texttt{make check} to verify them, or
\texttt{make venv} to set up just the Python side -- it creates a project-local
\texttt{.venv} and installs into it; macOS's bundled \texttt{python3} is
recent enough.
{{< /latex >}}

**macOS** (Homebrew):

```sh
brew install protobuf
brew install --cask mactex-no-gui
```

{{< latex >}}
On macOS, Ghostscript 10.01 and later dropped the PDF interpreter
\texttt{dvisvgm} depends on for converting TikZ pictures; if TikZ blocks fail
with a page-count error, install \texttt{mutool} as the fallback:
{{< /latex >}}

```sh
brew install mupdf-tools
```

**Linux** (Debian/Ubuntu):

```sh
sudo apt install texlive-luatex texlive-latex-extra texlive-fonts-recommended \
                  texlive-extra-utils protobuf-compiler python3-venv
```

{{< latex >}}
\texttt{texlive-extra-utils} is what carries \texttt{dvisvgm} on Debian/Ubuntu;
adjust package names for other distributions.
{{< /latex >}}

## The vanilla integration

{{< latex >}}
Point the reference build at a directory of \texttt{.tex} snippets and it emits a
self-contained static site -- one HTML page, the viewer, and the fonts:
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
