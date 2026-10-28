// SPDX-License-Identifier: AGPL-3.0-or-later
// The corpus's line matcher (tools/corpus/linematch.ts) on made-up lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { group, matchLines, type Line } from '../../tools/corpus/linematch.ts';

/** a seeded generator, so each run makes the same lines */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** n text lines 12 pt apart, each with its own x positions */
function doc(n: number, seed = 1): Line[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const xs: number[] = [];
    for (let x = 10 + r() * 20, k = 30 + Math.floor(r() * 30); k > 0; k--, x += 3 + r() * 4) xs.push(Math.round(x * 100) / 100);
    return { y: 12 * (i + 1), xs, text: `line ${i}` };
  });
}
const at = (l: Line, y: number, text = l.text): Line => ({ y, xs: [...l.xs], text });
const changes = (r: ReturnType<typeof matchLines>) => r.steps.map(s => s.change);

test('identical sides: every line paired, no steps', () => {
  const v = doc(40);
  const r = matchLines(v, v.map(l => at(l, l.y)));
  assert.equal(r.matched_lines, 40);
  assert.deepEqual(changes(r), []);
});

test('a short line with an exact twin 192 pt away keeps its own, inexact partner', () => {
  const v = doc(40);
  const year = [100, 105, 110, 115, 118];
  // the browser's '1950.' at line 10 and its twin at line 26 (192 pt further on)
  v[10] = { y: v[10].y, xs: year, text: '1950.' };
  v[26] = { y: v[26].y, xs: year, text: '1950.' };
  const s = v.map(l => at(l, l.y));
  // TeX's line 10 has one glyph 1 pt off (overlap 0.8); its twin at line 26 is exact
  s[10] = { y: s[10].y, xs: [100, 105, 110, 116, 118], text: '1950.' };
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), []);
  assert.equal(r.lines[10].strip_y, s[10].y);
  assert.equal(r.lines[26].strip_y, s[26].y);
  assert.equal(r.matched_lines, 40);
});

test('a twin with no partner of its own stays unpaired instead of jumping', () => {
  const v = doc(40);
  const year = [100, 105, 110, 115, 118];
  v[10] = { y: v[10].y, xs: year, text: '1950.' };
  const s = v.map(l => at(l, l.y));
  s[10] = { y: s[10].y, xs: [50, 60, 70], text: 'other' };   // TeX broke it differently
  s[26] = { y: s[26].y, xs: year, text: '1950.' };            // and has a '1950.' far on
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), []);
  assert.equal(r.lines[10].dy, null);
});

test('a real step is kept: dy +12 from line 20 on', () => {
  const v = doc(40);
  const s = v.map((l, i) => at(l, l.y + (i >= 20 ? 12 : 0)));
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), [12]);
  assert.equal(r.steps[0].viewer_y, v[20].y);
  assert.equal(r.matched_lines, 40);
});

test('a real excursion and back is kept: one line at −10, then dy 0 again', () => {
  const v = doc(40);
  const s = v.map((l, i) => at(l, l.y - (i === 15 ? 10 : 0)));
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), [-10, 10]);
});

test('a block of two lines displaced by 40 pt and back is kept', () => {
  // 100 pt of space before line 15 in the browser; TeX puts lines 15 and 16 40 pt higher in it
  const v = doc(40).map((l, i) => at(l, l.y + (i >= 15 ? 100 : 0)));
  const s = v.map((l, i) => at(l, l.y - (i === 15 || i === 16 ? 40 : 0)));
  assert.deepEqual(changes(matchLines(v, s)), [-40, 40]);
});

test('a paragraph broken differently: a coincident line inside it is not paired 72 pt off', () => {
  const v = doc(40);
  const other = doc(11, 5);   // TeX broke lines 10–19 into 11 other lines
  const s = [...v.slice(0, 10).map(l => at(l, l.y)), ...other.map((l, k) => at(l, 12 * (11 + k))),
    ...v.slice(20).map(l => at(l, l.y + 12))];
  // the browser's line 12 happens to sit like TeX's 9th line of the paragraph, 72 pt on, one glyph off
  v[12] = { y: v[12].y, xs: [...s[18].xs.slice(0, -1), s[18].xs.at(-1)! + 2], text: 'coincidence' };
  const r = matchLines(v, s);
  assert.equal(r.lines[12].dy, null);
  assert.deepEqual(changes(r), [12]);
});

