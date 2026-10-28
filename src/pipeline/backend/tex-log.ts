// SPDX-License-Identifier: AGPL-3.0-or-later
// What any backend can read off TeX's own log, whatever the engine: the
// characters a font did not have. TeX writes one line for each it could not
// set (with \tracinglostchars > 0, which LaTeX sets):
//
//     Missing character: There is no ^^c8 in font cmr10!              TeX, pdfTeX
//     Missing character: There is no ł (U+0142) in font ec-lmr10!     LuaTeX, XeTeX
//     Missing character: There is no È ("C8) in font cmr10!           XeTeX, a TFM font
//     ! Missing character: There is no ^^c8 ("C8) in font cmr10.      as an error (\tracinglostchars >= 3)
//
// and breaks a long one at max_print_line (79 unless set: bytes for pdfTeX,
// characters for XeTeX, a byte more for LuaTeX), going on at the next line's
// start. No hook into the engine is needed: a backend without one reports
// missing characters as the LuaTeX serializer's records do (MissingChar),
// counted by font and character, though without the stream or the text
// around them.
import type { MissingChar } from '../warnings.ts';

export interface LogReadOptions {
  /** the width TeX breaks the log's lines at (max_print_line) */
  maxPrintLine?: number;
}

const START = /^(?:! )?Missing character: There is no /;
/** The whole message, its lines joined: the character as TeX shows it, its
 *  code where the engine adds it (U+…, or "hex), and the font. A warning
 *  ends with "!", an error (begun with "! ") with a full stop. */
const BODY = String.raw`Missing character: There is no (.+?)(?: \((?:U\+([0-9A-Fa-f]{4,6})|"([0-9A-Fa-f]{1,6}))\))? in font (.+?)`;
const WARNING = new RegExp(String.raw`^${BODY}!$`, 'su');
const ERROR = new RegExp(String.raw`^! ${BODY}\.$`, 'su');

const utf8 = new TextEncoder();
const bytes = (s: string): number => utf8.encode(s).length;

/** A log's text from its bytes, line by line: UTF-8 where a line is (LuaTeX,
 *  XeTeX), else each byte its own code (pdfTeX writing a font's 8-bit codes
 *  as they are). */
function logText(log: string | Uint8Array): string {
  if (typeof log === 'string') return log;
  const strict = new TextDecoder('utf-8', { fatal: true });
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i <= log.length; i++) {
    if (i < log.length && log[i] !== 0x0A) continue;
    const line = log.subarray(from, i);
    try { out.push(strict.decode(line)); }
    catch { out.push(String.fromCharCode(...line)); }
    from = i + 1;
  }
  return out.join('\n');
}

/** A character as TeX's log shows it, to its code: ^^ notation (^^c8, ^^@,
 *  ^^?; XeTeX's ^^^^2550 and ^^^^^^01f600) or the character itself. */
function charCode(shown: string): number | null {
  let m = /^\^\^\^\^\^\^([0-9a-f]{6})$/.exec(shown) ?? /^\^\^\^\^([0-9a-f]{4})$/.exec(shown) ?? /^\^\^([0-9a-f]{2})$/.exec(shown);
  if (m) return parseInt(m[1], 16);
  m = /^\^\^([\x00-\x7F])$/.exec(shown);
  if (m) { const c = m[1].charCodeAt(0); return c < 0x40 ? c + 0x40 : c - 0x40; }
  const cps = [...shown];
  return cps.length === 1 ? cps[0].codePointAt(0)! : null;
}

/** The characters TeX could not set, from its log (a .log file's text, or its
 *  bytes): one record per font and character in the order first met, `count`
 *  the lines naming it. The font is named as TeX names it (a TFM font's name;
 *  for an OpenType font, the name it was loaded by, with its features). No
 *  stream: every record is the main flow's; `where` is empty. */
export function missingCharsFromLog(log: string | Uint8Array, o: LogReadOptions = {}): MissingChar[] {
  const width = o.maxPrintLine ?? 79;
  const lines = logText(log).split(/\r?\n/);
  const found = new Map<string, MissingChar>();
  for (let i = 0; i < lines.length; i++) {
    if (!START.test(lines[i])) continue;
    // the message as it was before TeX broke it: the first of its joins that
    // is whole (a full line goes on at the next; its length in UTF-8 bytes is
    // at least what any engine counts)
    const message = lines[i].startsWith('! ') ? ERROR : WARNING;
    let text = lines[i], j = i, m = message.exec(text);
    while (!m && bytes(lines[j]) >= width && j + 1 < lines.length) {
      text += lines[++j];
      m = message.exec(text);
    }
    if (!m) continue;
    const [, shown, unicode, hex, font] = m;
    const char = unicode ? parseInt(unicode, 16) : hex ? parseInt(hex, 16) : charCode(shown);
    if (char === null) continue;
    i = j;
    const key = `${font}\u0000${char}`;
    const got = found.get(key);
    if (got) got.count++;
    else found.set(key, { font, char, count: 1, where: [] });
  }
  return [...found.values()];
}
