// SPDX-License-Identifier: AGPL-3.0-or-later
// Classic fonts with only a METAFONT source – no Type 1 outline (bbm behind
// \mathbbm, and others): METAFONT renders each at a high resolution
// (mktexpk, into a directory of the pipeline's own), the bitmaps are read
// (pk.ts) and each glyph's pixels become its outline (pixels.ts), in an
// OpenType font written as a converted Type 1 face is (type1.ts). The
// browser's rasteriser then draws the bitmap, antialiased, at any size: at
// 2400 dpi a pixel is 1/33 pt. The advances are TeX's (the TFM's widths),
// as the glyphs are placed by them anyway.
//
// A METAFONT font names none of its glyphs, so its code points come from
// the family it belongs to where one is known (bbm: double-struck letters
// and digits, U+1D538 …, ℝ and the other letters Unicode had first), else
// the rule for a slot of such a font (src/shared/glyph-text.ts,
// classicSlotCode): printable ASCII as itself, else a private-use code.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { classicSlotCode, slotCode } from '../../shared/glyph-text.ts';
import { readPk } from './pk.ts';
import { pixelContours } from './pixels.ts';
import { readTfm } from './tfm.ts';
import { buildCmap, format12, parseCmap, readSfnt, writeSfnt } from './sfnt.ts';
import { finishConverted, kpsewhich, reproducible } from './type1.ts';

/** The resolution METAFONT renders at: ljfour's 600 dpi, magnified 4×. */
export const METAFONT_DPI = 2400;
const MODE = 'ljfour', BASE_DPI = 600;

// Double-struck letters: Unicode had seven before the mathematical alphabets,
// which leave holes for them.
const DOUBLE_STRUCK_FIRST: Record<number, number> = {
  0x43: 0x2102, 0x48: 0x210D, 0x4E: 0x2115, 0x50: 0x2119, 0x51: 0x211A, 0x52: 0x211D, 0x5A: 0x2124,
};
function doubleStruck(slot: number): number | null {
  if (DOUBLE_STRUCK_FIRST[slot]) return DOUBLE_STRUCK_FIRST[slot];
  if (slot >= 0x41 && slot <= 0x5A) return 0x1D538 + slot - 0x41;
  if (slot >= 0x61 && slot <= 0x7A) return 0x1D552 + slot - 0x61;
  if (slot >= 0x30 && slot <= 0x39) return 0x1D7D8 + slot - 0x30;
  return null;
}
/** Families whose letters are an alphabet of their own, by TeX font name. */
const FAMILIES: [RegExp, (slot: number) => number | null][] = [
  [/^bbm/, doubleStruck],              // bbm, bbmss, bbmtt, bbmbx, bbmsl … (\mathbbm, \mathbbmss, \mathbbmtt)
];

/** The code point of each slot of a classic font that names none of its
 *  glyphs (font `name`): its family's, else classicSlotCode; every code
 *  given once. */
export function classicAddressing(name: string, slots: Iterable<number>): Map<number, number> {
  const family = FAMILIES.find(([re]) => re.test(name))?.[1];
  const out = new Map<number, number>(), taken = new Set<number>();
  for (const slot of [...slots].sort((a, b) => a - b)) {
    let cp = family?.(slot) ?? classicSlotCode(slot);
    if (taken.has(cp)) cp = slotCode(slot);        // (each slot's own: never taken)
    out.set(slot, cp);
    taken.add(cp);
  }
  return out;
}

/** METAFONT's bitmaps of `name` (its .mf source rendered at `dpi`), made in
 *  `workDir` once; the PK file's path, or why there is none. */
