#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Draw one glyph of a font (OpenType/CFF, or Type 1) as an SVG, zoomed in, with its vector
controls: the outline, its on-curve anchors (squares) and the off-curve
handles of each Bézier segment (circles on thin lines), over the glyph's
advance box and baseline — the way a vector editor shows a selected path.

    python website/tools/glyph_outline.py website/latex-fonts/SegmentSymbol.otf \\
        segmentSymbol > website/assets/glyphs/segment-symbol.svg

The SVG uses currentColor and --lt-outline-accent, so it follows the page's
theme; the {{< glyph-outline >}} shortcode inlines it.
"""
import sys
from fontTools import t1Lib
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

path, name = sys.argv[1], sys.argv[2]
if path.endswith('.pfb'):
    font = t1Lib.T1Font(path); font.parse()
    glyphs = font.getGlyphSet()
else:
    glyphs = TTFont(path).getGlyphSet()
glyph = glyphs[name]
pen = RecordingPen(); glyph.draw(pen)
adv = glyph.width

xs = [x for _, pts in pen.value for x, _ in pts] + [0, adv]
ys = [y for _, pts in pen.value for _, y in pts] + [0]
pad = 70
x0, x1 = min(xs) - pad, max(xs) + pad
top, bottom = max(ys) + pad, min(ys) - pad - 40      # room for the labels below
Y = lambda y: top - y                                 # font units, y up → SVG, y down
w, h = x1 - x0, top - bottom

d, handles, anchors, controls = [], [], [], []
cur = None
for op, pts in pen.value:
    if op == 'moveTo':
        (cur,) = pts; d.append(f'M{cur[0]} {Y(cur[1])}'); anchors.append(cur)
    elif op == 'lineTo':
        (cur,) = pts; d.append(f'L{cur[0]} {Y(cur[1])}'); anchors.append(cur)
    elif op == 'curveTo':
        c1, c2, p = pts
        d.append(f'C{c1[0]} {Y(c1[1])} {c2[0]} {Y(c2[1])} {p[0]} {Y(p[1])}')
        handles += [(cur, c1), (p, c2)]; controls += [c1, c2]; anchors.append(p); cur = p
    elif op == 'closePath':
        d.append('Z')

out = [f'<svg class="glyph-outline" xmlns="http://www.w3.org/2000/svg" viewBox="{x0} 0 {w} {h}" '
       f'role="img" aria-label="The glyph {name}, zoomed in, with its anchor points and control handles">']
grid = ' '.join(f'M{x} 0V{h}' for x in range((x0 // 100 + 1) * 100, x1, 100)) + ' ' + \
       ' '.join(f'M{x0} {Y(y)}H{x1}' for y in range((bottom // 100 + 1) * 100, top, 100))
out.append(f'<path d="{grid}" class="go-grid"/>')
out.append(f'<rect x="0" y="{Y(max(ys))}" width="{adv}" height="{max(ys) - min(min(ys), 0)}" class="go-box"/>')
out.append(f'<path d="M{x0} {Y(0)}H{x1}" class="go-baseline"/>')
out.append(f'<path d="{" ".join(d)}" class="go-fill"/>')
out.append('<path d="' + ' '.join(f'M{a[0]} {Y(a[1])}L{c[0]} {Y(c[1])}' for a, c in handles) + '" class="go-handle"/>')
out.append(f'<path d="{" ".join(d)}" class="go-path"/>')
out += [f'<circle cx="{x}" cy="{Y(y)}" r="7" class="go-control"/>' for x, y in controls]
out += [f'<rect x="{x - 8}" y="{Y(y) - 8}" width="16" height="16" class="go-anchor"/>' for x, y in anchors]
out.append(f'<text x="{x0 + 12}" y="{Y(0) - 12}" class="go-label">baseline</text>')
out.append(f'<text x="{adv}" y="{Y(min(ys)) + 60}" text-anchor="end" class="go-label">advance {adv}</text>')
out.append('</svg>')
print('\n'.join(out))
