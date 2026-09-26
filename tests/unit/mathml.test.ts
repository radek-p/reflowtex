// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/mathml.ts: from the formulas the capture recorded (luamml's
// trees, with placeholders for the boxes it could not read) to one MathML
// string per formula a reader meets – each inline formula of a paragraph,
// each display (an alignment's rows together).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toXml, cleanup, attachMathML, type MathNode } from '../../src/pipeline/mathml.ts';
import { readSerializerOutput, type TexNode } from '../../src/pipeline/nodes.ts';

const el = (name: string, children: MathNode[] = [], attrs?: Record<string, string>): MathNode =>
  ({ name, children, ...(attrs ? { attrs } : {}) });
const NS = ' xmlns="http://www.w3.org/1998/Math/MathML"';
/** Drops the namespace, for shorter expectations. */
const bare = (s: unknown) => String(s).replaceAll(NS, '');

const glyph = (ch: string): TexNode => ({ type: 'glyph', char: ch.codePointAt(0) });
const begin = (id: number): TexNode => ({ type: 'math', subtype: 0, mathml: id });
const end = (): TexNode => ({ type: 'math', subtype: 1 });
const cell = (...children: TexNode[]): TexNode => ({ type: 'hlist', subtype: 5, children });
const row = (...cells: TexNode[]): TexNode => ({ type: 'hlist', subtype: 4, children: cells });

function doc(o: Record<string, unknown>) {
  return readSerializerOutput(JSON.stringify({ fonts: {}, paragraphs: [], content: [], streams: [], ...o }));
}

// ── serialisation ───────────────────────────────────────────────────────────

test('toXml: sorted attributes, escaped text, namespace on the root only', () => {
  const t = el('math', [el('mi', ['x']), el('mo', ['<'], { stretchy: 'false', form: 'infix' }), el('mtext', ['a & b'])]);
  assert.equal(toXml(t),
    `<math${NS}><mi>x</mi><mo form="infix" stretchy="false">&lt;</mo><mtext>a &amp; b</mtext></math>`);
  assert.equal(toXml(el('math', [], { display: 'block' })), `<math display="block"${NS}/>`);
});

// ── cleanup: what a speech engine would read as noise ───────────────────────

test('cleanup: zero-width spaces go, single-child rows flatten, empty rows go', () => {
  const t = cleanup(el('mrow', [el('mspace', [], { width: '0.000pt' }), el('mrow', [el('mi', ['x'])]), el('mrow')]));
  assert.deepEqual(t, el('mi', ['x']));
});

test('cleanup: mathvariant="normal" stays on letters only ("normal infinity")', () => {
  const t = cleanup(el('mrow', [el('mi', ['∞'], { mathvariant: 'normal' }), el('mi', ['R'], { mathvariant: 'normal' }),
    el('mi', ['sin'], { mathvariant: 'normal' })]));
  assert.deepEqual(t, el('mrow', [el('mi', ['∞']), el('mi', ['R'], { mathvariant: 'normal' }), el('mi', ['sin'])]));
});

test('cleanup: an operator wrapping a whole formula (\\Bigl) gives way to it', () => {
  const t = cleanup(el('mo', [el('mrow', [el('mo', ['('], { fence: 'true' }), el('mi', ['x'])])]));
  assert.deepEqual(t, el('mrow', [el('mo', ['('], { fence: 'true' }), el('mi', ['x'])]));
});

test('cleanup: spacing hints are dropped, fixed-arity children kept', () => {
  const t = cleanup(el('msup', [el('mi', ['x']), el('mrow')]));
  assert.deepEqual(t, el('msup', [el('mi', ['x']), el('mrow')]));
  assert.deepEqual(cleanup(el('mo', ['='], { lspace: '0.278em', rspace: '0.278em' })), el('mo', ['=']));
});

// ── attaching formulas to the document ──────────────────────────────────────

test('an inline formula: its begin-math node gets the MathML, the table goes', () => {
  const d = doc({
    paragraphs: [{ nodes: [glyph('a'), begin(1), glyph('x'), end(), glyph('b')] }],
    content: [{ kind: 'paragraph', para: 1 }],
    mathml: [{ tree: el('mi', ['𝑥']) }],
  });
  assert.equal(attachMathML(d), 1);
  assert.equal(bare(d.paragraphs[0].nodes[1].mathml), '<math><mi>𝑥</mi></math>');
  assert.equal(d.mathml, undefined);
});

test('a formula nested in another (\\text{…$y$…}) is covered by the outer one', () => {
  const d = doc({
    paragraphs: [{ nodes: [begin(2), { type: 'hlist', children: [begin(1), glyph('y'), end()] }, end()] }],
    content: [{ kind: 'paragraph', para: 1 }],
    mathml: [{ tree: el('mi', ['𝑦']) }, { tree: el('mrow', [el('mi', ['𝑥']), el('mtext', ['if'])]) }],
  });
  attachMathML(d);
  const outer = d.paragraphs[0].nodes[0], inner = d.paragraphs[0].nodes[1].children![0];
  assert.equal(bare(outer.mathml), '<math><mi>𝑥</mi><mtext>if</mtext></math>');
  assert.equal(inner.mathml, undefined);
});

