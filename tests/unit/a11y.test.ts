// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/a11y.ts: a block's accessible layer – the document in reading
// order as HTML, with MathML for its formulas – built from the encoded
// document, as a page ships it next to the drawn block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { a11yLayer, type LayerDocument } from '../../src/pipeline/a11y.ts';

type N = Record<string, unknown>;
const text = (s: string): N[] => [...s].map(ch => (ch === ' ' ? { type: 'glue', width: 218235 } : { type: 'glyph', char: ch.codePointAt(0) }));
const M = (inner: string, display = false) =>
  `<math${display ? ' display="block"' : ''} xmlns="http://www.w3.org/1998/Math/MathML">${inner}</math>`;
const formula = (mathml: string | undefined, ...inside: N[]): N[] =>
  [{ type: 'math', subtype: 0, ...(mathml ? { mathml } : {}) }, ...inside, { type: 'math', subtype: 1 }];
/** The layer's content, without its wrapper. */
const body = (doc: LayerDocument) => a11yLayer(doc).replace(/^<div class="latex-a11y"[^>]*>/, '').replace(/<\/div>$/, '');

test('a paragraph: its text, and MathML where a formula stands; data-para names it for the viewer', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [...text('Let '), ...formula(M('<mi>𝑥</mi>'), { type: 'glyph', char: 0x1D465 }), ...text(' be real.')] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), `<p data-para="1">Let ${M('<mi>𝑥</mi>')} be real.</p>`);
});

test('a display is its block MathML; one without MathML reads as its text; data-item is its content index (1-based)', () => {
  const doc: LayerDocument = {
    paragraphs: [],
    content: [
      { kind: 'display', mathml: M('<mn>1</mn>', true), box: { type: 'hlist', children: text('1') } },
      { kind: 'vspace', amount: 100 },
      { kind: 'display', box: { type: 'hlist', children: [{ type: 'hlist', children: text('a table') }] } },
      { kind: 'display', box: { type: 'hlist', children: [] } },
    ],
  };
  assert.equal(body(doc), `<div data-item="1">${M('<mn>1</mn>', true)}</div><p data-item="3">a table</p>`);
});

test('an alignment is read once: the rows after its first are in the first row’s table', () => {
  const row = (t: string) => ({ type: 'hlist', subtype: 4, children: text(t) });
  const doc: LayerDocument = {
    paragraphs: [],
    content: [
      { kind: 'display', mathml: M('<mtable/>', true), box: row('f = 1') },
      { kind: 'vspace', amount: 100 },
      { kind: 'display', box: row('g = 2') },
      { kind: 'display', box: { type: 'hlist', subtype: 6, children: text('table') } },
    ],
  };
  assert.equal(body(doc), `<div data-item="1">${M('<mtable/>', true)}</div><p data-item="4">table</p>`);
});

test('a formula without MathML (a footnote mark) reads as its text', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [...text('Text.'), ...formula(undefined, { type: 'hlist', children: text('1') })] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), '<p data-para="1">Text.1</p>');
});

test('text: ligatures as their letters, private-use glyphs left out, escaped, spaces collapsed', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [{ type: 'glyph', char: 0xFB03 }, ...text('ce  & <b>'), { type: 'glyph', char: 0x100123 }, { type: 'glyph', char: 0xE001 }] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), '<p data-para="1">ffice &amp; &lt;b&gt;</p>');
});

test('a hyphenation point reads as the unbroken word', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [...text('aug'), { type: 'disc', pre: text('-'), post: [], replace: [] }, ...text('mented')] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), '<p data-para="1">augmented</p>');
});

test('an empty paragraph is left out; the wrapper hides the layer only visually', () => {
  const doc: LayerDocument = { paragraphs: [{ nodes: [] }], content: [{ kind: 'paragraph', para: 1 }] };
  assert.equal(body(doc), '');
  const html = a11yLayer({ paragraphs: [{ nodes: text('x') }], content: [{ kind: 'paragraph', para: 1 }] });
  assert.match(html, /^<div class="latex-a11y" style="[^"]*clip[^"]*">/);
  assert.doesNotMatch(html, /display:\s*none|visibility:\s*hidden|aria-hidden/);
});

// ── Through the wire format, into a page ────────────────────────────────────

import { encodeDocument } from '../../src/pipeline/encode.ts';
import { readSerializerOutput } from '../../src/pipeline/nodes.ts';
import { blockHtml } from '../../src/pipeline/site.ts';

const encoded = () => encodeDocument(readSerializerOutput(JSON.stringify({
  fonts: {}, streams: [],
  paragraphs: [{ nodes: [...text('See '), ...formula(M('<mi>𝑥</mi>'), { type: 'glyph', char: 0x1D465 })] }],
  content: [{ kind: 'paragraph', para: 1 }, { kind: 'display', mathml: M('<mn>2</mn>', true), box: { type: 'hlist', children: [] } }],
})));

