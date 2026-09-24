#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fetch the pixel comparison the accuracy page shows (Showcase › Accuracy).

The comparison is 25 MB of pictures, too much to keep in git and new at every
run, so it is published as one file in a GitHub release (see
tools/pageless-pdf/publish_compare.py), and pixel-compare.lock, beside this
site, names that file and its SHA-256. build.sh runs this before Hugo:

    fetch_pixel_compare.py <site>

It unpacks the file into <site>/static/pixel-compare/ and
<site>/data/pixel_compare.json, unless they are already the ones the lock
names. Offline, or with no lock, it says so and leaves the site as it is: the
page then shows "No comparison data", and the build goes on.
"""

import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

MEMBERS = ('static/pixel-compare/', 'data/pixel_compare.json')


def main(site: Path) -> None:
    lock_path = site / 'pixel-compare.lock'
    pics = site / 'static' / 'pixel-compare'
    marker = pics / '.sha256'
    if not lock_path.exists():
        print('pixel-compare: no pixel-compare.lock; the accuracy page shows no comparison')
        return
    lock = json.loads(lock_path.read_text())
    if marker.exists() and marker.read_text().strip() == lock['sha256']:
        print('pixel-compare: up to date')
        return
    print(f'pixel-compare: fetching {lock["url"]} ({lock.get("bytes", 0) / 1048576:.1f} MB)')
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / 'pixel-compare.tar'
        digest = hashlib.sha256()
        try:
            with urllib.request.urlopen(lock['url'], timeout=120) as r, open(tar_path, 'wb') as f:
                while chunk := r.read(1 << 20):
                    digest.update(chunk)
                    f.write(chunk)
        except OSError as e:
            print(f'pixel-compare: WARNING – could not fetch it ({e}); the accuracy page shows no comparison',
                  file=sys.stderr)
            return
        if digest.hexdigest() != lock['sha256']:
            print(f'pixel-compare: WARNING – {lock["url"]} is not the file pixel-compare.lock names '
                  f'(SHA-256 {digest.hexdigest()}); left out', file=sys.stderr)
            return
        with tarfile.open(tar_path) as tar:
            members = tar.getmembers()
            for m in members:        # only the comparison's own files, nowhere else
                if not (m.isfile() or m.isdir()) or '..' in Path(m.name).parts \
                        or not m.name.startswith(MEMBERS):
                    sys.exit(f'ERROR: pixel-compare: unexpected entry {m.name!r} in {lock["url"]}')
            shutil.rmtree(pics, ignore_errors=True)
            try:
                tar.extractall(site, members=members, filter='data')
            except TypeError:        # a Python without extraction filters: the entries are checked above
                tar.extractall(site, members=members)
    marker.write_text(lock['sha256'] + '\n')
    print(f'pixel-compare: unpacked {sum(1 for _ in pics.rglob("*.webp"))} pictures')


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve())