test('a box luamml could not read: an alignment becomes a table, from its cells', () => {
  // cases: the formula holds a \vcenter luamml saw only as a box; the box's
  // rows and cells, with the formulas typeset in them, are in the node tree.
  const vbox: TexNode = { type: 'vlist', mathml_box: 7, children: [
    row(cell(begin(1), end()), cell(begin(2), end())),
    row(cell(begin(3), end()), cell(glyph('o'), glyph('k'))),
  ] };
  const d = doc({
    paragraphs: [{ nodes: [begin(4), vbox, end()] }],
    content: [{ kind: 'paragraph', para: 1 }],
    mathml: [{ tree: el('mn', ['1']) }, { tree: el('mi', ['𝑥']) }, { tree: el('mn', ['0']) },
      { tree: el('mrow', [el('mo', ['{']), { name: 'mglyph', box: 7 }]) }],
  });
  attachMathML(d);
  assert.equal(bare(d.paragraphs[0].nodes[0].mathml),
    '<math><mrow><mo>{</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mi>𝑥</mi></mtd></mtr>' +
    '<mtr><mtd><mn>0</mn></mtd><mtd><mtext>ok</mtext></mtd></mtr></mtable></mrow></math>');
  assert.equal(vbox.children![0].children![0].children![0].mathml, undefined);
});

test('an empty box (the strut in \\big) disappears', () => {
  const d = doc({
    paragraphs: [{ nodes: [begin(1), { type: 'vlist', mathml_box: 3, children: [] }, end()] }],
    content: [{ kind: 'paragraph', para: 1 }],
    mathml: [{ tree: el('mrow', [el('mo', ['(']), { name: 'mglyph', box: 3 }]) }],
  });
  attachMathML(d);
  assert.equal(bare(d.paragraphs[0].nodes[0].mathml), '<math><mo>(</mo></math>');
});

test('a display gets its formula as block MathML', () => {
  const d = doc({
    content: [{ kind: 'display', display_no: 2, box: { type: 'hlist', subtype: 6, children: [] } }],
    mathml: [{ tree: el('mi', ['𝑥']) }, { tree: el('mn', ['2']), display: 2 }],
  });
  attachMathML(d);
  assert.equal(bare(d.content[0].mathml), '<math display="block"><mn>2</mn></math>');
});

test('an alignment: its rows are display items of one number, read as one table', () => {
  const d = doc({
    content: [
      { kind: 'display', display_no: 5, box: row(cell(begin(1), end()), cell(begin(2), end()), cell(glyph('('), glyph('1'), glyph(')'))) },
      { kind: 'vspace', amount: 0 },
      { kind: 'display', display_no: 5, box: row(cell(begin(3), end()), cell(begin(4), end())) },
      { kind: 'display', display_no: 6, box: { type: 'hlist', subtype: 6, children: [] } },
    ],
    mathml: [{ tree: el('mi', ['𝑓']) }, { tree: el('mn', ['1']) }, { tree: el('mi', ['𝑔']) }, { tree: el('mn', ['2']) },
      { tree: el('mi', ['𝑦']), display: 6 }],
  });
  attachMathML(d);
  assert.equal(bare(d.content[0].mathml),
    '<math display="block"><mtable><mtr><mtd><mi>𝑓</mi></mtd><mtd><mn>1</mn></mtd><mtd><mtext>(1)</mtext></mtd></mtr>' +
    '<mtr><mtd><mi>𝑔</mi></mtd><mtd><mn>2</mn></mtd></mtr></mtable></math>');
  assert.equal(d.content[2].mathml, undefined, 'the second row is read with the first');
  assert.equal(bare(d.content[3].mathml), '<math display="block"><mi>𝑦</mi></math>');
  assert.equal((d.content[0].box!.children![0].children![0]).mathml, undefined, 'cells carry no MathML of their own');
});

test('streams (footnotes) get theirs too', () => {
  const d = doc({
    paragraphs: [{ nodes: [begin(1), end()] }],
    streams: [{ kind: 'footnote', content: [{ kind: 'paragraph', para: 1 }] }],
    mathml: [{ tree: el('mi', ['𝑥']) }],
  });
  attachMathML(d);
  assert.equal(bare(d.paragraphs[0].nodes[0].mathml), '<math><mi>𝑥</mi></math>');
});

test('a document without formulas is left as it was', () => {
  const d = doc({ paragraphs: [{ nodes: [glyph('a')] }], content: [{ kind: 'paragraph', para: 1 }] });
  const before = JSON.stringify(d.paragraphs);
  assert.equal(attachMathML(d), 0);
  assert.equal(JSON.stringify(d.paragraphs), before);
});
