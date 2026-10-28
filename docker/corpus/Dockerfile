# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The paper corpus's image: frozen TeX Live 2025 with only the packages the
# corpus's papers read (texlive-packages.txt, made by tools/corpus/texlive.ts
# from a run's logs), and the tools of the CI image at the same versions
# (Ghostscript, Poppler, MuPDF's mutool, dvisvgm 3.6, Node, Playwright's
# Chromium), so that only TeX differs from the rest of CI. Small enough for
# a GitHub runner. Built with network; papers are compiled from it with
# --network none (tools/corpus/run.ts). Build context: the repository.
#
#     docker build -f docker/corpus/Dockerfile -t reflowtex-corpus .
#
# Everything fetched is pinned: Debian's packages from snapshot.debian.org at
# fixed moments, TeX Live 2025 from its final, frozen repository by the
# sha512 of its database (install-tl and tlmgr check every package against
# it), dvisvgm and Node by their checksums.

FROM debian:testing-20260918-slim@sha256:fcaae10ef02f2c0cc2e4cb291ade86c2d259143fb919ee4544a0236a90cc975a
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive NOPERLDOC=1 TEXLIVE_INSTALL_NO_CONTEXT_CACHE=1

# apt from snapshot.debian.org at one moment: `apt-snapshot <timestamp> [trixie]`
COPY --chmod=755 <<'EOF' /usr/local/sbin/apt-snapshot
set -eu
ts=$1
cat > /etc/apt/sources.list.d/debian.sources <<SRC
Types: deb
URIs: http://snapshot.debian.org/archive/debian/$ts
Suites: testing testing-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp

Types: deb
URIs: http://snapshot.debian.org/archive/debian-security/$ts
Suites: testing-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp
SRC
if [ "${2:-}" = trixie ]; then
  cat > /etc/apt/sources.list.d/playwright-trixie.sources <<SRC
Types: deb
URIs: http://snapshot.debian.org/archive/debian/$ts
Suites: trixie
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp
SRC
  printf 'Package: *\nPin: release n=trixie\nPin-Priority: 100\n' > /etc/apt/preferences.d/playwright-trixie
fi
printf '%s\n' 'Acquire::Check-Valid-Until "false";' 'Acquire::Retries "5";' 'Acquire::http::Timeout "120";' \
  > /etc/apt/apt.conf.d/80snapshot
apt-get update -qq
EOF

