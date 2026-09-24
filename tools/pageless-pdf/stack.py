#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Stack the chunk pages pageless_pdf.lua shipped into one strip page.

    stack.py <job.pdf> <pageless.json> <out.pdf>

Each chunk page becomes a Form XObject placed edge to edge down a single page
whose height is the sum of the chunk pages' MediaBox heights — the heights
LuaTeX wrote, so the stacking is exact to the backend's own rounding. Captured
TikZ pictures, which the galley holds as empty placeholder boxes, are drawn
back from their private pages at the recorded positions. The result is one
page, as tall as the document, that a PDF rasteriser can crop from at any
offset (pdftoppm -x -y -W -H): the reference rendering of the pageless
document, for pixel comparison against the browser.
"""
import json
import sys
from pathlib import Path

import pikepdf
from pikepdf import Name

SP_PER_BP = 65536 * 72.27 / 72          # TeX sp per PostScript point


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    job, meta_path, out_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    meta = json.loads(meta_path.read_text())
    if meta.get('unit') != 'sp':
        sys.exit('unexpected unit in pageless.json')

    src = pikepdf.open(job)
    chunks = meta['chunks']
    if not chunks:
        sys.exit('no chunks recorded')

    # MediaBox heights as LuaTeX wrote them, so the strip is consistent with
    # the pages' own content placement
    heights = []
    width = None
    for ch in chunks:
        page = src.pages[ch['page'] - 1]
        x0, y0, x1, y1 = (float(v) for v in page.mediabox)
        heights.append(y1 - y0)
        width = x1 - x0 if width is None else width
    total = sum(heights)

    out = pikepdf.new()
    # Not add_blank_page: it enforces Acrobat's 14400-unit page limit, which
    # a document strip exceeds by design. Poppler and MuPDF render any size.
    strip = pikepdf.Page(out.make_indirect(pikepdf.Dictionary(
        Type=Name.Page,
        MediaBox=pikepdf.Array([0, 0, width, total]),
        Resources=pikepdf.Dictionary(),
    )))
    out.pages.append(strip)
    ops = []
    y_top = 0.0                             # from the top of the strip
    for ch, h in zip(chunks, heights):
        page = src.pages[ch['page'] - 1]
        xobj = out.copy_foreign(page.as_form_xobject())
        name = strip.add_resource(xobj, Name.XObject, prefix='Chunk')
        y = total - (y_top + h)             # PDF y of the chunk's bottom edge
        ops.append(f'q 1 0 0 1 0 {y:.6f} cm {name} Do Q')
        y_top += h

    drawn = 0
    for pic in meta.get('pictures', []):
        if not pic.get('page'):
            continue
        page = src.pages[pic['page'] - 1]
        xobj = out.copy_foreign(page.as_form_xobject())
        name = strip.add_resource(xobj, Name.XObject, prefix='Pic')
        x = pic['x'] / SP_PER_BP
        # the private page is exactly the box's size; its bottom edge sits at
        # the box's depth below the strip position of the box's top plus height
        y = total - (pic['y'] + pic['height'] + pic['depth']) / SP_PER_BP
        ops.append(f'q 1 0 0 1 {x:.6f} {y:.6f} cm {name} Do Q')
        drawn += 1

    strip.Contents = out.make_stream('\n'.join(ops).encode('ascii'))
    out.save(out_path)
    print(f'{out_path}: 1 page, {width:.3f} x {total:.3f} bp, '
          f'{len(chunks)} chunk(s), {drawn} picture(s)')


if __name__ == '__main__':
    main()
