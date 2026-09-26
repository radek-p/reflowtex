#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Bundles the companion's TypeScript (src/companion/src/, entry index.ts),
# with the Preact, htm and Preact Signals it re-exports, into the one ES
# module pages import as 'reflowtex/companion': src/companion/companion.js.
# The bundle is committed, so site builders never need Node; maintainers run
# this (`make build-companion`) after editing a module. Its second line
# records the SHA-256 of the sources it was built from. Read the sources,
# not the bundle (it is minified).
set -eu
cd "$(dirname "$0")"
ROOT=../..
[ -x "$ROOT/node_modules/.bin/esbuild" ] || (cd "$ROOT" && npm ci --no-audit --no-fund)

sha=$(find src \( -name '*.ts' -o -name '*.tsx' \) | LC_ALL=C sort | while read -r f; do
        printf '%s\n' "$f"; cat "$f"; done | shasum -a 256 | cut -c1-64)

"$ROOT/node_modules/.bin/esbuild" src/index.ts --bundle --format=esm --minify \
    --jsx=automatic --jsx-import-source=preact --target=es2022 \
    --charset=utf8 --legal-comments=none --log-level=warning \
    --outfile=companion.js.tmp

{
    echo '// SPDX-License-Identifier: AGPL-3.0-or-later'
    echo "// reflowtex/companion – GENERATED from src/companion/src/ by esbuild (make build-companion); sources sha256 $sha"
    echo '// Bundles preact, htm and @preact/signals (MIT; see THIRD-PARTY-LICENSES.md).'
    cat companion.js.tmp
} > companion.js
rm -f companion.js.tmp
echo "wrote src/companion/companion.js ($(wc -c < companion.js | tr -d ' ') bytes)"
