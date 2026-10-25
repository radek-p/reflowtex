// SPDX-License-Identifier: AGPL-3.0-or-later
// Which outline and encoding a classic TeX font is converted with. The font
// map says it, as it says it to TeX: Latin Modern's maths fonts are named
// after their outlines (lmsy10.pfb) but re-encoded by the map
// (lm-mathsy.enc). Read with the outline's own encoding instead, slot 106 of
// lmsy10 was no glyph at all, and `|x|` could not be drawn. A document may bring
// its own map lines (setDocumentMapLines), read before pdftex.map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import opentype from 'opentype.js';
import { convertOutline, convertType1, findOutline, kpsewhich, parseMapLines, PUA_BASE, readEncoding, setDocumentMapLines } from '../../src/pipeline/fonts/type1.ts';

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

/** The glyph name the converted face draws for each of `slots`. */
function convertedNames(face: string, slots: number[]): (string | null)[] {
  const out = mkdtempSync(join(tmpdir(), 'reflowtex-type1-'));
  const res = convertType1(face, out);
  assert.ok(res, `${face} converts`);
  const buf = readFileSync(join(out, res.served));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return slots.map(s => {
    const cp = res.addressing.get(s);
    return cp === undefined ? null : font.charToGlyph(String.fromCodePoint(cp)).name;
  });
}

test('Latin Modern maths slots convert to the glyphs TeX set', () => {
  // lmmi10: 0x0B alpha, 0x0C beta, 0x3B comma; lmsy10: 0x00 minus, 0x31 infinity;
  // lmex10: 0x50 summationtext, 0x58 summationdisplay
  assert.deepEqual(convertedNames('lmmi10', [0x0B, 0x0C, 0x3B]), ['alpha', 'beta', 'comma']);
  assert.deepEqual(convertedNames('lmsy10', [0x00, 0x31]), ['minus', 'infinity']);
  assert.deepEqual(convertedNames('lmex10', [0x50, 0x58]), ['summationtext', 'summationdisplay']);
});

test('map lines: \\pdfmapline\'s + and = read, a removal and comments skipped, the first line wins', () => {
  const map = parseMapLines(['% comment', '+foo Foo "E ReEncodeFont" <e.enc <foo.pfb', '=foo Other <other.pfb',
    '-bar Bar <bar.pfb', 'baz Baz <[baz.enc <baz.pfa']);
  assert.deepEqual([...map], [['foo', ['foo.pfb', 'e.enc']], ['baz', ['baz.pfa', 'baz.enc']]]);
});

test('a document\'s own map line gives its face the outline and encoding it names', () => {
  // a face of the document's (no docface.pfb anywhere): lmmi10's outline through lm-mathit.enc
  let lines: string[] = ['+docface LMMathItalic10-Regular "enclmmathit ReEncodeFont" <lm-mathit.enc <lmmi10.pfb'];
  setDocumentMapLines(() => lines);
  try {
    const found = findOutline('docface');
    assert.ok(found);
    assert.equal(found[0], kpsewhich('lmmi10.pfb'));
    assert.deepEqual(found[1], readEncoding(kpsewhich('lm-mathit.enc')!));
    assert.deepEqual(convertedNames('docface', [0x0B]), ['alpha']);
    lines = [];                                       // another document: the face is gone
    assert.equal(findOutline('docface'), null);
  } finally { setDocumentMapLines(() => []); }
});

test('a face whose map encoding is missing is not converted (metric boxes, not other glyphs)', () => {
  setDocumentMapLines(() => ['+docface LMMathItalic10-Regular "E ReEncodeFont" <no-such-encoding.enc <lmmi10.pfb']);
  try { assert.equal(findOutline('docface'), null); }
  finally { setDocumentMapLines(() => []); }
});
