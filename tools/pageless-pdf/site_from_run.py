#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A viewer page from a pageless build's own extraction.

    site_from_run.py <build dir> <site dir> [--extra-script FILE ...]

The public demo build compiles the document several times (display-width
sampling) and its bundle is not the strip's compile; for a comparison the
bundle and the strip must come from one run. This takes the output.json that
pageless.py left beside pageless.pdf, runs the pipeline's encode stages on a
copy (transforms, protobuf, font provisioning) and writes index.html exactly
as examples/testmath/build.py does. Each --extra-script is copied beside it
and loaded after the viewer (files it loads in turn are copied by hand).

The display model is built the way the pipeline builds it, but anchored on
the strip's own run: that run is sample 0, and the same input.tex is
recompiled with \reflowtexWidthExtra raised by 128 pt per sample (in
samples/<k>/ under the build dir, the .aux copied so references resolve)
until three consecutive samples pass display_model.check_samples; the
model is then attached to the narrowest of them. When that is the strip's
run, displays render at the strip's width exactly as the strip and reflow
at other widths; when sample 0 had to be rejected the anchor is a wider
run and a warning says so. --single-width skips the sampling: displays
then render as captured, fixed at the strip's width.
"""
import argparse
import base64
import copy
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent
SRC = PUBLIC / 'src'
VANILLA = PUBLIC / 'integrations' / 'vanilla'
sys.path.insert(0, str(SRC / 'encode'))
from pipeline import Pipeline, viewer_script                   # noqa: E402
import transforms                                              # noqa: E402
import encode_pb                                               # noqa: E402
import display_model                                           # noqa: E402
from pipeline import DISPLAY_SAMPLE_STEP_SP, TEX_MAX_DIMEN_SP  # noqa: E402


def sample_display_model(build: Path, base: dict, passes: int) -> dict:
    """The pipeline's sampling loop with the strip's run as the first sample."""
    src = (build / 'input.tex').read_text(encoding='utf-8')
    m = re.search(r'\\reflowtexWidthExtra=(\d+)sp', src)
    if not m:
        sys.exit('input.tex has no \\reflowtexWidthExtra assignment: not a build of this template')
    base_extra = int(m.group(1))
    base_width = int(base['source_width'])
    shell_escape = '-shell-escape' if os.environ.get('REFLOWTEX_SHELL_ESCAPE') == '1' else '-no-shell-escape'
    env = dict(os.environ)
    env['TEXINPUTS'] = f"{SRC / 'latex'}{os.pathsep}{env.get('TEXINPUTS', '')}"

    def compile_at(extra: int, name: str, required: bool = True) -> dict | None:
        """The document with \\reflowtexWidthExtra = extra, compiled in
        samples/<name>/ (the .aux copied, so references resolve); reused when
        the same input was compiled before."""
        d = build / 'samples' / name
        d.mkdir(parents=True, exist_ok=True)
        (d / 'pics').mkdir(exist_ok=True)
        tex = src.replace(m.group(0), f'\\reflowtexWidthExtra={extra}sp')
        fresh = (d / 'input.tex').exists() and (d / 'input.tex').read_text(encoding='utf-8') == tex \
            and (d / 'output.json').exists()
        if not fresh:
            (d / 'input.tex').write_text(tex, encoding='utf-8')
            for f in ('serializer.lua', 'input.aux'):
                if (build / f).exists():
                    shutil.copy(build / f, d / f)
            (d / 'output.json').unlink(missing_ok=True)
            for _ in range(max(1, passes)):
                subprocess.run(['lualatex', shell_escape, '-interaction=nonstopmode', 'input.tex'],
                               cwd=d, capture_output=True, text=True, env=env)
        log = (d / 'input.log').read_text(encoding='utf-8', errors='replace') if (d / 'input.log').exists() else ''
        errors = [l for l in log.splitlines() if l.startswith('! ')]
        if errors or not (d / 'output.json').exists():
            if not required:
                return None
            sys.exit(f'sample {name} (+{extra / 65536:g} pt) failed:\n' + '\n'.join(errors[:8]) + f'\n  see {d / "input.log"}')
        return json.loads((d / 'output.json').read_text())

    samples = [base]
    k = 0
    while True:
        if len(samples) >= 3:
            ok, reason = display_model.check_samples(*samples[-3:])
            if ok:
                widths = [s['source_width'] / 65536 for s in samples[-3:]]
                if samples[-3] is base:
                    data, note = display_model.attach_model(samples[-3], samples[-2], samples[-1]), ''
                else:
                    data, fixed = display_model.anchor_model(base, samples[-2], samples[-1])
                    probe = lambda w: compile_at(base_extra + w - base_width, f'w{w}', required=False)
                    n_wide, n_probes = display_model.wide_variants(data, samples[-2], samples[-1], probe)
                    note = (f", anchored at the strip's {base['source_width'] / 65536:g} pt"
                            + (f'; {n_wide} display(s) set another way there get a wide form '
                               f'({n_probes} compilation(s) to find where)' if n_wide else ''))
                print(f'  display model stable at {widths[0]:g}, {widths[1]:g}, {widths[2]:g} pt{note}')
                return data
            print(f'  rejected display sample at {samples[-3]["source_width"] / 65536:g} pt: {reason}')
            samples = samples[-2:]
        k += 1
        extra = base_extra + k * DISPLAY_SAMPLE_STEP_SP
        if int(samples[-1]['source_width']) + DISPLAY_SAMPLE_STEP_SP >= TEX_MAX_DIMEN_SP:
            sys.exit('no stable affine display topology before \\maxdimen')
        s = compile_at(extra, str(k))
        print(f'  sample {k}: width {s["source_width"] / 65536:g} pt')
        if int(s['source_width']) <= int(samples[-1]['source_width']):
            sys.exit('sample width did not increase')
        samples.append(s)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('build', type=Path)
    ap.add_argument('site', type=Path)
    ap.add_argument('--extra-script', action='append', default=[])
    ap.add_argument('--title', default='pageless run — Reflow TeX')
    ap.add_argument('--single-width', action='store_true', help='no display model: displays fixed at the strip\'s width')
    ap.add_argument('--passes', type=int, default=1, help='lualatex passes per extra sample (the .aux is copied from the strip run)')
    args = ap.parse_args()

    data = json.loads((args.build / 'output.json').read_text())
    if not args.single_width and display_model.has_displays(data):
        data = sample_display_model(args.build, data, args.passes)
    site = args.site
    site.mkdir(parents=True, exist_ok=True)
    pipe = Pipeline(build_root=args.build / 'site-build', fonts_dir=site / 'fonts',
                    template=PUBLIC / 'src' / 'extract' / 'template.tex')
    work = args.build / 'site-build' / 'run'
    work.mkdir(parents=True, exist_ok=True)
    (work / 'pics').mkdir(exist_ok=True)
    for f in ('input.pdf', 'pageless.json'):
        if (args.build / f).exists():
            shutil.copy(args.build / f, work / f)
    for p in (args.build / 'pics').glob('*'):
        shutil.copy(p, work / 'pics' / p.name)

    data = copy.deepcopy(data)
    n_dropped = transforms.drop_unreferenced_paragraphs(data)
    n_pictures = transforms.convert_pictures(data, work)
    n_stripped = transforms.strip_unsupported_nodes(data)
    n_legacy = transforms.normalise_legacy_font_addressing(data, pipe.fonts)
    n_rewritten = transforms.normalise_glyph_addressing(data, pipe.fonts)
    (work / 'output.json').write_text(json.dumps(data))
    print(f'  dropped {n_dropped} paragraph(s), {n_pictures} picture(s), stripped {n_stripped}, '
          f'legacy {n_legacy}, PUA {n_rewritten}')
    blob = encode_pb.build_document(data).SerializeToString()
    pipe.patch_fonts([data])
    print(f'  bundle {len(blob)} bytes')

    shutil.copy(viewer_script(), site / 'latex-viewer.js')
    shutil.copy(SRC / 'viewer' / 'protobuf.min.js', site / 'protobuf.min.js')
    extra_tags = ''
    for extra in args.extra_script:
        extra = Path(extra)
        shutil.copy(extra, site / extra.name)
        extra_tags += f'\n<script src="{html.escape(extra.name, quote=True)}"></script>'
    block = f'<div class="latex-block" data-nodelist-b64="{base64.b64encode(blob).decode()}"></div>'
    page = ((VANILLA / 'page.template.html').read_text(encoding='utf-8')
            .replace('{{TITLE}}', html.escape(args.title))
            .replace('{{SCHEMA_B64}}', pipe.schema_b64())
            .replace('{{FONT_MAP_JSON}}', json.dumps(pipe.font_map()))
            .replace('{{FONTS_BASE}}', 'fonts/')
            .replace('{{SOURCE_URL}}', 'https://github.com/radek-p/reflowtex')
            .replace('{{BLOCKS}}', block))
    marker = '<script src="latex-viewer.js"></script>'
    (site / 'index.html').write_text(page.replace(marker, marker + extra_tags), encoding='utf-8')
    print(f'site: {site}/index.html')


if __name__ == '__main__':
    main()
