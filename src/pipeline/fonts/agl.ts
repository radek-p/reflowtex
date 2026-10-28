// SPDX-License-Identifier: AGPL-3.0-or-later
// Glyph names → Unicode, as the Adobe Glyph List specification resolves them:
// a name's suffix after the first "." is dropped, "_" joins components, and
// each component is a listed name, uniXXXX(XXXX…) or uXXXX[XX]. The lists are
// TeX Live's copy of Adobe's glyphlist.txt and, for the names TeX fonts use
// that it lacks (cmsy's 'prime', cmmi's 'epsilon1', the AMS symbols…),
// texglyphlist.txt, lcdf-typetools' extension of it – the two pdfTeX's
// glyphtounicode.tex is made from, with the Adobe list first, as there.
// texglyphlist.txt may give a name several readings ("prime;2032,02B9"):
// each is kept, in its order, after the Adobe list's.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** The list file `name` in the TeX installation. */
function listFile(name: string): string {
  const path = execFileSync('kpsewhich', [name]).toString().trim();
  if (!path) throw new Error(`${name} not found (kpsewhich): the glyph lists ship with TeX Live`);
  return path;
}

/** A reading's text from its hex code points ("0053 0053" is "SS"); null for
 *  one that is no Unicode text (a surrogate: texglyphlist.txt's marker for
 *  "no character"). */
function readingText(hex: string): string | null {
  const cps = hex.trim().split(/\s+/).map(h => parseInt(h, 16));
  if (cps.some(c => !(c >= 0 && c <= 0x10FFFF) || (c >= 0xD800 && c <= 0xDFFF))) return null;
  return String.fromCodePoint(...cps);
}

let LISTS: Map<string, string[]> | null = null;
/** Glyph name → its readings, the Adobe list's first. */
function lists(): Map<string, string[]> {
  if (LISTS) return LISTS;
  LISTS = new Map();
  for (const file of ['glyphlist.txt', 'texglyphlist.txt']) {
    for (const line of readFileSync(listFile(file), 'latin1').split('\n')) {
      if (!line || line[0] === '#') continue;
      const [name, codes] = line.split(';');
      if (!name || !codes) continue;
      const readings = LISTS.get(name) ?? [];
      for (const alt of codes.split(',')) {
        const text = readingText(alt);
        if (text !== null && !readings.includes(text)) readings.push(text);
      }
      LISTS.set(name, readings);
    }
  }
  return LISTS;
}

/** A name component's readings: the lists', else its uniXXXX / uXXXX code. */
function componentReadings(part: string): string[] {
  const listed = lists().get(part);
  if (listed?.length) return listed;
  let m: RegExpExecArray | null;
  if ((m = /^uni((?:[0-9A-F]{4})+)$/.exec(part))) {
    let out = '';
    for (let i = 0; i < m[1].length; i += 4) {
      const c = parseInt(m[1].slice(i, i + 4), 16);
      if (c >= 0xD800 && c <= 0xDFFF) break;
      out += String.fromCharCode(c);
    }
    return out ? [out] : [];
  }
  if ((m = /^u([0-9A-F]{4,6})$/.exec(part))) {
    const c = parseInt(m[1], 16);
    if (c <= 0x10FFFF && !(c >= 0xD800 && c <= 0xDFFF)) return [String.fromCodePoint(c)];
  }
  return [];
}

/** What a glyph name stands for: each reading the lists give it, in their
 *  order ([] when it names nothing known). A name of components ("f_i") has
 *  one: its components' first readings joined. */
export function glyphReadings(glyph: string): string[] {
  const parts = glyph.split('.')[0].split('_');
  if (parts.length === 1) return componentReadings(parts[0]);
  const text = parts.map(p => componentReadings(p)[0] ?? '').join('');
  return text ? [text] : [];
}
