# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Reflow TeX build environment: LuaTeX + Ghostscript + dvisvgm + Node on top of a
# small TeX Live scheme (scheme-basic, ~350MB) instead of scheme-full (~2.5GB).
# Used both as the Dev Container image (see .devcontainer/devcontainer.json)
# and standalone (docker build/run, CI) for anyone who doesn't want to install
# a TeX toolchain on their host at all.
#
# Runs as root: tlmgr installs into /usr/local/texlive, which the
# lualatex-autoinstall wrapper below (and anyone running `tlmgr install` by
# hand for a new package) needs write access to. This matches the upstream
# texlive/texlive image's own default rather than adding a sudo/chown layer on
# top of it.
# Pinned by digest so every build (CI included) uses the same TeX Live; bump
# it deliberately and rebuild the website when you do.
FROM texlive/texlive:latest-basic@sha256:d54587cc7093dee8cc41c3a6317a37eb33164baf89f7ef9ad7b2f798e8997c58

# ── LaTeX packages ───────────────────────────────────────────────────────────
# src/extract/template.tex always loads mathtools, amssymb and fontspec, and
# (for TikZ picture capture) pgf – every snippet needs these regardless of its
# own preamble. xcolor, unicode-math and lm-math cover what this repo's own
# examples/integrations preambles add on top (examples/demo/preamble.tex,
# the unicode-math path template.tex documents as an alternative to the
# legacy Type1 math route). amsmath, amscls, amsfonts, lm and luaotfload ship
# with scheme-basic already. dvisvgm (converts externalised TikZ pictures to
# SVG) is a separate tlmgr package, not part of any scheme-basic install.
# microtype is loaded by every website preamble (website/latex-preambles/).
#
# tlmgr exits 0 when some packages fail to download (mirror.ctan.org hands
# each request to a random mirror, and some are broken or behind), so the
# image could build without the packages it lists here. Check the files
# themselves, and retry the install before giving up.
RUN tlmgr update --self && \
    for attempt in 1 2 3; do \
      tlmgr install \
        mathtools \
        fontspec \
        unicode-math \
        lm-math \
        pgf \
        tikz-cd \
        xcolor \
        microtype \
        dvisvgm; \
      missing=; \
      for f in mathtools.sty fontspec.sty unicode-math.sty lualatex-math.sty \
               filehook.sty latinmodern-math.otf pgf.sty tikz-cd.sty xcolor.sty \
               microtype.sty; do \
        kpsewhich "$f" >/dev/null || missing="$missing $f"; \
      done; \
      [ -x "$(kpsewhich -var-value SELFAUTOLOC)/dvisvgm" ] || missing="$missing dvisvgm"; \
      [ -z "$missing" ] && break; \
      echo "tlmgr install left out:$missing (attempt $attempt/3)" >&2; \
      [ "$attempt" -lt 3 ] || exit 1; \
      sleep 10; \
    done && \
    tlmgr path add

# ── Node + PDF tools ─────────────────────────────────────────────────────────
# mutool (mupdf-tools): dvisvgm's PDF backend needs Ghostscript < 10.01.0 or
# mutool – the Debian testing Ghostscript this image's base pulls in (10.07.1)
# is too new for dvisvgm to drive directly, so mutool is what dvisvgm shells
# out to for reading the externalised TikZ picture PDFs it converts to SVG.
# Ghostscript itself normalises ICC-coloured included PDFs to DeviceRGB before
# dvisvgm sees them; without that pass, Figma fills are silently lost.
# nodejs + npm: the whole build runs on Node (22.18 or later: it runs the
# TypeScript sources directly); its packages are installed by `make
# node-deps`, and the tests' browsers (Playwright) when they are set up.
# Poppler's pdftotext: tools/pageless-pdf/check-against-paged.ts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript \
      poppler-utils \
      mupdf-tools \
      nodejs \
      npm \
      git \
      make \
    && rm -rf /var/lib/apt/lists/*

# ── Hugo ─────────────────────────────────────────────────────────────────────
# Needed for website/build.sh (the reflowtex.dev site) and `make hugo-demo`.
# Pinned .deb from upstream, like the Makefile pins PROTOBUFJS_VERSION – no
# Hugo package in Debian's repos is both current and available for both
# architectures. "extended" for its embedded LibSass, in case a future layout
# adds an SCSS pipeline; nothing here uses it today.
ARG HUGO_VERSION=0.164.0
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL -o /tmp/hugo.deb \
      "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-${arch}.deb"; \
    apt-get update && apt-get install -y --no-install-recommends /tmp/hugo.deb; \
    rm -f /tmp/hugo.deb; \
    rm -rf /var/lib/apt/lists/*

# ── Lazy package install fallback ────────────────────────────────────────────
# Shadows the real lualatex (still at /usr/bin/lualatex): on a missing-package
# failure it tlmgr-installs the owning package and retries, so a preamble that
# reaches for something not baked in above doesn't just fail. See the script
# for the bounded-retry logic; needs network the first time a package is used.
COPY docker/lualatex-autoinstall.sh /usr/local/bin/lualatex
RUN chmod +x /usr/local/bin/lualatex

WORKDIR /workspace
