#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Rasterise a horizontal band of the pageless strip.
//
//     node tools/pageless-pdf/raster.ts <pageless.pdf> <top_pt> <height_pt> <out.png> [--dpi 144.54]
//
// Positions are in TeX points from the strip's top. The default 144.54 dpi is
// 2 device pixels per TeX point, so a band whose top is a multiple of 0.5pt –
// every chunk boundary is – starts on a pixel row, and bands from different
// runs line up pixel for pixel. MuPDF draws into a pixmap of the band alone,
// so the strip's height costs nothing; the band is pixel for pixel the same
// rows of MuPDF's whole-strip raster (compare.ts's). (raster.py's pdftoppm
// crop sat a row lower.)
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import * as mupdf from 'mupdf';

const PT_PER_BP = 72.27 / 72;

/** Rows [top, top + height) pt of the strip's first page, as PNG bytes. */
export function rasterBand(pdf: string, topPt: number, heightPt: number, dpi = 144.54): { png: Uint8Array; y: number; h: number; pxPerPt: number } {
  const pxPerPt = dpi / 72 / PT_PER_BP;
  const y = Math.round(topPt * pxPerPt), h = Math.round(heightPt * pxPerPt);
  const page = mupdf.Document.openDocument(readFileSync(pdf), 'application/pdf').loadPage(0);
  const [x0, , x1] = page.getBounds();
  const w = Math.round((x1 - x0) * dpi / 72);
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, y, w, y + h], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(dpi / 72, dpi / 72), pix);
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  return { png: pix.asPNG(), y, h, pxPerPt };
}

if (import.meta.main) {
  const { values: v, positionals: p } = parseArgs({ allowPositionals: true, options: { dpi: { type: 'string', default: '144.54' } } });
  if (p.length !== 4) { console.error('usage: raster.ts <pageless.pdf> <top_pt> <height_pt> <out.png> [--dpi 144.54]'); process.exit(2); }
  const r = rasterBand(p[0], Number(p[1]), Number(p[2]), Number(v.dpi));
  writeFileSync(p[3], r.png);
  console.log(`${p[3]}: rows ${r.y}..${r.y + r.h} of the strip at ${r.pxPerPt.toFixed(4)} px/pt`);
}
