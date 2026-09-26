// SPDX-License-Identifier: AGPL-3.0-or-later
// Glyph names → Unicode, as the Adobe Glyph List specification resolves them
// (and fontTools.agl.toUnicode, which the Python pipeline used): a name's
// suffix after the first "." is dropped, "_" joins components, and each
// component is an AGL name, uniXXXX(XXXX…) or uXXXX[XX]. The list itself is
// TeX Live's copy of Adobe's glyphlist.txt.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let AGL: Map<string, string> | null = null;
function agl(): Map<string, string> {
  if (AGL) return AGL;
  AGL = new Map();
  const path = execFileSync('kpsewhich', ['glyphlist.txt']).toString().trim();
  if (!path) throw new Error('glyphlist.txt not found (kpsewhich): the Adobe Glyph List ships with TeX Live');
  for (const line of readFileSync(path, 'latin1').split('\n')) {
    if (!line || line[0] === '#') continue;
    const [name, codes] = line.split(';');
    // single-character entries only: a name that stands for a sequence is not
    // one code point (the caller wants exactly one)
    if (codes && !codes.includes(' ') && !AGL.has(name)) AGL.set(name, String.fromCodePoint(parseInt(codes, 16)));
  }
  return AGL;
}

/** The text a glyph name stands for ('' when it names nothing known). */
export function toUnicode(glyph: string): string {
  const base = glyph.split('.')[0];
  let out = '';
  for (const part of base.split('_')) {
    const a = agl().get(part);
    if (a) { out += a; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^uni((?:[0-9A-F]{4})+)$/.exec(part))) {
      for (let i = 0; i < m[1].length; i += 4) {
        const c = parseInt(m[1].slice(i, i + 4), 16);
        if (c >= 0xD800 && c <= 0xDFFF) return out;
        out += String.fromCharCode(c);
      }
      continue;
    }
    if ((m = /^u([0-9A-F]{4,6})$/.exec(part))) {
      const c = parseInt(m[1], 16);
      if (c <= 0x10FFFF && !(c >= 0xD800 && c <= 0xDFFF)) out += String.fromCodePoint(c);
    }
  }
  return out;
}
