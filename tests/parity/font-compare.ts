// SPDX-License-Identifier: AGPL-3.0-or-later
// Fonts compared as the browser uses them – per code point: the outline (as
// opentype.js decodes it) and the advance (from hmtx) – for the parity tests.
import assert from 'node:assert/strict';
import opentype from 'opentype.js';
import { readSfnt, parseName, nameString } from '../../src/pipeline/fonts/sfnt.ts';

/** Advance widths from hmtx – what a browser uses. (opentype.js reports a
 *  CFF font's advances from its charstrings, where fontTools writes 0.) */
function advances(bytes: Uint8Array): number[] {
  const t = readSfnt(bytes).tables;
  const hhea = t.get('hhea')!, hmtx = t.get('hmtx')!;
  const n = (hhea[34] << 8) | hhea[35], glyphs = (t.get('maxp')![4] << 8) | t.get('maxp')![5];
  const out: number[] = [];
  for (let i = 0; i < glyphs; i++) { const k = Math.min(i, n - 1) * 4; out.push((hmtx[k] << 8) | hmtx[k + 1]); }
  return out;
}

/** code point → [advance, outline commands] of every mapped glyph. */
export function drawing(bytes: Uint8Array): Map<number, string> {
  const f = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer);
  const adv = advances(bytes);
  const out = new Map<number, string>();
  for (let i = 0; i < f.glyphs.length; i++) {
    const g = f.glyphs.get(i);
    for (const cp of g.unicodes ?? []) out.set(cp, JSON.stringify([adv[i], g.path.commands]));
  }
  return out;
}
export function sameDrawing(a: Uint8Array, b: Uint8Array, what: string): void {
  const da = drawing(a), db = drawing(b);
  assert.deepEqual([...da.keys()].sort((x, y) => x - y), [...db.keys()].sort((x, y) => x - y), `${what}: code points`);
  const bad = [...da.keys()].filter(c => da.get(c) !== db.get(c));
  assert.deepEqual(bad, [], `${what}: code points drawn differently`);
}
export const names = (bytes: Uint8Array) => parseName(readSfnt(bytes).tables.get('name')!).map(r => `${r.nameID}/${r.platformID}: ${nameString(r)}`).sort();

