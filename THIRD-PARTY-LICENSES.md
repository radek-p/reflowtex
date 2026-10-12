# Third-party components

Reflow TeX itself is licensed under the project [`LICENSE`](LICENSE)
(AGPL-3.0-or-later). It bundles and/or distributes the third-party components
below, each under its own license. These licenses are permissive and compatible
with a copyleft project license such as the AGPL-3.0: a permissive component may
be combined into a copyleft work, and keeps its own license and notice.

---

## Committed in this repository

### protobuf.js — `src/viewer/protobuf.min.js`

- **Version:** 8.7.1 (pinned; refresh with `make vendor-protobuf`)
- **Upstream:** https://github.com/protobufjs/protobuf.js
- **License:** BSD-3-Clause
- **Why vendored:** the browser viewer needs this runtime and has no build step;
  committing it keeps the browser side Node-free and offline. It is served to
  browsers by any site the build produces, so its notice below applies to the
  distributed site whether the file is vendored or installed from npm.

```
Copyright (c) 2016, Daniel Wirtz  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

### Preact, htm and Preact Signals — `src/inspector/vendor/preact.js`

- **Versions:** preact 10.29.8, htm 3.1.1, @preact/signals 2.11.2 (with
  @preact/signals-core), pinned in the Makefile and package.json; refresh
  the vendored file with `make vendor-inspector`
- **Upstream:** https://github.com/preactjs/preact,
  https://github.com/developit/htm, https://github.com/preactjs/signals
- **Licenses:** preact and the signals packages MIT; htm Apache-2.0
  (© 2018 Google Inc.; full text: https://www.apache.org/licenses/LICENSE-2.0)
- **Where:** vendored in one ES module for the inspector's panel, and
  bundled into the companion package's `companion.js` (built, not
  committed). Both are served by sites that use them, so these notices apply
  to the deployed files.

```
The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```
The MIT License (MIT)

Copyright (c) 2022-present Preact Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### AMS `testmath.tex` — `examples/testmath/testmath.tex`

- **Version:** 2.0a (2023/08/24)
- **Author / copyright:** © 1995, 1999 American Mathematical Society;
  © 2023 LaTeX Project
- **Upstream:** the `amsmath` package on CTAN — https://ctan.org/pkg/amsmath
- **License:** LPPL 1.3c — https://www.latex-project.org/lppl/lppl-1-3c/
  (full text bundled at `examples/testmath/LPPL-1.3c.txt`)
- **Why bundled:** it is the demo input rendered by `examples/testmath/`. It is
  included **verbatim and unmodified**, with its own copyright/license header
  intact — a complete, unmodified copy, which the LPPL permits redistributing.
  The build does not alter the file; it splits it into preamble and body in
  memory at build time (see `examples/testmath/NOTICE.md`).

---

## Shipped by the build (not committed here)

The build compiles LaTeX with your TeX installation and copies the OTF fonts it
used into each site's `fonts/` directory (see `src/pipeline/fonts/fonts.ts`). Those fonts
are **redistributed in the built site**, so their licenses apply to whatever you
deploy — not to this repository, which contains none of them.

To keep that redistribution clean, the build serves an **unmodified** font
verbatim under its original name, and serves any font it **modifies** (the cmap
patching some glyphs need) under a *renamed*, content-hashed file — e.g.
`NewCMMath-Regular.reflowtex-1a2b3c4d.otf`, with a marker added to the font's
internal name records too. So a modified font never masquerades as the upstream
original, as the GUST/OFL licenses ask. A modified font is also subset to the
characters the site uses; its name records, and so that marker, are kept. You still need to carry each font's own
license/notice with a deployed site; which fonts appear depends on your documents.
The defaults in `src/extract/template.tex` are:

| Font | Typical license |
|---|---|
| Latin Modern (`lmroman*`, `lmmono*`) | GUST Font License (LPPL-like) |
| New Computer Modern (`NewCMMath-*`) | GUST Font License / SIL OFL |

Before deploying a site, confirm the license of every font your build actually
provisions and include the required notices with the deployed output. The exact
terms ship with your TeX distribution (e.g. `texdoc lm`, `texdoc newcomputermodern`).
