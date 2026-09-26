#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Build the parity fixtures with the Python pipeline (see README.md): the
# demo examples through the vanilla integration, and testmath.
set -eu
cd "$(dirname "$0")/../.."
make venv >/dev/null
PY=.venv/bin/python3
mkdir -p build/parity
$PY integrations/vanilla/build.py examples/demo -o build/parity/demo-site --title parity >/dev/null
rm -rf build/parity/demo && mv build/parity/demo-site/_build build/parity/demo
echo "parity fixtures: $(ls build/parity/demo | wc -l | tr -d ' ') demo block(s) in build/parity/demo"
