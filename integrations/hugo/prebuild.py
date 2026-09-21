#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""reflowtex — Hugo integration prebuild.

A thin shell over reflowtex/src: it scans a Hugo site for {{< latex >}} shortcodes,
compiles each with the reflowtex pipeline, and writes the results where Hugo can
embed them at build time. Run it before `hugo` / `hugo server`:

    python prebuild.py [SITE_DIR] [--force] [--prune] [-j N]

SITE_DIR defaults to the current directory. It is expected to look like a normal
Hugo site:

    <site>/content/**/*.md            scanned for {{< latex >}}…{{< /latex >}}
    <site>/latex-preambles/<n>.tex    optional named preambles (preamble="<n>")
    <site>/latex-color-maps/<n>.json  optional named colour maps (color-map="<n>")
    <site>/latex-fonts/*.otf          optional repo-shipped fonts (not in TeX)

An inline block can also carry as="name" to register itself in the same
file→key lookup a file="name" ref would (data/latex_files.json) — for content
that has no natural .tex file of its own (a page's own short title, a handful
of one-line labels some sidebar template looks up from every page, …) but
that another template still wants to find later by name. A page of nothing
but such blocks, marked `render = "never"` in its front matter, replaces what
would otherwise need a whole --demos-dir of many tiny single-purpose files —
one .md file with N inline blocks instead of N .tex files plus N file refs to
them.

and this writes:

    <site>/data/latex_blocks/<key>.json   {nodelist_b64, content_hash}
    <site>/data/latex_schema.json         {schema_b64}
    <site>/data/latex_color_maps.json     {name: <parsed color-map JSON>, …}
    <site>/static/fonts/*.otf             provisioned + cmap-patched fonts
    <site>/.reflowtex-build/<key>/          per-block build artefacts (git-ignore)

Copy layouts/shortcodes/latex.html and layouts/partials/reflowtex-viewer.html from
this directory into your site's layouts/ (see README.md).
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFLOWTEX_ROOT = HERE.parent.parent
sys.path.insert(0, str(REFLOWTEX_ROOT / 'src' / 'encode'))

from pipeline import Pipeline, content_key, viewer_script   # noqa: E402

# Two ways to write a block:
#   inline     {{< latex [attrs] >}} …LaTeX… {{< /latex >}}
#   file ref   {{< latex file="name.tex" [attrs] />}}   (self-closing)
# The file ref shares one .tex source with other integrations (e.g. the vanilla
# demo); prebuild resolves it against --demos-dir and records name → key so the
# shortcode can look it up without reading across directories itself.
#
# An inline block can also carry as="name" to register under that same
# files_map, for content with nowhere more natural to live as its own file —
# e.g. a page's own short title, or a handful of one-line labels a sidebar
# needs to look up from every page — without needing a whole --demos-dir
# entry (and a file="…" ref to it) per snippet. Purely a lookup-table
# registration: as="…" plays no part in what gets compiled or how, so an
# inline block with no other page rendering it directly (a dedicated
# `render = "never"` page collecting several, say) is exactly what file refs
# already do for shared .tex sources, minus the extra file per snippet.
BLOCK_RE = re.compile(r'\{\{<\s*latex((?![^>]*\bfile=)[^>]*?)>\}\}(.*?)\{\{<\s*/latex\s*>\}\}', re.DOTALL)
FILEREF_RE = re.compile(r'\{\{<\s*latex\s+([^>]*?)/>\}\}')
PREAMBLE_ATTR_RE = re.compile(r'preamble="([^"]+)"')
COLOR_MAP_ATTR_RE = re.compile(r'color-map="([^"]+)"')
AS_ATTR_RE = re.compile(r'as="([^"]+)"')
FILE_ATTR_RE = re.compile(r'file="([^"]+)"')
HASH_RE = re.compile(r'^[0-9a-f]{16}$')


def _resolve_preamble(name: str, preamble_dir: Path) -> str:
    pfile = preamble_dir / f'{name}.tex'
    if not pfile.exists():
        sys.exit(f'ERROR: preamble "{name}" not found at {pfile}')
    return pfile.read_text(encoding='utf-8')


def _block_name(page: str, line: int, inner: str, as_name: str | None) -> str:
    """How an inline block is referred to in progress lines and errors: the page
    and line it starts on, its as="…" name if it has one, and the first words of
    its text — a line number alone is a poor handle once the page has been
    edited, while a few words of the block are recognisable at a glance."""
    excerpt = ' '.join(inner.split())
    if len(excerpt) > 48:
        excerpt = excerpt[:47].rstrip() + '…'
    name = f'{page}:{line}'
    if as_name:
        name += f' as="{as_name}"'
    return f'{name} "{excerpt}"'


