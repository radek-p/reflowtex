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
- **Reflowable.** Paragraphs re-break on resize; displays use width models
  recovered from several real TeX runs and scroll only when their content is
  genuinely too wide.
- **Self-contained.** The data is embedded in the page; no runtime fetches, works
  offline. The only client dependency is a vendored protobuf runtime.

> **Status: alpha.** The core is stable and tested; the integration surface and
> the on-disk formats may still change. Feedback welcome.

## Try it in one command

The build pipeline shells out to a real TeX toolchain (LuaTeX, dvisvgm,
protoc, Hugo for the website) — enough moving parts that the default,
recommended way to run it is in the provided container rather than installing
all of that on your machine. See [local install](#local-install) below if
you'd rather not use a container.

**1. Get a container runtime**, if you don't have one:

- **macOS:** [OrbStack](https://orbstack.dev) — `brew install orbstack`, or
  the installer from its site. Docker Desktop or
  [Colima](https://github.com/abiosoft/colima) (`brew install colima docker`)
  work too.
- **Linux:** Docker Engine — your distro's package (e.g. `apt install
  docker.io`) or the [official install script](https://docs.docker.com/engine/install/)
  (`curl -fsSL https://get.docker.com | sh`); add yourself to the `docker`
  group so it runs without `sudo`. [Podman](https://podman.io) works as a
  drop-in too.
- *(Windows isn't covered here yet — the container should still work under
  WSL2, just untested.)*

**2. Run the pipeline** — no local TeX Live, Python venv, or Hugo install
needed, the container has all of it:

```sh
docker compose run --rm reflowtex make check
docker compose run --rm --service-ports reflowtex make serve   # → http://localhost:8000
```

Open the URL and resize the window — the text re-breaks live. `.venv` lives
in its own named Docker volume rather than the bind-mounted repo, so it can't
collide with a `.venv` you might also build on the host outside the container.

**In VS Code** (Dev Containers extension, or OrbStack's Container Tools):
open the repo folder and run **Dev Containers: Reopen in Container** (or the
equivalent Container Tools command). It builds from `Dockerfile` /
`.devcontainer/devcontainer.json`; first build takes a few minutes, cached
after. The integrated terminal then has `make`, `lualatex`, `hugo`, etc., and
ports 8000 and 1313 forward to your host automatically.

A snippet's own preamble is free to `\usepackage` anything (see
[docs/architecture.md](docs/architecture.md)); if that pulls in a LaTeX
package the image doesn't already have, it's installed via `tlmgr` on the
spot and the run retried (see `docker/lualatex-autoinstall.sh`) — needs
network the first time a given package is used.

**Rebuilding the reflowtex.dev website from scratch:** the site's `baseURL`
bakes in a `/reflowtex/` path prefix, so serving `website/public` with a
plain static file server 404s on every asset — use Hugo's own dev server
instead, which rewrites the prefix to match:

```sh
docker compose run --rm reflowtex bash -lc 'make website-clean'
docker compose run --rm --service-ports reflowtex bash -lc 'cd website && hugo server --bind 0.0.0.0'
# → http://127.0.0.1:1313/reflowtex/
```

`make website-clean` forces every block to recompile, including the slow
multi-pass `testmath.tex`; for routine content edits use `make website`
instead (incremental), or `website/build.sh server --bind 0.0.0.0` to build
and serve in one step (equivalent to the two commands above, minus the forced
full rebuild — `--bind` is still needed so the dev server is reachable from
outside the container).

## Local install

If you'd rather not use a container, you need the [prerequisites](#prerequisites)
below on your own machine. Then:

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
| [`tests/linebreak/`](tests/linebreak/) | paragraph-breaking fixtures: captures TeX's exact breaks for byte-for-byte comparison |
| [`website/`](website/) | the project site; built in CI inside the container and deployed to GitHub Pages |
| [`docs/`](docs/) | architecture and format notes |

## Using it in a project

The simplest path is the **vanilla** integration — a directory of `.tex` snippets
becomes a self-contained static site:

```sh
python integrations/vanilla/build.py my-snippets/ -o site/
open site/index.html                 # self-contained — works straight off disk
```

For a **Hugo** site, copy two layout files and run the prebuild before `hugo` —
see [integrations/hugo/README.md](integrations/hugo/README.md). **Jekyll** is
planned. To embed blocks in a hand-written page, follow the DOM contract in
[src/viewer/README.md](src/viewer/README.md).

## Prerequisites

The build pipeline shells out to a real TeX toolchain:

- **LuaTeX** (`lualatex`) — TeX Live 2023+
- **Ghostscript** (`gs`) — normalises ICC-coloured included PDFs before SVG conversion
- **dvisvgm** — converts captured TikZ pages and included PDFs to SVG
- **protoc** — the Protocol Buffers compiler (`apt install protobuf-compiler`)
- **Python 3.10+** with the packages in
  [`src/encode/requirements.txt`](src/encode/requirements.txt), installed into a
  project-local virtualenv — `make venv` creates `.venv/` and installs them; every
  other `make` target (and `website/build.sh`) depends on it, so this happens
  automatically. To do it by hand: `python3 -m venv .venv && .venv/bin/pip install
  -r src/encode/requirements.txt`

The **browser** side has no build step and no external dependency beyond the
vendored `protobuf.min.js`.

`make check` verifies all of the above. The [container](#try-it-in-one-command)
described above has all of this baked in, if you'd rather not install it.

## License

Reflow TeX is licensed under the **GNU Affero General Public License v3.0 or
later** (AGPL-3.0-or-later). The full text is in [LICENSE](LICENSE).

Copyright © 2026 Radosław Piórkowski.

Third-party components (the vendored protobuf.js runtime, the bundled AMS
`testmath.tex` sample, and the fonts the build ships in each site) keep their own
licenses and are documented in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md);
their permissive terms are compatible with this project's copyleft license.
