# Contributing to Reflow TeX

Thank you for your interest. Reflow TeX is in its initial phase of
development, and its direction is set by the maintainer, Radosław
Piórkowski. Contributions are welcome within that direction.

## Before you start

- **Open an issue first** for anything beyond a small fix, so we can agree on
  the approach before you spend time on it. A pull request that changes the
  design without prior discussion may be declined, however good the code.
- **Bug reports** are most useful with the LaTeX source that shows the
  problem, the browser, and what you expected to see.
- **Security reports**: please report privately, through the repository's
  Security tab, not in a public issue.

## The Contributor License Agreement

Every contribution needs a signed [Contributor License Agreement](CLA.md).
It grants the maintainer broad rights in what you contribute – including the
right to license it under terms other than the AGPL – so that the project's
licensing and direction stay under one control while it takes shape. You keep
the copyright in your contributions.

To sign, comment on your first pull request with:

> I have read the CLA Document and I hereby sign the CLA

A pull request cannot be merged before its author has signed.

## Working on the code

- `make check` verifies the toolchain; `make node-deps` installs the Node
  packages (every other target does it on first use). `npm run typecheck`
  and `npm test` check the TypeScript.
- The code is TypeScript, strict, on Node and in the browser alike. The
  browser's scripts are built from it where they are needed and never
  committed: the integrations, `make website` and the tests build them when
  missing or stale (`make build-viewer`, `make build-companion`,
  `make build-inspector` build on demand). [TS-MIGRATION.md](TS-MIGRATION.md)
  says what is generated, what stays JavaScript, and why.
- `make website` rebuilds the documentation site, which doubles as the
  broadest test: every page is compiled and rendered by the pipeline.
- New source files start with an SPDX header:
  `SPDX-License-Identifier: AGPL-3.0-or-later`.
- Keep commits focused, with a message that says what changed and why.

## CI

One workflow, **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)),
checks every push to main and every pull request:

- **typescript**: `npm run typecheck` and the unit tests, on Node alone;
- **render**: the capture tests, the backend conformance suite
  ([docs/backends.md](docs/backends.md)) and the render tests, every glyph
  against TeX's pageless PDF;
- **web**: the web tests, in Chromium, WebKit and Firefox.

**The image.** render and web run in the CI image, the Dockerfile's `test`
target (TeX Live with the tests' packages, Node, Hugo, the three browsers).
[`ci-image.yml`](.github/workflows/ci-image.yml) names it by a hash of what
goes into it – the `Dockerfile`, `docker/` and `package-lock.json` – as
`ghcr.io/<owner>/reflowtex-ci:<hash>`, in this repository's own package
registry, with the workflow's `GITHUB_TOKEN` (`packages: write`; no secret
to set up). When that tag is already there, nothing is built and every job
pulls it; only the first run after one of those files changed builds it
(with the GitHub Actions cache, so only the layers that changed), pushes it,
and lets the jobs go on. Docker Hub, where the pinned texlive base image
comes from, is asked only by such a build. Every pull and registry call is
retried, a while apart (`.github/scripts/ci-image.sh`), and so is a build.

On the first push after this setup, the image job builds the image once
(minutes: TeX Live, the browsers), and render and web wait for it; every run after that
starts by finding it. Each change to the image's inputs leaves the previous
tag in the registry: delete old ones in the package's settings now and then.
The package is private, as the repository's packages are by default; a pull
request from a fork can pull it, but cannot push a new one, so one that
changes the image's inputs needs a maintainer's push first.

**Deploy website** ([`hugo.yml`](.github/workflows/hugo.yml)) runs after CI
has run for a push to main, whatever its verdict: it pulls the same image and
takes CI's render results for the site's Tools › Render tests, so neither is
made twice.

**Nothing is fetched while tests run.** The TeX packages the tests' documents
load are installed when the image is built: the Dockerfile's own list, and
[`docker/test-packages.txt`](docker/test-packages.txt) for the tests' and
the website's documents. The image's `lualatex` installs a missing package
on first use (`docker/lualatex-autoinstall.sh`), but the tests turn that off
(`REFLOWTEX_NO_AUTOINSTALL`), so a fixture that needs a new package fails
with a message naming the list: add the package there. To find what a new
fixture needs, run its tests with `REFLOWTEX_NO_AUTOINSTALL=0
REFLOWTEX_AUTOINSTALL_LOG=<file>`: each package installed is logged. The
browsers are in the image too, and the browser's scripts are built from the
checkout (below).

**The browser's scripts are not committed.** `latex-viewer.js` and its
minified copy, `companion.js` and the inspector's scripts are built from
their TypeScript (`src/pipeline/bundles.ts`) by whatever needs them – the
integrations, `make website`, the tests' set-up – when they are missing or
were built from other sources. A unit test checks that none is tracked.

**Releases.** Pushing a tag `v<version>` runs
[`release.yml`](.github/workflows/release.yml): it builds the scripts with
that version in their headers and attaches them to a GitHub Release of the
tag (`latex-viewer-<version>.js` and `.min.js`, the companion and the
inspector as archives), with their SHA-256 sums and a note on their
licences, which links the tag as their source.
