// SPDX-License-Identifier: AGPL-3.0-or-later
// A LaTeX document's parts as the pipeline reads them, whatever backend
// compiles it: the class line, the preamble, the body, the author's
// \DocumentMetadata.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const DOCCLASS_RE = /^[ \t]*\\documentclass\b[^\n]*$/m;
const BEGIN_DOC_RE = /^[ \t]*\\begin\{document\}[^\n]*\n?/m;
const END_DOC_RE = /^[ \t]*\\end\{document\}/m;

/** An author's \\DocumentMetadata{…} in `tex` (its braces balanced), and
 *  `tex` without it. */
export function takeMetadata(tex: string): [string, string] {
  const m = /\\DocumentMetadata\s*\{/.exec(tex);
  if (!m) return ['', tex];
  let depth = 0, end = -1;
  for (let i = m.index + m[0].length - 1; i < tex.length; i++) {
    if (tex[i] === '{') depth++;
    else if (tex[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) return ['', tex];
  return [tex.slice(m.index, end), tex.slice(0, m.index) + tex.slice(end)];
}

/** [class line, preamble, body] of a complete LaTeX document, or null for a
 *  snippet. Anything before the class line (comments, \RequirePackage) is
 *  dropped, anything after \end{document} ignored, as LaTeX ignores it. */
export function splitDocument(tex: string): [string, string, string] | null {
  const c = DOCCLASS_RE.exec(tex), b = BEGIN_DOC_RE.exec(tex), e = END_DOC_RE.exec(tex);
  if (!(c && b && e && c.index < b.index && b.index < e.index)) return null;
  return [c[0].trim(), tex.slice(c.index + c[0].length, b.index), tex.slice(b.index + b[0].length, e.index)];
}

/** A line that reads one of the document's files: \input{name}, \input name
 *  or \include{name}, alone on its line (a comment may follow). */
const INPUT_LINE_RE = /^[ \t]*\\(?:input|include)\s*(?:\{([^{}]+)\}|([^\s{}%\\]+))[ \t]*(?:%[^\n]*)?$/gm;

/** `name` among the document's own files, as \input looks for it: name.tex,
 *  then the name as it is, in each directory in turn. */
function ownFile(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const f of [`${name}.tex`, name]) {
      const p = resolve(dir, f);
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
  }
  return null;
}

/** `tex` with its class line where TeX would read it: when the main file has
 *  none before \begin{document}, the line there that \input's (or
 *  \include's) the file holding it – found in `dirs`, the document's own
 *  directories, and followed through the files it inputs in turn – is
 *  replaced by that file's text. Anything else is left to TeX. */
export function withInputClass(tex: string, dirs: string[], seen: ReadonlySet<string> = new Set()): string {
  const b = BEGIN_DOC_RE.exec(tex);
  const head = b ? tex.slice(0, b.index) : tex;
  if (!dirs.length || DOCCLASS_RE.test(head)) return tex;
  let found = false;
  const inlined = head.replace(INPUT_LINE_RE, (line, braced?: string, bare?: string) => {
    const file = found ? null : ownFile((braced ?? bare)!.trim(), dirs);
    if (!file || seen.has(file)) return line;
    const text = withInputClass(readFileSync(file, 'utf8'), dirs, new Set([...seen, file]));
    if (!DOCCLASS_RE.test(text)) return line;
    found = true;
    return text.replace(/\n$/, '');
  });
  return inlined + tex.slice(head.length);
}
