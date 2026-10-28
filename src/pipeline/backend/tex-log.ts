// SPDX-License-Identifier: AGPL-3.0-or-later
// TeX's log, read once (TexLog), and what any backend can read off it,
// whatever the engine: the warnings LaTeX wrote, and the characters a font
// did not have. Nothing here needs Node.
//
// TeX breaks a long log line at max_print_line (79 unless set), going on at
// the next line's start. LuaTeX (luatexdir/tex/printing.c) counts bytes of
// UTF-8 and never splits a character: a character of n bytes goes to the
// next line when the line has max_print_line − n bytes or more, so a line it
// broke before an ł has 77 or 78 bytes. Text it prints from C strings (font
// names, Lua's messages) runs to max_print_line + 1 bytes before the break,
// and a character printed after such text can end a line of that length
// that is not broken at all. pdfTeX counts bytes, XeTeX characters (a line
// it broke at 79 characters has 79 bytes or more). So a line is full – TeX
// may have broken it – when it has max_print_line bytes or more, or when the
// next line begins with a character of n ≥ 2 bytes and the line has
// max_print_line − n bytes or more; and a full line may also be a whole one.
// Every reader joins lines by that one rule (TexLog.join); one that can
// tell when its record is whole stops there.
//
// The characters a font did not have: TeX writes one line for each it could
// not set (with \tracinglostchars > 0, which LaTeX sets):
//
//     Missing character: There is no ^^c8 in font cmr10!              TeX, pdfTeX
//     Missing character: There is no ł (U+0142) in font ec-lmr10!     LuaTeX, XeTeX
//     Missing character: There is no È ("C8) in font cmr10!           XeTeX, a TFM font
//     ! Missing character: There is no ^^c8 ("C8) in font cmr10.      as an error (\tracinglostchars >= 3)
//
// No hook into the engine is needed: a backend without one reports missing
// characters as the LuaTeX serializer's records do (MissingChar), counted
// by font and character, though without the stream or the text around them.
import type { MissingChar } from '../warnings.ts';
import type { Diagnostic } from './types.ts';

export interface LogReadOptions {
  /** the width TeX breaks the log's lines at (max_print_line; default 79) */
  maxPrintLine?: number;
}

/** A log as a reader takes it: read already, or its text, or its bytes. */
export type TexLogSource = TexLog | string | Uint8Array;

const utf8 = new TextEncoder();
const strict = new TextDecoder('utf-8', { fatal: true });

/** Bytes as text: UTF-8 where they are (LuaTeX, XeTeX), else each byte its
 *  own code (pdfTeX writing a font's 8-bit codes as they are). */
function decode(b: Uint8Array): string {
  try { return strict.decode(b); } catch { /* not UTF-8 */ }
  let s = '';
  for (let i = 0; i < b.length; i += 4096) s += String.fromCharCode(...b.subarray(i, i + 4096));
  return s;
}

/** The bytes of the UTF-8 character a byte begins (LuaTeX's needs_wrapping). */
const charBytes = (lead: number): number => (lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1);

/** A TeX log, its lines as TeX wrote them and decoded once. */
export class TexLog {
  /** the log's lines, as TeX broke them */
  readonly lines: readonly string[];
  private readonly bytes: readonly Uint8Array[];
  private readonly width: number;
  private joined?: string;

  constructor(log: string | Uint8Array, o: LogReadOptions = {}) {
    this.width = o.maxPrintLine ?? 79;
    const b = typeof log === 'string' ? utf8.encode(log) : log;
    const lines: Uint8Array[] = [];
    for (let from = 0, i = 0; i <= b.length; i++) {
      if (i < b.length && b[i] !== 0x0A) continue;
      lines.push(b.subarray(from, i > from && b[i - 1] === 0x0D ? i - 1 : i));
      from = i + 1;
    }
    this.bytes = lines;
    this.lines = lines.map(decode);
  }

  /** `log` read, unless it is already (then `o` is the one it was read with). */
  static of(log: TexLogSource, o?: LogReadOptions): TexLog {
    return log instanceof TexLog ? log : new TexLog(log, o);
  }

  /** The log's text, its lines as TeX broke them. */
  get text(): string { return (this.joined ??= this.lines.join('\n')); }

