// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a box's ink ends (inkExtentOf, which sizes a display's scroll area):
// a clipping box (a box resource) shows its content only within its edges.
// The viewer's modules are imported by URL, outside the Node type check.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type TexNode = Record<string, unknown> & { type: string };
interface Display { inkExtentOf(fontInfo: object, box: TexNode): { min: number; max: number } }
const VIEWER = new URL('../../src/viewer/src/engine/', import.meta.url).href;
const { inkExtentOf }: Display = await import(`${VIEWER}layout/display.ts`);
const { SP_TO_PX }: { SP_TO_PX: number } = await import(`${VIEWER}core.ts`);

const PT = 65536;
const pt = (px: number) => Math.round(px / SP_TO_PX / PT * 1000) / 1000;
const kern = (kern: number): TexNode => ({ type: 'kern', kern });
const rule = (width: number): TexNode => ({ type: 'rule', width, height: 10 * PT, depth: 0 });
const box = (width: number, children: TexNode[], clip?: boolean): TexNode =>
  ({ type: 'hlist', width, height: 10 * PT, depth: 0, children, ...(clip ? { clip } : {}) });

test('a clipping box\'s ink ends at its edges', () => {
  // a rule 100 pt wide, moved 20 pt left, in a box 50 pt wide, 10 pt in
  const inner = [kern(-20 * PT), rule(100 * PT)];
  const extent = (clip: boolean) => {
    const e = inkExtentOf({}, box(60 * PT, [kern(10 * PT), box(50 * PT, inner, clip)]));
    return [pt(e.min), pt(e.max)];
  };
  assert.deepEqual(extent(true), [10, 60]);
  assert.deepEqual(extent(false), [-10, 90], 'unclipped, the rule as it is');
});
