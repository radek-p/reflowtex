#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Publish a pixel comparison for the website's accuracy page.

    publish_compare.py [<tiles.py out dir>] [--site website] [--upload]

The comparison's pictures (tiles.py: <ID>/{heat,fine,pdf,browser}-<k>.webp and
manifest.json) are too big for git, and new at every run, so the website takes
them from a GitHub release instead (website/tools/fetch_pixel_compare.py, run
by build.sh). This:

  1. copies a tiles.py output into the site, when given one:
     <ID>/ → <site>/static/pixel-compare/<ID>/, manifest.json →
     <site>/data/pixel_compare.json;
  2. packs those into pixel-compare-<hash>.tar (reproducibly: the same
     pictures give the same file and name);
  3. with --upload, creates the release pixel-compare-<hash> holding it,
     with the GitHub CLI (gh); otherwise prints how to;
  4. writes <site>/pixel-compare.lock – the file's URL and SHA-256 – which is
     what to commit.
"""

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def repo_slug() -> str:
    url = subprocess.run(['git', '-C', str(REPO), 'remote', 'get-url', 'origin'],
                         capture_output=True, text=True, check=True).stdout.strip()
    return url.removesuffix('.git').split('github.com')[-1].lstrip(':/')


def pack(site: Path) -> bytes:
    """static/pixel-compare/ and data/pixel_compare.json as one tar, the same
    bytes for the same files (sorted, no times or owners)."""
    files = sorted(p for p in (site / 'static' / 'pixel-compare').rglob('*.webp'))
    files.append(site / 'data' / 'pixel_compare.json')
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.PAX_FORMAT) as tar:
        for p in files:
            info = tarfile.TarInfo(p.relative_to(site).as_posix())
            data = p.read_bytes()
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('tiles', nargs='?', type=Path, help="tiles.py's output directory")
    ap.add_argument('--site', type=Path, default=REPO / 'website')
    ap.add_argument('--upload', action='store_true', help='create the GitHub release (needs gh)')
    args = ap.parse_args()
    site = args.site.resolve()

    if args.tiles:
        manifest = json.loads((args.tiles / 'manifest.json').read_text())
        pics = site / 'static' / 'pixel-compare'
        shutil.rmtree(pics, ignore_errors=True)
        for strip in manifest['strips']:
            shutil.copytree(args.tiles / strip['id'], pics / strip['id'])
        shutil.copy(args.tiles / 'manifest.json', site / 'data' / 'pixel_compare.json')

    blob = pack(site)
    sha = hashlib.sha256(blob).hexdigest()
    tag = f'pixel-compare-{sha[:8]}'
    out = site / '.reflowtex-build' / f'{tag}.tar'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)
    url = f'https://github.com/{repo_slug()}/releases/download/{tag}/{out.name}'
    print(f'packed {out} ({len(blob) / 1048576:.1f} MB)')

    notes = ('The pictures of the website\'s pixel comparison (Showcase › Accuracy), '
             'fetched by website/tools/fetch_pixel_compare.py. Made by tools/pageless-pdf.')
    if args.upload:
        subprocess.run(['gh', 'release', 'create', tag, str(out), '--repo', repo_slug(),
                        '--title', f'Pixel comparison {sha[:8]}', '--notes', notes], check=True)
    else:
        print(f'\nTo publish it: gh release create {tag} {out} --title "Pixel comparison {sha[:8]}" --notes "…"\n'
              f'(or on GitHub: Releases › Draft a new release, tag {tag}, attach {out.name}).')

    (site / 'pixel-compare.lock').write_text(json.dumps(
        {'url': url, 'sha256': sha, 'bytes': len(blob)}, indent=2) + '\n')
    print(f'wrote {site / "pixel-compare.lock"} – commit it once the release exists')


if __name__ == '__main__':
    sys.exit(main())
