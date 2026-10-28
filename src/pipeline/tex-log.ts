// SPDX-License-Identifier: AGPL-3.0-or-later
// What a TeX log says about errors: whether TeX stopped (no usable output),
// and each error it reported and carried on past in nonstopmode, as plain
// lualatex leaves them for the author.
//
// An error is TeX's `! …` line (with the lines a LaTeX error continues on),
// and the `l.N …` line of its context: the line TeX was reading and what it
// had read of it. The file is not on that line. It is found from the files
// TeX opened and closed before the error – `(name` and `)` in the log – and
// kept only when that file's line N holds what the context says TeX read;
// otherwise the error has a line but no file.
//
// Each reads TeX's lines joined where TeX broke them (TexLog).
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { TexLog, type TexLogSource } from './backend/tex-log.ts';

/** An error TeX reported and carried on past, as the log gives it. */
export interface TexErrorInfo {
  /** TeX's message, without the `! ` (a LaTeX error's continuation lines
   *  joined to it) */
  message: string;
  /** the file TeX was reading, as the log names it, when that is certain */
  file?: string;
  /** the line TeX was reading (its `l.N` context) */
  line?: number;
  /** what TeX had read of that line when the error came */
  context?: string;
  /** how many times the same error came at the same place */
  count: number;
}

/** The lines that say TeX stopped: an emergency stop (a missing file or
 *  class, a \read in nonstopmode, no \end), a full memory, a hundred errors,
 *  no output. Plain lualatex leaves the author no usable output either. */
const FATAL_RE = /^(! Emergency stop\.|! TeX capacity exceeded|\*\*\* \(job aborted|\*\*\* \(cannot \\read|\(That makes 100 errors|!\s+==> Fatal error occurred)/;

/** The log's line saying TeX stopped, or null when it went on to the end. */
export function fatalStop(source: TexLogSource): string | null {
  const log = TexLog.of(source);
  const i = log.lines.findIndex(l => FATAL_RE.test(l));
  return i < 0 ? null : log.join(i).text.trim();
}

/** TeX's error lines (`! …`), each whole: what the error message of a
 *  failed build lists. */
export function errorLines(source: TexLogSource): string[] {
  const log = TexLog.of(source);
  return log.lines.flatMap((l, i) => (l.startsWith('! ') ? [log.join(i).text] : []));
}
/** A line that ends an error's message: its context, LaTeX's help lines. */
const MESSAGE_END_RE = /^(l\.\d+ |<[^>]*> |Type {2}H <return>|See the .* for explanation\.| \.\.\.)/;
/** A box TeX reports as over- or underfull: the lines after it show the
 *  box's text, where parentheses need not match. */
const BOX_RE = /^(Overfull|Underfull|Tight|Loose) \\[hv]box/;
/** How far after an error its `l.N` line may be. */
const CONTEXT_LINES = 40;

/** Each distinct error TeX reported in `log` and carried on past, in the
 *  order first met; the same message at the same place is one, with its
 *  count. `dir` is where TeX ran: file names in the log are relative to it. */
export function texErrors(source: TexLogSource, dir: string): TexErrorInfo[] {
  const log = TexLog.of(source);
  const { lines } = log;
  const files = new FileTracker(dir);
  const found = new Map<string, TexErrorInfo>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (BOX_RE.test(l)) {
      // the box's text, to the blank line after it
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
      continue;
    }
    if (!l.startsWith('! ')) { i = files.read(log, i); continue; }
    if (FATAL_RE.test(l)) continue;
    const first = log.join(i);
    let message = first.text.slice(2);
    let j = first.end + 1;
    // a LaTeX error's own lines (\MessageBreak) go on after a space
    while (j < lines.length && lines[j].trim() !== '' && !MESSAGE_END_RE.test(lines[j]) && !lines[j].startsWith('! ')) {
      const next = log.join(j);
      message += ` ${next.text.trim()}`;
      j = next.end + 1;
    }
    message = message.replace(/\s+/g, ' ').trim();
    let line: number | undefined, context: string | undefined;
    for (let k = j; k < Math.min(lines.length, j + CONTEXT_LINES) && !lines[k].startsWith('! '); k++) {
      const m = /^l\.(\d+) (.*)$/.exec(lines[k]);
      if (m) { line = Number(m[1]); context = m[2].trimEnd(); j = k; break; }
    }
    // the error's own lines – its message, context and help, to the blank
    // line after its context – open and close no file
    while (j + 1 < lines.length && lines[j + 1].trim() !== '' && !lines[j + 1].startsWith('! ')) j++;
    i = j;
    const file = line !== undefined && context !== undefined ? files.holding(line, context) : undefined;
    const key = `${message}\u0000${file ?? ''}\u0000${line ?? ''}`;
    const got = found.get(key);
    if (got) got.count++;
    else found.set(key, { message, ...(file ? { file } : {}), ...(line !== undefined ? { line } : {}), ...(context ? { context } : {}), count: 1 });
  }
  return [...found.values()];
}

/** The files TeX has open, from the log's `(name` and `)`: a parenthesis
 *  that opens no file (text in a message) is kept too, so that its `)`
 *  closes it and not a file. */
class FileTracker {
  private readonly dir: string;
  /** open parentheses, innermost last: a file's name, or null */
  private readonly stack: (string | null)[] = [];
  /** every file opened so far, latest last */
  private readonly opened: string[] = [];
  private readonly text = new Map<string, string[] | null>();
  constructor(dir: string) { this.dir = dir; }

  /** Whether `name` is a file (a directory is part of a name TeX broke). */
  private exists(name: string): boolean {
    try { return statSync(isAbsolute(name) ? name : join(this.dir, name)).isFile(); } catch { return false; }
  }

  /** Take in line i of the log, and the lines it goes on in where TeX broke
   *  a name that is not a file's; returns the last line taken in. */
  read(log: TexLog, i: number): number {
    const { text: l, end } = log.join(i, t => { const m = /\(([^\s(){}"]*)$/.exec(t); return !m || this.exists(m[1]); });
    for (let c = 0; c < l.length; c++) {
      if (l[c] === ')') { this.stack.pop(); continue; }
      if (l[c] !== '(') continue;
      const name = /^[^\s(){}"]+/.exec(l.slice(c + 1))?.[0] ?? '';
      const file = name && /[./]/.test(name) && this.exists(name) ? name : null;
      this.stack.push(file);
      if (file) this.opened.push(file);
    }
    return end;
  }

  private linesOf(file: string): string[] | null {
    if (!this.text.has(file)) {
      let t: string[] | null = null;
      try { t = readFileSync(isAbsolute(file) ? file : join(this.dir, file), 'utf8').split(/\r?\n/); } catch { /* unreadable */ }
      this.text.set(file, t);
    }
    return this.text.get(file)!;
  }

  /** Whether line `n` of `file` holds what TeX's context shows it had read
   *  of it (the last characters; `...` stands for what TeX left out). */
  private holds(file: string, n: number, context: string): boolean {
    const text = this.linesOf(file);
    if (!text || n < 1 || n > text.length) return false;
    const read = context.replace(/^\.\.\./, '').trim();
    return read === '' || text[n - 1].includes(read.slice(-24));
  }

  /** The open file whose line `n` is the one TeX read (innermost first), or
   *  one opened and closed before: undefined when no file has it. */
  holding(n: number, context: string): string | undefined {
    const open = this.stack.filter((f): f is string => f !== null).reverse();
    for (const f of [...open, ...[...this.opened].reverse()]) if (this.holds(f, n, context)) return f;
    return undefined;
  }
}