RUN apt-snapshot 20260920T040158Z && \
    apt-get install -qy --no-install-recommends curl ca-certificates perl fontconfig libfile-homedir-perl libyaml-tiny-perl \
      libunicode-linebreak-perl xz-utils && \
    rm -rf /var/lib/apt/lists/*
RUN apt-snapshot 20261012T190538Z && \
    apt-get install -y --no-install-recommends ghostscript poppler-utils mupdf-tools && \
    rm -rf /var/lib/apt/lists/* && \
    dpkg-query -W -f '${Version}\n' ghostscript | grep -qx '10.08.0~dfsg-2' && \
    dpkg-query -W -f '${Version}\n' mupdf-tools | grep -qx '1.28.2+ds1-2' && \
    dpkg-query -W -f '${Version}\n' poppler-utils | grep -qx '26.07.0-3'

# TeX Live 2025, frozen: scheme-basic, then the corpus's packages
ARG TL_REPO=https://ftp.tu-chemnitz.de/pub/tug/historic/systems/texlive/2025/tlnet-final
ARG TL_TLPDB_SHA512=2fb7adc54cff58fa55c5b7c1bd3034e1efd849d0b73535c8dcdf0d8a36f66998b7a578ae036ef24354641be5f3738b0ad1323b7318581d88a0e271d1ac12cb2b
RUN set -eux; \
    curl -fsSL "$TL_REPO/tlpkg/texlive.tlpdb.sha512" | grep -q "^$TL_TLPDB_SHA512 "; \
    mkdir /tmp/install-tl; cd /tmp/install-tl; \
    curl -fsSL "$TL_REPO/install-tl-unx.tar.gz" | tar -xz --strip-components=1; \
    printf '%s\n' 'selected_scheme scheme-basic' 'tlpdbopt_install_docfiles 0' 'tlpdbopt_install_srcfiles 0' \
      'tlpdbopt_autobackup 0' 'tlpdbopt_sys_bin /usr/bin' 'instopt_adjustpath 1' 'instopt_adjustrepo 0' > profile; \
    perl install-tl --no-interaction --profile profile --repository "$TL_REPO"; \
    cd /; rm -rf /tmp/install-tl; \
    tlmgr option repository "$TL_REPO"; \
    tlmgr --version | grep -q 'TeX Live (https://tug.org/texlive) version 2025'
COPY docker/corpus/texlive-packages.txt /opt/reflowtex/texlive-packages.txt
RUN set -eu; \
    curl -fsSL "$TL_REPO/tlpkg/texlive.tlpdb.sha512" | grep -q "^$TL_TLPDB_SHA512 "; \
    pkgs=$(sed -e 's/#.*//' /opt/reflowtex/texlive-packages.txt | tr -s ' \t' '\n' | grep -v '^$'); \
    for attempt in 1 2 3; do \
      tlmgr install $pkgs || true; \
      installed=$(tlmgr info --only-installed --data name); missing=; \
      for p in $pkgs; do echo "$installed" | grep -qx "$p" || missing="$missing $p"; done; \
      [ -z "$missing" ] && break; \
      echo "left out:$missing (attempt $attempt of 3)" >&2; [ $attempt = 3 ] && exit 1; sleep 10; \
    done; \
    tlmgr path add; \
    for f in fontspec.sty unicode-math.sty luamml-convert.lua pgf.sty xcolor.sty microtype.sty biblatex.sty; do \
      kpsewhich "$f" >/dev/null || { echo "missing: $f" >&2; exit 1; }; done; \
    command -v biber

# aastex631.cls (an AAS journal class) as TeX Live 2024 shipped it: TeX Live
# 2025 has only its successor, and a paper of the corpus asks for 6.3.1
ARG TL24_REPO=https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2024/tlnet-final
ARG TL24_TLPDB_SHA512=a6f2d2fd59b42c74cd5d4d11c56ac5b393cc3ee53c021b60ef1605dddcae5db427105d8ec8ae4af9d812dd4307e2ef7b646e00c2bd1b7947393186286a9aa5d0
ARG AASTEX631_CLS_SHA512=bcedf34bf35f10df5b405fe5a5e1540098442ac772ff911dfc9e6857c47f12f980dd26ca9ebacf5d5fa61abd6fda705cbb5ad6ea65715aa459fd2c86793bcf4f
ARG AASJOURNAL_BST_SHA512=4f75ab2d9f927d8b7c2b7fa0a1e4862642c83a3752939a313cd40be2eae0c52a728075531d81261772652256330b9a68ea6c8b8d910c61f4591a1c0bff3d47fa
ARG UA="reflowtex-corpus/0.1 (+https://github.com/radek-p/reflowtex)"
RUN set -eu; mkdir /tmp/aas; cd /tmp/aas; \
    curl -fsSL -A "$UA" -o texlive.tlpdb "$TL24_REPO/tlpkg/texlive.tlpdb"; \
    echo "$TL24_TLPDB_SHA512  texlive.tlpdb" | sha512sum -c -; \
    awk '/^name aastex$/{p=1} p&&/^$/{exit} p' texlive.tlpdb > aastex.tlpobj; \
    grep -qx 'revision 58057' aastex.tlpobj; \
    sum=$(sed -n 's/^containerchecksum //p' aastex.tlpobj); \
    curl -fsSL -A "$UA" -o aastex.tar.xz "$TL24_REPO/archive/aastex.tar.xz"; \
    echo "$sum  aastex.tar.xz" | sha512sum -c -; \
    xz -dc aastex.tar.xz | tar -x; \
    echo "$AASTEX631_CLS_SHA512  tex/latex/aastex/aastex631.cls" | sha512sum -c -; \
    echo "$AASJOURNAL_BST_SHA512  bibtex/bst/aastex/aasjournal.bst" | sha512sum -c -; \
    local=$(kpsewhich -var-value TEXMFLOCAL); \
    install -D -m 644 tex/latex/aastex/aastex631.cls "$local/tex/latex/aastex631/aastex631.cls"; \
    install -D -m 644 bibtex/bst/aastex/aasjournal.bst "$local/bibtex/bst/aastex631/aasjournal.bst"; \
    mktexlsr "$local"; cd /; rm -rf /tmp/aas; \
    for f in aastex631.cls aasjournal.bst; do kpsewhich "$f" >/dev/null || { echo "missing: $f" >&2; exit 1; }; done

