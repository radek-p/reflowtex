#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Record the Python pipeline's calls on the builds the parity tests replay
# (README.md, "Captured calls"): the website, testmath, the narrow-display
# examples and the OpenType-maths fixture. Needs lualatex and the venv.
set -eu
cd "$(dirname "$0")/../.."
make venv >/dev/null
PY=.venv/bin/python3
CAP=build/capture
rm -rf "$CAP" build/parity-testmath-site build/parity-dmn-site build/parity-otfmath-site
mkdir -p "$CAP" website/layouts/shortcodes website/layouts/partials
cp integrations/hugo/layouts/shortcodes/latex.html website/layouts/shortcodes/
cp integrations/hugo/layouts/partials/reflowtex-viewer.html website/layouts/partials/
rm -rf website/.reflowtex-build
$PY tests/parity/capture.py "$CAP/site" integrations/hugo/prebuild.py website \
    --demos-dir examples/demo --demos-dir examples/testmath --demos-dir examples/book \
    --demos-dir examples/symbol --force -j 8 > "$CAP/site.log" 2>&1
$PY tests/parity/capture.py "$CAP/testmath" examples/testmath/build.py -o build/parity-testmath-site > "$CAP/testmath.log" 2>&1
$PY tests/parity/capture.py "$CAP/dmn" integrations/vanilla/build.py examples/display-model-narrow -o build/parity-dmn-site > "$CAP/dmn.log" 2>&1
$PY tests/parity/capture.py "$CAP/otfmath" integrations/vanilla/build.py tests/parity/fixtures/otfmath -o build/parity-otfmath-site > "$CAP/otfmath.log" 2>&1
echo "captured: $(ls -d "$CAP"/*/*/ | wc -l | tr -d ' ') block(s)"
