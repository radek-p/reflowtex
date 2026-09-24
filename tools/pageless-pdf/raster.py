#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Rasterise a horizontal band of the pageless strip.

    raster.py <pageless.pdf> <top_pt> <height_pt> <out.png> [--dpi 144.54]

Positions are in TeX points from the strip's top. The default 144.54 dpi is
2 device pixels per TeX point, so a band whose top is a multiple of 0.5pt —
every chunk boundary is — starts on a pixel row, and bands from different
runs line up pixel for pixel. pdftoppm renders only the requested crop, so
the strip's height costs nothing.
"""
import subprocess
import sys
from pathlib import Path

PT_PER_BP = 72.27 / 72


def main() -> None:
    args = sys.argv[1:]
    dpi = 144.54
    if '--dpi' in args:
        i = args.index('--dpi'); dpi = float(args[i + 1]); del args[i:i + 2]
    if len(args) != 4:
        sys.exit(__doc__)
    pdf, top_pt, height_pt, out = Path(args[0]), float(args[1]), float(args[2]), Path(args[3])
    px_per_pt = dpi / 72 / PT_PER_BP
    y = round(top_pt * px_per_pt)
    h = round(height_pt * px_per_pt)
    info = subprocess.run(['pdfinfo', str(pdf)], capture_output=True, text=True, check=True).stdout
    width_bp = float([l for l in info.splitlines() if l.startswith('Page size')][0].split()[2])
    w = round(width_bp * dpi / 72)
    prefix = out.with_suffix('')
    subprocess.run(['pdftoppm', '-r', str(dpi), '-f', '1', '-l', '1', '-x', '0', '-y', str(y),
                    '-W', str(w), '-H', str(h), '-png', '-singlefile', str(pdf), str(prefix)], check=True)
    print(f'{out}: rows {y}..{y + h} of the strip at {px_per_pt:.4f} px/pt')


if __name__ == '__main__':
    main()
