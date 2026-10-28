#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Stack the chunk pages pageless_pdf.lua shipped into one strip page.
//
//     node tools/pageless-pdf/stack.ts <job.pdf> <pageless.json> <out.pdf>
//
// Each chunk page becomes a Form XObject placed edge to edge down a single page
// as tall as the chunk pages together – the heights LuaTeX wrote, so the
// stacking is exact to the backend's own rounding (captured TikZ pictures are
// in the chunk pages already: pageless_pdf.lua puts each back in its place).
// The result is one page, as tall as the document: the reference rendering
// of the pageless document, for comparison with the browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

interface Meta {
  unit: string;
  chunks: { page: number }[];
}

/** Stack job.pdf's chunk pages; returns what was drawn. */
export async function stack(jobPdf: string, meta: Meta, outPdf: string): Promise<{ width: number; height: number; chunks: number }> {
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
  const embedded = await out.embedPdf(src, meta.chunks.map(c => c.page - 1));
  let top = 0;
  meta.chunks.forEach((_, i) => {
    strip.drawPage(embedded[i], { x: 0, y: total - (top + heights[i]) });
    top += heights[i];
  });
  writeFileSync(outPdf, await out.save());
  return { width, height: total, chunks: meta.chunks.length };
}

if (import.meta.main) {
  const [job, metaPath, outPath] = process.argv.slice(2);
  if (!outPath) { console.error('usage: stack.ts <job.pdf> <pageless.json> <out.pdf>'); process.exit(2); }
  const r = await stack(job, JSON.parse(readFileSync(metaPath, 'utf8')), outPath);
  console.log(`${outPath}: 1 page, ${r.width.toFixed(3)} x ${r.height.toFixed(3)} bp, ${r.chunks} chunk(s)`);
}
