#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Bundles the viewer's modules (src/viewer/src/, entry index.js) into the one
# classic script integrations ship, src/viewer/latex-viewer.js. The bundle is
# committed, so site builders never need Node; maintainers run this (through
# `make build-viewer`) after editing a module. Its second line records the
# SHA-256 of the sources it was built from, and pipeline.viewer_script() warns
# when that no longer matches (see viewer_sources_sha256 there: both hash
# every src/**/*.js as "path\n" + contents, in byte order of the paths).
#
# esbuild drops ordinary comments, so read the modules, not the bundle.
set -eu
cd "$(dirname "$0")"
: "${ESBUILD_VERSION:?set ESBUILD_VERSION (the Makefile pins it)}"

sha=$(find src -name '*.js' | LC_ALL=C sort | while read -r f; do
        printf '%s\n' "$f"; cat "$f"; done | shasum -a 256 | cut -c1-64)

npx --yes "esbuild@$ESBUILD_VERSION" src/index.js --bundle --format=iife \
    --charset=utf8 --legal-comments=none --log-level=warning \
    --outfile=latex-viewer.js.tmp

{
    echo '// SPDX-License-Identifier: AGPL-3.0-or-later'
    echo "// reflowtex latex-viewer.js – GENERATED from src/viewer/src/ by esbuild@$ESBUILD_VERSION (make build-viewer); sources sha256 $sha"
    echo "'use strict';"
    cat latex-viewer.js.tmp
} > latex-viewer.js
rm -f latex-viewer.js.tmp
echo "wrote src/viewer/latex-viewer.js ($(wc -l < latex-viewer.js | tr -d ' ') lines, $(wc -c < latex-viewer.js | tr -d ' ') bytes)"
