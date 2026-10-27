// SPDX-License-Identifier: AGPL-3.0-or-later
// The strip's glyphs as vector-compare.ts reads them (traceStrip): each with
// its text, advance and size, and so its record in vector.json when no
// browser glyph took it, as large as it is (the report boxes it by them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mupdf from 'mupdf';
import { stripRecord, traceStrip } from '../../tools/pageless-pdf/vector-compare.ts';

const PT_PER_BP = 72.27 / 72;

/** A one-page PDF: "A" at 17 bp, then "b" at 10 bp, in Times. */
function pdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Times-Roman'));
  const resources = doc.addObject({ Font: { F1: font } });
  const page = doc.addPage([0, 0, 200, 100], 0, resources, 'BT /F1 17 Tf 20 60 Td (A) Tj ET BT /F1 10 Tf 20 30 Td (b) Tj ET');
  doc.insertPage(-1, page);
  return doc.saveToBuffer('').asUint8Array();
}

test('the strip\'s glyphs carry their text, advance and size; so do the records of those no browser glyph took', () => {
  const s = traceStrip(pdf());
  assert.equal(s.glyphs.length, 2);
  assert.equal(s.info.length, 2);
  const [a, b] = s.info;
  assert.equal(a.text, 'A');
  assert.equal(b.text, 'b');
  assert.ok(Math.abs(a.size - 17 * PT_PER_BP) < 1e-6, `A's size ${a.size}`);
  assert.ok(Math.abs(b.size - 10 * PT_PER_BP) < 1e-6, `b's size ${b.size}`);
  // Times' advances: A 0.722 em, b 0.5 em
  assert.ok(Math.abs(a.w - 0.722 * 17 * PT_PER_BP) < 0.01, `A's advance ${a.w}`);
  assert.ok(Math.abs(b.w - 0.5 * 10 * PT_PER_BP) < 0.01, `b's advance ${b.w}`);
  // origins: y down from the page's top, in pt
  assert.ok(Math.abs(s.glyphs[0][1] - 40 * PT_PER_BP) < 1e-6);
  const r = stripRecord(s.glyphs[0], a);
  assert.deepEqual(Object.keys(r).sort(), ['size', 'text', 'w', 'x', 'y']);
  assert.equal(r.text, 'A');
  assert.equal(r.size, Math.round(17 * PT_PER_BP * 100) / 100);
  assert.ok(r.w > 12);
});
