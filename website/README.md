# Reflow TeX — landing site

The project's public site (Hugo), built to be hosted on **GitHub Pages**. Most of
its prose is set through the reflowtex pipeline itself — the page is its own demo.

## Build

```sh
./build.sh          # compile LaTeX blocks + hugo -> public/
./build.sh server   # live preview at the printed URL
```

`build.sh` vendors the shortcode and viewer partial from `../integrations/hugo`,
runs `prebuild.py` (which needs the pipeline prerequisites — `lualatex`,
`dvisvgm`, `protoc`, and the Python deps; see the repo `Makefile`'s `check`
target), then runs Hugo. Everything it generates is git-ignored, `public/`
included: the deployed site is built in CI, never committed.

The reproducible way to build it is inside the project container, which is
also what CI does:

```sh
docker compose run --rm reflowtex make website          # incremental
docker compose run --rm reflowtex make website-clean    # everything from scratch
```

`./build.sh server` rewrites `public/` with dev-server URLs while it runs;
that is fine, since `public/` is not tracked.

## What's here

| Path | |
|---|---|
| `content/_index.md` | home copy + feature grid (rendered via `{{< latex >}}`) |
| `content/hero/` | the headless hero paragraph (breathing-width reflow) |
| `content/{docs,examples,about}/` | getting-started, live demos, license/about |
| `static/testmath/` | standalone AMS `testmath.tex` demo (built by `build.sh`, served at `/testmath/`, linked from Examples) |
| `layouts/` | base template, home, page layouts, and the hero/nav/switch partials |
| `layouts/partials/hero.html` | the animated hero (ported from `experiments/26-reflow-tex-hero`) |

The reader controls from the vanilla output — **width**, **colour theme**, and
**text size** — are in the bottom-right corner and persist across pages.

## Before you publish

Set these to the real values (all currently placeholders):

- `baseURL` in `hugo.toml` — your Pages URL, e.g. `https://<user>.github.io/reflowtex/`.
  The viewer resolves font URLs against it, so a project subpath works.
- `params.github` and `params.reflowtexSource` in `hugo.toml` — the repository URL
  (used by the nav link and the AGPL-3.0 source-offer footer).

## Deploy

`.github/workflows/hugo.yml` (at the repo root) runs on every push to `main`:
it builds the project container image (cached between runs), runs
`make website` inside it, and publishes `website/public` to GitHub Pages.
The per-block build tree and the multi-pass testmath demo are cached
between runs, so only blocks whose content changed are recompiled. TeX Live
is pinned by image digest in the `Dockerfile`; bump it deliberately.
