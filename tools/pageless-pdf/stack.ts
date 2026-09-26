#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Stack the chunk pages pageless_pdf.lua shipped into one strip page.
//
//     node tools/pageless-pdf/stack.ts <job.pdf> <pageless.json> <out.pdf>
//
// Each chunk page becomes a Form XObject placed edge to edge down a single page
// as tall as the chunk pages together – the heights LuaTeX wrote, so the
// stacking is exact to the backend's own rounding. Captured TikZ pictures,
// which the galley holds as empty placeholder boxes, are drawn back from their
// private pages at the recorded positions. The result is one page, as tall as
// the document: the reference rendering of the pageless document, for
// comparison with the browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const SP_PER_BP = 65536 * 72.27 / 72;          // TeX sp per PostScript point

interface Meta {
  unit: string;
  chunks: { page: number }[];
  pictures?: { page?: number; x: number; y: number; height: number; depth: number }[];
}

/** Stack job.pdf's chunk pages; returns what was drawn. */
export async function stack(jobPdf: string, meta: Meta, outPdf: string): Promise<{ width: number; height: number; chunks: number; pictures: number }> {
  if (meta.unit !== 'sp') throw new Error('unexpected unit in pageless.json');
  if (!meta.chunks.length) throw new Error('no chunks recorded');
  const src = await PDFDocument.load(readFileSync(jobPdf));
  const out = await PDFDocument.create();
  // MediaBox heights as LuaTeX wrote them
  const heights = meta.chunks.map(c => src.getPage(c.page - 1).getMediaBox().height);
  const width = src.getPage(meta.chunks[0].page - 1).getMediaBox().width;
  const total = heights.reduce((a, b) => a + b, 0);
  // (pdf-lib has no page-size limit; Acrobat's 14400 units do not apply here)
  const strip = out.addPage([width, total]);
  const pics = (meta.pictures ?? []).filter(p => p.page);
  const embedded = await out.embedPdf(src, [...meta.chunks.map(c => c.page - 1), ...pics.map(p => p.page! - 1)]);
  let top = 0;
  meta.chunks.forEach((_, i) => {
    strip.drawPage(embedded[i], { x: 0, y: total - (top + heights[i]) });
    top += heights[i];
  });
  // a picture's private page is exactly its box: its bottom edge sits at the
  // box's depth below the strip position of the box's top plus height
  pics.forEach((p, k) => strip.drawPage(embedded[meta.chunks.length + k],
    { x: p.x / SP_PER_BP, y: total - (p.y + p.height + p.depth) / SP_PER_BP }));
  writeFileSync(outPdf, await out.save());
  return { width, height: total, chunks: meta.chunks.length, pictures: pics.length };
}

if (import.meta.main) {
  const [job, metaPath, outPath] = process.argv.slice(2);
  if (!outPath) { console.error('usage: stack.ts <job.pdf> <pageless.json> <out.pdf>'); process.exit(2); }
  const r = await stack(job, JSON.parse(readFileSync(metaPath, 'utf8')), outPath);
  console.log(`${outPath}: 1 page, ${r.width.toFixed(3)} x ${r.height.toFixed(3)} bp, ${r.chunks} chunk(s), ${r.pictures} picture(s)`);
}