export function renderPk(name: string, workDir: string, dpi = METAFONT_DPI): string | { reason: string } {
  if (!kpsewhich(`${name}.mf`)) return { reason: `no METAFONT source ${name}.mf` };
  const dir = join(workDir, 'pk');
  const pk = join(dir, `${name}.${dpi}pk`);
  if (existsSync(pk)) return pk;
  mkdirSync(dir, { recursive: true });
  try {
    // a TEXMFVAR of its own: nothing written to the user's, and METAFONT's
    // base file (mf.base), if it has to be made, made there too
    execFileSync('mktexpk', ['--mfmode', MODE, '--bdpi', String(BASE_DPI), '--mag', String(dpi / BASE_DPI), '--dpi', String(dpi), '--destdir', dir, name],
                 { cwd: workDir, env: { ...process.env, TEXMFVAR: join(workDir, 'texmf-var') }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { code?: string; stderr?: Buffer };
    if (err.code === 'ENOENT') return { reason: 'METAFONT (mktexpk) is not installed' };
    const last = String(err.stderr ?? '').trim().split('\n').slice(-1)[0];
    return { reason: `METAFONT could not render ${name}.mf${last ? ` (${last})` : ''}` };
  }
  return existsSync(pk) ? pk : { reason: `METAFONT made no ${name}.${dpi}pk` };
}

/** The OpenType bytes of a METAFONT font's bitmaps, and its addressing. */
export function pixelFont(name: string, pkBytes: Uint8Array, tfmBytes: Uint8Array | null): { bytes: Uint8Array; addressing: Map<number, number> } {
  const pk = readPk(pkBytes);
  const tfm = tfmBytes ? readTfm(tfmBytes) : null;
  // a unit is a pixel (scaled by the hair it takes to make an em whole)
  const ppem = pk.designSize * pk.hppp;
  const upm = Math.min(16384, Math.max(16, Math.round(ppem)));
  const k = upm / ppem;
  const codes = [...pk.glyphs.keys()].sort((a, b) => a - b);
  const addressing = classicAddressing(name, codes);
  const designSp = tfm?.designSize ?? Math.round(pk.designSize * 65536);
  const glyphs = [new opentype.Glyph({ name: '.notdef', advanceWidth: 0, path: new opentype.Path(), unicodes: [] })];
  for (const code of codes) {
    const g = pk.glyphs.get(code)!;
    const path = new opentype.Path();
    for (const contour of pixelContours(g.rows, g.hoff, g.voff)) {
      contour.forEach(([x, y], i) => (i ? path.lineTo(Math.round(x * k), Math.round(y * k)) : path.moveTo(Math.round(x * k), Math.round(y * k))));
      path.close();
    }
    // TeX's width (the TFM's), else the bitmap's own record of it
    const width = tfm?.char(code, designSp)?.width;
    const advance = Math.round((width !== undefined ? width / designSp : g.tfmWidth) * upm);
    glyphs.push(new opentype.Glyph({ name: `g${code}`, advanceWidth: advance, path, unicodes: [addressing.get(code)!] }));
  }
  const label = `${name} (ReflowTeX from METAFONT)`;
  const font = new opentype.Font({
    familyName: label, styleName: 'Regular', fullName: label, postScriptName: `${name}-ReflowTeXMetafont`,
    unitsPerEm: upm, ascender: upm, descender: 0, glyphs,
  });
  // opentype.js writes a format-4 cmap only, which holds no code point past
  // the BMP (the double-struck letters, 𝟙): every one goes into a format-12
  const sfnt = readSfnt(new Uint8Array(font.toArrayBuffer()));
  const subs = parseCmap(sfnt.tables.get('cmap')!), f12 = format12(subs);
  codes.forEach((code, i) => f12.shared.map.set(addressing.get(code)!, i + 1));
  f12.shared.dirty = true;
  sfnt.tables.set('cmap', buildCmap(subs));
  return { bytes: reproducible(writeSfnt(sfnt)), addressing };
}

/** A METAFONT font as a served OTF (NAME.reflowtex-HASH.otf in `outDir`),
 *  rendered in `workDir`; or why it cannot be. */
export function convertMetafont(name: string, outDir: string, workDir: string): { served: string; addressing: Map<number, number> } | { reason: string } {
  const pk = renderPk(name, workDir);
  if (typeof pk !== 'string') return pk;
  const tfm = kpsewhich(`${name}.tfm`);
  let made: ReturnType<typeof pixelFont>;
  try { made = pixelFont(name, readFileSync(pk), tfm ? readFileSync(tfm) : null); }
  catch (e) { return { reason: `METAFONT's bitmaps of ${name} could not be read (${(e as Error).message})` }; }
  return { served: finishConverted(name, made.bytes, outDir), addressing: made.addressing };
}