  /** Whether TeX may have broken line `i` at max_print_line, going on in the
   *  next (the rule above). */
  full(i: number): boolean {
    if (i + 1 >= this.bytes.length) return false;
    const n = this.bytes[i].length;
    if (n >= this.width) return true;
    const next = this.bytes[i + 1];
    const c = next.length ? charBytes(next[0]) : 1;
    return c > 1 && n + c >= this.width;
  }

  /** Line `i` as TeX wrote it before breaking it: joined with the next line
   *  while the last one joined is full – or, for a reader that can tell,
   *  until `whole` accepts the text (a full line may be a whole one) –
   *  and `end`, the last line in it. */
  join(i: number, whole?: (text: string) => boolean): { text: string; end: number } {
    let text = this.lines[i], end = i;
    for (let n = this.bytes[i].length; this.full(end) && !whole?.(text);) {
      const parts = this.bytes.slice(i, ++end + 1);
      const b = new Uint8Array(n += parts[parts.length - 1].length);
      parts.reduce((at, p) => { b.set(p, at); return at + p.length; }, 0);
      text = decode(b);
    }
    return { text, end };
  }
}

/** The warnings in a LaTeX log: `LaTeX Warning: …`, `Package x Warning: …`,
 *  `Class x Warning: …`, with their continuation lines and the input line
 *  they name. */
export function logDiagnostics(source: TexLogSource): Diagnostic[] {
  const log = TexLog.of(source);
  const out: Diagnostic[] = [];
  for (let i = 0; i < log.lines.length; i++) {
    if (!/^(LaTeX|Package|Class) /.test(log.lines[i])) continue;
    const first = log.join(i);
    const m = /^(LaTeX|Package (\S+)|Class (\S+)) Warning: (.*)$/s.exec(first.text);
    if (!m) continue;
    let message = m[4].trim();
    i = first.end;
    // continuation lines: a package's or class's begin "(name)", LaTeX's
    // own are indented
    const prefix = m[2] ?? m[3];
    const cont = prefix ? new RegExp(`^\\(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*(.*)$`, 's') : /^\s+(\S.*)$/s;
    while (i + 1 < log.lines.length) {
      const next = log.join(i + 1);
      const c = cont.exec(next.text);
      if (!c) break;
      message += ` ${c[1].trim()}`;
      i = next.end;
    }
    const line = /on input line (\d+)\.?/.exec(message);
    out.push({ severity: 'warning', message: message.replace(/\s+/g, ' ').trim(), ...(line ? { line: Number(line[1]) } : {}) });
  }
  return out;
}

const START = /^(?:! )?Missing character: There is no /;
/** The whole message: the character as TeX shows it, its code where the
 *  engine adds it (U+…, or "hex), and the font. A warning ends with "!", an
 *  error (begun with "! ") with a full stop. */
const BODY = String.raw`Missing character: There is no (.+?)(?: \((?:U\+([0-9A-Fa-f]{4,6})|"([0-9A-Fa-f]{1,6}))\))? in font (.+?)`;
const WARNING = new RegExp(String.raw`^${BODY}!$`, 'su');
const ERROR = new RegExp(String.raw`^! ${BODY}\.$`, 'su');

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

/** The characters TeX could not set, from its log: one record per font and
 *  character in the order first met, `count` the lines naming it. The font
 *  is named as TeX names it (a TFM font's name; for an OpenType font, the
 *  name it was loaded by, with its features). No stream: every record is
 *  the main flow's; `where` is empty. */
export function missingCharsFromLog(source: TexLogSource, o: LogReadOptions = {}): MissingChar[] {
  const log = TexLog.of(source, o);
  const found = new Map<string, MissingChar>();
  for (let i = 0; i < log.lines.length; i++) {
    if (!START.test(log.lines[i])) continue;
    const message = log.lines[i].startsWith('! ') ? ERROR : WARNING;
    const { text, end } = log.join(i, t => message.test(t));
    const m = message.exec(text);
    if (!m) continue;
    const [, shown, unicode, hex, font] = m;
    const char = unicode ? parseInt(unicode, 16) : hex ? parseInt(hex, 16) : charCode(shown);
    if (char === null) continue;
    i = end;
    const key = `${font}\u0000${char}`;
    const got = found.get(key);
    if (got) got.count++;
    else found.set(key, { font, char, count: 1, where: [] });
  }
  return [...found.values()];
}
