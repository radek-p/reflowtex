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
DEMOS="$REPO/examples/demo"                     # shared snippets for the docs pages
TESTMATH="$REPO/examples/testmath"               # testmath.tex, rendered on the Showcase page
BOOK="$REPO/examples/book"                       # the batch example (Books in parts)
SYMBOL="$REPO/examples/symbol"                   # a symbol of one's own (Symbols of your own)

# Python deps (protobuf, fonttools) live in the repo-root virtualenv, not the
# system interpreter. `make venv` (in $REPO) creates it; build it here too so
# this script works standalone. Needs Python 3.9+ (the floor of the protobuf
# and fonttools packages; macOS's bundled /usr/bin/python3 qualifies), so
# rebuild the venv if it's missing or was created with a too-old interpreter.
VENV="$REPO/.venv"
if [ -x "$VENV/bin/python3" ] && "$VENV/bin/python3" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
  :
else
  BASE_PYTHON="$("$REPO/scripts/find_python.sh")"
  echo "Creating $VENV with $BASE_PYTHON ($("$BASE_PYTHON" --version))"
  # Empty it rather than remove it: in the container .venv is a mount point
  # (a named volume, see docker-compose.yml), which cannot be unlinked.
  if [ -d "$VENV" ]; then find "$VENV" -mindepth 1 -delete; else rm -rf "$VENV"; fi
  "$BASE_PYTHON" -m venv "$VENV"
fi
PYTHON="$VENV/bin/python3"
if [ ! -f "$VENV/.deps-installed" ] || [ "$REPO/src/encode/requirements.txt" -nt "$VENV/.deps-installed" ]; then
  "$VENV/bin/pip" install --upgrade pip
  "$VENV/bin/pip" install -r "$REPO/src/encode/requirements.txt"
  touch "$VENV/.deps-installed"
fi

# 1. Vendor the shortcode + viewer partial from the Hugo integration (the docs'
#    "copy these two files into layouts/" step, done automatically).
mkdir -p "$SITE/layouts/shortcodes" "$SITE/layouts/partials"
cp "$HUGO_INT/layouts/shortcodes/latex.html"          "$SITE/layouts/shortcodes/latex.html"
cp "$HUGO_INT/layouts/partials/reflowtex-viewer.html" "$SITE/layouts/partials/reflowtex-viewer.html"
#    …and the floating inspector (src/inspector), which every page offers.
mkdir -p "$SITE/static/inspector"
cp "$REPO/src/inspector/inspector.js" "$REPO/src/inspector/inspector.css" "$REPO/src/inspector/agent.js" "$SITE/static/inspector/"

# 2. Compile all LaTeX blocks, embed the schema, provision + patch fonts.
#    Set PREBUILD_ARGS to pass extra flags (e.g. --force, --prune, -j 8).
# shellcheck disable=SC2086
"$PYTHON" "$HUGO_INT/prebuild.py" "$SITE" --demos-dir "$DEMOS" --demos-dir "$TESTMATH" --demos-dir "$BOOK" --demos-dir "$SYMBOL" ${PREBUILD_ARGS:-}

# 3. Build (or serve) the static site.
if [ "${1:-}" = "server" ]; then
  shift
  exec hugo server --source "$SITE" "$@"
fi
exec hugo --source "$SITE" --minify "$@"
