// SPDX-License-Identifier: AGPL-3.0-or-later
// METAFONT's packed bitmap fonts (PK), as mktexpk writes them: each
// character's bitmap, with its reference point and TFM width. The format is
// Tomas Rokicki's (texmf/doc: pktype); this reads the preamble and the
// character packets – the short, extended-short and long forms, raw bitmaps
// and run-length-encoded ones with their repeated rows – and skips the
// specials.

/** One character: its code, its TFM width (a fraction of the design size),
 *  and its bitmap – `rows` top to bottom, each `width` pixels, 1 for ink –
 *  placed by the offsets of its reference point from the top-left pixel. */
export interface PkGlyph {
  code: number;
  tfmWidth: number;
  width: number;
  height: number;
  hoff: number;
  voff: number;
  rows: Uint8Array[];
}
export interface PkFont {
  /** pt (TeX's) */
  designSize: number;
  /** pixels per pt, across and down */
  hppp: number;
  vppp: number;
  glyphs: Map<number, PkGlyph>;
}

const PK_PRE = 247, PK_POST = 245, PK_NOOP = 246, PK_YYY = 244;

export function readPk(bytes: Uint8Array): PkFont {
  let p = 0;
  const u8 = () => bytes[p++];
  const u = (n: number) => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + bytes[p++]; return x; };
  const s = (n: number) => { const x = u(n); return x >= 2 ** (8 * n - 1) ? x - 2 ** (8 * n) : x; };
  if (u8() !== PK_PRE || u8() !== 89) throw new Error('not a PK file');
  const comment = u8();
  p += comment;                                    // (read first: `p += u8()` would add to the old p)
  const designSize = s(4) / 2 ** 20;
  p += 4;                                          // checksum
  const hppp = s(4) / 2 ** 16, vppp = s(4) / 2 ** 16;
  const glyphs = new Map<number, PkGlyph>();
  while (p < bytes.length) {
    const flag = u8();
    if (flag >= 240) {
      if (flag === PK_POST) break;
      if (flag === PK_NOOP) continue;
      if (flag === PK_YYY) { p += 4; continue; }
      if (flag === PK_PRE) throw new Error('PK: a second preamble');
      const length = u(flag - 239);                // pk_xxx1..4: a special, its length in that many bytes
      p += length;
      continue;
    }
    // The packet's length counts the bytes after the character code.
    const dynF = flag >> 4, turnOn = (flag & 8) !== 0, form = flag & 7;
    let end: number, code: number, tfm: number, w: number, h: number, hoff: number, voff: number;
    if (form < 4) {                                // short
      const pl = ((form & 3) << 8) + u8();
      code = u8(); end = p + pl;
      tfm = u(3); p += 1; w = u8(); h = u8(); hoff = s(1); voff = s(1);
    } else if (form < 7) {                         // extended short
      const pl = ((form & 3) << 16) + u(2);
      code = u8(); end = p + pl;
      tfm = u(3); p += 2; w = u(2); h = u(2); hoff = s(2); voff = s(2);
    } else {                                       // long
      const pl = u(4);
      code = u(4); end = p + pl;
      tfm = s(4); p += 8; w = u(4); h = u(4); hoff = s(4); voff = s(4);
    }
    if (end > bytes.length || p > end) throw new Error(`PK: character ${code}'s packet runs past the file`);
    glyphs.set(code, { code, tfmWidth: tfm / 2 ** 20, width: w, height: h, hoff, voff,
                       rows: raster(bytes.subarray(p, end), dynF, turnOn, w, h) });
    p = end;
  }
  return { designSize, hppp, vppp, glyphs };
}

/** A character's raster: a plain bitmap (dyn_f 14), or runs of alternating
 *  colour in packed numbers, a row repeated where a repeat count says. */
function raster(data: Uint8Array, dynF: number, black: boolean, w: number, h: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  if (!w || !h) return rows;
  if (dynF === 14) {
    for (let r = 0, bit = 0; r < h; r++) {
      const row = new Uint8Array(w);
      for (let c = 0; c < w; c++, bit++) row[c] = (data[bit >> 3] >> (7 - (bit & 7))) & 1;
      rows.push(row);
    }
    return rows;
  }
  let nyb = 0;
  const nybble = () => {
    if (nyb >> 1 >= data.length) throw new Error('PK: a character\'s runs end before its last row');
    const b = data[nyb >> 1]; const x = nyb & 1 ? b & 15 : b >> 4; nyb++; return x;
  };
  let repeat = 0;
  const packed = (): number => {
    let i = nybble();
    if (i === 0) {
      let j = 0;
      do { i = nybble(); j++; } while (i === 0);
      for (; j > 0; j--) i = i * 16 + nybble();
      return i - 15 + (13 - dynF) * 16 + dynF;
    }
    if (i <= dynF) return i;
    if (i < 14) return (i - dynF - 1) * 16 + nybble() + dynF + 1;
    repeat = i === 14 ? packed() : 1;
    return packed();
  };
  let row = new Uint8Array(w), col = 0;
  while (rows.length < h) {
    let count = packed();
    while (count > 0 && rows.length < h) {
      const take = Math.min(count, w - col);
      if (black) row.fill(1, col, col + take);
      col += take; count -= take;
      if (col === w) {
        for (let k = 0; k <= repeat && rows.length < h; k++) rows.push(row.slice());
        repeat = 0; row = new Uint8Array(w); col = 0;
      }
    }
    black = !black;
  }
  return rows;
}
