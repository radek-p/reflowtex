#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# The CI image's registry steps, with retries (CONTRIBUTING.md, "CI"):
#
#   ci-image.sh login             log in to ghcr.io with $GITHUB_TOKEN
#   ci-image.sh exists <image>    exit 0 if the tag is in the registry, 1 if
#                                 it is not; any other answer is retried
#   ci-image.sh pull <image>      pull it and tag it reflowtex:test
#
# Each try that fails waits longer before the next (15 s, 45 s, 135 s): a
# registry that answers 5xx or times out usually does again within minutes.
set -uo pipefail

tries=4
retry() {
  local n=1
  until "$@"; do
    [ "$n" -lt "$tries" ] || { echo "ci-image: '$*' failed $tries times" >&2; return 1; }
    local wait=$((15 * 3 ** (n - 1)))
    echo "ci-image: '$*' failed (try $n/$tries); again in ${wait}s" >&2
    sleep "$wait"; n=$((n + 1))
  done
}

login() { printf '%s' "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin; }

# 0: there; 1: not there (the registry said so); 2: no answer to trust
probe() {
  local out
  if out=$(docker manifest inspect "$1" 2>&1); then return 0; fi
  case "$out" in *"manifest unknown"*|*"not found"*|*"no such manifest"*) return 1 ;; esac
  echo "$out" >&2; return 2
}

case "${1:-}" in
  login) retry login ;;
  exists)
    n=1
    while true; do
      probe "$2"; s=$?
      [ "$s" -le 1 ] && exit "$s"
      [ "$n" -lt "$tries" ] || { echo "ci-image: no answer from the registry about $2" >&2; exit 2; }
      sleep $((15 * 3 ** (n - 1))); n=$((n + 1))
    done ;;
  pull) retry docker pull --quiet "$2" && docker tag "$2" reflowtex:test ;;
  *) echo "usage: $0 login | exists <image> | pull <image>" >&2; exit 2 ;;
esac
