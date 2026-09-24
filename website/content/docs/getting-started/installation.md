---
title: Installation
weight: 10
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Getting started]{Installation}
\bigskip
The build step drives a real \TeX{} toolchain -- Lua\TeX, \texttt{dvisvgm},
Ghostscript, \texttt{protoc} -- plus Python for the encoder. The easiest way
to get all of it is the project's container: nothing to install but a
container runtime.
\section*{In a container}
With Docker (or OrbStack, Colima, Podman) available, from a checkout of the
repository:
{{< /latex >}}

```sh
docker compose run --rm reflowtex make check
docker compose run --rm --service-ports reflowtex make serve   # → http://localhost:8000
```

{{< latex preamble="docs" >}}
Open the address and resize the window: the demo text re-breaks live. A
snippet's preamble may \verb|\usepackage| anything; a package the image lacks is
installed with \texttt{tlmgr} the first time it is used.
\section*{Locally}
You need a \TeX{} installation (\texttt{lualatex}, \texttt{dvisvgm}),
Ghostscript, \texttt{protoc}, and Python 3.9 or later. Running \texttt{make check}
verifies them; \texttt{make venv} sets up the Python side in a project-local
\texttt{.venv}.

\medskip\noindent\textbf{macOS} (Homebrew):
{{< /latex >}}

```sh
brew install protobuf
brew install --cask mactex-no-gui
```

{{< latex preamble="docs" >}}
On macOS, Ghostscript 10.01 and later dropped the PDF interpreter
\texttt{dvisvgm} relies on for TikZ pictures; if pictures fail with a
page-count error, install \texttt{mutool} as the fallback:
{{< /latex >}}

```sh
brew install mupdf-tools
```

{{< latex preamble="docs" >}}
\noindent\textbf{Linux} (Debian/Ubuntu):
{{< /latex >}}

```sh
sudo apt install texlive-luatex texlive-latex-extra texlive-fonts-recommended \
                  texlive-extra-utils protobuf-compiler python3-venv
```

{{< latex preamble="docs" >}}
On Debian and Ubuntu, \texttt{texlive-extra-utils} carries \texttt{dvisvgm};
adjust the names for other distributions. The build compiles \LaTeX, which is
a programming language: if the snippets come from anyone but you, read
\texttt{docs/security.md} in the repository first.
{{< /latex >}}

