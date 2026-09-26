#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Installs the system libraries Playwright's browsers need, in the project's
# image (Debian testing).
#
#     sh docker/playwright-deps.sh chromium webkit
#
# `playwright install --with-deps` asks apt for the packages of the Debian
# release Playwright builds its browsers for (13, trixie), and testing has
# moved on: libicu76 and libxml2 are gone, and the newer ones there
# (libicu78, libxml2-16) have other sonames, which WebKit's binaries do not
# load. So this takes Playwright's own list, installs what testing has, and
# takes the rest from trixie – added as a source apt never prefers on its own
# (priority 100), used only for the names asked of it here.
set -eu
[ "$#" -gt 0 ] || { echo "usage: $0 <browser>…" >&2; exit 2; }
RELEASE=trixie

pkgs=$(npx playwright install-deps --dry-run "$@" 2>/dev/null |
       sed -n 's/.*apt-get install -y --no-install-recommends//p' | tr -d '"' | tail -n 1)
[ -n "$pkgs" ] || { echo "playwright-deps: no package list from playwright install-deps --dry-run" >&2; exit 1; }

if [ ! -f /etc/apt/sources.list.d/playwright-$RELEASE.sources ]; then
  cat > /etc/apt/sources.list.d/playwright-$RELEASE.sources <<EOF
Types: deb
URIs: http://deb.debian.org/debian
Suites: $RELEASE
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF
  printf 'Package: *\nPin: release n=%s\nPin-Priority: 100\n' "$RELEASE" > /etc/apt/preferences.d/playwright-$RELEASE
fi
apt-get update -qq

# Testing's own package when it has one (apt prefers it); trixie's otherwise.
here= old=
for p in $pkgs; do
  if apt-cache policy "$p" 2>/dev/null | grep -q '500 .* forky\|500 .* testing\|500 .* sid'; then here="$here $p"
  else echo "playwright-deps: $p from $RELEASE"; old="$old $p/$RELEASE"; fi
done
# shellcheck disable=SC2086
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $here $old
