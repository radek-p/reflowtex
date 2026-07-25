#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Public demo: render AMS' testmath.tex (the amsmath "sample paper").

testmath.tex is bundled **verbatim** (see NOTICE.md — LPPL 1.3c, © American
Mathematical Society and the LaTeX Project). This script does not modify it: at
build time it splits the file into its preamble and its body and compiles them
with the classic Computer Modern fonts the document was written for — no
fontspec, no unicode-math (see template.tex).

Those 8-bit Type1 fonts have no OpenType form, so the pipeline converts them to
web OTFs addressed via PUA (src/encode/t1_convert.py). This demo is therefore
also a stress test of that legacy-font path on a dense, real amsmath document.

    python build.py            # → build/testmath-site/  (served at the site root)
"""
import argparse
import base64
import html
import json
import os
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LT = HERE.parent.parent                        # reflowtex/
SRC = LT / 'src'
VANILLA = LT / 'integrations' / 'vanilla'
sys.path.insert(0, str(SRC / 'encode'))

from pipeline import Pipeline                   # noqa: E402

DEFAULT_OUT = LT / 'build' / 'testmath-site'
# AGPL-3.0 §13 source offer shown in the page footer (see the vanilla template).
DEFAULT_SOURCE_URL = os.environ.get(
    'REFLOWTEX_SOURCE_URL', 'https://github.com/radek-p/reflowtex')
# testmath is full of \eqref/\ref cross-references; a few passes let the shared
# .aux settle so they resolve instead of showing [?] (see Pipeline.compile).
PASSES = 3


def split_document(tex: str) -> tuple[str, str]:
    """Split a complete LaTeX file into (preamble, body) without altering either.

    preamble = from \\documentclass up to (not including) \\begin{document};
    body     = between \\begin{document} and \\end{document}.
    Keeping the document's own preamble verbatim is the whole point — we add only
    the serializer, in template.tex, after this preamble.
    """
    m_class = re.search(r'^[ \t]*\\documentclass', tex, re.M)
    m_begin = re.search(r'^[ \t]*\\begin\{document\}[^\n]*\n', tex, re.M)
    m_end = re.search(r'^[ \t]*\\end\{document\}', tex, re.M)
    if not (m_class and m_begin and m_end):
        sys.exit('error: could not find \\documentclass / \\begin{document} / \\end{document}')
    preamble = tex[m_class.start():m_begin.start()]
    body = tex[m_begin.end():m_end.start()]
    return preamble, body


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('-o', '--out', type=Path, default=DEFAULT_OUT,
                    help=f'output directory (default: {DEFAULT_OUT})')
    ap.add_argument('--fonts-base', default='/fonts/',
                    help="URL prefix @font-face fetches fonts from (default "
                         "'/fonts/'; use a relative value like 'fonts/' to serve "
                         'the page under a subpath)')
    ap.add_argument('--source-url', default=DEFAULT_SOURCE_URL,
                    help='published-source URL for the AGPL-3.0 footer')
    args = ap.parse_args()
    out: Path = args.out

    src = HERE / 'testmath.tex'
    if not src.exists():
        sys.exit(f'error: {src} missing (it ships with the repo — see NOTICE.md)')
    preamble, body = split_document(src.read_text(encoding='utf-8'))

    pipe = Pipeline(build_root=LT / 'build' / 'testmath-build',
                    fonts_dir=out / 'fonts',
                    template=HERE / 'template.tex')
    print(f'reflowtex: compiling testmath.tex ({PASSES} passes so cross-references resolve) …')
    blob = pipe.compile(body, preamble=preamble, key='testmath', passes=PASSES)
    pipe.patch_fonts()
    print(f'  OK ({len(blob)} bytes)')

    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(SRC / 'viewer' / 'latex-viewer.js', out / 'latex-viewer.js')
    shutil.copy(SRC / 'viewer' / 'protobuf.min.js', out / 'protobuf.min.js')

    block = (f'<div class="latex-block" '
             f'data-nodelist-b64="{base64.b64encode(blob).decode()}"></div>')
    page = ((VANILLA / 'page.template.html').read_text(encoding='utf-8')
            .replace('{{TITLE}}', html.escape('AMS testmath.tex — Reflow TeX'))
            .replace('{{SCHEMA_B64}}', pipe.schema_b64())
            .replace('{{FONT_MAP_JSON}}', json.dumps(pipe.font_map()))
            .replace('{{FONTS_BASE}}', html.escape(args.fonts_base, quote=True))
            .replace('{{SOURCE_URL}}', html.escape(args.source_url, quote=True))
            .replace('{{BLOCKS}}', block))
    (out / 'index.html').write_text(page, encoding='utf-8')

    print(f'reflowtex: wrote {out / "index.html"}')
    print(f'         serve it with:  python -m http.server -d {out}')


if __name__ == '__main__':
    main()
