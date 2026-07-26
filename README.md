# Reflow TeX

**Render real LaTeX on the web, and let it reflow to the reader's screen.**

[Website](https://radek-p.github.io/reflowtex/)

Reflow TeX compiles a LaTeX snippet with LuaTeX, captures the finished node list
(every glyph, kern, rule and box, with the exact positions TeX computed), and
ships it to the browser as a compact binary. A small JavaScript viewer then runs
the Knuth–Plass line-breaking algorithm *in the browser* and paints the result as
inline SVG. Because line breaking happens client-side, a paragraph re-breaks to
whatever width the page gives it — the math and microtypography stay exactly as
TeX set them.

- **Faithful.** Glyphs, spacing, fractions, accents, and TikZ pictures come from
  a genuine TeX run, not an approximation.
- **Reflowable.** Paragraphs re-break on resize; displays scroll when too wide.
- **Self-contained.** The data is embedded in the page; no runtime fetches, works
  offline. The only client dependency is a vendored protobuf runtime.

> **Status: alpha.** The core is stable and tested; the integration surface and
> the on-disk formats may still change. Feedback welcome.

## Try it in one command

You need the [prerequisites](#prerequisites) below. Then:

```sh
make check     # confirm lualatex, dvisvgm, protoc, python deps are present
make serve     # compile examples/demo and serve it at http://localhost:8000
```

Open the URL and resize the window — the text re-breaks live.

## How it fits together

```
  LaTeX snippet
       │  lualatex + serializer.lua          ┐
       ▼                                     │  src/extract
  output.json  (the finished node list)      ┘
       │  transforms.py  (strip · glyph-normalise · tikz→SVG)     ┐
       │  encode_pb.py   (→ Protocol Buffers, schema/latex.proto) │  src/encode
       ▼                                                          ┘
  nodelist.pb  (base64, embedded in the page)
       │  latex-viewer.js  (Knuth–Plass line breaking → inline SVG)  ┐
       ▼                                                             │  src/viewer
  rendered, reflowable math in the browser                           ┘
```

Everything under [`src/`](src/) is framework-agnostic. Each [`integrations/`](integrations/)
directory is a thin shell that drives `src/` for a particular site generator.

See [docs/architecture.md](docs/architecture.md) for the why, and
[docs/binary-format.md](docs/binary-format.md) for the wire format.

## Repository layout

| Path | What it is |
|---|---|
| [`src/extract/`](src/extract/) | LuaTeX serializer + the wrapper template (LaTeX → `output.json`) |
| [`src/schema/latex.proto`](src/schema/latex.proto) | the node-list schema — the single source of truth |
| [`src/encode/`](src/encode/) | the build pipeline: transforms, protobuf encoder, font handling |
| [`src/viewer/`](src/viewer/) | the browser renderer (`latex-viewer.js`) + vendored `protobuf.min.js` |
| [`integrations/vanilla/`](integrations/vanilla/) | reference integration: `.tex` snippets → a static site |
| [`integrations/hugo/`](integrations/hugo/) | Hugo shortcode + prebuild (also a runnable example) |
| [`integrations/jekyll/`](integrations/jekyll/) | Jekyll integration (planned — see its README) |
| [`examples/demo/`](examples/demo/) | the snippets `make demo` renders |
| [`examples/testmath/`](examples/testmath/) | AMS' `testmath.tex` rendered with classic CM fonts (`make testmath-demo`) |
| [`docs/`](docs/) | architecture and format notes |

## Using it in a project

The simplest path is the **vanilla** integration — a directory of `.tex` snippets
becomes a self-contained static site:

```sh
python integrations/vanilla/build.py my-snippets/ -o site/
python -m http.server -d site        # the viewer loads fonts from /fonts/, so serve at root
```

For a **Hugo** site, copy two layout files and run the prebuild before `hugo` —
see [integrations/hugo/README.md](integrations/hugo/README.md). **Jekyll** is
planned. To embed blocks in a hand-written page, follow the DOM contract in
[src/viewer/README.md](src/viewer/README.md).

## Prerequisites

The build pipeline shells out to a real TeX toolchain:

- **LuaTeX** (`lualatex`) — TeX Live 2023+
- **dvisvgm** — converts externalised TikZ pictures to SVG
- **protoc** — the Protocol Buffers compiler (`apt install protobuf-compiler`)
- **Python 3.10+** with the packages in
  [`src/encode/requirements.txt`](src/encode/requirements.txt), installed into a
  project-local virtualenv — `make venv` creates `.venv/` and installs them; every
  other `make` target (and `website/build.sh`) depends on it, so this happens
  automatically. To do it by hand: `python3 -m venv .venv && .venv/bin/pip install
  -r src/encode/requirements.txt`

The **browser** side has no build step and no external dependency beyond the
vendored `protobuf.min.js`.

`make check` verifies all of the above.

## License

Reflow TeX is licensed under the **GNU Affero General Public License v3.0 or
later** (AGPL-3.0-or-later). The full text is in [LICENSE](LICENSE).

Copyright © 2026 Radosław Piórkowski.

Third-party components (the vendored protobuf.js runtime, the bundled AMS
`testmath.tex` sample, and the fonts the build ships in each site) keep their own
licenses and are documented in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md);
their permissive terms are compatible with this project's copyleft license.