test('a line lost in the browser: TeX\'s line unpaired, the lines after it one line higher', () => {
  const s = doc(40);
  const v = s.filter((_, i) => i !== 15).map((l, i) => at(l, 12 * (i + 1)));
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), [12]);
  assert.equal(r.unmatched_strip, 1);
  assert.equal(r.unmatched_viewer, 0);
});

test('an extra line in the browser: unpaired, the lines after it one line lower', () => {
  const s = doc(40);
  const extra = doc(1, 99)[0];
  const v = [...s.slice(0, 15), extra, ...s.slice(15)].map((l, i) => at(l, 12 * (i + 1)));
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), [-12]);
  assert.equal(r.unmatched_viewer, 1);
  assert.equal(r.lines[15].dy, null);
  assert.equal(r.unmatched_strip, 0);
});

test('a line split in two in TeX: both halves and the browser\'s line unpaired, the rest in step', () => {
  const v = doc(40);
  const s: Line[] = [];
  v.forEach((l, i) => {
    if (i !== 12) { s.push(at(l, l.y + (i > 12 ? 12 : 0))); return; }
    const half = Math.floor(l.xs.length / 2);
    s.push({ y: l.y, xs: l.xs.slice(0, half), text: 'first half' }, { y: l.y + 12, xs: l.xs.slice(half), text: 'second half' });
  });
  const r = matchLines(v, s);
  assert.equal(r.lines[12].dy, null);
  assert.equal(r.unmatched_strip, 2);
  assert.deepEqual(changes(r), [12]);
});

test('rows alike (a table) with one lost: each row stays with its own', () => {
  const s = doc(30);
  const row = [40, 44, 48, 120, 124, 128, 200, 204, 208];
  for (let i = 10; i < 16; i++) s[i] = { y: s[i].y, xs: row, text: `row ${i}` };
  // the browser lost the first row; the rest move up one line. Which row is
  // lost cannot be told from the rows alike, so the step may be anywhere in the
  // table; what matters is one step, not a row paired one line off and back.
  const v = s.filter((_, i) => i !== 10).map((l, i) => at(l, 12 * (i + 1)));
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), [12]);
  assert.ok(r.steps[0].viewer_y >= v[10].y && r.steps[0].viewer_y <= v[15].y);
  assert.equal(r.unmatched_strip, 1);
});

test('a shift past the 300 pt band is found again (content lost before it)', () => {
  const v = doc(60);
  const s = v.map((l, i) => at(l, l.y + (i >= 30 ? 450 : 0)));
  const r = matchLines(v, s);
  assert.deepEqual(changes(r), [450]);
  assert.equal(r.matched_lines, 60);
});

test('fast enough: 8 000 lines a side in well under seconds', () => {
  const v = doc(8000, 7);
  const s = v.map((l, i) => at(l, l.y + (i >= 4000 ? 7 : 0)));
  const t = performance.now();
  const r = matchLines(v, s);
  assert.ok(performance.now() - t < 5000, `took ${performance.now() - t} ms`);
  assert.deepEqual(changes(r), [7]);
});

test('group: glyphs 0.002 pt apart share a line, 0.05 pt apart do not', () => {
  // a baseline whose glyphs sit either side of a rounding edge (100.004, 100.006) is one line
  const one = group([{ x: 10, y: 100.004, text: 'a' }, { x: 20, y: 100.006, text: 'b' }, { x: 15, y: 100.004, text: 'c' }]);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].xs, [10, 15, 20]);
  assert.equal(one[0].text, 'acb');
  // two baselines 0.05 pt apart stay two, in order of y
  const two = group([{ x: 10, y: 100.05 }, { x: 20, y: 100.00 }]);
  assert.deepEqual(two.map(l => l.y), [100, 100.05]);
});
