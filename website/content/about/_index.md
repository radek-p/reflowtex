---
title: About
latexTitle: true
---

{{< latex preamble="about" >}}
\pagetitle{About}
\bigskip
Reflow\,\TeX{} is an experiment in bringing genuine \TeX{} typesetting to the
open web: real line breaking, real mathematics, real fonts -- re-flowed to
the reader's screen instead of frozen in a PDF.
\section*{Where this is going}
\textbf{Today: a faithful imitation.} The viewer re-breaks every paragraph
with its own JavaScript implementation of the Knuth--Plass algorithm. It is a
careful port -- the same badness and demerits, the same fitness classes --
but it is still a re-implementation, with its own arithmetic, its own line
packing, and a simplified microtype layer. The breaks it picks are very close
to \TeX's; they are not guaranteed to be \TeX's.
\medskip

\textbf{Next: the real thing, in WebAssembly.} The plan is to replace that
approximation with a genuine \TeX{} paragraph breaker, compiled to
WebAssembly and running in the browser.
\medskip

\textbf{Why this works.} \TeX{} hyphenates, ligatures, and kerns a paragraph
\emph{before} it breaks it, and none of that depends on the line width. The
node list the build step already exports is precisely the input the breaker
expects, so one \TeX{} run yields a paragraph that can be re-broken at any
width by the same code that would have set it in print -- without porting
the hyphenation, language, or font machinery to the browser.
\section*{How it is built}
A Lua\LaTeX{} run records the finished node list, Protocol Buffers carry it
to the page, and the browser breaks it into lines. The repository's
\texttt{README} and \texttt{docs/} describe the design.
\section*{License}
Reflow\,\TeX{} is free software under the \textbf{GNU Affero General Public
License, version 3 or later} (AGPL-3.0-or-later). Bundled third-party
components (the protobuf.js runtime, the fonts a build ships) keep their own
permissive licenses.
\section*{Source and contact}
The source code is at
\href{https://github.com/radek-p/reflowtex}{github.com/radek-p/reflowtex}.
Questions and bug reports go to its
\href{https://github.com/radek-p/reflowtex/issues}{issue tracker}; security
reports, privately, through its
\href{https://github.com/radek-p/reflowtex/security}{Security tab}.
{{< /latex >}}
