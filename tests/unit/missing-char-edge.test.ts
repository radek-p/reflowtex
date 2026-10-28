// SPDX-License-Identifier: AGPL-3.0-or-later
// A character TeX could not set, at a line's edge under microtype. TeX's
// search for the character that protrudes stops at the glyph – a character
// with no protrusion codes – so the comma before it does not hang into the
// margin, nor a quotation mark after it at a line's start. The serializer
// writes the glyph as a box of its size holding an empty vlist, which stops
// the viewer's search too (a rule of size 0 would not: LuaTeX steps over
// one); an empty box (a label's anchor) is stepped over, as TeX steps over it.
//
// The viewer's module, imported by a path the Node project does not follow
// (see node-kinds.test.ts); the signatures used are written out here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type TexNode = Record<string, unknown> & { type: string };
interface Breaker {
  findLastGlyph(nodes: TexNode[], idx: number): TexNode | null;
  findFirstGlyph(nodes: TexNode[], idx: number): TexNode | null;
}
const VIEWER = new URL('../../src/viewer/src/engine/', import.meta.url).href;
const { findLastGlyph, findFirstGlyph }: Breaker = await import(`${VIEWER}breaker.ts`);

const PT = 65536;
const glyph = (char: string): TexNode => ({ type: 'glyph', font: 1, char: char.codePointAt(0)!, width: 3 * PT, height: 7 * PT, depth: 0 });
const glue: TexNode = { type: 'glue', width: 3 * PT, stretch: PT, shrink: PT };
/** what serializer.lua writes for a glyph TeX draws nothing for */
const missing = (width = 0): TexNode => ({
  type: 'hlist', subtype: 2, width, height: 0, depth: 0, shift: 0, glue_set: 0, glue_sign: 0, glue_order: 0,
  children: [{ type: 'vlist', width: 0, height: 0, depth: 0, shift: 0, glue_set: 0, glue_sign: 0, glue_order: 0, children: [] }],
});
const anchor: TexNode = { type: 'hlist', subtype: 2, width: 0, height: 0, depth: 0, children: [] };

test('a missing character at a line\'s end: the comma before it does not protrude', () => {
  const line = [glyph('X'), glyph(','), missing(), glue];
  assert.equal(findLastGlyph(line, 3), null);
  const notdef = [glyph('X'), glyph(','), missing(), missing(183501), glue];   // and an OpenType font's .notdef
  assert.equal(findLastGlyph(notdef, 4), null);
  const labelled = [glyph('X'), glyph(','), anchor, glue];
  assert.equal(findLastGlyph(labelled, 3)?.char, 0x2C, 'an anchor is stepped over');
});

test('a missing character at a line\'s start: the quotation mark after it does not protrude', () => {
  assert.equal(findFirstGlyph([missing(), glyph('“'), glyph('a')], 0), null);
  assert.equal(findFirstGlyph([anchor, glyph('“'), glyph('a')], 0)?.char, 0x201C, 'an anchor is stepped over');
});
