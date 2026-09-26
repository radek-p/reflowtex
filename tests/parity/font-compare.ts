// SPDX-License-Identifier: AGPL-3.0-or-later
// Fonts compared as the browser uses them – per code point: the outline (as
// opentype.js decodes it) and the advance (from hmtx) – for the parity tests.
import assert from 'node:assert/strict';
import opentype from 'opentype.js';
import { advanceWidths, readSfnt, parseName, nameString } from '../../src/pipeline/fonts/sfnt.ts';

/** code point → [advance, outline commands] of every mapped glyph. */
export function drawing(bytes: Uint8Array): Map<number, string> {
  const f = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer);
  const adv = advanceWidths(readSfnt(bytes));
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

