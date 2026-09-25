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
PAGELESS="$REPO/tools/pageless-pdf"               # the pageless PDF (Tools › Pageless PDF)
if [ ! -f "$VENV/.deps-installed" ] || [ "$REPO/src/encode/requirements.txt" -nt "$VENV/.deps-installed" ] \
   || [ "$PAGELESS/requirements.txt" -nt "$VENV/.deps-installed" ]; then
  "$VENV/bin/pip" install --upgrade pip
  "$VENV/bin/pip" install -r "$REPO/src/encode/requirements.txt" -r "$PAGELESS/requirements.txt"
  touch "$VENV/.deps-installed"
fi

# 1. Vendor the shortcode + viewer partial from the Hugo integration (the docs'
#    "copy these two files into layouts/" step, done automatically).
mkdir -p "$SITE/layouts/shortcodes" "$SITE/layouts/partials"
cp "$HUGO_INT/layouts/shortcodes/latex.html"          "$SITE/layouts/shortcodes/latex.html"
cp "$HUGO_INT/layouts/partials/reflowtex-viewer.html" "$SITE/layouts/partials/reflowtex-viewer.html"
#    …and the inspector (src/inspector), which every page offers. It is served
#    from a folder named by a hash of its files: its panel's ES modules import
#    each other by plain relative paths, which no ?v= can follow, so a new
#    version must be new URLs throughout – no browser then mixes a cached old
#    module with new ones. The partial reads the folder from data/inspector.json.
INSPECTOR_V="$("$PYTHON" - "$REPO/src/inspector" <<'PY'
import hashlib, pathlib, sys
root, h = pathlib.Path(sys.argv[1]), hashlib.sha256()
for p in sorted(root.rglob('*')):
    if p.is_file() and p.suffix in ('.js', '.css'):
        h.update(str(p.relative_to(root)).encode()); h.update(p.read_bytes())
print(h.hexdigest()[:10])
PY
)"
rm -rf "$SITE/static/inspector"
mkdir -p "$SITE/static/inspector/$INSPECTOR_V" "$SITE/data"
(cd "$REPO/src/inspector" && cp -R inspector.js inspector.css agent.js panel vendor "$SITE/static/inspector/$INSPECTOR_V/")
printf '{"dir": "inspector/%s"}\n' "$INSPECTOR_V" > "$SITE/data/inspector.json"
#    …and the companion package's browser side (src/companion), with the
#    Preact it is written in (the inspector's vendored copy), served the same
#    way: a folder named by a hash of its files. Pages import it by name, from
#    an import map (layouts/partials/companion.html, data/companion.json).
COMPANION_V="$(cat "$REPO/src/companion/companion.js" "$REPO/src/companion/companion.css" \
                   "$REPO/src/inspector/vendor/preact.js" | shasum -a 256 | cut -c1-10)"
rm -rf "$SITE/static/companion"
mkdir -p "$SITE/static/companion/$COMPANION_V"
cp "$REPO/src/companion/companion.js" "$REPO/src/companion/companion.css" \
   "$REPO/src/inspector/vendor/preact.js" "$SITE/static/companion/$COMPANION_V/"
printf '{"dir": "companion/%s"}\n' "$COMPANION_V" > "$SITE/data/companion.json"

# 2. Compile all LaTeX blocks, embed the schema, provision + patch fonts.
#    Set PREBUILD_ARGS to pass extra flags (e.g. --force, --prune, -j 8).
# shellcheck disable=SC2086
"$PYTHON" "$HUGO_INT/prebuild.py" "$SITE" --demos-dir "$DEMOS" --demos-dir "$TESTMATH" --demos-dir "$BOOK" --demos-dir "$SYMBOL" ${PREBUILD_ARGS:-}

# 3. testmath.tex as a pageless PDF, for the Tools page (one page as tall as
#    the document). Rebuilt only when the document, its template or the tool
#    changed.
PL_OUT="$SITE/.reflowtex-build/pageless-testmath"
PL_PDF="$SITE/static/pageless/testmath.pdf"
if [ ! -f "$PL_PDF" ] || [ -n "$(find "$TESTMATH/testmath.tex" "$TESTMATH/template.tex" "$PAGELESS" \
      "$REPO/src/extract/serializer.lua" -newer "$PL_PDF" -type f 2>/dev/null | head -1)" ]; then
  "$PYTHON" "$PAGELESS/pageless.py" "$TESTMATH/testmath.tex" --template "$TESTMATH/template.tex" \
      --passes 3 -o "$PL_OUT"
  mkdir -p "$(dirname "$PL_PDF")"
  cp "$PL_OUT/pageless.pdf" "$PL_PDF"
fi

# 4. The accuracy page's pixel comparison: too big for git, so a release file
#    that pixel-compare.lock names (tools/pageless-pdf/publish_compare.py makes
#    one). Fetched once, and again only when the lock changes; offline, the page
#    shows no comparison and the build goes on.
"$PYTHON" "$SITE/tools/fetch_pixel_compare.py" "$SITE"

# 5. Build (or serve) the static site.
if [ "${1:-}" = "server" ]; then
  shift
  exec hugo server --source "$SITE" "$@"
fi
exec hugo --source "$SITE" --minify "$@"
