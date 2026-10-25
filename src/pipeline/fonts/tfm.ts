// SPDX-License-Identifier: AGPL-3.0-or-later
// TeX font metric files (.tfm): each character's width, height and depth,
// and the font's parameters, scaled to a size exactly as TeX scales them
// (store_scaled, TeX §571–572), which LuaTeX's and XeTeX's readers do too.
// Pure (bytes in), so the editor's converter runs the same code.

export interface TfmChar { width: number; height: number; depth: number; italic: number }
export interface Tfm {
  /** the design size, sp */
  designSize: number;
  /** a character's box at `at` sp; undefined for a character the font lacks */
  char(c: number, at: number): TfmChar | undefined;
  /** \fontdimen n (1-based) at `at` sp; 0 when the font has none */
  param(n: number, at: number): number;
}

/** A fix_word × `at` sp, bit-exact as TeX scales it (store_scaled); a value
 *  outside TeX's range (16 units or more) is scaled by plain arithmetic. */
export function texScale(fix: number, at: number): number {
  const b0 = (fix >>> 24) & 255;
  if (b0 !== 0 && b0 !== 255) return Math.round(fix * at / 2 ** 20);
  let z = at, alpha = 16;
  while (z >= 0o40000000) { z = Math.trunc(z / 2); alpha += alpha; }
  const beta = Math.trunc(256 / alpha);
  alpha *= z;
  const b = [(fix >>> 16) & 255, (fix >>> 8) & 255, fix & 255];
  const sw = Math.trunc((Math.trunc((Math.trunc(b[2] * z / 256) + b[1] * z) / 256) + b[0] * z) / beta);
  return b0 === 0 ? sw : sw - alpha;
}

export function readTfm(bytes: Uint8Array): Tfm {
  const word = (i: number) => ((bytes[4 * i] << 24) | (bytes[4 * i + 1] << 16) | (bytes[4 * i + 2] << 8) | bytes[4 * i + 3]);
  const half = (o: number) => (bytes[o] << 8) | bytes[o + 1];
  const lh = half(2), bc = half(4), ec = half(6), nw = half(8), nh = half(10), nd = half(12), ni = half(14);
  const nl = half(16), nk = half(18), ne = half(20), np = half(22);
  if (bytes.length < 24 || 6 + lh + (ec - bc + 1) + nw + nh + nd + ni + nl + nk + ne + np > bytes.length / 4) throw new Error('tfm: truncated');
  const charBase = 6 + lh;
  const widthBase = charBase + (ec - bc + 1), heightBase = widthBase + nw, depthBase = heightBase + nh, italicBase = depthBase + nd;
  const paramBase = italicBase + ni + nl + nk + ne;
  return {
    designSize: Math.trunc((word(7) >>> 0) / 16),
    char(c, at) {
      if (c < bc || c > ec) return undefined;
      const ci = word(charBase + c - bc) >>> 0, wi = ci >>> 24;
      if (wi === 0) return undefined;
      return {
        width: texScale(word(widthBase + wi), at), height: texScale(word(heightBase + ((ci >>> 20) & 15)), at),
        depth: texScale(word(depthBase + ((ci >>> 16) & 15)), at), italic: texScale(word(italicBase + ((ci >>> 10) & 63)), at),
      };
    },
    // \fontdimen1 (the slant) is a plain number, the others dimensions
    param: (n, at) => (n < 1 || n > np ? 0 : n === 1 ? word(paramBase) : texScale(word(paramBase + n - 1), at)),
  };
}
