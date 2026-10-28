// SPDX-License-Identifier: AGPL-3.0-or-later
// TeX's log read once (src/pipeline/backend/tex-log.ts, TexLog): its lines
// joined where TeX broke them, by LuaTeX's rule (printing.c), with
// characters of several bytes at the break. Then the characters a font did
// not have, read off it: TeX's, pdfTeX's, XeTeX's and LuaTeX's lines as each
// engine writes them (the excerpts below are from TeX Live 2025 and 2026
// logs), broken at max_print_line or not, as warnings or as errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { missingCharsFromLog, TexLog } from '../../src/pipeline/backend/index.ts';
import { missingCharWarnings } from '../../src/pipeline/warnings.ts';

const utf8 = new TextEncoder();

/** Text as LuaTeX's print_char writes it to the log (printing.c): bytes
 *  counted; a character of n >= 2 bytes goes to the next line when the line
 *  has width - n bytes or more (needs_wrapping); the line is broken once it
 *  has width bytes – then a line ending there is followed by an empty one. */
function luatexLines(text: string, width = 79): string[] {
  const lines: number[][] = [[]];
  for (const ch of text) {
    const b = utf8.encode(ch);
    if (b.length > 1 && lines[lines.length - 1].length + b.length >= width) lines.push([]);
    for (const x of b) {
      lines[lines.length - 1].push(x);
      if (lines[lines.length - 1].length === width) lines.push([]);
    }
  }
  return lines.map(l => new TextDecoder().decode(new Uint8Array(l)));
}

test('TexLog: a line LuaTeX broke is joined whole, whichever character of 1–4 bytes falls at the break', () => {
  for (const ch of ['a', 'ł', '═', '😀']) {
    for (let at = 70; at <= 82; at++) {
      const text = `${'x'.repeat(at)}${ch}${'y'.repeat(at)}${ch}tail`;
      const lines = luatexLines(text);
      assert.ok(lines.length > 1);
      const log = new TexLog([...lines, 'The next line.'].join('\n'));
      assert.deepEqual(log.join(0), { text, end: lines.length - 1 }, `${ch} after ${at} bytes`);
      assert.deepEqual(log.join(lines.length), { text: 'The next line.', end: lines.length }, 'the next line is its own');
    }
  }
  // a line of 79 bytes ends where TeX broke it: the empty line after is the break's
  const full = 'x'.repeat(79);
  assert.deepEqual(luatexLines(full), [full, '']);
  assert.deepEqual(new TexLog(`${full}\n\nNext`).join(0), { text: full, end: 1 });
});

test('TexLog: where a line is full and where it is not', () => {
  const log = new TexLog(['x'.repeat(78), 'ok', 'x'.repeat(77), 'łx', 'x'.repeat(76), 'łx', 'x'.repeat(76), '═x', 'x'.repeat(75), '😀x',
    'x'.repeat(74), '😀x', 'x'.repeat(80), 'tail', 'x'.repeat(78), ''].join('\n'));
  assert.deepEqual(log.lines.map((_, i) => log.full(i)),
    [false, false, true, false, false, false, true, false, true, false, false, false, true, false, false, false]);
  // another width: the same rule
  const narrow = new TexLog('abcdefghij\nklm\nabcdefgh\nłx', { maxPrintLine: 10 });
  assert.deepEqual(narrow.lines.map((_, i) => narrow.full(i)), [true, false, true, false]);
});

test('TexLog: a full line may be whole; a reader that can tell stops there', () => {
  // LuaTeX ends lines of 79 and 80 bytes by itself after a font's name
  // (fixtures/luatex-broken-lines.log)
  const whole = 'Missing character: There is no ═ (U+2550) in font file:lmroman10-regular.otf!';
  assert.equal(utf8.encode(whole).length, 79);
  const log = new TexLog(`${whole}\nMissing character: There is no ═ (U+2550) in font file:lmroman10-bolditalic.ot\nf!`);
  assert.equal(log.join(0).end, 2, 'by the rule alone, joined');
  assert.deepEqual(log.join(0, t => t.endsWith('!')), { text: whole, end: 0 });
  assert.deepEqual(log.join(1, t => t.endsWith('!')), { text: 'Missing character: There is no ═ (U+2550) in font file:lmroman10-bolditalic.otf!', end: 2 });
});

test('TexLog: bytes decoded once a line is joined (a character pdfTeX split), CRLF, the text as written', () => {
  const ł = utf8.encode('ł');
  const bytes = new Uint8Array([...utf8.encode('x'.repeat(78)), ł[0], 0x0A, ł[1], ...utf8.encode('y\r\n'), 0xC8, 0x0A]);
  const log = new TexLog(bytes);
  assert.deepEqual(log.join(0), { text: `${'x'.repeat(78)}ły`, end: 1 });
  assert.equal(log.lines[2], '\u00C8', 'a byte that is not UTF-8 is its own code');
  assert.equal(log.text, `${log.lines[0]}\n${log.lines[1]}\n\u00C8\n`);
  assert.equal(TexLog.of(log), log, 'a log read once is not read again');
});

test('TexLog uses no Node API: a browser reads a log as the pipeline does', () => {
  const source = readFileSync(new URL('../../src/pipeline/backend/tex-log.ts', import.meta.url), 'utf8');
  assert.deepEqual(source.match(/^import (?!type ).*$/gm), null, 'types alone');
});

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
