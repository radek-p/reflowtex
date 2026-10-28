// SPDX-License-Identifier: AGPL-3.0-or-later
// Box leaders as TeX sets them (TeX82 §626): \leaders on a grid counted from
// the left edge of the box they are in, so that the dots of a table of
// contents line up from entry to entry whatever the length of the title
// before them; \cleaders centred, \xleaders spread, each from the glue alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Node = Record<string, unknown> & { type: string };
interface Placement { start: number; step: number; count: number }
interface Render {
  leaderPlacement(subtype: number, h: number, w: number, lw: number): Placement;
  renderNodes(fontInfo: object, sink: object, nodes: Node[], x: number, y: number, ratio?: number, expandRatio?: number,
              fillOrder?: number, runH?: number, runD?: number, scale?: number, edge?: number): number;
}
// The viewer is imported by a path the Node project does not follow (see
// node-kinds.test.ts); the few signatures used are written out above.
const VIEWER = new URL('../../src/viewer/src/', import.meta.url).href;
const render: Render = await import(`${VIEWER}engine/render.ts`);
const { SP_TO_PX }: { SP_TO_PX: number } = await import(`${VIEWER}engine/core.ts`);

const PT = 65536, LEADERS = 100, CLEADERS = 101, XLEADERS = 102;
const BOX = Math.round(7.2 * PT);         // a dot's box, 7.2pt as TeX rounds it

test('\\leaders: the first copy at the first point of the box\'s grid not left of the glue', () => {
  // glue from 10pt to 100pt of its box: copies at 14.4pt, 21.6pt, … the last ending at 93.6pt
  const at = render.leaderPlacement(LEADERS, 10 * PT, 90 * PT, BOX);
  assert.equal(10 * PT + at.start, 2 * BOX);
  assert.equal(at.step, BOX);
  assert.equal(at.count, 11);
  // a glue that starts on the grid starts with a copy
  assert.deepEqual(render.leaderPlacement(LEADERS, 2 * BOX, 90 * PT, BOX), { start: 0, step: BOX, count: 12 });
  // and one that starts left of the box's edge too (after a negative kern)
  assert.equal(render.leaderPlacement(LEADERS, -BOX - 5, 90 * PT, BOX).start, 5);
});

test('\\leaders: a copy fits within TeX\'s 10sp allowance, and none fits in a glue shorter than one', () => {
  assert.equal(render.leaderPlacement(LEADERS, 0, 3 * BOX - 9, BOX).count, 3);
  assert.equal(render.leaderPlacement(LEADERS, 0, 3 * BOX - 11, BOX).count, 2);
  assert.equal(render.leaderPlacement(LEADERS, PT, BOX, BOX).count, 0);
});

test('\\cleaders and \\xleaders are placed from the glue, whatever its position in the box', () => {
  for (const h of [0, 3 * PT, 10 * PT + 7]) {
    const c = render.leaderPlacement(CLEADERS, h, 30 * PT, 7 * PT);
    assert.equal(c.count, 4);
    assert.equal(c.step, 7 * PT);
    // the remainder (TeX's lr, of the width plus its 10sp) halved
    assert.equal(c.start, Math.trunc((30 * PT + 10 - 4 * 7 * PT) / 2));
    const x = render.leaderPlacement(XLEADERS, h, 30 * PT, 7 * PT);
    const lr = 30 * PT + 10 - 4 * 7 * PT, lx = Math.trunc(lr / 5);
    assert.deepEqual(x, { start: Math.trunc((lr - 3 * lx) / 2), step: 7 * PT + lx, count: 4 });
  }
});

// A line: some text of width `lead`, then dot leaders to 100pt.
const dot: Node = { type: 'glyph', font: 1, char: 46, width: Math.round(2.78 * PT), height: PT, depth: 0 };
const dotBox = (): Node => ({ type: 'hlist', width: BOX, height: PT, depth: 0, glue_set: 0, glue_sign: 0, glue_order: 0,
                              children: [{ type: 'kern', kern: Math.round(2.21 * PT) }, { ...dot }] });
const leaders = (lead: number): Node[] => [
  { type: 'kern', kern: lead },
  { type: 'glue', subtype: LEADERS, width: 100 * PT - lead, stretch: 0, shrink: 0, leader: dotBox() },
];
function dotsAt(nodes: Node[], x: number, edge?: number): number[] {
  const xs: number[] = [];
  render.renderNodes({}, { glyph: (_n: Node, gx: number) => xs.push(Math.round(gx / SP_TO_PX)), space() {}, rule() {}, picture() {},
                           beginTransform() {}, endTransform() {} },
                     nodes, x, 0, 0, 0, 0, 0, 0, 1, edge);
  return xs;
}

const OFF = Math.round(2.21 * PT);     // the dot's place in its box
const onGrid = (xs: number[], origin: number) => xs.every(x => (x - origin - OFF) % BOX === 0);

test('dot leaders after titles of different lengths line up', () => {
  const a = dotsAt(leaders(10 * PT), 0), b = dotsAt(leaders(15 * PT), 0), c = dotsAt(leaders(2 * BOX), 0);
  assert.deepEqual(a, c);
  assert.deepEqual(b, c.slice(1));
  assert.equal(c[0], 2 * BOX + OFF);
  for (const xs of [a, b, c]) assert.ok(onGrid(xs, 0));
});

test('the grid is counted from the box\'s left edge: the line\'s, left of its \\leftskip, or a box\'s inside it', () => {
  // a line whose text starts 13pt in, after its \leftskip: the grid is the
  // line box's, from 0, and the glue from 23pt starts on it at 28.8pt
  const skipped = dotsAt(leaders(10 * PT), 13 * PT * SP_TO_PX, 0);
  assert.ok(onGrid(skipped, 0));
  assert.equal(skipped[0], 4 * BOX + OFF);
  // the box of a line hung 21pt in (\hangindent): its grid moves with it
  const hung = dotsAt(leaders(10 * PT), 21 * PT * SP_TO_PX);
  assert.deepEqual(hung, dotsAt(leaders(10 * PT), 0).map(x => x + 21 * PT));
  // a box 5pt into the line has its own grid, from its own left edge
  const inBox: Node = { type: 'hlist', width: 100 * PT, height: PT, depth: 0, glue_set: 0, glue_sign: 0, glue_order: 0, children: leaders(10 * PT) };
  assert.deepEqual(dotsAt([{ type: 'kern', kern: 5 * PT }, inBox], 0), dotsAt(leaders(10 * PT), 0).map(x => x + 5 * PT));
});

test('\\gleaders count their grid from the outermost box, not the box they are in', () => {
  const g = (lead: number): Node[] => leaders(lead).map(n => n.type === 'glue' ? { ...n, subtype: 103 } : n);
  const inBox: Node = { type: 'hlist', width: 100 * PT, height: PT, depth: 0, glue_set: 0, glue_sign: 0, glue_order: 0, children: g(10 * PT) };
  const xs = dotsAt([{ type: 'kern', kern: 5 * PT }, inBox], 0);
  assert.ok(onGrid(xs, 0));
  assert.equal(xs[0], 3 * BOX + OFF);    // the glue starts at 15pt of the line
});
