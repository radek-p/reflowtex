#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build (or serve) the Reflow TeX landing site.
#
#   ./build.sh            # compile LaTeX blocks + `hugo` -> public/
#   ./build.sh server     # …then `hugo server` for live preview
#
# It vendors the two canonical integration layout files (the shortcode and the
# viewer partial) so there is a single source of truth, runs the reflowtex Hugo
# prebuild to compile every {{< latex >}} block and provision fonts, then hands
# off to hugo. Anything it generates is git-ignored (see .gitignore).
set -euo pipefail

SITE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SITE/.." && pwd)"                 # reflowtex/
HUGO_INT="$REPO/integrations/hugo"
DEMOS="$REPO/examples/demo"                     # shared snippets for examples/

# 1. Vendor the shortcode + viewer partial from the Hugo integration (the docs'
#    "copy these two files into layouts/" step, done automatically).
mkdir -p "$SITE/layouts/shortcodes" "$SITE/layouts/partials"
cp "$HUGO_INT/layouts/shortcodes/latex.html"          "$SITE/layouts/shortcodes/latex.html"
cp "$HUGO_INT/layouts/partials/reflowtex-viewer.html" "$SITE/layouts/partials/reflowtex-viewer.html"

# 2. Compile all LaTeX blocks, embed the schema, provision + patch fonts.
#    Set PREBUILD_ARGS to pass extra flags (e.g. --force, --prune, -j 8).
# shellcheck disable=SC2086
python3 "$HUGO_INT/prebuild.py" "$SITE" --demos-dir "$DEMOS" ${PREBUILD_ARGS:-}

# 2b. Build the standalone testmath.tex demo (the AMS sample paper, set in classic
#     Computer Modern via the legacy Type1 path, multi-pass) into static/ so Hugo
#     publishes it at /testmath/. It's a self-contained page with its own controls;
#     --fonts-base is relative so it works under the site's subpath. This is slow,
#     so it's skipped if already built — set FORCE_TESTMATH=1 to rebuild.
TESTMATH_OUT="$SITE/static/testmath"
if [ ! -f "$TESTMATH_OUT/index.html" ] || [ -n "${FORCE_TESTMATH:-}" ]; then
  python3 "$REPO/examples/testmath/build.py" --out "$TESTMATH_OUT" --fonts-base 'fonts/'
else
  echo "testmath demo already built ($TESTMATH_OUT) — set FORCE_TESTMATH=1 to rebuild"
fi

# 3. Build (or serve) the static site.
if [ "${1:-}" = "server" ]; then
  shift
  exec hugo server --source "$SITE" "$@"
fi
exec hugo --source "$SITE" --minify "$@"
