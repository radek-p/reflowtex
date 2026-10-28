// SPDX-License-Identifier: AGPL-3.0-or-later
// The characters a font did not have, read off TeX's own log
// (src/pipeline/backend/tex-log.ts): TeX's, pdfTeX's, XeTeX's and LuaTeX's
// lines as each engine writes them (the excerpts below are from TeX Live
// 2025 and 2026 logs), broken at max_print_line or not, as warnings or as
// errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingCharsFromLog } from '../../src/pipeline/backend/index.ts';
import { missingCharWarnings } from '../../src/pipeline/warnings.ts';

/** [font, char, count] for each record */
const brief = (log: string | Uint8Array, o?: { maxPrintLine?: number }) =>
  missingCharsFromLog(log, o).map(m => [m.font, m.char, m.count]);

const LONG = 'averyveryverylongfontnamethatmakesthelinewrapatseventyninecolumnsxx';
const OTF = '[lmroman10-regular.otf]:mapping=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern';

test('TeX and pdfTeX: the character in ^^ notation, a long font name broken at 79', () => {
  const log = [
    '(./plain-1.tex',
    'Missing character: There is no ^^c8 in font cmr10!',
    'Missing character: There is no ^^80 in font cmr10!',
    'Missing character: There is no ^^ff in font cmr10!',
    'Missing character: There is no ^^c8 in font averyveryverylongfontnamethatmakest',
    'helinewrapatseventyninecolumnsxx!',
    'Missing character: There is no ^^c8 in font averyveryverylongfontnamethatmakest',
    'helinewrapatseventyninecolumnsxx!',
    '',
    'Overfull \\hbox (19.58339pt too wide) in paragraph at lines 4--8',
  ].join('\n');
  assert.deepEqual(brief(log), [['cmr10', 0xC8, 1], ['cmr10', 0x80, 1], ['cmr10', 0xFF, 1], [LONG, 0xC8, 2]]);
});

test('pdfTeX with \\tracinglostchars >= 3: an error, its code in hex, ended with a full stop', () => {
  const log = [
    '! Missing character: There is no ^^c8 ("C8) in font cmr10.',
    'l.4 A\\char"C8 ',
    '              \\char"80 \\char"FF \\char"7F',
    '',
    '! Missing character: There is no ^^ff ("FF) in font cmr10.',
    'l.4 A\\char"C8 \\char"80 \\char"FF ',
    '',
    '! Missing character: There is no ^^c8 ("C8) in font averyveryverylongfontnameth',
    'atmakesthelinewrapatseventyninecolumnsxx.',
    'l.6 B\\char"C8',
  ].join('\n');
  assert.deepEqual(brief(log), [['cmr10', 0xC8, 1], ['cmr10', 0xFF, 1], [LONG, 0xC8, 1]]);
});

test('LuaTeX: the character and U+, the line broken at 79 bytes and one more (a character of several bytes counted as such)', () => {
  const log = [
    'Missing character: There is no È (U+00C8) in font cmr10!',
    'Missing character: There is no \u0080 (U+0080) in font cmr10!',
    'Missing character: There is no È (U+00C8) in font averyveryverylongfontnamethat',
    'makesthelinewrapatseventyninecolumnsxx!',
    'Missing character: There is no ═ (U+2550) in font [lmroman10-regular.otf]:mapp',
    'ing=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern!',
    'Missing character: There is no 😀 (U+1F600) in font [lmroman10-regular.otf]:ma',
    'pping=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern!',
    'Missing character: There is no \u{10FFFD} (U+10FFFD) in font [lmroman10-regular.otf]:m',
    'apping=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern!',
    '])</usr/local/texlive/2026/texmf-dist/fonts/opentype/public/lm/lmroman10-regular',
    '.otf>',
  ].join('\n');
  assert.deepEqual(brief(log), [['cmr10', 0xC8, 1], ['cmr10', 0x80, 1], [LONG, 0xC8, 1], [OTF, 0x2550, 1], [OTF, 0x1F600, 1], [OTF, 0x10FFFD, 1]]);
  // as an error (\tracinglostchars >= 3): the same line, the error's own after it
  assert.deepEqual(brief(['Missing character: There is no È (U+00C8) in font cmr10!', '.', '<to be read again> ', '                   \\end '].join('\n')),
    [['cmr10', 0xC8, 1]]);
});

