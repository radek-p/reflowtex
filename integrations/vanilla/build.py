#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""reflowtex — vanilla HTML+JS integration.

The reference integration: it depends only on reflowtex/src, nothing framework-
specific. Point it at a directory of LaTeX snippets and it emits a self-contained
static site — one HTML page, the viewer scripts, and the fonts — that renders the
snippets in any browser.

    python build.py <snippets-dir> -o site/

Each `*.tex` file in the directory becomes one block on the page, in filename
order, headed by its filename stem. A file named `preamble.tex` is not a block:
its contents are prepended to every snippet's preamble (shared macros, packages,
fonts). Repo-local OTF fonts (faces not installed into TeX) go in a `fonts/`
subdirectory of the snippets dir, or pass --local-fonts.

Self-contained: open site/index.html straight off disk, or serve it any way
you like (python -m http.server -d site works too) — fonts resolve relative
to latex-viewer.js's own URL, wherever that ends up.
"""

import argparse
import base64
import html
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFLOWTEX_ROOT = HERE.parent.parent
SRC = REFLOWTEX_ROOT / 'src'
sys.path.insert(0, str(SRC / 'encode'))

from pipeline import Pipeline, content_key  # noqa: E402

PAGE_TEMPLATE = HERE / 'page.template.html'

# AGPL-3.0 §13: deployed pages must offer their users the Corresponding Source of
# the software they interact with. This is the URL the footer's source link points
# to — the reflowtex source. Overridable with --source-url or the
# REFLOWTEX_SOURCE_URL environment variable.
DEFAULT_SOURCE_URL = os.environ.get(
    'REFLOWTEX_SOURCE_URL', 'https://github.com/radek-p/reflowtex')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', type=Path, help='directory of .tex snippets')
    ap.add_argument('-o', '--out', type=Path, default=Path('site'),
                    help='output directory (default: site/)')
    ap.add_argument('--title', default='reflowtex', help='page title')
    ap.add_argument('--source-url', default=DEFAULT_SOURCE_URL,
                    help='URL of the published source (AGPL-3.0 §13 source offer '
                         'shown in the page footer)')
    ap.add_argument('--fonts-base', default='fonts/',
                    help="URL prefix @font-face fetches fonts from — relative "
                         "(default 'fonts/') resolves against latex-viewer.js's "
                         'own URL, which works unmodified from a subpath, a '
                         "different domain, or straight off disk over file://; "
                         'pass an absolute URL (e.g. a CDN) to override that')
    ap.add_argument('-j', '--jobs', type=int, default=1,
                    help='snippets to compile in parallel (default: 1)')
    ap.add_argument('--local-fonts', type=Path, default=None,
                    help='dir of repo-shipped OTF fonts (default: <source>/fonts if it exists)')
    args = ap.parse_args()

    src_dir: Path = args.source
    if not src_dir.is_dir():
        sys.exit(f'error: {src_dir} is not a directory')

    out: Path = args.out
    build_root = out / '_build'
    fonts_dir = out / 'fonts'

    local_fonts = args.local_fonts
    if local_fonts is None and (src_dir / 'fonts').is_dir():
        local_fonts = src_dir / 'fonts'

    preamble = ''
    preamble_file = src_dir / 'preamble.tex'
    if preamble_file.exists():
        preamble = preamble_file.read_text(encoding='utf-8')

    snippets = sorted(p for p in src_dir.glob('*.tex') if p.name != 'preamble.tex')
    if not snippets:
        sys.exit(f'error: no .tex snippets found in {src_dir}')

    pipe = Pipeline(build_root=build_root, fonts_dir=fonts_dir, local_fonts_dir=local_fonts)

    print(f'reflowtex: compiling {len(snippets)} snippet(s) from {src_dir}')
    # Each snippet owns its heading (a \section, if any), so no HTML heading is
    # added here — the block is one self-contained rendering.
    jobs = [(content_key(p.read_text(encoding='utf-8'), preamble),
             p.read_text(encoding='utf-8'), preamble)
            for p in snippets]
    # Compile (optionally in parallel), then assemble blocks in filename order.
    blobs = pipe.compile_many(jobs, jobs=args.jobs)
    pipe.patch_fonts()

    blocks_html = []
    for key, _content, _pre in jobs:
        b64 = base64.b64encode(blobs[key]).decode()
        blocks_html.append(f'<div class="latex-block" data-nodelist-b64="{b64}"></div>')

    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(SRC / 'viewer' / 'latex-viewer.js', out / 'latex-viewer.js')
    shutil.copy(SRC / 'viewer' / 'protobuf.min.js', out / 'protobuf.min.js')

    import json
    page = (PAGE_TEMPLATE.read_text(encoding='utf-8')
            .replace('{{TITLE}}', html.escape(args.title))
            .replace('{{SCHEMA_B64}}', pipe.schema_b64())
            .replace('{{FONT_MAP_JSON}}', json.dumps(pipe.font_map()))
            .replace('{{SOURCE_URL}}', html.escape(args.source_url, quote=True))
            .replace('{{FONTS_BASE}}', html.escape(args.fonts_base, quote=True))
            .replace('{{BLOCKS}}', '\n'.join(blocks_html)))
    (out / 'index.html').write_text(page, encoding='utf-8')

    print(f'reflowtex: wrote {out / "index.html"} ({len(snippets)} block(s))')
    print(f'         serve it with:  python -m http.server -d {out}')


if __name__ == '__main__':
    main()
