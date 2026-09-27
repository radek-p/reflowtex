// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/mathml.ts: LaTeX's MathML (its <jobname>-luamml-mathml.html,
// written with tagging on and luamml loaded) put where each formula is, as
// LaTeX wrote it – nothing converted, completed or cleaned up – with its
// spoken form as alttext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachMathML, parseMathmlFile } from '../../src/pipeline/mathml.ts';
import type { SerializerOutput, TexNode } from '../../src/pipeline/nodes.ts';

const NS = 'xmlns="http://www.w3.org/1998/Math/MathML"';
// As LaTeX (latex-lab-math) writes the file: a <div> per top-level formula.
const entry = (n: number, source: string, math: string) =>
  `<div>\n<h2>\\mml ${n}</h2>\n<p>${source}</p>\n<p>D34B06587E3A7167AE362781C497C98A </p>\n\n${math}\n</div>\n`;
const FILE = '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml">\n'
  + entry(1, '$x$', `<math ${NS}>\n <mi>𝑥</mi>\n</math>`)
  + entry(2, '$\\text {a $y$ b}$', `<math ${NS}>\n <mtext>\n a \n <math ${NS}>\n <mi>𝑦</mi>\n </math>\n  b\n </mtext>\n</math>`)
  + entry(3, '\\begin {align}…\\end {align}', `<math display="block" ${NS}>\n <mtable intent=":system-of-equations">\n <mtr><mtd><mi>𝑎</mi></mtd></mtr>\n </mtable>\n</math>`)
  + '</html>';

test('the file: each \\mml N to its <math>, as written (a formula in \\text inside it)', () => {
  const f = parseMathmlFile(FILE);
  assert.deepEqual([...f.keys()], [1, 2, 3]);
  assert.equal(f.get(1), `<math ${NS}>\n <mi>𝑥</mi>\n</math>`);
  assert.match(f.get(2)!, /^<math [^>]*>\n <mtext>\n a \n <math [^>]*>\n <mi>𝑦<\/mi>\n <\/math>\n  b\n <\/mtext>\n<\/math>$/);
  assert.match(f.get(3)!, /intent=":system-of-equations"/);
});

const begin = (mathml?: number): TexNode => ({ type: 'math', subtype: 0, ...(mathml ? { mathml } : {}) });
const end: TexNode = { type: 'math', subtype: 1 };
const glyph = (c: string): TexNode => ({ type: 'glyph', char: c.codePointAt(0) });
const doc = (o: Partial<SerializerOutput>): SerializerOutput => ({ fonts: {}, paragraphs: [], content: [], streams: [], ...o } as SerializerOutput);

test('an inline formula: its MathML on its begin-math node, unchanged; one nested in it has none', () => {
  const inner = begin(2);
  const d = doc({ paragraphs: [{ nodes: [begin(1), glyph('x'), end, glyph(' '), begin(2), { type: 'hlist', children: [inner, glyph('y'), end] }, end] }] });
  const n = attachMathML(d, { formulas: parseMathmlFile(FILE) });
  assert.equal(n, 2);
  const [a, , , , b] = d.paragraphs[0].nodes;
  assert.equal(a.mathml, `<math ${NS}>\n <mi>𝑥</mi>\n</math>`);
  assert.match(String(b.mathml), /<mtext>/);
  assert.equal(inner.mathml, undefined);
});

test('a display: its item gets the MathML; an alignment’s rows share a number, the first carries the table', () => {
  const row = (t: string) => ({ kind: 'display', display_no: 7, box: { type: 'hlist', subtype: 4, children: [glyph(t)] } });
  const d = doc({ content: [row('a'), { kind: 'vspace', amount: 1 }, row('b')], mathml: [{ n: 3, display: 7 }] } as never);
  assert.equal(attachMathML(d, { formulas: parseMathmlFile(FILE) }), 1);
  assert.match(String(d.content[0].mathml), /^<math display="block"[^>]*>\n <mtable intent=":system-of-equations">/);
  assert.equal(d.content[2].mathml, undefined);
  assert.equal(d.content[0].display_no, undefined, 'the numbers are bookkeeping');
  assert.equal((d as { mathml?: unknown }).mathml, undefined);
});

test('streams (footnotes, boxes) get theirs too', () => {
  const d = doc({ streams: [{ kind: 'footnote', content: [{ kind: 'display', display_no: 1, box: { type: 'hlist' } }] }], mathml: [{ n: 1, display: 1 }] } as never);
  attachMathML(d, { formulas: parseMathmlFile(FILE) });
  assert.match(String(d.streams[0].content![0].mathml), /<mi>𝑥<\/mi>/);
});

test('no file (the author did not enable luamml): no MathML, and the numbers go', () => {
  const d = doc({ paragraphs: [{ nodes: [begin(1), glyph('x'), end] }], content: [{ kind: 'display', display_no: 1 }], mathml: [{ n: 1, display: 1 }] } as never);
  assert.equal(attachMathML(d), 0);
  assert.equal(d.paragraphs[0].nodes[0].mathml, undefined);
  assert.equal(d.content[0].display_no, undefined);
});

test('alttext: each formula carries its spoken form, from the speaker given, on its root', () => {
  const d = doc({ paragraphs: [{ nodes: [begin(1), glyph('x'), end] }] });
  attachMathML(d, { formulas: parseMathmlFile(FILE), speak: () => 'x "quoted" & <more>' });
  assert.equal(d.paragraphs[0].nodes[0].mathml, `<math alttext="x &quot;quoted&quot; &amp; &lt;more>" ${NS}>\n <mi>𝑥</mi>\n</math>`);
});
