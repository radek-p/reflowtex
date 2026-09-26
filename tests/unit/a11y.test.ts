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

test('a paragraph: its text, and MathML where a formula stands', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [...text('Let '), ...formula(M('<mi>𝑥</mi>'), { type: 'glyph', char: 0x1D465 }), ...text(' be real.')] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), `<p>Let ${M('<mi>𝑥</mi>')} be real.</p>`);
});

test('a display is its block MathML; one without MathML reads as its text', () => {
  const doc: LayerDocument = {
    paragraphs: [],
    content: [
      { kind: 'display', mathml: M('<mn>1</mn>', true), box: { type: 'hlist', children: text('1') } },
      { kind: 'vspace', amount: 100 },
      { kind: 'display', box: { type: 'hlist', children: [{ type: 'hlist', children: text('a table') }] } },
      { kind: 'display', box: { type: 'hlist', children: [] } },
    ],
  };
  assert.equal(body(doc), `${M('<mn>1</mn>', true)}<p>a table</p>`);
});

test('a formula without MathML (a footnote mark) reads as its text', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [...text('Text.'), ...formula(undefined, { type: 'hlist', children: text('1') })] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), '<p>Text.1</p>');
});

test('text: ligatures as their letters, private-use glyphs left out, escaped, spaces collapsed', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [{ type: 'glyph', char: 0xFB03 }, ...text('ce  & <b>'), { type: 'glyph', char: 0x100123 }, { type: 'glyph', char: 0xE001 }] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), '<p>ffice &amp; &lt;b&gt;</p>');
});

test('a hyphenation point reads as the unbroken word', () => {
  const doc: LayerDocument = {
    paragraphs: [{ nodes: [...text('aug'), { type: 'disc', pre: text('-'), post: [], replace: [] }, ...text('mented')] }],
    content: [{ kind: 'paragraph', para: 1 }],
  };
  assert.equal(body(doc), '<p>augmented</p>');
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
  assert.equal(layer.replace(/^<div class="latex-a11y"[^>]*>/, ''), `<p>See ${M('<mi>𝑥</mi>')}</p>${M('<mn>2</mn>', true)}</div>`);
});

test('blockHtml without {a11y} is as it was', () => {
  const html = blockHtml(encoded());
  assert.match(html, /^<div class="latex-block" data-nodelist-b64="[^"]+"><\/div>$/);
});
