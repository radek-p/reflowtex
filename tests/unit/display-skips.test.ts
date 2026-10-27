// SPDX-License-Identifier: AGPL-3.0-or-later
// The display skips the viewer chooses again at the reader's width
// (displaySkipAdjust): only where TeX set one of its own. Text between an
// alignment's rows (\intertext) carries its skips as \vskip's, and an equation
// number on a line of its own takes the skip's place: there the captured
// space stands. The viewer's modules are imported by URL, outside the Node
// type check.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Item = Record<string, unknown>;
type Layout = Record<string, unknown>;
interface Display { displaySkipAdjust(L: Layout, prev: Layout | undefined): number }
const VIEWER = new URL('../../src/viewer/src/engine/', import.meta.url).href;
const { displaySkipAdjust }: Display = await import(`${VIEWER}layout/display.ts`);
const { SP_TO_PX }: { SP_TO_PX: number } = await import(`${VIEWER}core.ts`);

const PT = 65536;
const pt = (px: number) => Math.round(px / SP_TO_PX / PT * 1000) / 1000;
const ALIGNMENT = 4, EQUATION = 6;
// the four skips in force: 10 pt and 6 pt, as in LaTeX's article at 10 pt
const skips = { display_above: 10 * PT, display_above_short: 0, display_below: 10 * PT, display_below_short: 6 * PT };
const display = (subtype: number, item: Item): Layout => ({
  seg: { kind: 'display', isAlign: subtype === ALIGNMENT, rows: [{ item: { ...skips, ...item, box: { type: 'hlist', subtype } }, gap: 0 }] },
  lines: [], W: 0, H: 0, firstAscent: 0, lastDepth: 0, firstMeta: null, gapBefore: 0,
});
const text = (): Layout => ({
  seg: { kind: 'text', items: [] }, lines: [], W: 0, H: 0, firstAscent: 0, lastDepth: 0, firstMeta: null, gapBefore: 0,
});

test('an alignment\'s rows after text between them get no display skip TeX did not set', () => {
  // the rows after \intertext: TeX's glue above them is the \vskip of
  // \intertext, not a display skip, so none is recorded
  const after = display(ALIGNMENT, {});
  assert.equal(pt(displaySkipAdjust(after, text())), 0);
  // the rows before it, then the text: no display skip below them either
  const before = display(ALIGNMENT, {});
  displaySkipAdjust(before, text());
  assert.equal(pt(displaySkipAdjust(text(), before)), 0);
  // where TeX set the skips, they stand as TeX set them
  assert.equal(pt(displaySkipAdjust(display(ALIGNMENT, { display_used_above: 10 * PT }), text())), 0);
});

test('a display skip TeX set is chosen again; one it did not set is not', () => {
  // an equation TeX set with the short skips, which the full pair suits at the
  // reader's width (its left edge, 0, is left of \predisplaysize)
  const eq = (item: Item) => display(EQUATION, { display_pre_size: 100 * PT, display_after_line: false, ...item });
  const shortSet = eq({ display_used_above: 0, display_used_below: 6 * PT });
  assert.equal(pt(displaySkipAdjust(shortSet, text())), 10, 'the full above skip in place of the short one');
  assert.equal(pt(displaySkipAdjust(text(), shortSet)), 4, 'and the full below skip');
  // a number on its own line below the formula, in place of the below skip
  // (§1205), and one on the left above it, in place of the above skip (§1203)
  const numberBelow = eq({ display_used_above: 0 });
  displaySkipAdjust(numberBelow, text());
  assert.equal(pt(displaySkipAdjust(text(), numberBelow)), 0, 'no below skip');
  const numberAbove = eq({ display_used_below: 6 * PT });
  assert.equal(pt(displaySkipAdjust(numberAbove, text())), 0, 'no above skip');
  assert.equal(pt(displaySkipAdjust(text(), numberAbove)), 4, 'the below skip chosen again');
});
