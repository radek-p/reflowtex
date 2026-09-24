#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Cut compare.py's pictures into tiles a web page can load one at a time.

    tiles.py <out dir> --strip ID <compare dir> <vector.json> [--strip ...]
             [--fine ID <compare dir of a --supersample run> ...] [--tile-pt 500]

For each strip, the strip is cut into tiles of --tile-pt points, and for
each the rows of compare.py's diff that pair with it (strip and browser
aligned line by line, as in diff.png and heat.png) give the pictures, full
resolution:

    <ID>/heat-<k>.webp      heat.png: white where the two agree, red by how
                            much a pixel differs (16 levels; intensity times
                            --gain, 1.6, then raised to --gamma, 1.5)
    <ID>/fine-<k>.webp      the same from the --fine run: both sides drawn K
                            times finer and averaged down, which leaves less of
                            the two renderers' own anti-aliasing
    <ID>/pdf-<k>.webp       the strip (LuaTeX's PDF), greyscale (from the
                            --fine run when there is one)
    <ID>/browser-<k>.webp   the browser, greyscale, same rows

manifest.json lists the strips with their measurements (compare.py's row
counts and vector_compare.py's exact glyph placement) and, per tile, the
strip's y range and how many rows of it differ, so a page can show where the
differences are without loading the pictures.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HEAT_LEVELS = 16
BLANK = (232, 232, 232)          # compare.py's colour for a side with no row


def heat_palette_image(heat: np.ndarray, blank_rows: np.ndarray, gamma: float, gain: float) -> Image.Image:
    """heat.png's red scale (255, 255−d, 255−d), its intensity multiplied by
    `gain` (capped at full red), raised to `gamma` and folded to HEAT_LEVELS
    steps; rows with no counterpart keep compare.py's blank grey. A gamma
    above 1 keeps a pixel partly off (an anti-aliased edge a fraction of a
    pixel away) paler than one wholly off (ink that is not there), so
    misplaced ink stands out from rasterisation; the gain makes both easier
    to see."""
    d = (255 - heat[:, :, 1].astype(np.float64)) / 255
    level = np.rint(np.minimum(1, d * gain) ** gamma * (HEAT_LEVELS - 1))
    step = 255 // (HEAT_LEVELS - 1)
    v = (255 - level * step).astype(np.uint8)
    out = np.empty(heat.shape, np.uint8)
    out[:, :, 0] = 255
    out[:, :, 1] = v
    out[:, :, 2] = v
    out[blank_rows] = BLANK
    return Image.fromarray(out)


class Run:
    """One compare.py output: its pictures and its row pairing (rows.tsv)."""

    def __init__(self, cdir: Path):
        self.report = json.loads((cdir / 'report.json').read_text())
        self.heat = np.asarray(Image.open(cdir / 'heat.png').convert('RGB'))
        diff = np.asarray(Image.open(cdir / 'diff.png').convert('RGB'))
        W = self.heat.shape[1]
        bar = diff.shape[1] - 2 * W
        self.left, self.right = diff[:, :W], diff[:, W + bar:]
        rows = [line.split('\t') for line in (cdir / 'rows.tsv').read_text().splitlines()[1:]]
        self.strip_row = np.array([int(r[0]) for r in rows])
        self.browser_row = np.array([int(r[1]) for r in rows])
        self.verdict = np.array([r[2] for r in rows])
        # the diff row where each strip row is, carried forward over rows the
        # strip does not have, so a range of strip rows maps to diff rows
        self.first = np.maximum.accumulate(np.where(self.strip_row >= 0, self.strip_row, -1))

    def rows_for(self, s0: int, s1: int) -> tuple[int, int]:
        """The diff rows [a, b) that pair with strip rows [s0, s1)."""
        return int(np.searchsorted(self.first, s0)), int(np.searchsorted(self.first, s1))

    def strong_share(self) -> float:
        """The share of the picture's pixels that differ by more than half."""
        d = 255 - self.heat[:, :, 1].astype(np.int16)
        paired = (self.strip_row >= 0) & (self.browser_row >= 0)
        return float((d[paired] > 128).mean())

    def pixels(self) -> dict:
        r = self.report['rows']
        return {'strip_rows': r['strip'], 'browser_rows': r['browser'],
                'equal': r['equal'], 'differing': r['differing'], 'shifted': r['shifted'],
                'unmatched': r['unmatched'], 'spacing': r['spacing'],
                'offset_pt': self.report['offset_pt'], 'strong_share': self.strong_share(),
                'supersample': self.report.get('settings', {}).get('supersample', 1)}


def strip_tiles(out: Path, sid: str, cdir: Path, vec_path: Path, tile_pt: float, gamma: float, gain: float,
                fine_dir: Path | None = None, fine_factor: int = 4) -> dict:
    """Tiles of `tile_pt` points of the strip. Each covers the same strip rows
    in both runs (the coarse one, and a supersampled one if given), so the
    two heat maps of a tile show the same part of the paper. The PDF and
    browser pictures come from the supersampled run when there is one."""
    coarse = Run(cdir)
    fine = Run(fine_dir) if fine_dir else None
    vec = json.loads(vec_path.read_text())
    ppp = coarse.report['ppp']
    W = coarse.heat.shape[1]
    th = int(round(tile_pt * ppp))
    n_strip = coarse.report['rows']['strip']
    d = out / sid
    d.mkdir(parents=True, exist_ok=True)
    pics = fine or coarse
    tiles = []
    for k, s0 in enumerate(range(0, n_strip, th)):
        s1 = min(n_strip, s0 + th)
        tile = {'y0_pt': round(s0 / ppp, 1), 'y1_pt': round(s1 / ppp, 1)}
        for name, run in (('heat', coarse), ('fine', fine)):
            if run is None:
                continue
            a, b = run.rows_for(s0, s1)
            blank = (run.strip_row[a:b] < 0) | (run.browser_row[a:b] < 0)
            heat_palette_image(run.heat[a:b], blank, gamma, gain).save(d / f'{name}-{k}.webp', 'WEBP', lossless=True, method=6)
            v = run.verdict[a:b]
            tile[name] = {'rows': b - a, 'differing': int((v == 'differ').sum()), 'shifted': int((v == 'shifted').sum()),
                          'unmatched': int((v == 'unmatched').sum()), 'spacing': int((v == 'spacing').sum())}
        a, b = pics.rows_for(s0, s1)
        for name, img in (('pdf', pics.left), ('browser', pics.right)):
            Image.fromarray(img[a:b]).convert('L').save(d / f'{name}-{k}.webp', 'WEBP', lossless=True, method=6)
        tile['rows'] = b - a
        tiles.append(tile)
    lines = vec['lines']
    g = vec['glyphs']
    return {
        'id': sid,
        'hsize_pt': coarse.report['hsize_pt'],
        'margin_pt': coarse.report['margin_pt'],
        'ppp': ppp,
        'fine_factor': fine_factor if fine else None,
        'width_px': W,
        'tile_rows': th,
        'tiles': tiles,
        'pixels': coarse.pixels(),
        'pixels_fine': fine.pixels() if fine else None,
        'glyphs': {
            'strip': g['strip'], 'browser': g['viewer'], 'matched': g['matched'],
            'window_pt': vec['window_pt'],
            'within_0_1pt': sum(1 for m in vec['matched'] if abs(m['dx']) <= 0.1 and abs(m['dy']) <= 0.1),
            'lines': len(lines),
            'lines_within_0_1pt': sum(1 for l in lines if l['max_abs_dx'] <= 0.1),
            'lines_within_0_5pt': sum(1 for l in lines if l['max_abs_dx'] <= 0.5),
            'vertical_largest_pt': max((abs(m['dy']) for m in vec['matched']), default=None),
            'horizontal_largest_pt': max((abs(m['dx']) for m in vec['matched']), default=None),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out', type=Path)
    ap.add_argument('--strip', nargs=3, action='append', metavar=('ID', 'COMPARE_DIR', 'VECTOR_JSON'), required=True)
    ap.add_argument('--fine', nargs=2, action='append', default=[], metavar=('ID', 'COMPARE_DIR'),
                    help='a supersampled compare.py run of the same strip (compare.py --supersample K)')
    ap.add_argument('--fine-factor', type=int, default=4, help='the K of the --fine runs')
    ap.add_argument('--tile-pt', type=float, default=500)
    ap.add_argument('--gamma', type=float, default=1.5, help='heat map intensity exponent (1: as heat.png)')
    ap.add_argument('--gain', type=float, default=1.6, help='heat map intensity factor, before the exponent')
    args = ap.parse_args()
    fine = dict(args.fine)
    args.out.mkdir(parents=True, exist_ok=True)
    strips = []
    for sid, cdir, vec in args.strip:
        s = strip_tiles(args.out, sid, Path(cdir), Path(vec), args.tile_pt, args.gamma, args.gain,
                        Path(fine[sid]) if sid in fine else None, args.fine_factor)
        print(f'{sid}: {len(s["tiles"])} tiles of {s["tile_rows"]} strip rows, {s["width_px"]} px wide'
              + (f'; strong differences {s["pixels"]["strong_share"]:.4%} → {s["pixels_fine"]["strong_share"]:.4%} '
                 f'drawn ×{args.fine_factor} finer' if s['pixels_fine'] else ''))
        strips.append(s)
    (args.out / 'manifest.json').write_text(json.dumps({'tile_pt': args.tile_pt, 'gamma': args.gamma, 'gain': args.gain,
                                                        'strips': strips}, indent=1))
    total = sum(p.stat().st_size for p in args.out.rglob('*') if p.is_file())
    print(f'→ {args.out}/manifest.json, {total / 1e6:.1f} MB in all')


if __name__ == '__main__':
    main()
