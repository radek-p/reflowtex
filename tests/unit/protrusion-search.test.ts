// SPDX-License-Identifier: AGPL-3.0-or-later
// The search for the character that protrudes at a line's edge, as LuaTeX's
// find_protchar_left and find_protchar_right make it: over what cp_skipable
// allows (protSkipable), into boxes. A box of size zero with nothing in it
// is skipped like a penalty: the empty nucleus of $^1$ or \textsuperscript,
// a label's anchor, an empty \hbox{}.
//
// The viewer's module, imported by a path the Node project does not follow
// (see node-kinds.test.ts); the signatures used are written out here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type TexNode = Record<string, unknown> & { type: string };
interface Breaker {
  findLastGlyph(nodes: TexNode[], idx: number): TexNode | null;
  findFirstGlyph(nodes: TexNode[], idx: number): TexNode | null;
  protSkipable(n: TexNode): boolean;
}
const VIEWER = new URL('../../src/viewer/src/engine/', import.meta.url).href;
const { findLastGlyph, findFirstGlyph, protSkipable }: Breaker = await import(`${VIEWER}breaker.ts`);

const PT = 65536;
const glyph = (char: string): TexNode => ({ type: 'glyph', font: 1, char: char.codePointAt(0)!, width: 3 * PT, height: 7 * PT, depth: 0 });
const box = (children: TexNode[], width = 0): TexNode =>
  ({ type: 'hlist', width, height: children.length ? 5 * PT : 0, depth: 0, children });
const empty = (): TexNode => box([]);
const math = (subtype: number): TexNode => ({ type: 'math', subtype, surround: 0 });
const penalty = (n: number): TexNode => ({ type: 'penalty', penalty: n });
const glue: TexNode = { type: 'glue', width: 3 * PT, stretch: PT, shrink: PT };
const char = (n: TexNode | null) => n && String.fromCodePoint(n.char as number);

test('cp_skipable: an empty box and a rule of size zero are stepped over; a box with a size, or a vlist, is not', () => {
  assert.equal(protSkipable(empty()), true);
  assert.equal(protSkipable({ type: 'rule', width: 0, height: 0, depth: 0 }), true);
  assert.equal(protSkipable({ type: 'rule', width: 0, height: 7 * PT, depth: 0 }), false);
  assert.equal(protSkipable(box([], 2 * PT)), false);
  assert.equal(protSkipable(box([penalty(0)])), false, 'a box with a list is searched, not skipped');
  assert.equal(protSkipable({ type: 'vlist', width: 0, height: 0, depth: 0, children: [] }), false);
});

// $^1$ at a line's start: math-on, the empty nucleus, the superscript's box
// holding the digit, math-off. LuaTeX protrudes the digit.
test('a superscript at a line\'s start protrudes past the empty nucleus', () => {
  const sup = glyph('1');
  const line = [empty(), math(0), empty(), box([sup]), math(1), glyph('N'), glue];
  assert.equal(findFirstGlyph(line, 0), sup);
  // and at a line's end, the mirror image
  const end = [glyph('x'), glue, math(0), box([glyph('2')]), empty(), math(1), glue];
  assert.equal(char(findLastGlyph(end, 6)), '2');
});

// LuaTeX leaves a box at a line's start that holds nothing to protrude and
// takes the node after it as it is: a character protrudes, a box is not
// searched.
test('a line\'s start: a box of nothing ends the search at the node after it', () => {
  assert.equal(char(findFirstGlyph([box([penalty(0)]), glyph('A'), glyph('b')], 0)), 'A');
  assert.equal(findFirstGlyph([box([penalty(0)]), box([glyph('A')])], 0), null);
  assert.equal(findFirstGlyph([box([penalty(0)]), penalty(0), glyph('A')], 0), null);
  assert.equal(char(findFirstGlyph([box([box([penalty(0)])]), glyph('A')], 0)), 'A', 'out of every box it ends');
  assert.equal(findFirstGlyph([box([penalty(0)])], 0), null);
  assert.equal(findFirstGlyph([box([], 2 * PT), glyph('A')], 0), null, 'a box with a size stops it');
});

// A paragraph ending in a period and the anchor thm-restate and hyperref
// leave: \penalty10000 \hbox{\hbox{\penalty10000}} \penalty10000. LuaTeX
// goes into the box, finds nothing but penalties, steps back out of both and
// on before the box: the period protrudes.
test('a line\'s end: the search steps back out of a box of nothing and goes on before it', () => {
  assert.equal(char(findLastGlyph([glyph('x'), glyph('.'), penalty(10000), box([box([penalty(10000)])]), penalty(10000)], 5)), '.');
  assert.equal(char(findLastGlyph([glyph('.'), box([penalty(0), box([])])], 2)), '.');
  assert.equal(findLastGlyph([box([penalty(10000)]), penalty(0)], 2), null, 'nothing before it');
  // a box whose last item stops the search: nothing protrudes
  const kern: TexNode = { type: 'kern', kern: PT, subtype: 1 };
  assert.equal(findLastGlyph([glyph('.'), box([glyph('a'), kern])], 2), null);
  assert.equal(findLastGlyph([glyph('.'), box([], 2 * PT)], 2), null, 'a box with a size stops it');
});

// LuaTeX looks for the character at a line's end back to the line's start
// only: a line holding nothing but penalties after a break does not hang the
// character before the break.
test('a line\'s end: the search stops at the line\'s start', async () => {
  interface Candidate { kind: string; nodeIdx: number; rightProtrusion: number }
  const breaker = await import(`${VIEWER}breaker.ts`) as {
    buildBreakCandidates(nodes: TexNode[], fontInfo: object, para: object): Candidate[];
    rightProtrusionOf(a: Candidate, b: Candidate, packed: boolean): number;
  };
  const QUAD = 10 * PT;
  const fontInfo = { 1: { quad: QUAD, codes: new Map([[0x2E, { char: 0x2E, lp: 0, rp: 500, ef: 1000 }]]) } };
  const pfs: TexNode = { type: 'glue', subtype: 15, width: 0, stretch: PT, stretch_order: 2, shrink: 0 };
  const nodes = [glyph('a'), glyph('.'), penalty(0), penalty(0), glyph('b'), penalty(10000), pfs];
  const bcs = breaker.buildBreakCandidates(nodes, fontInfo, { protrude_chars: 2 });
  assert.deepEqual(bcs.map(b => [b.kind, b.nodeIdx]), [['start', -1], ['penalty', 2], ['penalty', 3], ['end', 6]]);
  assert.equal(breaker.rightProtrusionOf(bcs[0], bcs[1], false), QUAD / 2, 'the period ends the first line');
  assert.equal(breaker.rightProtrusionOf(bcs[0], bcs[2], false), QUAD / 2, 'and a line from the start to the second penalty');
  assert.equal(breaker.rightProtrusionOf(bcs[1], bcs[2], false), 0, 'but not the empty line between the two');
});
