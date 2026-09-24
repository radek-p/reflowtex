#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A LaTeX document as a pageless PDF: one page as tall as the document.

    pageless.py <document.tex> [-o DIR] [--template T] [--passes N]
                [--margin 36pt] [--width-extra 0pt]

The document is compiled as the pipeline compiles it – inside the
extraction template, with the serializer capturing the galley – plus two
lines: pageless_pdf.lua loaded after the serializer, and a hook at the end
of the document that ships the captured galley as a few very tall pages.
stack.py then stacks those pages into one, `pageless.pdf`: the document
with no page breaks, every box and every glue where TeX put them. It is the
reference the browser's rendering can be compared with at the same width.

The run also leaves the serializer's output.json beside the PDF, so the
PDF and a page built from that output.json describe the same compilation.
Unlike the pipeline, this compiles once, at the document's own width (the
pipeline also compiles documents with displays at wider widths, to model
them).

A complete document fills the template as the pipeline fills it: its
\\documentclass line replaces the template's, and its preamble and body go
in the template's slots. A template without a \\documentclass line (such as
examples/testmath/template.tex) takes the class line as part of the
preamble.

Outputs in DIR (default: pageless/<document stem>/ in the current
directory): pageless.pdf, pageless.json (the chunk pages and pictures, sp),
output.json, and the run's input.tex, input.log and input.pdf.

Needs lualatex on PATH and pikepdf (pip install pikepdf). Shell escape is
off unless REFLOWTEX_SHELL_ESCAPE=1, as in the pipeline.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
EXTRACT = REPO / 'src' / 'extract'
LATEX_DIR = REPO / 'src' / 'latex'
sys.path.insert(0, str(REPO / 'src' / 'encode'))
from pipeline import (PREAMBLE_MARK, CONTENT_MARK, WIDTH_EXTRA_MARK,  # noqa: E402
                      TEMPLATE_CLASS_RE, split_document)


def instrument(template: str, margin: str) -> str:
    """The template with the shipper loaded and the end-of-document hook."""
    serializer_line = '\\directlua{dofile("serializer.lua")}'
    if serializer_line not in template:
        sys.exit('template does not load serializer.lua')
    template = template.replace(
        serializer_line,
        serializer_line + '\n\\directlua{dofile("pageless_pdf.lua")}', 1)
    hook = ('\\AddToHook{enddocument/afterlastpage}{%\n'
            f'  \\pdfvariable horigin={margin} \\pdfvariable vorigin=0pt\n'
            f'  \\directlua{{Pageless.ship{{margin = tex.sp("{margin}")}}}}}}\n')
    begin = '\\begin{document}'
    if begin not in template:
        sys.exit('template has no \\begin{document}')
    return template.replace(begin, hook + begin, 1)


def fill(template: str, document: str, width_extra_sp: int) -> str:
    doc = split_document(document)
    if not doc:
        sys.exit('not a complete document (\\documentclass … \\begin{document} … \\end{document})')
    class_line, preamble, body = doc
    template, n = TEMPLATE_CLASS_RE.subn(lambda _: class_line, template, count=1)
    if not n:
        preamble = class_line + preamble
    return (template.replace(PREAMBLE_MARK, preamble)
                    .replace(CONTENT_MARK, body)
                    .replace(WIDTH_EXTRA_MARK, str(width_extra_sp)))


def dimen_sp(s: str) -> int:
    """A TeX dimension (pt, bp, mm, cm, in, pc) in sp."""
    m = re.fullmatch(r'\s*(-?[0-9.]+)\s*(pt|bp|mm|cm|in|pc)?\s*', s)
    if not m:
        sys.exit(f'bad dimension: {s!r}')
    pt = float(m.group(1)) * {'pt': 1, 'bp': 72.27 / 72, 'mm': 72.27 / 25.4, 'cm': 72.27 / 2.54,
                              'in': 72.27, 'pc': 12}[m.group(2) or 'pt']
    return round(pt * 65536)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('document', type=Path)
    ap.add_argument('-o', '--out', type=Path, default=None, help='output directory')
    ap.add_argument('--template', type=Path, default=EXTRACT / 'template.tex',
                    help='extraction template (default: the pipeline\'s)')
    ap.add_argument('--passes', type=int, default=2, help='lualatex passes (references need 2 or 3)')
    ap.add_argument('--margin', default='36pt', help='white margin left and right of the column')
    ap.add_argument('--width-extra', default='0pt',
                    help='added to the document\'s \\textwidth through the template\'s width hook, e.g. 85pt')
    args = ap.parse_args()

    out = (args.out or Path('pageless') / args.document.stem).resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / 'pics').mkdir(exist_ok=True)
    template = instrument(args.template.read_text(encoding='utf-8'), args.margin)
    tex = fill(template, args.document.read_text(encoding='utf-8'), dimen_sp(args.width_extra))
    (out / 'input.tex').write_text(tex, encoding='utf-8')
    shutil.copy(EXTRACT / 'serializer.lua', out / 'serializer.lua')
    shutil.copy(HERE / 'pageless_pdf.lua', out / 'pageless_pdf.lua')
    for stale in ('input.aux', 'pageless.json', 'input.pdf', 'output.json', 'pageless.pdf'):
        (out / stale).unlink(missing_ok=True)

    shell_escape = '-shell-escape' if os.environ.get('REFLOWTEX_SHELL_ESCAPE') == '1' else '-no-shell-escape'
    env = dict(os.environ)
    env['TEXINPUTS'] = f"{LATEX_DIR}{os.pathsep}{env.get('TEXINPUTS', '')}"
    # the document's own files (\input, graphics) resolve beside it
    env['TEXINPUTS'] = f"{args.document.resolve().parent}{os.pathsep}{env['TEXINPUTS']}"
    for n in range(max(1, args.passes)):
        r = subprocess.run(['lualatex', shell_escape, '-interaction=nonstopmode', 'input.tex'],
                           cwd=out, capture_output=True, text=True, env=env)
        log_path = out / 'input.log'
        log = log_path.read_text(encoding='utf-8', errors='replace') if log_path.exists() else ''
        errors = [l for l in log.splitlines() if l.startswith('! ')]
        if r.returncode != 0 or errors or not (out / 'input.pdf').exists():
            sys.exit(f'lualatex pass {n + 1} failed:\n' + '\n'.join(errors[:10]) + f'\n  see {log_path}')
        shipped = [l for l in log.splitlines() if l.startswith('pageless: ')]
        print(f'  pass {n + 1}: {shipped[-1] if shipped else "no pageless line in the log"}')

    if not (out / 'pageless.json').exists():
        sys.exit('the run wrote no pageless.json')
    r = subprocess.run([sys.executable, str(HERE / 'stack.py'), 'input.pdf', 'pageless.json', 'pageless.pdf'],
                       cwd=out, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('stack.py failed:\n' + r.stderr[-2000:])
    print('  ' + r.stdout.strip())
    print(f'pageless: {out / "pageless.pdf"}')


if __name__ == '__main__':
    main()
