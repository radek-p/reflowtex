---
title: Installation
weight: 10
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Getting started]{Installation}
\bigskip
The build needs Lua\TeX and Node. The simplest way to get them all is the project's container,
which needs only a container runtime.
\section*{In a container}
With Docker (or OrbStack, Colima, Podman) available, from a checkout of the
repository:
{{< /latex >}}

```sh
docker compose run --rm reflowtex make check
docker compose run --rm --service-ports reflowtex make serve   # → http://localhost:8000
```

{{< latex preamble="docs" >}}
Open the address and resize the window: the demo text re-breaks to fit. A
snippet's preamble may \verb|\usepackage| anything; a package the image lacks is
installed with \texttt{tlmgr} the first time it is used.
\section*{Locally}
You need a \TeX{} installation (\texttt{lualatex}) and Node 22.18 or later
(it runs the build's TypeScript directly; pictures are drawn by MuPDF, one of
its packages). Running \texttt{make check} verifies them, and installs the
build's Node packages into \texttt{node\_modules}.

\medskip\noindent\textbf{macOS} (Homebrew):
{{< /latex >}}

```sh
brew install node
brew install --cask mactex-no-gui
```

{{< latex preamble="docs" >}}
\noindent\textbf{Linux} (Debian/Ubuntu):
{{< /latex >}}

```sh
sudo apt install texlive-luatex texlive-latex-extra texlive-fonts-recommended \
                  nodejs npm
```

{{< latex preamble="docs" >}}
Adjust the names for other distributions. An older release's
\texttt{nodejs} may be below 22.18: \texttt{make check} says so, and
\texttt{nodejs.org} has current builds. The build compiles \LaTeX, which is
a programming language: if the snippets come from anyone but you, read
\texttt{docs/security.md} in the repository first.
{{< /latex >}}

