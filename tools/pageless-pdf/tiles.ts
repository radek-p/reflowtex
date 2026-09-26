#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Cut compare.ts's pictures into tiles a web page can load one at a time.
//
//     node tools/pageless-pdf/tiles.ts <out dir> --strip ID <compare dir> <vector.json> [--strip ...]
//          [--fine ID <compare dir of a --supersample run> ...] [--tile-pt 500]
//
// For each strip, the strip is cut into tiles of --tile-pt points, and for
// each the rows of compare.ts's diff that pair with it (strip and browser
// aligned line by line, as in diff.png and heat.png) give the pictures, full
// resolution:
//
//     <ID>/heat-<k>.webp      heat.png: white where the two agree, red by how
//                             much a pixel differs (16 levels; intensity times
//                             --gain, 1.6, then raised to --gamma, 1.5)
//     <ID>/fine-<k>.webp      the same from the --fine run: both sides drawn K
//                             times finer and averaged down, which leaves less of
//                             the two renderers' own anti-aliasing
//     <ID>/pdf-<k>.webp       the strip (LuaTeX's PDF), greyscale (from the
//                             --fine run when there is one)
//     <ID>/browser-<k>.webp   the browser, greyscale, same rows
//
// manifest.json lists the strips with their measurements (compare.ts's row
// counts and vector-compare.ts's exact glyph placement) and, per tile, the
// strip's y range and how many rows of it differ, so a page can show where the
// differences are without loading the pictures.
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { readRgb, type Rgb } from './images.ts';

const HEAT_LEVELS = 16;
const BLANK = [232, 232, 232];          // compare.ts's colour for a side with no row

/** Python's round(x, n) for the values here: half to even on the decimal. */
const round = (x: number, n: number) => Number(x.toFixed(n));
/** numpy's rint: half to even. */
const rint = (x: number) => { const f = Math.floor(x), d = x - f; return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f; };

const rowsOf = (img: Rgb, a: number, b: number): Rgb => ({ data: img.data.subarray(a * img.w * 3, b * img.w * 3), w: img.w, h: b - a });

/** heat.png's red scale (255, 255−d, 255−d), its intensity multiplied by
 *  `gain` (capped at full red), raised to `gamma` and folded to HEAT_LEVELS
 *  steps; rows with no counterpart keep compare.ts's blank grey. A gamma above
 *  1 keeps a pixel partly off (an anti-aliased edge a fraction of a pixel
 *  away) paler than one wholly off (ink that is not there), so misplaced ink
 *  stands out from rasterisation; the gain makes both easier to see. */
export function heatPalette(heat: Rgb, blankRows: boolean[], gamma: number, gain: number): Rgb {
  const step = Math.floor(255 / (HEAT_LEVELS - 1));
  const lut = new Uint8Array(256);
  for (let g = 0; g < 256; g++) lut[g] = 255 - rint(Math.min(1, ((255 - g) / 255) * gain) ** gamma * (HEAT_LEVELS - 1)) * step;
  const out = new Uint8Array(heat.data.length);
  for (let y = 0; y < heat.h; y++) for (let x = 0; x < heat.w; x++) {
    const p = (y * heat.w + x) * 3;
    if (blankRows[y]) out.set(BLANK, p);
    else { const v = lut[heat.data[p + 1]]; out[p] = 255; out[p + 1] = v; out[p + 2] = v; }
  }
  return { data: out, w: heat.w, h: heat.h };
}

/** Greyscale as Pillow's convert('L'): ITU-R 601-2 luma, in its fixed point. */
function grey(img: Rgb): Uint8Array {
  const out = new Uint8Array(img.w * img.h);
  for (let i = 0, p = 0; i < out.length; i++, p += 3)
    out[i] = (img.data[p] * 19595 + img.data[p + 1] * 38470 + img.data[p + 2] * 7471 + 0x8000) >> 16;
  return out;
}

const webp = (data: Uint8Array, w: number, h: number, channels: 1 | 3, file: string) =>
  sharp(data, { raw: { width: w, height: h, channels }, limitInputPixels: false }).webp({ lossless: true, effort: 6 }).toFile(file);

type Verdict = 'equal' | 'differ' | 'shifted' | 'unmatched' | 'spacing' | string;

