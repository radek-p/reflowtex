---
title: Static site
weight: 20
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Getting started]{A static site}
\bigskip
The reference integration turns a directory of \texttt{.tex} snippets into a
self-contained site: one HTML page, the viewer, and the fonts the snippets
use. Each snippet becomes one block, in file-name order; a file named
\texttt{preamble.tex} is not a block but is prepended to every snippet's
preamble.
{{< /latex >}}

```sh
python integrations/vanilla/build.py examples/demo -o site
python -m http.server -d site          # or open site/index.html from disk
```

{{< latex preamble="docs" >}}
The page works at a domain root, under a subpath or opened from disk,
because fonts are found relative to the viewer script. To embed
blocks in a page of your own, follow the DOM contract in
\texttt{src/viewer/README.md}: one element per block carrying the encoded
node list, the schema once per page, and the two scripts.
{{< /latex >}}