test('XeTeX: U+ for an OpenType font, "hex for a TFM one; the line broken at 79 characters', () => {
  const log = [
    'Missing character: There is no ═ (U+2550) in font [lmroman10-regular.otf]:mappi',
    'ng=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern!',
    'Missing character: There is no ═ (U+2550) in font [lmroman10-regular.otf]:mappi',
    'ng=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern!',
    'Missing character: There is no 😀 (U+1F600) in font [lmroman10-regular.otf]:mapp',
    'ing=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern!',
    '',
    'Missing character: There is no ═ ("2550) in font nullfont!',
    'Missing character: There is no È ("C8) in font cmr10!',
    'Missing character: There is no ^^80 ("80) in font cmr10!',
    '[1] )',
  ].join('\n');
  assert.deepEqual(brief(log), [[OTF, 0x2550, 2], [OTF, 0x1F600, 1], ['nullfont', 0x2550, 1], ['cmr10', 0xC8, 1], ['cmr10', 0x80, 1]]);
  const errors = [
    '! Missing character: There is no 😀 (U+1F600) in font [lmroman10-regular.otf]:ma',
    'pping=tex-text;+tlig;+liga;color=FF0000;letterspace=0.0;+kern.',
    'l.3 Zażółć ł ═ ^^^^2550 ^^^^^^01f600 ',
    '                                     \\char"10FFFD',
    '',
    '! Missing character: There is no È ("C8) in font cmr10.',
    'l.5 \\font\\c=cmr10 \\c A\\char"C8 ',
  ].join('\n');
  assert.deepEqual(brief(errors), [[OTF, 0x1F600, 1], ['cmr10', 0xC8, 1]]);
});

test('every ^^ form, and the character itself where no code is given', () => {
  const line = (c: string) => `Missing character: There is no ${c} in font f!`;
  assert.deepEqual(brief(['^^@', '^^A', '^^?', '^^e9', '^^^^2550', '^^^^^^01f600', 'ł', ' ', '!'].map(line).join('\n')).map(r => r[1]),
    [0, 1, 0x7F, 0xE9, 0x2550, 0x1F600, 0x142, 0x20, 0x21]);
});

test("pdfTeX's 8-bit characters as they are, from the log's bytes; UTF-8 lines beside them", () => {
  const enc = new TextEncoder();
  const bytes = new Uint8Array([
    ...enc.encode('Missing character: There is no '), 0xC8, ...enc.encode(' in font cmr10!\n'),
    ...enc.encode('Missing character: There is no '), 0xAA, ...enc.encode(' in font cmr10!\n'),
    ...enc.encode('Missing character: There is no ł (U+0142) in font ec-lmr10!\n'),
  ]);
  assert.deepEqual(brief(bytes), [['cmr10', 0xC8, 1], ['cmr10', 0xAA, 1], ['ec-lmr10', 0x142, 1]]);
});

test('another max_print_line: lines broken at it are joined, and only those', () => {
  const msg = 'Missing character: There is no ^^c8 in font averyveryverylongfontname!';
  const at = (w: number) => msg.match(new RegExp(`.{1,${w}}`, 'g'))!.join('\n');
  assert.deepEqual(brief(at(40), { maxPrintLine: 40 }), [['averyveryverylongfontname', 0xC8, 1]]);
  assert.deepEqual(brief(at(40)), [], 'not at the default width: a short line is a whole one');
  assert.deepEqual(brief(msg, { maxPrintLine: 10000 }), [['averyveryverylongfontname', 0xC8, 1]]);
  // a line that is not whole and not full is no record; what follows is read as it is
  assert.deepEqual(brief(['Missing character: There is no ^^c8 in font cm', 'Missing character: There is no A in font cmr10!'].join('\n')), [['cmr10', 0x41, 1]]);
});

test('the records make the same warnings as the LuaTeX serializer\'s', () => {
  const [w] = missingCharWarnings(missingCharsFromLog('Missing character: There is no ł (U+0142) in font ec-lmr10!\r\n'));
  assert.deepEqual(w, {
    level: 'warning', code: 'missing-char', message: 'There is no ł (U+0142) in font ec-lmr10',
    details: { font: 'ec-lmr10', char: 'ł', codepoint: 'U+0142', count: '1', where: '' },
  });
});