test('blockHtml({a11y}): the drawn block hidden from assistive technology, the layer after it', () => {
  const html = blockHtml(encoded(), {}, { a11y: true });
  const [block, layer] = html.split(/(?=<div class="latex-a11y")/);
  assert.match(block, /^<div class="latex-block" aria-hidden="true" data-nodelist-b64="[^"]+"><\/div>$/);
  assert.equal(layer.replace(/^<div class="latex-a11y"[^>]*>/, ''), `<p data-para="1">See ${M('<mi>𝑥</mi>')}</p><div data-item="2">${M('<mn>2</mn>', true)}</div></div>`);
});

test('blockHtml without {a11y} is as it was', () => {
  const html = blockHtml(encoded());
  assert.match(html, /^<div class="latex-block" data-nodelist-b64="[^"]+"><\/div>$/);
});

// Streams: a box, an accordion's panes, a hint, a footnote, a side note. The
// drawing is hidden from screen readers, so what a stream says is read only
// if the layer has it (boxed theorems and hints were once skipped whole).
test('a box is read where it stands, in a group; streams nest; data-stream names its drawn box', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: text('Before.') }, { nodes: text('Theorem 1. True.') }, { nodes: text('Claim. Also.') }, { nodes: text('After.') }],
    content: [{ kind: 'paragraph', para: 1 }, { kind: 'stream', stream: 1 }, { kind: 'paragraph', para: 4 }],
    streams: [{ kind: 'theorem', content: [{ kind: 'paragraph', para: 2 }, { kind: 'stream', stream: 2 }] },
              { kind: 'proof', content: [{ kind: 'vspace', amount: 1 }, { kind: 'paragraph', para: 3 }] }],
  };
  assert.equal(body(doc), '<p data-para="1">Before.</p>'
    + '<div role="group" data-stream="1" data-kind="theorem"><p data-para="2">Theorem 1. True.</p>'
    + '<div role="group" data-stream="2" data-kind="proof"><p data-para="3">Claim. Also.</p></div></div>'
    + '<p data-para="4">After.</p>');
});

test('every pane of an accordion is read, in order; a hint is a closed disclosure; a stream’s text is code', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: text('Short.') }, { nodes: text('Long.') }, { nodes: text('Try n = 2.') }],
    content: [{ kind: 'stream', stream: 1 }, { kind: 'stream', stream: 4 }, { kind: 'stream', stream: 5 }],
    streams: [{ kind: 'accordion', content: [{ kind: 'stream', stream: 2 }, { kind: 'vspace', amount: 1 }, { kind: 'stream', stream: 3 }] },
              { kind: 'pane', content: [{ kind: 'paragraph', para: 1 }] },
              { kind: 'pane', content: [{ kind: 'paragraph', para: 2 }] },
              { kind: 'hint', content: [{ kind: 'paragraph', para: 3 }] },
              { kind: 'leancode', content: [{ kind: 'anchorpoint' }], text: 'example : 2 < 3 := by decide' }],
  };
  const html = body(doc);
  assert.match(html, /<p data-para="1">Short\.<\/p><\/div><div role="group" data-stream="3" data-kind="pane"><p data-para="2">Long\.<\/p>/);
  assert.match(html, /<details data-stream="4" data-kind="hint"><summary>Hint<\/summary><p data-para="3">Try n = 2\.<\/p><\/details>/);
  assert.match(html, /<pre>example : 2 &lt; 3 := by decide<\/pre>/);
});

test('a footnote and a side note are notes after the paragraph that refers to them, once each', () => {
  const mark = { type: 'glyph', char: 0x31, stream: 1 };
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [...text('Text'), mark, ...text(' and'), { type: 'hlist', aside: 2 }, ...text(' more'), mark] },
                 { nodes: text('1 The note.') }, { nodes: text('In the margin.') }],
    content: [{ kind: 'paragraph', para: 1 }],
    streams: [{ kind: 'footnote', content: [{ kind: 'paragraph', para: 2 }] }, { kind: 'sidenote', content: [{ kind: 'paragraph', para: 3 }] }],
  };
  assert.equal(body(doc), '<p data-para="1">Text1 and more1</p>'
    + '<div role="note" data-stream="1" data-kind="footnote"><p data-para="2">1 The note.</p></div>'
    + '<div role="note" data-stream="2" data-kind="sidenote"><p data-para="3">In the margin.</p></div>');
});

test('a glue that only stretches is a space: a contents entry’s number and its title are two words', () => {
  const entry = { type: 'hlist', children: [...text('1.1'), { type: 'glue', width: 0, stretch: 65536 }] };
  const doc: LayerDocument = { paragraphs: [{ nodes: [entry, ...text('Entries')] }], content: [{ kind: 'paragraph', para: 1 }] };
  assert.equal(body(doc), '<p data-para="1">1.1 Entries</p>');
});
