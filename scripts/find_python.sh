#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Prints the path to a Python 3.9+ interpreter on stdout, or exits 1 with
# guidance on stderr. 3.9 is the floor of the protobuf and fonttools packages
# src/encode depends on (the code itself keeps to 3.9 syntax: union types
# appear only in annotations, under `from __future__ import annotations`).
set -euo pipefail

for cand in python3 python3.13 python3.12 python3.11 python3.10 python3.9; do
  if command -v "$cand" >/dev/null 2>&1 \
     && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    command -v "$cand"
    exit 0
  fi
done

echo "error: no Python 3.9+ interpreter found on PATH – install one, e.g.:" >&2
echo "         brew install python@3.12" >&2
echo "       (or, with MacPorts: sudo port install python312)" >&2
exit 1
