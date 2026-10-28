// SPDX-License-Identifier: AGPL-3.0-or-later
// The corpus's scores (tools/corpus/scores.ts) on made-up lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLines, type Line } from '../../tools/corpus/linematch.ts';
import { absolute, pairedWithin, placement, scoresOf, vertical } from '../../tools/corpus/scores.ts';

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
const at = (l: Line, y: number): Line => ({ y, xs: [...l.xs], text: l.text });
const glyphs = (ls: Line[]) => ls.flatMap(l => l.xs.map(x => ({ x, y: l.y })));
const points = (ls: Line[]) => ls.flatMap(l => l.xs.map(x => [x, l.y] as [number, number]));
const total = (ls: Line[]) => ls.reduce((a, l) => a + l.xs.length, 0);
const score = (v: Line[], s: Line[]) => { const r = matchLines(v, s); return scoresOf(v, s, r, absolute(glyphs(v), points(s))); };

test('pairedWithin pairs one to one, within the tolerance', () => {
  assert.equal(pairedWithin([1, 2, 3], [1.05, 2.2, 3]), 2);
  assert.equal(pairedWithin([1, 1, 1], [1]), 1);
  assert.equal(pairedWithin([], [1]), 0);
});

test('identical sides: everything placed, every gap right, absolute 1', () => {
  const v = doc(40), s = v.map(l => at(l, l.y));
  const sc = score(v, s);
  assert.equal(sc.placement.share, 1);
  assert.equal(sc.vertical.jumps, 0);
  assert.equal(sc.vertical.gaps, 40);
  assert.equal(sc.vertical.share_right, 1);
  assert.equal(sc.absolute.share, 1);
});

test('one early jump: placement high, one jump counted once, absolute near 0', () => {
  // the title 25 pt lower in the browser, everything after it too
  const s = doc(80), v = s.map(l => at(l, l.y + 25));
  const sc = score(v, s);
  assert.equal(sc.placement.share, 1);
  assert.equal(sc.vertical.jumps, 1);
  assert.equal(sc.vertical.max_abs_pt, 25);
  assert.equal(sc.vertical.largest[0].at_start, true);
  assert.equal(sc.vertical.gaps, 80);
  assert.ok(sc.absolute.share < 0.01, `absolute ${sc.absolute.share}`);
});

test('a jump after the first line: placement high, one jump at that line', () => {
  const s = doc(80), v = s.map((l, i) => at(l, l.y + (i >= 3 ? 5 : 0)));
  const sc = score(v, s);
  assert.equal(sc.placement.share, 1);
  assert.equal(sc.vertical.jumps, 1);
  assert.equal(sc.vertical.largest[0].change, -5);
  assert.equal(sc.vertical.largest[0].viewer_y, v[3].y);
  assert.equal(sc.vertical.largest[0].at_start, undefined);
  assert.ok(sc.absolute.share < 0.05);
});

test('small changes of dy within 0.092 pt are no jumps', () => {
  const s = doc(30), v = s.map((l, i) => at(l, l.y + (i >= 10 ? 0.08 : 0)));
  const vt = vertical(matchLines(v, s));
  assert.equal(vt.jumps, 0);
  assert.equal(vt.share_right, 1);
});

test('lost lines cost placement: TeX\'s glyphs in them are wrong', () => {
  const s = doc(40);
  const lost = new Set([10, 11, 12, 13]);
  const v = s.filter((_, i) => !lost.has(i)).map((l, i) => at(l, 12 * (i + 1)));
  const r = matchLines(v, s), p = placement(v, s, r);
  const gone = [...lost].reduce((a, i) => a + s[i].xs.length, 0);
  assert.equal(p.tex_glyphs, total(s));
  assert.equal(p.tex_glyphs_in_unmatched_lines, gone);
  assert.equal(p.placed, total(s) - gone);
  assert.ok(p.share < 1 - gone / total(s) + 1e-4);
  // the lines after the loss sit 48 pt higher: one jump, not one per line
  assert.equal(vertical(r).jumps, 1);
});

test('glyphs off along a matched line cost placement, not vertical', () => {
  const s = doc(20), v = s.map(l => at(l, l.y));
  v[5] = { ...v[5], xs: v[5].xs.map((x, k) => (k >= 10 ? x + 0.3 : x)) };
  const r = matchLines(v, s), p = placement(v, s, r);
  assert.equal(p.placed, total(s) - (s[5].xs.length - 10));
  assert.equal(vertical(r).jumps, 0);
});

test('extra browser lines do not raise placement and are counted', () => {
  const s = doc(30), extra = doc(1, 99)[0];
  const v = [...s.slice(0, 15), extra, ...s.slice(15)].map((l, i) => at(l, 12 * (i + 1)));
  const r = matchLines(v, s), p = placement(v, s, r);
  assert.equal(p.share, 1);
  assert.equal(p.browser_glyphs_in_unmatched_lines, extra.xs.length);
});

test('absolute matches vector-compare: within 0.7 pt and nearest by |dx| + |dy|', () => {
  const a = absolute([{ x: 0, y: 0 }, { x: 10, y: 0.05 }, { x: 20, y: 0.5 }, { x: 30, y: 2 }], [[0, 0], [10, 0], [20, 0], [40, 0]]);
  assert.equal(a.matched, 3);
  assert.equal(a.share, 0.5);       // (0, 0) and (10, 0.05) within 0.092
  assert.equal(a.share_0_05, 0.5);
  assert.equal(a.missing, 1);
  assert.equal(a.extra, 1);
});
