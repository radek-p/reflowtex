// SPDX-License-Identifier: AGPL-3.0-or-later
// A block's warnings: the characters TeX could not set, one warning per font
// and character, and how they reach the page's data (Document.warnings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingCharWarnings, type MissingChar } from '../../src/pipeline/warnings.ts';
import { encodeDocument } from '../../src/pipeline/encode.ts';
import { messageType } from '../../src/pipeline/schema.ts';
import type { SerializerOutput } from '../../src/pipeline/nodes.ts';

const RAW: MissingChar[] = [
  { font: 'ec-lmr10', char: 0x142, count: 2, where: ['Paweł Borówka', 'its ł and'] },
  { font: 'LMRoman8-Regular', char: 0x2550, count: 3, where: ['as ═ and'] },
  // the same character in a footnote (another stream): merged with the first
  { font: 'ec-lmr10', char: 0x142, stream: 4, count: 1, where: ['Michał', 'Łukasz Michał'] },
  { font: 'nullfont', char: 0, count: 1, where: [] },
];

test('one warning per font and character, in the order first met', () => {
  const w = missingCharWarnings(RAW);
  assert.deepEqual(w.map(x => x.message), [
    'There is no ł (U+0142) in font ec-lmr10',
    'There is no ═ (U+2550) in font LMRoman8-Regular',
    'There is no ^^@ (U+0000) in font nullfont',
  ]);
  assert.deepEqual(w[0], {
    level: 'warning', code: 'missing-char', message: 'There is no ł (U+0142) in font ec-lmr10',
    details: { font: 'ec-lmr10', char: 'ł', codepoint: 'U+0142', count: '3', where: 'Paweł Borówka · its ł and · Michał' },
  });
  assert.equal(RAW[0].count, 2, 'the records are not changed');
});

test('the warnings reach the block\'s data', () => {
  const data: SerializerOutput = { fonts: new Map(), paragraphs: [], content: [], streams: [], missing_chars: RAW.slice(0, 2) };
  const Document = messageType('Document');
  const doc = Document.toObject(Document.decode(encodeDocument(data))) as { warnings: { code: string; details: Record<string, string> }[] };
  assert.deepEqual(doc.warnings.map(w => [w.code, w.details.char, w.details.count]), [['missing-char', 'ł', '2'], ['missing-char', '═', '3']]);
});
