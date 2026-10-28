// SPDX-License-Identifier: AGPL-3.0-or-later
// A virtual font's character that is drawn as a box of pieces (a ligature its
// packet builds from two characters, a small capital moved by letterspacing)
// is still the one character TeX set: it protrudes by its own codes and
// expands with its line, its pieces with it, as in TeX's PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Node = Record<string, unknown> & { type: string };
interface Candidate { leftProtrusion: number; rightProtrusion: number; packRightProtrusion?: number }
interface Breaker {
  buildBreakCandidates(nodes: Node[], fontInfo: object, para: object): Candidate[];
  fontStretchSp(fontInfo: object, ns: Node[], i: number, shrink: boolean): number;
}
interface Core { expandableSp(fontInfo: object, ns: Node[], i: number): number }
interface Render {
  renderNodes(fontInfo: object, sink: object, nodes: Node[], x: number, y: number, ratio?: number, expandRatio?: number): number;
}
// The viewer is imported by a path the Node project does not follow (see
// node-kinds.test.ts); the few signatures used are written out above.
const VIEWER = new URL('../../src/viewer/src/', import.meta.url).href;
const breaker: Breaker = await import(`${VIEWER}engine/breaker.ts`);
const core: Core = await import(`${VIEWER}engine/core.ts`);
const render: Render = await import(`${VIEWER}engine/render.ts`);

const PT = 65536, QUAD = 12 * PT;
// font 7: the virtual face, with TeX's codes for it (as annotate_fonts reads
// them); font 8: the face its packets draw from, which has none of its own
const fontInfo = {
  7: { quad: QUAD, expand: { stretch: 20, shrink: 20, step: 1 }, codes: new Map([[52, { char: 52, lp: 38, rp: 0, ef: 1000 }], [45, { char: 45, lp: 191, rp: 191, ef: 1000 }]]) },
  8: { quad: QUAD, expand: { stretch: 20, shrink: 20, step: 1 }, codes: new Map() },
};
const LETTERSPACE = 19660;
/** a character of font 7 drawn as font 8's character `c`, moved right by the letterspacing */
const charBox = (char: number, c: number, w: number): Node => ({
  type: 'hlist', subtype: 2, font: 7, char, width: w, height: 8 * PT, depth: 0, shift: 0, glue_set: 0, glue_sign: 0, glue_order: 0,
  children: [{ type: 'kern', kern: LETTERSPACE, subtype: 1 }, { type: 'glyph', font: 8, char: c, width: w - 2 * LETTERSPACE, height: 8 * PT, depth: 0 }],
});
const space: Node = { type: 'glue', subtype: 13, width: 3 * PT, stretch: 2 * PT, shrink: PT };
const parfill: Node[] = [{ type: 'penalty', penalty: 10000 }, { type: 'glue', subtype: 15, width: 0, stretch: PT, stretch_order: 2, shrink: 0 }];
const para = { protrude_chars: 2, adjust_spacing: 2 };

test('a character drawn as a box hangs into the margin by its own \\lpcode and \\rpcode', () => {
  // "4 -" in small capitals: the digit at the line's start, the hyphen at its end
  const nodes = [charBox(52, 52, 432537), space, charBox(45, 45, 301200), ...parfill];
  const bcs = breaker.buildBreakCandidates(nodes, fontInfo, para);
  assert.equal(bcs[0].leftProtrusion, Math.round(QUAD * 38 / 1000), "the 4's \\lpcode of its font's quad");
  assert.equal(bcs[bcs.length - 1].packRightProtrusion, Math.round(QUAD * 191 / 1000), "the hyphen's \\rpcode");
});

test('a character drawn as a box expands with its line, and a font kern beside it too', () => {
  const ff = charBox(27, 70, 420080), e: Node = { type: 'glyph', font: 7, char: 101, width: 290976, height: 8 * PT, depth: 0 };
  const kern: Node = { type: 'kern', kern: -9824, subtype: 0 };
  const ns = [ff, kern, e];
  assert.equal(core.expandableSp(fontInfo, ns, 0), 420080 * 1, 'its whole width, per unit of expansion');
  assert.equal(core.expandableSp(fontInfo, ns, 1), -9824, 'a kern between two characters');
  assert.ok(breaker.fontStretchSp(fontInfo, ns, 0, false) > 0, "TeX's font stretch counts it");
  // drawn at 2 % wider: the box, and the piece in it moved by the
  // letterspacing widened as well
  const at: [number, number][] = [];
  const sink = { glyph: (n: Node, x: number) => at.push([n.char as number, x]), space() {}, rule() {}, picture() {}, beginTransform() {}, endTransform() {} };
  const end = render.renderNodes(fontInfo, sink, ns, 0, 0, 0, 0.02);
  const px = 2 / 65536;
  assert.ok(Math.abs(at[0][1] - LETTERSPACE * 1.02 * px) < 1e-9, 'the piece where the widened packet puts it');
  assert.ok(Math.abs(at[1][1] - (420080 - 9824) * 1.02 * px) < 1e-9, 'the next character after the widened box and kern');
  assert.ok(Math.abs(end - (420080 - 9824 + 290976) * 1.02 * px) < 1e-9);
});

test('a character in a line TeX set (in a box) is drawn with the expansion TeX gave it, a box of pieces too', () => {
  // as the serializer records such a line: each character's factor in
  // millionths of its width, its font kerns as expanded
  const ff = { ...charBox(27, 70, 420080), expansion_factor: 20000 };
  const e: Node = { type: 'glyph', font: 7, char: 101, width: 290976, height: 8 * PT, depth: 0, expansion_factor: -15000 };
  const at: [number, number][] = [];
  const sink = { glyph: (n: Node, x: number) => at.push([n.char as number, x]), space() {}, rule() {}, picture() {}, beginTransform() {}, endTransform() {} };
  const end = render.renderNodes(fontInfo, sink, [ff, e, { type: 'glyph', font: 8, char: 120, width: 300000, height: 8 * PT, depth: 0 }], 0, 0, 0, 0);
  const px = 2 / 65536;
  assert.ok(Math.abs(at[0][1] - LETTERSPACE * 1.02 * px) < 1e-9, "the piece where the box's widened packet puts it");
  assert.ok(Math.abs(at[1][1] - 420080 * 1.02 * px) < 1e-9, 'the next character after the widened box');
  assert.ok(Math.abs(at[2][1] - (420080 * 1.02 + 290976 * 0.985) * px) < 1e-9, 'and after the narrowed one');
  assert.ok(Math.abs(end - (420080 * 1.02 + 290976 * 0.985 + 300000) * px) < 1e-9, 'one without a factor: its own width');
});
