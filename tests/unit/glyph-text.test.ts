// SPDX-License-Identifier: AGPL-3.0-or-later
// What a glyph says as text (src/shared/glyph-text.ts): the one rule for the
// accessible layer, copying, finding and the inspector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPH_INDEX_PUA, glyphText, isPrivateUse, nodeText, slotCode } from '../../src/shared/glyph-text.ts';

test('a glyph is its character; a ligature its letters; a private-use code nothing', () => {
  assert.equal(glyphText(0x61), 'a');
  assert.equal(glyphText(0x1D465), '𝑥');                 // mathematical italic x
  assert.equal(glyphText(0x211D), 'ℝ');
  assert.deepEqual([0xFB00, 0xFB01, 0xFB02, 0xFB03, 0xFB04].map(glyphText), ['ff', 'fi', 'fl', 'ffi', 'ffl']);
  for (const cp of [slotCode(64), GLYPH_INDEX_PUA + 1234, 0xF0001, 0xF8FF]) {
    assert.ok(isPrivateUse(cp), cp.toString(16));
    assert.equal(glyphText(cp), '');
  }
  assert.ok(!isPrivateUse(0xFB01));
});

test("a glyph node's text: a \\webtext word's own, else its character's", () => {
  assert.equal(nodeText({ char: 0xFB01 }), 'fi');
  assert.equal(nodeText({ text: 'word', char: 0x61 }), 'word');
  assert.equal(nodeText({}), '');
});