/** One compare.ts output: its pictures and its row pairing (rows.tsv). */
class Run {
  report: Record<string, any>;
  heat!: Rgb; left!: Rgb; right!: Rgb;
  stripRow: Int32Array; browserRow: Int32Array; verdict: Verdict[];
  /** the diff row where each strip row is, carried forward over rows the strip
   *  does not have, so a range of strip rows maps to diff rows */
  first: Int32Array;
  dir: string;
  constructor(dir: string) {
    this.dir = dir;
    this.report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    const rows = readFileSync(join(dir, 'rows.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split('\t'));
    this.stripRow = Int32Array.from(rows, r => Number(r[0]));
    this.browserRow = Int32Array.from(rows, r => Number(r[1]));
    this.verdict = rows.map(r => r[2]);
    this.first = new Int32Array(rows.length);
    let m = -Infinity;
    this.stripRow.forEach((s, k) => { m = Math.max(m, s >= 0 ? s : -1); this.first[k] = m; });
  }
  async load(): Promise<this> {
    this.heat = await readRgb(join(this.dir, 'heat.png'));
    const diff = await readRgb(join(this.dir, 'diff.png'));
    const W = this.heat.w, bar = diff.w - 2 * W;
    const cols = (x0: number): Rgb => {
      const out = new Uint8Array(W * diff.h * 3);
      for (let y = 0; y < diff.h; y++) out.set(diff.data.subarray((y * diff.w + x0) * 3, (y * diff.w + x0 + W) * 3), y * W * 3);
      return { data: out, w: W, h: diff.h };
    };
    this.left = cols(0); this.right = cols(W + bar);
    return this;
  }
  /** The diff rows [a, b) that pair with strip rows [s0, s1) (numpy's searchsorted, left). */
  rowsFor(s0: number, s1: number): [number, number] {
    const search = (v: number) => { let lo = 0, hi = this.first.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (this.first[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
    return [search(s0), search(s1)];
  }
  /** The share of the picture's pixels that differ by more than half. */
  strongShare(): number {
    let n = 0, strong = 0;
    for (let y = 0; y < this.heat.h; y++) {
      if (this.stripRow[y] < 0 || this.browserRow[y] < 0) continue;
      for (let x = 0; x < this.heat.w; x++, n++) if (255 - this.heat.data[(y * this.heat.w + x) * 3 + 1] > 128) strong++;
    }
    return n ? strong / n : NaN;
  }
  pixels() {
    const r = this.report.rows;
    return { strip_rows: r.strip, browser_rows: r.browser, equal: r.equal, differing: r.differing, shifted: r.shifted,
      unmatched: r.unmatched, spacing: r.spacing, offset_pt: this.report.offset_pt, strong_share: this.strongShare(),
      supersample: this.report.settings?.supersample ?? 1 };
  }
}

/** Tiles of `tilePt` points of the strip. Each covers the same strip rows in
 *  both runs (the coarse one, and a supersampled one if given), so the two
 *  heat maps of a tile show the same part of the paper. The PDF and browser
 *  pictures come from the supersampled run when there is one. */
export async function stripTiles(out: string, sid: string, cdir: string, vecPath: string, tilePt: number, gamma: number, gain: number,
                                 fineDir: string | null = null, fineFactor = 4) {
  const coarse = await new Run(cdir).load();
  const fine = fineDir ? await new Run(fineDir).load() : null;
  const vec = JSON.parse(readFileSync(vecPath, 'utf8'));
  const ppp: number = coarse.report.ppp;
  const W = coarse.heat.w;
  const th = rint(tilePt * ppp);
  const nStrip: number = coarse.report.rows.strip;
  const d = join(out, sid);
  mkdirSync(d, { recursive: true });
  const pics = fine ?? coarse;
  const tiles: Record<string, unknown>[] = [];
  for (let k = 0, s0 = 0; s0 < nStrip; k++, s0 += th) {
    const s1 = Math.min(nStrip, s0 + th);
    const tile: Record<string, unknown> = { y0_pt: round(s0 / ppp, 1), y1_pt: round(s1 / ppp, 1) };
    for (const [name, run] of [['heat', coarse], ['fine', fine]] as const) {
      if (!run) continue;
      const [a, b] = run.rowsFor(s0, s1);
      const blank = Array.from({ length: b - a }, (_, i) => run.stripRow[a + i] < 0 || run.browserRow[a + i] < 0);
      const img = heatPalette(rowsOf(run.heat, a, b), blank, gamma, gain);
      await webp(img.data, img.w, img.h, 3, join(d, `${name}-${k}.webp`));
      const v = run.verdict.slice(a, b), count = (x: string) => v.filter(y => y === x).length;
      tile[name] = { rows: b - a, differing: count('differ'), shifted: count('shifted'), unmatched: count('unmatched'), spacing: count('spacing') };
    }
    const [a, b] = pics.rowsFor(s0, s1);
    for (const [name, img] of [['pdf', pics.left], ['browser', pics.right]] as const)
      await webp(grey(rowsOf(img, a, b)), img.w, b - a, 1, join(d, `${name}-${k}.webp`));
    tile.rows = b - a;
    tiles.push(tile);
  }
  const lines: { max_abs_dx: number }[] = vec.lines, g = vec.glyphs;
  const matched: { dx: number; dy: number }[] = vec.matched;
  const largest = (f: (m: { dx: number; dy: number }) => number) => (matched.length ? Math.max(...matched.map(f)) : null);
  return {
    id: sid, hsize_pt: coarse.report.hsize_pt, margin_pt: coarse.report.margin_pt, ppp,
    fine_factor: fine ? fineFactor : null, width_px: W, tile_rows: th, tiles,
    pixels: coarse.pixels(), pixels_fine: fine ? fine.pixels() : null,
    glyphs: {
      strip: g.strip, browser: g.viewer, matched: g.matched, window_pt: vec.window_pt,
      within_0_1pt: matched.filter(m => Math.abs(m.dx) <= 0.1 && Math.abs(m.dy) <= 0.1).length,
      lines: lines.length,
      lines_within_0_1pt: lines.filter(l => l.max_abs_dx <= 0.1).length,
      lines_within_0_5pt: lines.filter(l => l.max_abs_dx <= 0.5).length,
      vertical_largest_pt: largest(m => Math.abs(m.dy)),
      horizontal_largest_pt: largest(m => Math.abs(m.dx)),
    },
  };
}

const sizeOf = (dir: string): number => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? sizeOf(join(dir, e.name)) : e.isFile() ? statSync(join(dir, e.name)).size : 0), 0);

if (import.meta.main) {
  // --strip takes three values and --fine two: gathered by hand, as parseArgs takes one
  const argv = process.argv.slice(2), strips: string[][] = [], fines = new Map<string, string>(), rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strip') { strips.push(argv.slice(i + 1, i + 4)); i += 3; }
    else if (argv[i] === '--fine') { fines.set(argv[i + 1], argv[i + 2]); i += 2; }
    else rest.push(argv[i]);
  }
  const { values: v, positionals: [out] } = parseArgs({ args: rest, allowPositionals: true, options: {
    'fine-factor': { type: 'string', default: '4' }, 'tile-pt': { type: 'string', default: '500' },
    gamma: { type: 'string', default: '1.5' }, gain: { type: 'string', default: '1.6' } } });
  if (!out || !strips.length || strips.some(s => s.length !== 3)) {
    console.error('usage: tiles.ts <out dir> --strip ID <compare dir> <vector.json> [--strip …] [--fine ID <compare dir>] [--fine-factor 4] [--tile-pt 500] [--gamma 1.5] [--gain 1.6]');
    process.exit(2);
  }
  const tilePt = Number(v['tile-pt']), gamma = Number(v.gamma), gain = Number(v.gain), ff = Number(v['fine-factor']);
  mkdirSync(out, { recursive: true });
  const all = [];
  for (const [sid, cdir, vec] of strips) {
    const s = await stripTiles(out, sid, cdir, vec, tilePt, gamma, gain, fines.get(sid) ?? null, ff);
    const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
    console.log(`${sid}: ${s.tiles.length} tiles of ${s.tile_rows} strip rows, ${s.width_px} px wide` +
      (s.pixels_fine ? `; strong differences ${pct(s.pixels.strong_share)} → ${pct(s.pixels_fine.strong_share)} drawn ×${ff} finer` : ''));
    all.push(s);
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ tile_pt: tilePt, gamma, gain, strips: all }, null, 1));
  console.log(`→ ${out}/manifest.json, ${(sizeOf(out) / 1e6).toFixed(1)} MB in all`);
}
