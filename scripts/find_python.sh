#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Prints the path to a Python 3.10+ interpreter on stdout, or exits 1 with
# guidance on stderr. src/encode uses bare `X | None` union-type syntax
# (PEP 604, no `from __future__ import annotations`), so 3.10+ is a hard
# requirement — and macOS's bundled /usr/bin/python3 is often 3.9.
set -euo pipefail

for cand in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$cand" >/dev/null 2>&1 \
     && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    command -v "$cand"
    exit 0
  fi
done

echo "error: no Python 3.10+ interpreter found on PATH." >&2
echo "       macOS's bundled /usr/bin/python3 is often 3.9 — install a newer one, e.g.:" >&2
echo "         brew install python@3.12" >&2
echo "       (or, with MacPorts: sudo port install python312)" >&2
exit 1
