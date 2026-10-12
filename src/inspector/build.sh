#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Builds the inspector's committed scripts from its sources (src/inspector/src/):
#   inspector.js  the loader a page includes        (src/inspector.*, a classic script)
#   agent.js      the page-side half                (src/agent/, bundled into a classic script)
#   panel/*.js    the panel's ES modules            (src/panel/*, one module each)
# They are committed, so a site needs no Node; maintainers run this (`make
# build-inspector`) after editing a source. Each records, on its second line,
# the SHA-256 of the sources it was built from. esbuild drops ordinary
# comments: read the sources, not the output.
set -eu
cd "$(dirname "$0")"
ROOT=../..
ESBUILD="$ROOT/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || (cd "$ROOT" && npm ci --no-audit --no-fund)

sha=$(find src \( -name '*.js' -o -name '*.ts' \) | LC_ALL=C sort | while read -r f; do
        printf '%s\n' "$f"; cat "$f"; done | shasum -a 256 | cut -c1-64)
COMMON="--charset=utf8 --legal-comments=none --log-level=warning"

# (the generated file: its header, then esbuild's output, then $3 if given)
emit() {
    { echo '// SPDX-License-Identifier: AGPL-3.0-or-later'
      echo "// reflowtex inspector – GENERATED from src/inspector/$2 by esbuild (make build-inspector); sources sha256 $sha"
      cat "$1"
      if [ -n "${3:-}" ]; then echo "$3"; fi
    } > "$4"
    rm -f "$1"
}

entry() { for e in "$@"; do [ -e "$e" ] && { echo "$e"; return; }; done; }

src=$(entry src/inspector.ts src/inspector.js)
"$ESBUILD" "$src" --bundle --format=iife $COMMON --outfile=inspector.js.tmp
emit inspector.js.tmp "$src" "" inspector.js

# The agent's last statement installs it, so that the file's value, evaluated
# as a script, is the result ('ok', or 'no-api' without an inspectable viewer).
src=$(entry src/agent/index.ts src/agent/index.js)
"$ESBUILD" "$src" --bundle --format=iife $COMMON --outfile=agent.js.tmp
emit agent.js.tmp "src/agent/" "window.__rtxInspectorInstall();" agent.js

mkdir -p panel
rm -f panel/*.js
for f in src/panel/*.ts src/panel/*.js; do
    [ -e "$f" ] || continue
    name=$(basename "$f"); name=${name%.*}
    "$ESBUILD" "$f" --format=esm $COMMON --outfile="panel/$name.js.tmp"
    emit "panel/$name.js.tmp" "$f" "" "panel/$name.js"
done
echo "wrote src/inspector/inspector.js, agent.js and panel/ ($(cat inspector.js agent.js panel/*.js | wc -c | tr -d ' ') bytes)"
