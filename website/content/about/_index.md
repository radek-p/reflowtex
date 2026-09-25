---
title: About
latexTitle: true
---

{{< latex preamble="about" >}}
\pagetitle[Reflow\,\TeX]{About}
\bigskip
Reflow\,\TeX{} is an experiment: \LaTeX{} documents on the web, typeset by
\TeX, but with the lines broken for the reader's screen instead of fixed in
a PDF.
\section*{Plans}
\textbf{Now.} The viewer breaks paragraphs with its own JavaScript version
of the Knuth--Plass algorithm. It uses \TeX's badness, demerits and fitness
classes, but its arithmetic and line packing are its own, and its microtype
support is simplified. It usually picks the same breaks as \TeX, but not
always.
\medskip

\textbf{Next.} Replace it with \TeX's own paragraph builder, compiled to
WebAssembly and run in the browser.
\medskip

This can work because \TeX{} hyphenates a paragraph, forms its ligatures and
kerns it \emph{before} breaking it into lines, and none of that depends on
the line width. The node list the build already exports is what the line
breaker takes as input. So after one \TeX{} run, \TeX's own code can break
the paragraph at any width, and hyphenation, languages and fonts need not be
ported to the browser.
\section*{How it is built}
Lua\LaTeX{} records the finished node list, Protocol Buffers carry it to the
page, and the browser breaks it into lines. The repository's
\texttt{README} and \texttt{docs/} describe the design.
\section*{Licence}
Reflow\,\TeX{} is free software under the \textbf{GNU Affero General Public
License, version 3 or later} (AGPL-3.0-or-later). Bundled third-party
components (the protobuf.js runtime, the fonts a build ships) keep their own
permissive licences.
\section*{Source and contact}
The source code is at
\href{https://github.com/radek-p/reflowtex}{github.com/radek-p/reflowtex}.
Report bugs and ask questions on the
\href{https://github.com/radek-p/reflowtex/issues}{issue tracker}. Report
security problems privately, through the
\href{https://github.com/radek-p/reflowtex/security}{Security tab}.
{{< /latex >}}
