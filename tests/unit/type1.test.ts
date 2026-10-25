// SPDX-License-Identifier: AGPL-3.0-or-later
// Which outline and encoding a classic TeX font is converted with. The font
// map says it, as it says it to TeX: Latin Modern's maths fonts are named
// after their outlines (lmsy10.pfb) but re-encoded by the map
// (lm-mathsy.enc). Read with the outline's own encoding instead, slot 106 of
// lmsy10 was no glyph at all, and `|x|` could not be drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { convertOutline, findOutline, PUA_BASE } from '../../src/pipeline/fonts/type1.ts';

/** The outline file and encoding `face` is converted with. */
function outlineOf(face: string): { file: string; encoding: string[] | null } {
  const found = findOutline(face);
  assert.ok(found, `${face}: no outline found`);
  return { file: basename(found[0]), encoding: found[1] };
}

test('Latin Modern maths fonts take the encoding the font map gives them', () => {
  const sy = outlineOf('lmsy10');
  assert.equal(sy.file, 'lmsy10.pfb');
  assert.ok(sy.encoding, 'lmsy10: read with its own encoding, not lm-mathsy.enc');
  assert.equal(sy.encoding[106], 'bar');                 // | in TeX's OMS layout
  assert.equal(sy.encoding[49], 'infinity');
  assert.equal(sy.encoding[0], 'minus');

  const ex = outlineOf('lmex10');
  assert.equal(ex.file, 'lmex10.pfb');
  assert.ok(ex.encoding);
  assert.equal(ex.encoding[80], 'summationtext');       // \sum, text size
  assert.equal(ex.encoding[90], 'integraldisplay');     // \int, display size

  const mi = outlineOf('lmmi10');
  assert.equal(mi.file, 'lmmi10.pfb');
  assert.ok(mi.encoding);
  assert.equal(mi.encoding[11], 'alpha');
});

test('every slot of lmsy10 that TeX uses is addressed', () => {
  const found = findOutline('lmsy10');
  assert.ok(found);
  const { addressing } = convertOutline(found[0], 'lmsy10', found[1]);
  // \aleph, |, \infty, \cup, \subseteq, \langle, \rangle, the brackets
  for (const slot of [64, 106, 49, 91, 18, 104, 105, 102, 103]) assert.ok(addressing.has(slot), `slot ${slot} not addressed`);
  assert.equal(addressing.get(106), '|'.codePointAt(0));
  assert.equal(addressing.get(64), PUA_BASE + 64);       // aleph: not a searchable character
});

test('a face whose map entry has no encoding keeps the outline\'s own', () => {
  const cm = outlineOf('cmsy10');
  assert.equal(cm.file, 'cmsy10.pfb');
  assert.equal(cm.encoding, null);
});

test('a face named after no outline file takes the map\'s outline and encoding', () => {
  const ec = outlineOf('ec-lmr10');
  assert.equal(ec.file, 'lmr10.pfb');
  assert.ok(ec.encoding);
  assert.equal(ec.encoding[0xC4], 'Adieresis');
});
