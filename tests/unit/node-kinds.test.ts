// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's switches over a node's type name every type (each ends in
// unreachable(), so leaving one out does not compile). Naming them showed
// three that were missing behind a default: a bare rule's width, a rule's
// height and depth in a line's ink, and a widget before a display.
//
// The modules are the viewer's, type-checked with it (tsconfig.browser.json).
// Imported by a path the Node project does not follow: their types reach the
// host's (engine/model.ts → host/types.ts → host/inspect.ts), which the Node
// project cannot check. So the few signatures used are written out here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type TexNode = Record<string, unknown> & { type: string };
interface InkItem { x1: number; x2: number; h: number; d: number }
interface Engine {
  RUNNING_RULE: number; SP_TO_PX: number;
  nodeWidthSp(n: TexNode): number;
  sumWidthSp(ns: TexNode[]): number;
}
interface Lines { lineProfile(fonts: object, nodes: TexNode[], x: number, ratio: number, er: number): InkItem[] }
interface Display {
  preDisplaySizeSp(fonts: object, lines: { nodes: TexNode[]; ratio: number; fitness: number; leftProtrusion: number }[],
                   lrp: { ratio: number; er: number; x0: number }[]): { w: number; quad: number } | null;
}
const VIEWER = new URL('../../src/viewer/src/engine/', import.meta.url).href;
const { RUNNING_RULE, SP_TO_PX, nodeWidthSp, sumWidthSp }: Engine = await import(`${VIEWER}core.ts`);
const { lineProfile }: Lines = await import(`${VIEWER}layout/lines.ts`);
const { preDisplaySizeSp }: Display = await import(`${VIEWER}layout/display.ts`);

const PT = 65536;
const fonts = {
  '1': { face: { kind: 'text', family: 'f' }, size_px: 20, quad: 10 * PT, expand: null, codes: new Map() },
};
const glyph = (w: number, h = 7 * PT, d = 0): TexNode => ({ type: 'glyph', font: 1, char: 0x61, width: w, height: h, depth: d });
const rule = (w: number, h: number, d: number): TexNode => ({ type: 'rule', width: w, height: h, depth: d });

test('a rule set in a line takes its width there; a running width is none', () => {
  assert.equal(nodeWidthSp(rule(3 * PT, PT, 0)), 3 * PT);
  assert.equal(nodeWidthSp(rule(RUNNING_RULE, PT, 0)), 0);
  assert.equal(sumWidthSp([glyph(5 * PT), rule(2 * PT, RUNNING_RULE, RUNNING_RULE), glyph(5 * PT)]), 12 * PT);
});

test("a rule's height and depth are ink of its line; running ones are the line's own", () => {
  const items = lineProfile(fonts, [glyph(5 * PT), rule(PT, 18 * PT, 7 * PT), rule(2 * PT, RUNNING_RULE, RUNNING_RULE), glyph(5 * PT)], 0, 0, 0);
  const at = (k: number) => k * PT * SP_TO_PX;
  assert.deepEqual(items.map(it => [it.x1, it.x2, it.h, it.d]), [
    [0, at(5), at(7), 0],
    [at(5), at(6), at(18), at(7)],
    [at(6), at(8), 0, 0],
    [at(8), at(13), at(7), 0],
  ]);
});

test("a widget at a line's end is the last ink before a display (\\predisplaysize)", () => {
  const widget: TexNode = { type: 'widget', width: 50 * PT, height: 8 * PT, depth: 2 * PT };
  const line = { nodes: [glyph(5 * PT), widget], ratio: 0, fitness: 0, leftProtrusion: 0 };
  const size = preDisplaySizeSp(fonts, [line], [{ ratio: 0, er: 0, x0: 0 }]);
  assert.deepEqual(size, { w: 55 * PT, quad: 10 * PT });
});
