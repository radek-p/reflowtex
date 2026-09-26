// SPDX-License-Identifier: AGPL-3.0-or-later
// How the browser reaches each glyph LuaTeX set. The viewer draws a glyph as
// SVG text by code point, so every glyph needs a code point that, in the file
// served, maps to exactly that glyph. Two passes make it so.
import { forEachNode, type SerializerOutput } from '../nodes.ts';
import type { Fonts } from './fonts.ts';

/** Private-use base for rewritten glyphs (plane 16, clear of LuaTeX's own
 *  plane-15 assignments): PUA_BASE + glyph index. */
export const PUA_BASE = 0x100000;

/** A font's per-character protrusion and expansion codes are keyed by the
 *  character's code; after a rewrite one character can live under several
 *  codes (a base glyph keeps its code point, a script variant moves to the
 *  PUA) and each must carry the entry, or a protruding comma stops
 *  protruding the moment it is a variant. `remap`: font id → {source code →
 *  the codes it now appears as}. */
function remapFontCodes(data: SerializerOutput, remap: Map<string, Map<number, Set<number>>>): void {
  for (const [fid, table] of remap) {
    const info = data.fonts.get(fid);
    const codes = info?.codes as { char: number }[] | undefined;
    if (!info || !codes?.length) continue;
    const out: { char: number }[] = [], seen = new Set<number>();
    for (const entry of codes) {
      for (const target of [...(table.get(entry.char) ?? new Set([entry.char]))].sort((a, b) => a - b)) {
        if (!seen.has(target)) { out.push({ ...entry, char: target }); seen.add(target); }
      }
    }
    info.codes = out;
  }
}

const COMBINING = /^\p{M}$/u;

/** Rewrite a glyph to PUA_BASE + its glyph index whenever drawing it by its
 *  code point would not reliably give the glyph LuaTeX set:
 *   * a GSUB result (script-size variants, sized delimiters): the cmap maps
 *     the code point to another glyph, and asking the browser to re-apply
 *     font features is the cross-browser lottery this pipeline avoids;
 *   * a combining mark (math accents): Safari will not let an isolated mark's
 *     ink hang left of its origin; a PUA code point has no such semantics;
 *   * a code point with no cmap entry (LuaTeX's plane-15 codes for unencoded
 *     variants).
 *  The font patcher adds the matching cmap entries. Returns the rewrites. */
export function normaliseGlyphAddressing(data: SerializerOutput, fonts: Fonts, log?: (s: string) => void): number {
  const files = new Map([...data.fonts].map(([id, f]) => [id, f.filename]));
  fonts.provision(new Set(files.values()), log);
  let rewritten = 0;
  const remap = new Map<string, Map<number, Set<number>>>();
  forEachNode(data, n => {
    if (n.type !== 'glyph') return;
    const cp = n.char, gi = n.gindex as number | undefined | null;
    if (cp === undefined || gi === undefined || gi === null) return;
    const fid = String(n.font ?? '');
    const lookup = fonts.cmapLookup(files.get(fid) ?? '');
    const needsPua = cp < PUA_BASE && (
      (cp < 0xF0000 && COMBINING.test(String.fromCodePoint(cp))) ||
      (lookup !== null && lookup.get(cp) !== gi));
    if (needsPua) { n.char = PUA_BASE + gi; rewritten++; }
    if (!remap.has(fid)) remap.set(fid, new Map());
    const t = remap.get(fid)!;
    if (!t.has(cp)) t.set(cp, new Set());
    t.get(cp)!.add(n.char!);
  });
  remapFontCodes(data, remap);
  return rewritten;
}

/** Classic 8-bit fonts (serializer filename 'unknown'): convert each to a
 *  served OTF (type1.ts) and rewrite its glyphs' slot numbers to the code
 *  points the converted font maps. A font with no convertible outline stays
 *  'unknown', and the viewer draws metric boxes. Returns the rewrites. */
export function normaliseLegacyFontAddressing(data: SerializerOutput, fonts: Fonts): number {
  const rewrite = new Map<string, Map<number, number>>();       // font id → slot → code point
  for (const [fid, info] of data.fonts) {
    if (info.filename !== undefined && info.filename !== null && info.filename !== 'unknown') continue;
    const res = fonts.legacyOtf(info.name);
    if (!res) continue;
    info.filename = res.served;                                // so the encoder and viewer fetch the OTF
    rewrite.set(fid, res.addressing);
  }
  if (!rewrite.size) return 0;
  let rewritten = 0;
  forEachNode(data, n => {
    if (n.type !== 'glyph') return;
    const addressing = rewrite.get(String(n.font));
    // only slots the OTF addresses; an unencoded one renders as nothing
    if (addressing && n.char !== undefined && addressing.has(n.char)) { n.char = addressing.get(n.char); rewritten++; }
  });
  // the slot → code point map is total per font, so the codes follow it directly
  remapFontCodes(data, new Map([...rewrite].map(([fid, a]) => [fid, new Map([...a].map(([slot, cp]) => [slot, new Set([cp])]))])));
  return rewritten;
}
