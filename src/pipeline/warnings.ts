// SPDX-License-Identifier: AGPL-3.0-or-later
// A block's warnings (Document.warnings, latex.proto's Warning): what the
// build found about the document that the page itself does not show, for
// tools to list (the inspector). The page carries no mark of them.

import type { Warning } from '../shared/log.ts';
export type { Warning };

/** A character TeX could not set, as serializer.lua records it: by font (its
 *  name), character and stream (absent: the main flow), how often, and the
 *  text around the first few. */
export interface MissingChar { font: string; char: number; stream?: number; count: number; where: string[] }

/** Contexts kept per font and character. */
const PLACES = 3;

const codepoint = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** A character as TeX's log shows it: a control character in ^^ notation. */
const shown = (cp: number): string =>
  cp < 0x20 ? `^^${String.fromCharCode(cp + 0x40)}` : cp === 0x7F ? '^^?' : String.fromCodePoint(cp);

/** One warning per font and character TeX had no glyph for, in the order
 *  they were first met: neither TeX's PDF nor the page draws them. Code
 *  missing-char; details font (its name), char, codepoint (U+…), count, and
 *  where (the text around the first few, "·" between them). */
export function missingCharWarnings(list: readonly MissingChar[]): Warning[] {
  const merged = new Map<string, MissingChar>();
  for (const m of list) {
    const key = `${m.font}\u0000${m.char}`;
    const got = merged.get(key);
    if (got) {
      got.count += m.count;
      got.where = [...got.where, ...m.where].slice(0, PLACES);
    } else merged.set(key, { ...m, where: m.where.slice(0, PLACES) });
  }
  return [...merged.values()].map(m => ({
    level: 'warning',
    code: 'missing-char',
    message: `There is no ${shown(m.char)} (${codepoint(m.char)}) in font ${m.font}`,
    details: {
      font: m.font, char: shown(m.char), codepoint: codepoint(m.char), count: String(m.count),
      where: m.where.join(' · '),
    },
  }));
}