# dvisvgm 3.6 (TeX Live 2026's, as the CI image has it), pinned by checksum
ARG DVISVGM_REPOS="https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2026/tlnet-final https://ftp.tu-chemnitz.de/pub/tex/systems/texlive/tlnet https://mirror.ctan.org/systems/texlive/tlnet"
ARG DVISVGM_SHA512_AARCH64=c14e2a2d31157e41957565e34441eded1b0f2356d7ff3896ad3bc8313ec56958fc74f951fab24eea3d49cbf3cb72fc3927130abeee2990bd7b7f90c7739d25f9
ARG DVISVGM_SHA512_X86_64=ddaf146f122e700db66a72825c4de155548ab77bb1fbce0d8a8c6b787cdce20e4ccf7d0a78ffd3ee9c3cc2e7e05ce93f7791462262de6c9ac06e257b37a13491
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      arm64) tl=aarch64-linux; sum=$DVISVGM_SHA512_AARCH64 ;; \
      amd64) tl=x86_64-linux; sum=$DVISVGM_SHA512_X86_64 ;; \
      *) echo "no dvisvgm pinned for this architecture" >&2; exit 1 ;; \
    esac; \
    bin=$(kpsewhich -var-value SELFAUTOLOC); [ "$(basename "$bin")" = "$tl" ]; \
    mkdir /tmp/dvisvgm; cd /tmp/dvisvgm; ok=; \
    for repo in $DVISVGM_REPOS; do \
      curl -fsSL -o p.tar.xz "$repo/archive/dvisvgm.$tl.tar.xz" || continue; \
      echo "$sum  p.tar.xz" | sha512sum -c - && { ok=1; break; }; \
    done; \
    [ -n "$ok" ] || { echo "no dvisvgm.$tl with the pinned checksum" >&2; exit 1; }; \
    xz -dc p.tar.xz | tar -x; install -m 755 "bin/$tl/dvisvgm" "$bin/dvisvgm"; \
    cd /; rm -rf /tmp/dvisvgm; \
    dvisvgm --version | grep -qx 'dvisvgm 3.6'

RUN (luaotfload-tool -u || true) && fc-cache -fs

ARG NODE_VERSION=24.14.1
RUN set -eux; \
    case "$(dpkg --print-architecture)" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) exit 1 ;; esac; \
    base="https://nodejs.org/dist/v${NODE_VERSION}"; file="node-v${NODE_VERSION}-linux-${arch}.tar.gz"; \
    curl -fsSL -o "/tmp/${file}" "${base}/${file}"; \
    curl -fsSL "${base}/SHASUMS256.txt" | grep " ${file}$" | (cd /tmp && sha256sum -c -); \
    tar -xzf "/tmp/${file}" -C /usr/local --strip-components=1 --no-same-owner --exclude CHANGELOG.md --exclude LICENSE --exclude README.md; \
    rm -f "/tmp/${file}"

# the lualatex wrapper the CI image has (it installs nothing when REFLOWTEX_NO_AUTOINSTALL=1, as the corpus runs it)
COPY --chmod=755 docker/lualatex-autoinstall.sh /usr/local/bin/lualatex

# Playwright's Chromium, at package-lock.json's version
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json docker/playwright-deps.sh /opt/playwright/
RUN apt-snapshot 20261012T190643Z trixie && \
    cd /opt/playwright && \
    npm ci --no-audit --no-fund --ignore-scripts && \
    sh playwright-deps.sh chromium && \
    npx playwright install chromium && \
    rm -rf /var/lib/apt/lists/* node_modules

WORKDIR /workspace
