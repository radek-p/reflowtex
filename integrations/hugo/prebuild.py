#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""reflowtex — Hugo integration prebuild.

A thin shell over reflowtex/src: it scans a Hugo site for {{< latex >}} shortcodes,
compiles each with the reflowtex pipeline, and writes the results where Hugo can
embed them at build time. Run it before `hugo` / `hugo server`:

    python prebuild.py [SITE_DIR] [--force] [--prune] [-j N]

SITE_DIR defaults to the current directory. It is expected to look like a normal
Hugo site:

    <site>/content/**/*.md          scanned for {{< latex >}}…{{< /latex >}}
    <site>/latex-preambles/<n>.tex  optional named preambles (preamble="<n>")
    <site>/latex-fonts/*.otf        optional repo-shipped fonts (not in TeX)

and this writes:

    <site>/data/latex_blocks/<key>.json   {nodelist_b64, content_hash}
    <site>/data/latex_schema.json         {schema_b64}
    <site>/static/fonts/*.otf             provisioned + cmap-patched fonts
    <site>/.reflowtex-build/<key>/          per-block build artefacts (git-ignore)

Copy layouts/shortcodes/latex.html and layouts/partials/reflowtex-viewer.html from
this directory into your site's layouts/ (see README.md).
"""

import argparse
import base64
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFLOWTEX_ROOT = HERE.parent.parent
sys.path.insert(0, str(REFLOWTEX_ROOT / 'src' / 'encode'))

from pipeline import Pipeline, content_key   # noqa: E402

# Two ways to write a block:
#   inline     {{< latex [attrs] >}} …LaTeX… {{< /latex >}}
#   file ref   {{< latex file="name.tex" [attrs] />}}   (self-closing)
# The file ref shares one .tex source with other integrations (e.g. the vanilla
# demo); prebuild resolves it against --demos-dir and records name → key so the
# shortcode can look it up without reading across directories itself.
BLOCK_RE = re.compile(r'\{\{<\s*latex((?![^>]*\bfile=)[^>]*?)>\}\}(.*?)\{\{<\s*/latex\s*>\}\}', re.DOTALL)
FILEREF_RE = re.compile(r'\{\{<\s*latex\s+([^>]*?)/>\}\}')
PREAMBLE_ATTR_RE = re.compile(r'preamble="([^"]+)"')
FILE_ATTR_RE = re.compile(r'file="([^"]+)"')
HASH_RE = re.compile(r'^[0-9a-f]{16}$')


def _resolve_preamble(name: str, preamble_dir: Path) -> str:
    pfile = preamble_dir / f'{name}.tex'
    if not pfile.exists():
        sys.exit(f'ERROR: preamble "{name}" not found at {pfile}')
    return pfile.read_text(encoding='utf-8')


def scan_content(content_dir: Path, preamble_dir: Path, demos_dir: Path | None):
    """Scan all markdown for latex blocks.

    Returns (blocks, files_map):
      blocks    {key: (content, preamble)}   — everything to compile
      files_map {"name.tex": key}            — for file-ref shortcode lookups
    """
    blocks: dict[str, tuple[str, str]] = {}
    files_map: dict[str, str] = {}

    # File refs share the demos dir's own preamble.tex (if present).
    demos_preamble = ''
    if demos_dir and (demos_dir / 'preamble.tex').exists():
        demos_preamble = (demos_dir / 'preamble.tex').read_text(encoding='utf-8')

    for path in sorted(content_dir.rglob('*.md')):
        text = path.read_text(encoding='utf-8')

        for m in BLOCK_RE.finditer(text):
            attrs, inner = m.group(1), m.group(2)
            pm = PREAMBLE_ATTR_RE.search(attrs or '')
            preamble = _resolve_preamble(pm.group(1), preamble_dir) if pm else ''
            key = content_key(inner.strip(), preamble)
            blocks[key] = (inner.strip(), preamble)

        for m in FILEREF_RE.finditer(text):
            attrs = m.group(1)
            fm = FILE_ATTR_RE.search(attrs)
            if not fm:
                continue
            name = fm.group(1)
            if demos_dir is None:
                sys.exit(f'ERROR: {path.name} references file="{name}" but --demos-dir is not set')
            src = demos_dir / name
            if not src.exists():
                sys.exit(f'ERROR: file="{name}" not found at {src}')
            content = src.read_text(encoding='utf-8')
            pm = PREAMBLE_ATTR_RE.search(attrs or '')
            preamble = _resolve_preamble(pm.group(1), preamble_dir) if pm else demos_preamble
            key = content_key(content.strip(), preamble)
            blocks[key] = (content.strip(), preamble)
            files_map[name] = key

    return blocks, files_map