def scan_content(content_dir: Path, preamble_dir: Path, demos_dir: Path | None):
    r"""Scan all markdown for latex blocks.

    Returns (blocks, files_map, block_pages, color_map_names):
      blocks          {key: (content, preamble, name)} — everything to compile;
                      name is where the block was authored (page:line, or the
                      referenced .tex file), for progress lines and errors
      files_map       {"name.tex": key}            — for file-ref shortcode lookups,
                      plus any inline block that registered itself via as="…"
      block_pages     {key: "sub/page.md"}         — which page each block sits on,
                      content-dir-relative, so a ``\label`` compiled inside a block can
                      be turned into a URL by the only layer that knows about URLs
      color_map_names {"name", …}                  — every color-map="…" referenced;
                      unlike preamble, a colour map never affects compilation (it's a
                      browser-rendering concern), so it plays no part in a block's key
    """
    blocks: dict[str, tuple[str, str, str]] = {}
    files_map: dict[str, str] = {}
    block_pages: dict[str, str] = {}
    color_map_names: set[str] = set()

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
            page = path.relative_to(content_dir).as_posix()
            line = text.count('\n', 0, m.start()) + 1
            am = AS_ATTR_RE.search(attrs or '')
            blocks.setdefault(key, (inner.strip(), preamble,
                                    _block_name(page, line, inner, am.group(1) if am else None)))
            block_pages.setdefault(key, page)
            cm = COLOR_MAP_ATTR_RE.search(attrs or '')
            if cm:
                color_map_names.add(cm.group(1))
            if am:
                files_map[am.group(1)] = key

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
            blocks.setdefault(key, (content.strip(), preamble, name))
            files_map[name] = key
            block_pages.setdefault(key, path.relative_to(content_dir).as_posix())
            cm = COLOR_MAP_ATTR_RE.search(attrs or '')
            if cm:
                color_map_names.add(cm.group(1))

    return blocks, files_map, block_pages, color_map_names


def _resolve_color_maps(names: set[str], color_map_dir: Path) -> dict:
    maps = {}
    for name in sorted(names):
        cfile = color_map_dir / f'{name}.json'
        if not cfile.exists():
            sys.exit(f'ERROR: color-map "{name}" not found at {cfile}')
        try:
            maps[name] = json.loads(cfile.read_text(encoding='utf-8'))
        except json.JSONDecodeError as e:
            sys.exit(f'ERROR: color-map "{name}" ({cfile}) is not valid JSON: {e}')
    return maps


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
    content_dir    = site / 'content'
    preamble_dir   = site / 'latex-preambles'
    color_map_dir  = site / 'latex-color-maps'
    data_dir       = site / 'data' / 'latex_blocks'
    schema_file    = site / 'data' / 'latex_schema.json'
    files_file     = site / 'data' / 'latex_files.json'
    color_maps_file = site / 'data' / 'latex_color_maps.json'
    fonts_dir      = site / 'static' / 'fonts'
    local_fonts    = site / 'latex-fonts'
    build_root     = site / '.reflowtex-build'

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
    shutil.copy(viewer_script(), static / 'latex-viewer.js')
    shutil.copy(REFLOWTEX_ROOT / 'src' / 'viewer' / 'protobuf.min.js', static / 'protobuf.min.js')

    blocks, files_map, block_pages, color_map_names = scan_content(
        content_dir, preamble_dir, demos_dir)
    # The path→key map lets the shortcode resolve file="…" without reading the
    # source itself. Always (re)write it, even if empty, so a removed ref clears.
    files_file.write_text(json.dumps(files_map, indent=2, sort_keys=True))
    # Same idea for colour maps: only the ones actually referenced by a
    # color-map="…" attribute are read from <site>/latex-color-maps/ and
    # embedded, so an unused or removed map doesn't linger in the output.
    color_maps_file.write_text(json.dumps(
        _resolve_color_maps(color_map_names, color_map_dir), indent=2, sort_keys=True))
    if not blocks:
        print('No {{< latex >}} blocks found.')
        return

    stale = []
    for key, (content, preamble, name) in blocks.items():
        out = data_dir / f'{key}.json'
        if not args.force and out.exists() and json.loads(out.read_text()).get('content_hash') == key:
            print(f'  {name} ({key}): up to date')
            continue
        stale.append((key, content, preamble, name))

    if stale:
        print(f'reflowtex: compiling {len(stale)} block(s)…')
        blobs = pipe.compile_many(stale, jobs=args.jobs)
        for key, blob in blobs.items():
            (data_dir / f'{key}.json').write_text(json.dumps(
                {'nodelist_b64': base64.b64encode(blob).decode(), 'content_hash': key}, indent=2))
            print(f'  {blocks[key][2]} ({key}): done ({len(blob)} bytes)')

    print('font-patch:')
    pipe.patch_fonts()
    # original → served font filename (a modified font is served renamed +
    # content-hashed); the viewer partial embeds this so @font-face fetches the
    # right file. Always (re)written so a changed hash propagates.
    (site / 'data' / 'latex_font_map.json').write_text(
        json.dumps(pipe.font_map(), indent=2, sort_keys=True))

    # label → the content page whose block defines it. The labels come out of the
    # same compilation that produced the blocks, so this cannot drift from what
    # was actually typeset the way scanning the sources for \label would. Turning
    # a page into a URL is left to the template: permalinks, slugs and front
    # matter are Hugo's business, not ours.
    link_map: dict[str, str] = {}
    for key, page in sorted(block_pages.items()):
        out_json = build_root / key / 'output.json'
        if not out_json.exists():
            continue
        for label in json.loads(out_json.read_text()).get('anchors', []):
            link_map.setdefault(label, page)
    (site / 'data' / 'latex_link_map.json').write_text(
        json.dumps(link_map, indent=2, sort_keys=True))
    print(f'link-map: {len(link_map)} label(s) across {len(set(link_map.values()))} page(s)')

    if args.prune:
        print('prune:')
        prune_stale(data_dir, build_root, set(blocks.keys()))


if __name__ == '__main__':
    main()
