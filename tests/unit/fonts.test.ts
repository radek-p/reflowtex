// SPDX-License-Identifier: AGPL-3.0-or-later
// A font's face (src/shared/font-face.ts): decided once by the pipeline,
// carried on the wire, read back by the viewer – and the encoder refusing
// what the wire format cannot carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FONT_KINDS, faceFromWire, faceToWire, type TexFontFace } from '../../src/shared/font-face.ts';
import { readSerializerOutput, writeSerializerOutput, type SerializerOutput } from '../../src/pipeline/nodes.ts';
import { encodeDocument, SchemaMismatch } from '../../src/pipeline/encode.ts';
import { messageType, schema } from '../../src/pipeline/schema.ts';
import { Fonts, fontNeeds } from '../../src/pipeline/fonts/fonts.ts';
import { normaliseLegacyFontAddressing } from '../../src/pipeline/fonts/addressing.ts';
import { FontError } from '../../src/pipeline/errors.ts';

const doc = (fonts: Record<string, unknown>, nodes: Record<string, unknown>[] = []): SerializerOutput =>
  readSerializerOutput(JSON.stringify({ fonts, paragraphs: [{ nodes }], content: [{ kind: 'paragraph', para: 1 }], streams: [] }));
/** Encoded and decoded as the viewer decodes (runtime/decode.ts). */
const wire = (d: SerializerOutput) => {
  const Document = messageType('Document');
  return Document.toObject(Document.decode(encodeDocument(d)), { defaults: false, arrays: true, enums: String, longs: Number }) as
    { fonts: Record<string, unknown>[]; paragraphs: { nodes: Record<string, unknown>[] }[] };
};

test("every kind of face is one of latex.proto's FontKind values, and the other way round", () => {
  assert.deepEqual(Object.keys(schema().lookupEnum('latex.FontKind').values), [...FONT_KINDS]);
});

test('a face goes over the wire and comes back the same', () => {
  const faces: TexFontFace[] = [
    { kind: 'opentype', file: 'lmroman10-regular.otf' },
    { kind: 'type1', file: 'cmr10.reflowtex-0123abcd.otf' },
    { kind: 'boxes', reason: 'no outline' },
  ];
  for (const face of faces) assert.deepEqual(faceFromWire(faceToWire(face)), face);
  const d = doc({ 1: { name: 'a', size_sp: 655360, face: faces[0] }, 2: { name: 'b', size_sp: 655360, face: faces[1] },
                  3: { name: 'c', size_sp: 655360, face: faces[2] } });
  assert.deepEqual(wire(d).fonts.map(f => faceFromWire(f)), faces);
});

test('data that makes no face is drawn as boxes, saying so', () => {
  assert.equal(faceFromWire({ kind: 'opentype' }).kind, 'boxes');
  assert.equal(faceFromWire({ kind: 'sprite', filename: 'x.png' }).kind, 'boxes');
  assert.equal(faceFromWire({ filename: 'old.otf' }).kind, 'boxes');
});

test("the serializer's fonts: a file is an OpenType face, none a classic font yet to be given one; output.json keeps the face", () => {
  const d = doc({ 1: { name: 'LMRoman10-Regular', size_sp: 1, filename: 'lmroman10-regular.otf' }, 2: { name: 'cmr10', size_sp: 1 } });
  assert.deepEqual(d.fonts.get('1')!.face, { kind: 'opentype', file: 'lmroman10-regular.otf' });
  assert.equal(d.fonts.get('1')!.filename, undefined);
  assert.deepEqual(d.fonts.get('2')!.face, { kind: 'tfm' });
  assert.deepEqual(readSerializerOutput(writeSerializerOutput(d)).fonts, d.fonts);
});

test('a classic font with no outline is given boxes, with the reason, and the build refuses it by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-fonts-'));
  try {
    const d = doc({ 7: { name: 'rtxnoface10', size_sp: 655360 } }, [{ type: 'glyph', font: 7, char: 65, width: 1, height: 1, depth: 0 }]);
    normaliseLegacyFontAddressing(d, new Fonts(dir));
    const face = d.fonts.get('7')!.face;
    assert.equal(face.kind, 'boxes');
    assert.match(face.kind === 'boxes' ? face.reason : '', /rtxnoface10/);
    const fonts = new Fonts(dir);
    const needs = fontNeeds([d]);
    assert.deepEqual([...needs.boxes], [['rtxnoface10', { reason: face.kind === 'boxes' ? face.reason : '', glyphs: 1 }]]);
    assert.throws(() => fonts.verify(needs), (e: Error) => e instanceof FontError && /rtxnoface10: no face/.test(e.message));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the encoder refuses a font with no face yet, and a key the schema has no field for', () => {
  assert.throws(() => encodeDocument(doc({ 2: { name: 'cmr10', size_sp: 1 } })), (e: Error) => e instanceof SchemaMismatch && /cmr10/.test(e.message));
  const face = { kind: 'opentype', file: 'a.otf' };
  assert.throws(() => encodeDocument(doc({ 1: { name: 'a', size_sp: 1, face } }, [{ type: 'glyph', font: 1, char: 65, sprite: 3 }])),
    (e: Error) => e instanceof SchemaMismatch && /\.sprite: latex\.proto's Node has no field sprite/.test(e.message));
  assert.throws(() => encodeDocument(doc({ 1: { name: 'a', size_sp: 1, face, sheet: 1 } })),
    (e: Error) => e instanceof SchemaMismatch && /FontInfo has no field sheet/.test(e.message));
  // what the pipeline keeps for itself is left out, without a word
  const out = wire(doc({ 1: { name: 'a', size_sp: 1, face } }, [{ type: 'glyph', font: 1, char: 65, gindex: 36 }]));
  const g = out.paragraphs[0].nodes[0];
  assert.deepEqual([g.type, g.char, g.font, g.gindex], ['glyph', 65, 1, undefined]);
});
