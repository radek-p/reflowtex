// SPDX-License-Identifier: AGPL-3.0-or-later
// website/tools/a11y-figure-compose.ts: the Accessibility page's figure from
// what a live render gave – each drawn line (glyph outlines, hidden from
// screen readers) with the layer's regions, and under it the reading rows a
// screen reader gets: MathML with alttext, or the spoken words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFigure, type Captured } from '../../website/tools/a11y-figure-compose.ts';

const MATH = '<math alttext="x squared"><msup><mi>𝑥</mi><mn>2</mn></msup></math>';
const captured = (): Captured => ({
  mathml: [{ display: false, lines: [{ parts: [
    { kind: 'text', text: 'Let ', box: { x: 100, y: 200, w: 30, h: 20 } },
    { kind: 'math', mathml: MATH, box: { x: 130, y: 198, w: 20, h: 24 } },
    { kind: 'text', text: ' be <big>.', box: { x: 150, y: 200, w: 60, h: 20 } },
  ] }] }],
  spoken: [{ display: false, lines: [{ parts: [
    { kind: 'text', text: 'Let ', box: { x: 100, y: 200, w: 30, h: 20 } },
    { kind: 'spoken', text: 'x squared', box: { x: 130, y: 200, w: 20, h: 20 } },
    { kind: 'text', text: ' be <big>.', box: { x: 150, y: 200, w: 60, h: 20 } },
  ] }] }],
  glyphs: [
    { ch: 'L', family: 'f1', size: 10, x: 100, y: 215, scale: 1 },
    { ch: 'e', family: 'f1', size: 10, x: 106, y: 215, scale: 1 },
    { ch: 'L', family: 'f1', size: 10, x: 150, y: 215, scale: 1 },
    { ch: 'Z', family: 'f1', size: 10, x: 100, y: 400, scale: 1 },     // another line's
  ],
  rules: [{ x: 132, y: 205, w: 10, h: 1 }],
});
const outline = (family: string, ch: string) => `M0 0L${ch.codePointAt(0)} 0Z`;

test('each drawn line: its glyphs as outlines, once each, and its regions; hidden from screen readers', () => {
  const html = composeFigure(captured(), outline);
  const drawn = html.match(/<svg class="a11y-drawn"[\s\S]*?<\/svg>/g)!;
  assert.equal(drawn.length, 1);
  assert.match(drawn[0], /aria-hidden="true"/);
  assert.equal((drawn[0].match(/<use /g) ?? []).length, 3, 'the line\'s three glyphs, not the other line\'s');
  assert.equal((html.match(/<path id=/g) ?? []).length, 2, 'L once, e once (Z is not on this line)');
  assert.equal((drawn[0].match(/class="a11y-region/g) ?? []).length, 3, 'a region per run');
  assert.match(drawn[0], /class="a11y-region math"/);
  assert.equal((drawn[0].match(/class="a11y-rule"/g) ?? []).length, 1);
});

test('under each line, what a reader is given: MathML with alttext, or the words', () => {
  const html = composeFigure(captured(), outline);
  const said = (mode: string) => html.match(new RegExp(`<p class="a11y-said" data-mode="${mode}">([\\s\\S]*?)</p>`))![1];
  assert.equal(said('mathml').replace(/<span class="a11y-speaker"[\s\S]*?<\/span>/, ''), `Let ${MATH} be &lt;big&gt;.`);
  assert.equal(said('spoken').replace(/<span class="a11y-speaker"[\s\S]*?<\/span>/, ''), 'Let x squared be &lt;big&gt;.');
  assert.match(said('mathml'), /^<span class="a11y-speaker" aria-hidden="true">/);
});

test('the figure is as wide as its drawn lines, so a long reading row wraps under its line', () => {
  const html = composeFigure(captured(), outline);
  // runs from x 100 to 210, with 4 px on each side
  assert.match(html, /^<div class="a11y-reading-figure" data-mode="mathml" style="max-width:118px">/);
  assert.match(html, /<svg class="a11y-drawn"[^>]* width="118"/);
});
