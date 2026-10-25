// SPDX-License-Identifier: AGPL-3.0-or-later
// What a glyph says as text: the one rule, for everything that turns a glyph
// into text – the accessible layer (src/pipeline/a11y.ts, and the viewer's
// line by line), copying and the text a page finds marks by (the viewer),
// and the inspector. The code point a glyph is drawn by is the pipeline's
// (src/pipeline/fonts): a real character where the font has one for it,
// else a private-use code of its own. It imports nothing, so it runs
// anywhere.

/** Private-use codes the pipeline gives glyphs that are no character of
 *  their own, so the browser draws exactly the glyph TeX set:
 *  GLYPH_INDEX_PUA + glyph index for a glyph of an OpenType font reached
 *  another way than by its cmap (a GSUB variant, a combining mark;
 *  fonts/addressing.ts), in plane 16; SLOT_PUA + slot for a classic font's
 *  slot with no searchable character (fonts/type1.ts), in the BMP's private
 *  use area. LuaTeX gives unencoded variants plane-15 codes of its own. */
export const GLYPH_INDEX_PUA = 0x100000;
export const SLOT_PUA = 0xE000;

/** A code point in a private use area: the BMP's, or planes 15 and 16. */
export const isPrivateUse = (cp: number): boolean => (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000;

/** The code a classic font's slot gets when it is no character a reader
 *  would search for: the rule every producer of a classic face shares. */
export const slotCode = (slot: number): number => SLOT_PUA + slot;

/** The code of a slot of a classic font that names none of its glyphs (no
 *  glyph names to go by: one drawn as boxes): printable ASCII as itself – what
 *  a PDF of the font copies it as – else slotCode. */
export const classicSlotCode = (slot: number): number => (slot >= 0x21 && slot <= 0x7E ? slot : slotCode(slot));

/** A glyph's text: its character; a ligature its letters (ﬁ: fi); a
 *  private-use code nothing – it stands for no character. */
export function glyphText(cp: number): string {
    if (isPrivateUse(cp)) return '';
    const ch = String.fromCodePoint(cp);
    return cp >= 0xFB00 && cp <= 0xFB06 ? ch.normalize('NFKC') : ch;
}

/** A glyph node's text: a \webtext word's own (the viewer sets a page's text
 *  as such words), else its character's. */
export const nodeText = (n: { char?: number; text?: string }): string =>
    n.text !== undefined ? n.text : n.char === undefined ? '' : glyphText(n.char);