def prune_stale(data_dir: Path, build_root: Path, live: set[str]) -> None:
    removed = 0
    for f in sorted(data_dir.glob('*.json')):
        if HASH_RE.match(f.stem) and f.stem not in live:
            f.unlink(); removed += 1
            print(f'  prune: data/latex_blocks/{f.name}')
    for d in sorted(build_root.glob('*')) if build_root.exists() else []:
        if d.is_dir() and HASH_RE.match(d.name) and d.name not in live:
            import shutil; shutil.rmtree(d); removed += 1
            print(f'  prune: {build_root.name}/{d.name}/')
    print(f'  prune: {removed} stale entr{"y" if removed == 1 else "ies"} removed')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('site', nargs='?', type=Path, default=Path('.'), help='Hugo site root')
    ap.add_argument('--demos-dir', type=Path, default=None,
                    help='directory that file="…" references resolve against '
                         '(default: <site>/latex-src if it exists)')
    ap.add_argument('--force', action='store_true', help='recompile all blocks')
    ap.add_argument('--prune', action='store_true', help='drop data/build entries no longer in content')
    ap.add_argument('-j', '--jobs', type=int, default=4, help='blocks to compile in parallel')
    args = ap.parse_args()

    site: Path = args.site.resolve()
    content_dir  = site / 'content'
    preamble_dir = site / 'latex-preambles'
    data_dir     = site / 'data' / 'latex_blocks'
    schema_file  = site / 'data' / 'latex_schema.json'
    files_file   = site / 'data' / 'latex_files.json'
    fonts_dir    = site / 'static' / 'fonts'
    local_fonts  = site / 'latex-fonts'
    build_root   = site / '.reflowtex-build'

    demos_dir = args.demos_dir.resolve() if args.demos_dir else None
    if demos_dir is None and (site / 'latex-src').is_dir():
        demos_dir = site / 'latex-src'

    if not content_dir.is_dir():
        sys.exit(f'error: {content_dir} not found — is {site} a Hugo site?')
    data_dir.mkdir(parents=True, exist_ok=True)

    pipe = Pipeline(build_root=build_root, fonts_dir=fonts_dir,
                    local_fonts_dir=local_fonts if local_fonts.is_dir() else None)

    # Embed the schema once (the browser parses latex.proto at runtime).
    schema_file.parent.mkdir(parents=True, exist_ok=True)
    schema_file.write_text(json.dumps({'schema_b64': pipe.schema_b64()}, indent=2))

    # Copy the viewer assets into static/ so the partial can load them from the
    # site root (and so the site needs no manual copy step).
    import shutil
    static = site / 'static'
    static.mkdir(parents=True, exist_ok=True)
    for asset in ('latex-viewer.js', 'protobuf.min.js'):
        shutil.copy(REFLOWTEX_ROOT / 'src' / 'viewer' / asset, static / asset)

    blocks, files_map = scan_content(content_dir, preamble_dir, demos_dir)
    # The path→key map lets the shortcode resolve file="…" without reading the
    # source itself. Always (re)write it, even if empty, so a removed ref clears.
    files_file.write_text(json.dumps(files_map, indent=2, sort_keys=True))
    if not blocks:
        print('No {{< latex >}} blocks found.')
        return

    stale = []
    for key, (content, preamble) in blocks.items():
        out = data_dir / f'{key}.json'
        if not args.force and out.exists() and json.loads(out.read_text()).get('content_hash') == key:
            print(f'  {key}: up to date')
            continue
        stale.append((key, content, preamble))

    if stale:
        print(f'reflowtex: compiling {len(stale)} block(s)…')
        blobs = pipe.compile_many(stale, jobs=args.jobs)
        for key, blob in blobs.items():
            (data_dir / f'{key}.json').write_text(json.dumps(
                {'nodelist_b64': base64.b64encode(blob).decode(), 'content_hash': key}, indent=2))
            print(f'  {key}: done ({len(blob)} bytes)')

    print('font-patch:')
    pipe.patch_fonts()
    # original → served font filename (a modified font is served renamed +
    # content-hashed); the viewer partial embeds this so @font-face fetches the
    # right file. Always (re)written so a changed hash propagates.
    (site / 'data' / 'latex_font_map.json').write_text(
        json.dumps(pipe.font_map(), indent=2, sort_keys=True))

    if args.prune:
        print('prune:')
        prune_stale(data_dir, build_root, set(blocks.keys()))


if __name__ == '__main__':
    main()
