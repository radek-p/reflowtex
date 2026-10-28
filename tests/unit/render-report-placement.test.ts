// SPDX-License-Identifier: AGPL-3.0-or-later
// The render report's placement (tests/render/report/placement.ts): each of
// the browser's lines set on the baseline of the TeX line it is paired with
// (lines.json), so that one vertical offset costs one jump, not every glyph
// after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placementOf, type LineData, type VectorGlyphs } from '../../tests/render/report/placement.ts';

const JUMP = 31.39;
/** Three lines of ten glyphs, TeX's JUMP pt lower than the browser's from the
 *  first line on, as vector.json has them after that (nothing within its
 *  window: every glyph on one side only); `along`: the browser's glyph 3 of
 *  line 1 that far to the right. */
function doc(along = 0): { v: VectorGlyphs; l: LineData } {
  const ys = [20, 32, 44];
  const glyph = (x: number, y: number) => ({ x, y, w: 5, size: 10, text: 'a' });
  const viewer = ys.flatMap((y, i) => Array.from({ length: 10 }, (_, k) => glyph(50 + 6 * k + (i === 1 && k === 3 ? along : 0), y)));
  const strip = ys.flatMap(y => Array.from({ length: 10 }, (_, k) => glyph(50 + 6 * k, y + JUMP)));
  return {
    v: { hsize_pt: 345, margin_pt: 36, matched: [], viewer_unmatched: viewer, strip_unmatched: strip,
         rules: [{ x: 50, y: 25, w: 100, h: 0.4, unmatched: true }], rules_missing: [{ x: 50, y: 25 + JUMP, w: 100, h: 0.4 }] },
    l: { lines: ys.map(y => ({ viewer_y: y, strip_y: y + JUMP, dy: JUMP, text: 'aaaaaaaaaa' })) },
  };
}

test('one jump at the first line: nothing off, the jump once', () => {
  const { v, l } = doc();
  const p = placementOf(v, l, 0.092, 0.092);
  assert.deepEqual(p.off, []);
  assert.deepEqual(p.jumps, [{ viewer_y: 20, strip_y: 20 + JUMP, before: 0, after: JUMP, change: JUMP, text: 'aaaaaaaaaa' }]);
  assert.equal(p.placed, 30);
  assert.equal(p.texGlyphs, 30);
});

test('a glyph off along its line: that glyph, on both sides, its own size', () => {
  const { v, l } = doc(0.3);
  const p = placementOf(v, l, 0.092, 0.092);
  assert.equal(p.off.length, 1);
  const o = p.off[0];
  assert.equal(o.kind, 'along');
  if (o.kind !== 'along') return;
  assert.equal(o.dx, -0.3);
  assert.deepEqual([o.viewer.y, o.strip.y, o.strip.size], [32, 32 + JUMP, 10]);
});

test('a line with no partner: its glyphs on one side only; a jump back where the next pairs again', () => {
  const { v, l } = doc();
  l.lines[1] = { ...l.lines[1], strip_y: null, dy: null };
  l.lines[2] = { ...l.lines[2], strip_y: 44, dy: 0 };
  v.strip_unmatched = v.strip_unmatched!.map(g => (Math.abs(g.y - (44 + JUMP)) < 0.01 ? { ...g, y: 44 } : g));
  const p = placementOf(v, l, 0.092, 0.092);
  const kinds = p.off.map(o => `${o.kind}${'lone' in o && o.lone ? ' lone' : ''}`);
  assert.deepEqual(kinds, [...Array(10).fill('viewer lone'), ...Array(10).fill('strip lone')]);
  assert.deepEqual(p.jumps.map(j => j.change), [JUMP, -JUMP]);
});

test('older builds: TeX\'s glyphs with no size are boxed by their partner\'s', () => {
  const { v, l } = doc(0.3);
  v.strip_unmatched = v.strip_unmatched!.map(g => ({ x: g.x, y: g.y }));
  const o = placementOf(v, l, 0.092, 0.092).off[0];
  assert.ok(o.kind === 'along' && o.strip.size === 10 && o.strip.w === 5);
});
