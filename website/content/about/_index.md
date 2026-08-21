---
title: About
---

{{< latex >}}
Reflow\,\TeX{} is an experiment in bringing genuine \TeX{} typesetting to the
open web: real line breaking, real math, real fonts -- re-flowed to the reader's
screen instead of frozen in a PDF.
{{< /latex >}}

## Where this is going

{{< latex >}}
\textbf{Today: a faithful imitation.} The viewer re-breaks every paragraph
with its own JavaScript implementation of the Knuth--Plass algorithm. It is a
careful port -- the same badness and demerits, the same fitness classes -- but
it is still a re-implementation, with its own arithmetic, its own line packing,
and a simplified microtype layer. The breaks it picks are very close to
\TeX's; they are not guaranteed to be \TeX's.
{{< /latex >}}

{{< latex >}}
\textbf{Next: the real thing, in WebAssembly.} The plan is to replace that
approximation with a genuine \TeX{} paragraph breaker running in the browser --
and the engine it is being built around is Tectonic, the modern,
self-contained, MIT-licensed engine descended from XeTeX, which
Reflow\,\TeX{} itself may move to.
{{< /latex >}}

{{< latex >}}
\textbf{Why this works.} \TeX{} hyphenates, ligatures, and kerns a paragraph
\emph{before} it breaks it, and none of that depends on the line width. The
node list the build step already exports is precisely the input the breaker
expects, so one \TeX{} run yields a paragraph that can be re-broken at any
width by the same code that would have set it in print -- without porting the
hyphenation, language, or font machinery to the browser.
{{< /latex >}}

## License

{{< latex >}}
Reflow\,\TeX{} is free software under the \textbf{GNU Affero General Public
License, version 3 or later} (AGPL-3.0-or-later). Bundled third-party
components (the protobuf.js runtime, the fonts a build ships) keep their own
permissive licenses.
{{< /latex >}}

## Source & contact

- **Source code:** [{{< param github >}}]({{< param github >}})
- **Issues & questions:** use the repository's issue tracker
- **Security reports:** please report privately via the repository's Security tab

{{< latex >}}
Built with the reflowtex pipeline (\texttt{lualatex} $\to$ node list $\to$
Protocol Buffers $\to$ browser). See the repository's \texttt{README} and
\texttt{docs/} for the design.
{{< /latex >}}
