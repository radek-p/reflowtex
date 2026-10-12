// SPDX-License-Identifier: AGPL-3.0-or-later
// A LaTeX document's parts as the pipeline reads them, whatever backend
// compiles it: the class line, the preamble, the body, the author's
// \DocumentMetadata.

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
