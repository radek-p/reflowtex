---
title: About
---

{{< latex >}}
Reflow\,\TeX{} is an experiment in bringing genuine \TeX{} typesetting to the
open web: real line breaking, real math, real fonts -- re-flowed to the reader's
screen instead of frozen in a PDF.
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
