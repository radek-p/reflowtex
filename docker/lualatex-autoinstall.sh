#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Installed as /usr/local/bin/lualatex, shadowing the real binary at
# /usr/bin/lualatex (see the Dockerfile: /usr/local/bin precedes /usr/bin on
# PATH). The image bakes in the packages src/extract/template.tex and this
# repo's own examples need, but a snippet's own preamble is free to
# \usepackage anything (see docs/architecture.md) – if that pulls in something
# not already installed, this retries via tlmgr instead of failing outright.
# Needs network access the first time any given package is needed.
set -uo pipefail

REAL_LUALATEX=/usr/bin/lualatex
MAX_ATTEMPTS=5

find_logfile() {
  for arg in "$@"; do
    case "$arg" in
      *.tex) printf '%s' "${arg%.tex}.log"; return ;;
    esac
  done
}

find_missing_package() {
  local logfile=$1 missing
  missing=$(grep -oE "! LaTeX Error: File \`[^']+' not found" "$logfile" 2>/dev/null \
              | tail -1 | sed -E "s/.*\`([^']+)'.*/\1/")
  [ -n "$missing" ] && { printf '%s' "$missing"; return 0; }
  return 1
}

find_owning_tlpkg() {
  local fname=$1
  tlmgr search --global --file "/$fname" 2>/dev/null | awk -v f="$fname" '
    /:$/          { name = $0; sub(/:$/, "", name); next }
    $0 ~ f "$"    { print name; exit }
  '
}

logfile=$(find_logfile "$@")
attempt=1
while true; do
  "$REAL_LUALATEX" "$@"
  status=$?
  [ $status -eq 0 ] && exit 0
  [ "$attempt" -lt "$MAX_ATTEMPTS" ] || exit "$status"
  [ -n "$logfile" ] && [ -f "$logfile" ] || exit "$status"

  missing=$(find_missing_package "$logfile") || exit "$status"
  pkg=$(find_owning_tlpkg "$missing")
  [ -n "$pkg" ] || exit "$status"

  echo "lualatex-autoinstall: '$missing' missing – installing tlmgr package '$pkg' (attempt $attempt/$MAX_ATTEMPTS)" >&2
  if ! tlmgr install "$pkg" >&2; then
    # The image's tlmgr can fall behind CTAN's rolling tlnet repo the longer
    # it goes un-rebuilt, at which point tlmgr refuses to install anything
    # ("tlmgr itself needs to be updated") until it updates its own client.
    # Try that once and retry this same install before giving up.
    echo "lualatex-autoinstall: tlmgr install failed – trying 'tlmgr update --self', then retrying once" >&2
    tlmgr update --self >&2 || exit "$status"
    tlmgr install "$pkg" >&2 || exit "$status"
  fi
  tlmgr path add >&2 2>/dev/null || true

  attempt=$((attempt + 1))
done
