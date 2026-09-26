#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Compare the pageless strip with the browser's rendering, pixel row by row.
//
//     node tools/pageless-pdf/compare.ts <build dir | pageless.pdf> <page url> [options]
//
// Both sides are rendered at one scale, --ppp device pixels per TeX point
// (default 2: the viewer's 2 CSS px/pt at device scale 1), in one frame: the
// column of \hsize with --margin points of white either side (default: the
// strip's own margin; a smaller one crops the strip and pads the browser alike).
//
// The two images are aligned the way text files are diffed, with lines as the
// unit. Each is cut into *bands* – runs of pixel rows that carry ink: lines of
// text, displays, rules – and every band is reduced to its ink profile (mean
// ink per column, pooled over --block pixels). Bands are then matched in order
// by profile correlation (sequence alignment with free gaps: a band pairs with
// another only when they correlate above --match), so a fault that shifts
// everything below it costs only the bands it touches.
//
// Inside a matched pair the browser's band may sit a pixel or two off; the
// shift within --search-x/--search-y that best overlays the pair is found and
// reported. With it applied the rows are compared pixel for pixel: a row is
// *equal* when at most --frac of its pixels differ by more than --tol, else
// *differing*. Blank rows between consecutive matched bands are paired in
// order; the surplus on one side is a *spacing* difference.
//
// A differing run of --shift-min rows or more is then tested for being the
// same ink elsewhere: its strip ink is cut into pieces and each is looked for
// in the browser within --shift-x/--shift-y px by normalised correlation of
// blurred ink. When every piece is found (--shift-corr) and one sits
// --shift-min-px or more from its place, the rows are *shifted*.
//
// Output in --out (default <build>/compare/): strip.png, browser.png; diff.png
// (side by side, rows aligned, a bar between: green equal, red differing, grey
// no counterpart, amber blank rows the other side lacks, blue shifted);
// heat.png; overview.png (--overview times smaller); rows.tsv; report.json and
// a summary on stdout.
//
// --region X0 Y0 X1 Y1 restricts the strip to that rectangle (TeX pt from the
// strip's top left) and photographs the browser --slack points above and below
// it. The browser is driven by capture.ts; its screenshots are kept in --out
// and reused with --reuse. The strip is drawn by MuPDF (in WebAssembly), whole,
// once per scale, and kept beside the PDF.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import { capture, type CaptureManifest } from './capture.ts';
import * as I from './images.ts';

const PT_PER_BP = 72.27 / 72, SP_PER_PT = 65536;
// row verdicts
const EQUAL = 1, DIFFER = 2, UNMATCHED = 3, SPACING = 4, SHIFTED = 5;
const COLOUR: Record<number, [number, number, number]> = { [EQUAL]: [46, 204, 64], [DIFFER]: [255, 65, 54], [UNMATCHED]: [150, 150, 150], [SPACING]: [255, 190, 0], [SHIFTED]: [0, 116, 217] };
const PRIORITY: Record<number, number> = { [UNMATCHED]: 5, [DIFFER]: 4, [SHIFTED]: 3, [SPACING]: 2, [EQUAL]: 1 };
const BLANK: [number, number, number] = [232, 232, 232];      // the other side of a row that has none
const TICK: [number, number, number] = [0, 0, 0];

/** Python's round(): half to even. */
const pyRound = (v: number) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r; };
const r2 = (v: number) => pyRound(v * 100) / 100, r3 = (v: number) => pyRound(v * 1000) / 1000, r4 = (v: number) => pyRound(v * 10000) / 10000;
const pyG = (x: number) => String(Number(x.toPrecision(6)));

// ── Rendering ───────────────────────────────────────────────────────────────

/** The strip's pixels at dpi, rows y..y+h, columns x..x+w: MuPDF draws the
 *  whole strip once (ss times finer and averaged down with --supersample),
 *  kept beside the PDF keyed by scale and the PDF's time. */
async function stripRaster(pdf: string, x: number, y: number, w: number, h: number, dpi: number, ss: number): Promise<I.Rgb> {
  const tag = `${dpi.toFixed(2)}${ss > 1 ? `x${ss}` : ''}`;
  const stem = basename(pdf).replace(/\.pdf$/, '');
  const cache = join(dirname(pdf), `${stem}.mupdf-${tag}-${Math.floor(statSync(pdf).mtimeMs / 1000)}.png`);
  if (!existsSync(cache)) {
    for (const f of readdirSync(dirname(pdf))) if (f.startsWith(`${stem}.mupdf-`)) rmSync(join(dirname(pdf), f));
    const page = mupdf.Document.openDocument(readFileSync(pdf), 'application/pdf').loadPage(0);
    const s = (dpi * ss) / 72;
    const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false);
    let img = sharp(pix.asPNG(), { limitInputPixels: false });
    if (ss > 1) img = sharp(await img.raw().toBuffer(), { raw: { width: pix.getWidth(), height: pix.getHeight(), channels: 3 }, limitInputPixels: false })
      .resize(Math.floor(pix.getWidth() / ss), Math.floor(pix.getHeight() / ss), { kernel: 'cubic', fastShrinkOnLoad: false });
    await img.png().toFile(cache);
  }
  const full = await I.readRgb(cache);
  const out = I.blank(w, h);
  const y1 = Math.min(full.h, y + h), x1 = Math.min(full.w, x + w);
  for (let r = y; r < y1; r++) out.data.set(full.data.subarray((r * full.w + x) * 3, (r * full.w + x1) * 3), (r - y) * w * 3);
  return out;
}

/** The browser's frame between CSS rows y0..y1, stitched from the capture's
 *  bands: [image, its first device row, manifest]. */
async function browserRaster(url: string, o: { ppp: number; ss: number; hsize: number; margin: number; y0: number; y1: number | null; css: string;
  chromiumArgs: string; reuse: boolean; band: number; waitLog?: string }, cache: string): Promise<[I.Rgb, number, CaptureManifest & { request?: unknown }]> {
  const manifestFile = join(cache, 'manifest.json');
  const request = { url, ppp: o.ppp * o.ss, hsize: o.hsize, margin: o.margin, y0: o.y0, y1: o.y1, css: o.css, chromium_args: o.chromiumArgs };
  if (!(o.reuse && existsSync(manifestFile) && JSON.stringify(JSON.parse(readFileSync(manifestFile, 'utf8')).request) === JSON.stringify(request))) {
    const m = await capture(url, cache, { hsize: o.hsize, margin: o.margin, ppp: o.ppp * o.ss, band: o.band, y0: o.y0, y1: o.y1,
      extraCss: o.css, chromiumArgs: o.chromiumArgs, waitLog: o.waitLog });
    writeFileSync(manifestFile, JSON.stringify({ ...m, request }, null, 1));
  }
  const m = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (m.errors.length) console.error(`browser page errors: ${m.errors.slice(0, 3)}`);
  const dsf = m.dsf / o.ss;                                   // device px per CSS px after the reduction
  const row0 = pyRound(m.y0 * dsf), row1 = pyRound(m.y1 * dsf), width = pyRound(m.css_width * dsf);
  const img = I.blank(width, row1 - row0);
  for (const b of m.bands) {
    let band = await I.readRgb(b.file);
    if (o.ss > 1) {
      const buf = await sharp(band.data, { raw: { width: band.w, height: band.h, channels: 3 } })
        .resize(Math.ceil(band.w / o.ss), Math.ceil(band.h / o.ss), { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
      band = { data: new Uint8Array(buf.data), w: buf.info.width, h: buf.info.height };
    }
    const top = pyRound(b.scroll_y * dsf);
    const a0 = Math.max(top, row0), a1 = Math.min(top + band.h, row1);
    for (let r = a0; r < a1; r++) img.data.set(band.data.subarray((r - top) * band.w * 3, ((r - top) * band.w + Math.min(width, band.w)) * 3), (r - row0) * width * 3);
  }
  return [img, row0, m];
}

// ── Bands and their alignment ───────────────────────────────────────────────

/** The contiguous run of bands within [lo, hi) containing j whose extent is
 *  closest to target and within tol rows; null when none is. */
function bestRun(bands: [number, number][], j: number, lo: number, hi: number, target: number, tol: number): number[] | null {
  let best: [number, number, number] | null = null;
  for (let j0 = lo; j0 <= j; j0++) for (let j1 = j; j1 < hi; j1++) {
    if (j1 === j && j0 === j) continue;
    const d = Math.abs(bands[j1][1] - bands[j0][0] - target);
    if (d <= tol && (best === null || d < best[0])) best = [d, j0, j1];
  }
  return best ? Array.from({ length: best[2] - best[1] + 1 }, (_, k) => best![1] + k) : null;
}

/** Groups from the pairs: a pair whose bands differ in height by more than
 *  mergeMin rows and 15 % is regrouped so that the shorter side is the run of
 *  its free neighbours whose extent matches the taller band. */
function mergeBands(pairs: [number, number][], ba: [number, number][], bb: [number, number][], tol: number): [number[], number[]][] {
  return pairs.map(([i, j], k) => {
    const ha = ba[i][1] - ba[i][0], hb = bb[j][1] - bb[j][0];
    const prevI = k ? pairs[k - 1][0] : -1, prevJ = k ? pairs[k - 1][1] : -1;
    const nextI = k + 1 < pairs.length ? pairs[k + 1][0] : ba.length, nextJ = k + 1 < pairs.length ? pairs[k + 1][1] : bb.length;
    let ia = [i], jb = [j];
    if (ha - hb > Math.max(tol, 0.15 * ha)) jb = bestRun(bb, j, prevJ + 1, nextJ, ha, tol) ?? [j];
    else if (hb - ha > Math.max(tol, 0.15 * hb)) ia = bestRun(ba, i, prevI + 1, nextI, hb, tol) ?? [i];
    return [ia, jb];
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function compare(build: string, url: string, a: Record<string, any>): Promise<Record<string, unknown>> {
  const pdf = build.endsWith('.pdf') ? build : join(build, 'pageless.pdf');
  const meta = JSON.parse(readFileSync(join(dirname(pdf), 'pageless.json'), 'utf8'));
  const out = a.out ?? join(dirname(pdf), 'compare');
  mkdirSync(out, { recursive: true });
  const hsize = meta.hsize / SP_PER_PT, stripMargin = meta.margin / SP_PER_PT;
  const margin = a.margin ?? stripMargin;
  if (margin > stripMargin + 1e-6) throw new Error(`--margin ${margin} exceeds the strip's margin ${stripMargin}pt (rebuild the strip with a wider one)`);
  const ppp: number = a.ppp, dpi = ppp * 72.27, ss: number = a.supersample;
  const bounds = mupdf.Document.openDocument(readFileSync(pdf), 'application/pdf').loadPage(0).getBounds();
  const stripHPt = (bounds[3] - bounds[1]) * PT_PER_BP;
  // the frame: x = 0 is `margin` left of the column, y as the strip counts
  const frameX = stripMargin - margin, frameW = hsize + 2 * margin;
  let fx0 = 0, fx1 = frameW, fy0 = 0, fy1 = stripHPt;
  if (a.region) {
    const [X0, Y0, X1, Y1] = a.region as number[];
    fx0 = Math.max(0, X0 - frameX); fx1 = Math.min(frameW, X1 - frameX); fy0 = Math.max(0, Y0); fy1 = Math.min(stripHPt, Y1);
    if (fx1 <= fx0 || fy1 <= fy0) throw new Error('empty region');
  }
  const px = (v: number) => pyRound(v * ppp);

  const A = a.stripPng ? await I.readRgb(a.stripPng)
    : await stripRaster(pdf, px(frameX + fx0), px(fy0), px(fx1) - px(fx0), px(fy1) - px(fy0), dpi, ss);
  await I.writePng(join(out, 'strip.png'), A);
  // the browser, in CSS px (2 per pt), the band around the region
  const by0 = a.region ? Math.max(0, fy0 - a.slack) : 0, by1 = a.region ? fy1 + a.slack : null;
  const [Bfull, brow0, manifest] = await browserRaster(url, { ppp, ss, hsize, margin, y0: by0 * 2, y1: by1 === null ? null : by1 * 2, css: a.browserCss,
    chromiumArgs: a.chromiumArgs, reuse: a.reuse, band: a.band, waitLog: a.waitLog }, join(out, 'browser-cache'));
  const B = I.cropColumns(Bfull, px(fx0), px(fx1));
  await I.writePng(join(out, 'browser.png'), B);
  const bTopPt = brow0 / ppp;                                 // strip-frame y of B's first row

  // bands, profiles, alignment
  const inkA = I.inkOf(A), inkB = I.inkOf(B);
  const ba = I.bandsOf(inkA, a.ink, a.bandGap), bb = I.bandsOf(inkB, a.ink, a.bandGap);
  if (!ba.length || !bb.length) throw new Error(`nothing to compare: ${ba.length} strip band(s), ${bb.length} browser band(s)`);
  const { P: PA, cols } = I.profilesOf(inkA, ba, a.block), { P: PB } = I.profilesOf(inkB, bb, a.block);
  // the similarity tolerates a horizontal shift up to the shift search width,
  // so a display the browser centres elsewhere still pairs with its line
  const S = await I.similarity(PA, PB, cols, ba.length, bb.length, Math.max(0, Math.floor(a.shiftX / a.block)),
    ba.map(([p, q]) => q - p), bb.map(([p, q]) => q - p), a.match);
  const nb = bb.length, sAt = (i: number, j: number) => S[i * nb + j];
  const pairs = I.alignBands(S, ba.length, bb.length, a.match);
  // One band against several: a tall delimiter or a fraction rule bridges the
  // rows of a display in one rasteriser and not in the other.
  const groups = mergeBands(pairs, ba, bb, a.mergeMin);
  // a region: browser rows outside the matched extent were photographed on
  // purpose (the slack); leave them out of the picture and the counts
  let jlo = 0, jhi = B.h;
  if (a.region && pairs.length) {
    jlo = Math.max(0, bb[pairs[0][1]][0] - 2 * a.searchY - 4);
    jhi = Math.min(B.h, bb[pairs[pairs.length - 1][1]][1] + 2 * a.searchY + 4);
  }

  const rowsIa: number[] = [], rowsIb: number[] = [], rowsV: number[] = [], rowsDx: number[] = [];
  const pairInfo: Record<string, any>[] = [];
  let ca = 0, cb = jlo;
  const push = (ia: number, ib: number, v: number, dx: number) => { rowsIa.push(ia); rowsIb.push(ib); rowsV.push(v); rowsDx.push(dx); };
  /** Rows up to aTo / bTo, each side in its own order: an ink row with no pair
   *  is unmatched; blank rows pair with blank rows, the surplus a spacing
   *  difference (equal within the tolerance). */
  const flush = (aTo: number, bTo: number) => {
    const aRows = Array.from({ length: Math.max(0, aTo - ca) }, (_, k) => [ca + k, I.rowMax(inkA, ca + k) > a.ink] as const);
    const bRows = Array.from({ length: Math.max(0, bTo - cb) }, (_, k) => [cb + k, I.rowMax(inkB, cb + k) > a.ink] as const);
    const surplus = Math.abs(aRows.filter(r => !r[1]).length - bRows.filter(r => !r[1]).length) <= a.spacingTol ? EQUAL : SPACING;
    let i = 0, j = 0;
    while (i < aRows.length || j < bRows.length) {
      const aInk = i < aRows.length && aRows[i][1], bInk = j < bRows.length && bRows[j][1];
      if (aInk) push(aRows[i++][0], -1, UNMATCHED, 0);
      else if (bInk) push(-1, bRows[j++][0], UNMATCHED, 0);
      else if (i < aRows.length && j < bRows.length) push(aRows[i++][0], bRows[j++][0], EQUAL, 0);
      else if (i < aRows.length) push(aRows[i++][0], -1, surplus, 0);
      else push(-1, bRows[j++][0], surplus, 0);
    }
    ca = aTo; cb = bTo;
  };

  // what is compared as a block: every pair, and – between two pairs – a run
  // of lines left unpaired on both sides, taken if it overlays well
  type Item = { a: [number, number]; b: [number, number]; sim: number | null; kind: string; ia: number[]; jb: number[]; pair?: [number, number] };
  const items: Item[] = [];
  groups.forEach(([iaG, jbG], k) => {
    const single = iaG.length === 1 && jbG.length === 1;
    items.push({ a: [ba[iaG[0]][0], ba[iaG[iaG.length - 1]][1]], b: [bb[jbG[0]][0], bb[jbG[jbG.length - 1]][1]],
      sim: single ? sAt(iaG[0], jbG[0]) : null, kind: single ? 'band' : 'merge', ia: iaG, jb: jbG,
      pair: [iaG.length === 1 ? iaG[0] : pairs[k][0], jbG.length === 1 ? jbG[0] : pairs[k][1]] });
    if (k + 1 < groups.length) {
      const i = iaG[iaG.length - 1], j = jbG[jbG.length - 1], i2 = groups[k + 1][0][0], j2 = groups[k + 1][1][0];
      if (i2 > i + 1 && j2 > j + 1) items.push({ a: [ba[i + 1][0], ba[i2 - 1][1]], b: [bb[j + 1][0], bb[j2 - 1][1]], sim: null, kind: 'block',
        ia: Array.from({ length: i2 - i - 1 }, (_, t) => i + 1 + t), jb: Array.from({ length: j2 - j - 1 }, (_, t) => j + 1 + t) });
    }
  });
  items.sort((x, y) => x.a[0] - y.a[0]);                    // stable, as Python's sort
  const pa = new Set(groups.flatMap(g => g[0])), pb = new Set(groups.flatMap(g => g[1]));

  for (let it of items) {
    let [a0, a1] = it.a, [b0, b1] = it.b;
    let aStart = Math.max(0, a0 - 1), bStart = Math.max(0, b0 - 1);
    let n = Math.min(Math.max(a1 - a0, b1 - b0) + 2, A.h - aStart, B.h - bStart - a.searchY);   // one row of context either side
    let shift = I.bestShift(A, B, aStart, bStart, n, a.searchX, a.searchY, a.tol);
    let [dx, dy, resid] = shift ?? [0, 0, 1.0];
    if (it.kind === 'block') {
      if (resid > a.accept) continue;                         // different content after all: stays unmatched
      it.ia.forEach(x => pa.add(x)); it.jb.forEach(x => pb.add(x));
    } else if (it.kind === 'merge' && resid > a.accept) {
      // the grouping did not overlay: back to the one pair the alignment made
      const [i, j] = it.pair!;
      for (const x of it.ia) if (x !== i) pa.delete(x);
      for (const x of it.jb) if (x !== j) pb.delete(x);
      it = { a: ba[i], b: bb[j], sim: sAt(i, j), kind: 'band', ia: [i], jb: [j] };
      [a0, a1] = it.a; [b0, b1] = it.b;
      aStart = Math.max(0, a0 - 1); bStart = Math.max(0, b0 - 1);
      n = Math.min(Math.max(a1 - a0, b1 - b0) + 2, A.h - aStart, B.h - bStart - a.searchY);
      shift = I.bestShift(A, B, aStart, bStart, n, a.searchX, a.searchY, a.tol);
      [dx, dy, resid] = shift ?? [0, 0, 1.0];
    }
    bStart += dy;
    const aLo = Math.max(aStart, ca), bLo = Math.max(bStart, cb);
    const aHi = Math.min(aStart + n, A.h), bHi = Math.min(bStart + n, jhi);
    const k0 = Math.max(aLo - aStart, bLo - bStart), k1 = Math.min(aHi - aStart, bHi - bStart);
    if (k1 <= k0) continue;
    flush(aStart + k0, bStart + k0);
    const ia = Array.from({ length: k1 - k0 }, (_, t) => aStart + k0 + t), ib = Array.from({ length: k1 - k0 }, (_, t) => bStart + k0 + t);
    const v = I.rowVerdicts(A, B, ia, ib, dx, a.tol, a.frac, EQUAL, DIFFER);
    const rStart = rowsIa.length;
    ia.forEach((x, t) => push(x, ib[t], v[t], dx));
    // where the ink sits, to a fraction of a pixel: the centroid of each
    // side's rows, the whole-pixel shift taken out
    const [subY, subX] = I.centroidOffset(I.inkRows(inkA, ia), I.inkRows(inkB, ib), dx);
    ca = aStart + k1; cb = bStart + k1;
    pairInfo.push({
      strip_y0: r2(fy0 + a0 / ppp), strip_y1: r2(fy0 + a1 / ppp), browser_y0: r2(bTopPt + b0 / ppp),
      offset_pt: r2((bTopPt + (b0 + dy) / ppp) - (fy0 + a0 / ppp)), dx_px: dx, dy_px: dy, sub_px_y: r3(subY), sub_px_x: r3(subX),
      similarity: it.sim === null ? null : r3(it.sim), kind: it.kind, lines: it.ia.length, rows: k1 - k0,
      differing_rows: v.filter(x => x === DIFFER).length, shifted_rows: 0, residual: r4(resid), _r: [rStart, rStart + ia.length],
    });
  }
  flush(A.h, jhi);
  const verdict = Int8Array.from(rowsV);

  // ── Shifted, not different? ─────────────────────────────────────────────
  // A differing run is often the same ink elsewhere: a display the browser
  // centres where TeX set it flush left, a row of an alignment a few pixels
  // off. Its strip ink is split into fragments, each looked for in the browser
  // by correlation of blurred ink; when all are found and one is off its place,
  // the rows are shifted.
  const shiftedRuns: Record<string, unknown>[] = [], shiftTests: Record<string, unknown>[] = [];
  const fA = I.blur3(inkA), fB = I.blur3(inkB);
  const sx: number = a.shiftX, sy: number = a.shiftY;
  for (const [r0, r1] of I.runsOf(Array.from(verdict, x => x === DIFFER))) {
    if (r1 - r0 < a.shiftMin) continue;
    const iaAll = rowsIa.slice(r0, r1), ibAll = rowsIb.slice(r0, r1);
    const place = (rows: number[], c0: number, c1: number, gap: number): Record<string, any>[] => {
      const ib = rows.map(r => ibAll[iaAll.indexOf(r)]);
      const sub = I.inkCols(I.inkRows(inkA, rows), c0, c1);
      let inkCount = 0;
      for (const x of sub.data) if (x > a.ink) inkCount++;
      if (inkCount < 30) return [];                          // too little ink to place
      const tpl = I.inkCols(I.inkRows(fA, rows), c0, c1);
      const bLo = Math.max(0, ib[0] - sy), bHi = Math.min(B.h, ib[ib.length - 1] + 1 + sy);
      const w0 = Math.max(0, c0 - sx), w1 = Math.min(B.w, c1 + sx);
      const win = I.inkCols(I.inkRows(fB, Array.from({ length: bHi - bLo }, (_, t) => bLo + t)), w0, w1);
      const res = win.h >= tpl.h ? I.nccSearch(tpl, win, ib[0] - bLo, c0 - w0) : null;
      const rec: Record<string, any> = { y0_pt: r2(fy0 + rows[0] / ppp), y1_pt: r2(fy0 + (rows[rows.length - 1] + 1) / ppp),
        x0_pt: r2(frameX + fx0 + c0 / ppp), x1_pt: r2(frameX + fx0 + c1 / ppp), dx_px: null, dy_px: null, corr: null, corr_in_place: null, found: false, moved: false };
      if (res) {
        const [corr, dy, dx, corr0] = res;
        rec.corr = r3(corr); rec.corr_in_place = r3(corr0);
        if (corr >= a.shiftCorr) {
          // a moved claim needs a piece wide enough to be distinctive: a lone
          // letter is "found" wherever the same letter recurs – the larger the
          // jump, the wider the piece must be
          const far = Math.max(Math.abs(dx), Math.abs(dy));
          const wide = c1 - c0 >= a.shiftMinWidth * ppp * (far > 4 * ppp ? 2 : 1);
          Object.assign(rec, { dx_px: dx, dy_px: dy, found: true, moved: far >= a.shiftMinPx && corr - corr0 >= 0.05 && wide });
        }
      }
      if (rec.found && rec.corr >= a.shiftDeep) return [rec];
      const parts: [number[], number, number][] = [];
      for (const [s0, s1] of I.bandsOf(sub, a.ink, a.bandGap)) {
        const slice = { data: sub.data.subarray(s0 * sub.w, s1 * sub.w), w: sub.w, h: s1 - s0 };
        for (const [d0, d1] of I.fragmentsOf(slice, a.ink, Math.max(1, gap >> 1))) parts.push([rows.slice(s0, s1), c0 + d0, c0 + d1]);
      }
      const finer = gap >= 4 && (parts.length > 1 || (parts.length > 0 && (parts[0][1] > c0 || parts[0][2] < c1 || parts[0][0].length < rows.length)));
      if (finer) {
        const recs = parts.flatMap(([pr, d0, d1]) => place(pr, d0, d1, gap >> 1));
        if (recs.length && (!rec.found || recs.some(r => r.moved))) return recs;
      }
      return [rec];
    };
    const frags: Record<string, any>[] = [];
    const runInk = I.inkRows(inkA, iaAll);
    for (const [s0, s1] of I.bandsOf(runInk, a.ink, a.bandGap)) {
      const rows = iaAll.slice(s0, s1);
      for (const [c0, c1] of I.fragmentsOf(I.inkRows(inkA, rows), a.ink, a.gap)) frags.push(...place(rows, c0, c1, a.gap));
    }
    const found = frags.filter(f => f.found).length, moved = frags.filter(f => f.moved).length;
    const all = frags.length > 0 && found === frags.length;
    shiftTests.push({ strip_y0: r2(fy0 + iaAll[0] / ppp), strip_y1: r2(fy0 + (iaAll[iaAll.length - 1] + 1) / ppp), rows: r1 - r0,
      pieces: frags.length, found, moved, outcome: all && moved ? 'shifted' : all ? 'in place' : 'not found', fragments: frags });
    if (all && moved) {
      verdict.fill(SHIFTED, r0, r1);
      shiftedRuns.push({ strip_y0: r2(fy0 + iaAll[0] / ppp), strip_y1: r2(fy0 + (iaAll[iaAll.length - 1] + 1) / ppp), rows: r1 - r0, fragments: frags });
    }
  }
  for (const p of pairInfo) {                                // the verdicts after the shift pass
    const seg = verdict.subarray(p._r[0], p._r[1]);
    p.differing_rows = seg.filter(x => x === DIFFER).length; p.shifted_rows = seg.filter(x => x === SHIFTED).length;
    delete p._r;
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const count = (code: number, side?: number[]) => verdict.reduce((s, x, k) => s + (x === code && (!side || side[k] >= 0) ? 1 : 0), 0);
  const counts = { equal: count(EQUAL), differing: count(DIFFER), unmatched: count(UNMATCHED), spacing: count(SPACING), shifted: count(SHIFTED),
    unmatched_strip: count(UNMATCHED, rowsIa), unmatched_browser: count(UNMATCHED, rowsIb), spacing_strip: count(SPACING, rowsIa), spacing_browser: count(SPACING, rowsIb) };
  const unmatched: Record<string, unknown>[] = [];
  for (const [side, bands, inpair, top] of [['strip', ba, pa, fy0], ['browser', bb, pb, bTopPt]] as const)
    bands.forEach(([y0, y1], k) => {
      if (!inpair.has(k) && (side === 'strip' || (jlo <= y0 && y0 < jhi))) unmatched.push({ side, y0: r2(top + y0 / ppp), y1: r2(top + y1 / ppp), rows: y1 - y0 });
    });
  const steps: Record<string, number>[] = [];
  for (let k = 0; k + 1 < pairInfo.length; k++) {
    const d = pairInfo[k + 1].offset_pt - pairInfo[k].offset_pt;
    if (Math.abs(d) >= a.stepMin - 1e-9) steps.push({ between_strip_y: pairInfo[k].strip_y1, and: pairInfo[k + 1].strip_y0, delta_pt: r2(d) });
  }
  const offsets = pairInfo.map(p => p.offset_pt as number);
  const good = pairInfo.filter(p => p.similarity !== null && p.similarity >= 0.9);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const std = (x: number[]) => Math.sqrt(mean(x.map(v => (v - mean(x)) ** 2)));
  const sub = good.length ? { y: { mean: r3(mean(good.map(p => p.sub_px_y))), std: r3(std(good.map(p => p.sub_px_y))) },
                              x: { mean: r3(mean(good.map(p => p.sub_px_x))), std: r3(std(good.map(p => p.sub_px_x))) } } : null;
  const hist = (xs: number[]) => Object.fromEntries([...new Set(xs)].sort((p, q) => p - q).map(k => [String(k), xs.filter(x => x === k).length]));
  const report = {
    ppp, dpi, margin_pt: margin, hsize_pt: hsize, frame_x_pt: frameX,
    region_pt: [frameX + fx0, fy0, frameX + fx1, fy1], browser_rows_from_pt: bTopPt,
    rows: { strip: A.h, browser: jhi - jlo, ...counts },
    bands: { strip: ba.length, browser: bb.length, matched_strip: pa.size, matched_browser: pb.size,
             blocks: pairInfo.filter(p => p.kind === 'block').length, merges: pairInfo.filter(p => p.kind === 'merge').length },
    settings: { supersample: ss, tol: a.tol, frac: a.frac, ink: a.ink, block: a.block, match: a.match, search_x: a.searchX, search_y: a.searchY,
                shift_min: a.shiftMin, shift_x: a.shiftX, shift_y: a.shiftY, shift_corr: a.shiftCorr, gap: a.gap },
    offset_pt: offsets.length ? { first: offsets[0], last: offsets[offsets.length - 1], min: Math.min(...offsets), max: Math.max(...offsets) } : null,
    dx_px_histogram: hist(pairInfo.map(p => p.dx_px)), dy_px_histogram: hist(pairInfo.map(p => p.dy_px)),
    sub_pixel_offset_px: sub,
    spacing_steps: [...steps].sort((p, q) => Math.abs(q.delta_pt) - Math.abs(p.delta_pt)),
    shifted_runs: [...shiftedRuns].sort((p, q) => (q.rows as number) - (p.rows as number)),
    shift_tests: shiftTests,
    worst_pairs: [...pairInfo].sort((p, q) => q.differing_rows - p.differing_rows || q.residual - p.residual).slice(0, 40),
    unmatched_bands: unmatched, pairs: pairInfo, browser_geometry: manifest.geometry,
  };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  // rows.tsv: every row of the diff in diff order
  const names: Record<number, string> = { [EQUAL]: 'equal', [DIFFER]: 'differ', [UNMATCHED]: 'unmatched', [SPACING]: 'spacing', [SHIFTED]: 'shifted' };
  writeFileSync(join(out, 'rows.tsv'), 'strip_row\tbrowser_row\tverdict\tdx_px\n' + rowsIa.map((x, k) => `${x}\t${rowsIb[k]}\t${names[verdict[k]]}\t${rowsDx[k]}\n`).join(''));

  // ── The pictures: rows in diff order, the strip left, the browser right ──
  const W = A.w, N = rowsIa.length, bar = a.bar as number;
  const barColour = (k: number, x: number): [number, number, number] => {
    if (a.tick > 0) {
      const t = a.tick * ppp, third = Math.max(1, Math.floor(bar / 3));
      const tickAt = (y: number) => Math.floor(y / t) !== Math.floor((y - 1) / t);
      if (x < third && rowsIa[k] >= 0 && tickAt(fy0 * ppp + rowsIa[k])) return TICK;
      if (x >= bar - third && rowsIb[k] >= 0 && tickAt(bTopPt * ppp + rowsIb[k])) return TICK;
    }
    return COLOUR[verdict[k]];
  };
  if (!a.noFullImage) {
    const full = I.blank(2 * W + bar, N, BLANK), heat = I.blank(W, N, BLANK);
    for (let k = 0; k < N; k++) {
      const o = k * full.w * 3;
      if (rowsIa[k] >= 0) full.data.set(A.data.subarray(rowsIa[k] * W * 3, (rowsIa[k] + 1) * W * 3), o);
      for (let x = 0; x < bar; x++) full.data.set(barColour(k, x), o + (W + x) * 3);
      if (rowsIb[k] >= 0) full.data.set(B.data.subarray(rowsIb[k] * B.w * 3, rowsIb[k] * B.w * 3 + W * 3), o + (W + bar) * 3);
      // heat: white where the pair agrees, red by how much a pixel differs
      if (rowsIa[k] >= 0 && rowsIb[k] >= 0) {
        const dx = rowsDx[k], ax0 = Math.max(0, dx), bx0 = Math.max(0, -dx), w = W - Math.abs(dx);
        heat.data.fill(255, k * W * 3, (k + 1) * W * 3);
        for (let x = 0; x < w; x++) {
          const pA = (rowsIa[k] * W + ax0 + x) * 3, pB = (rowsIb[k] * B.w + bx0 + x) * 3;
          const d = Math.max(Math.abs(A.data[pA] - B.data[pB]), Math.abs(A.data[pA + 1] - B.data[pB + 1]), Math.abs(A.data[pA + 2] - B.data[pB + 2]));
          heat.data[(k * W + ax0 + x) * 3 + 1] = 255 - d; heat.data[(k * W + ax0 + x) * 3 + 2] = 255 - d;
        }
      }
    }
    await I.writePng(join(out, 'diff.png'), full);
    await I.writePng(join(out, 'heat.png'), heat);
  }
  if (a.overview > 1) {
    // f rows and columns to one, a group's bar showing its worst verdict
    const f = a.overview as number, rows = Math.ceil(N / f), ow = Math.max(1, Math.floor(W / f)), barW = Math.max(3, Math.ceil(bar / f));
    const shrink = (img: (k: number) => number, into: I.Rgb, x0: number, src: Uint8Array, srcW: number) => {
      for (let R = 0; R < rows; R++) for (let X = 0; X < ow; X++) {
        const s = [0, 0, 0];
        for (let dy = 0; dy < f; dy++) {
          const k = R * f + dy, row = k < N ? img(k) : -1;
          for (let dx = 0; dx < f; dx++) for (let c = 0; c < 3; c++)
            s[c] += row >= 0 ? src[(row * srcW + X * f + dx) * 3 + c] : k < N ? BLANK[c] : 255;
        }
        for (let c = 0; c < 3; c++) into.data[(R * into.w + x0 + X) * 3 + c] = Math.round(s[c] / (f * f));
      }
    };
    const ov = I.blank(2 * ow + barW, rows);
    shrink(k => rowsIa[k], ov, 0, A.data, W);
    shrink(k => rowsIb[k], ov, ow + barW, B.data, B.w);
    for (let R = 0; R < rows; R++) {
      let worst = 0, code = EQUAL;
      for (let k = R * f; k < Math.min(N, (R + 1) * f); k++) if (PRIORITY[verdict[k]] > worst) { worst = PRIORITY[verdict[k]]; code = verdict[k]; }
      for (let x = 0; x < barW; x++) ov.data.set(worst ? COLOUR[code] : [255, 255, 255], (R * ov.w + ow + x) * 3);
    }
    await I.writePng(join(out, 'overview.png'), ov);
  }

  const say = (s: string) => console.log(s);
  say(`frame: hsize ${pyG(hsize)}pt, margin ${pyG(margin)}pt, ${pyG(ppp)} px/pt; strip region x ${pyG(frameX + fx0)}..${pyG(frameX + fx1)}, y ${pyG(fy0)}..${pyG(fy1)} pt`);
  say(`bands: strip ${ba.length}, browser ${bb.length}, matched ${pa.size}/${pb.size} (${report.bands.blocks} block(s) of touching lines taken whole, ${report.bands.merges} band(s) paired with several)`);
  say(`rows: strip ${A.h}, browser ${jhi - jlo}: ${counts.equal} equal, ${counts.differing} differing, ${counts.shifted} shifted, unmatched ` +
      `${counts.unmatched_strip}/${counts.unmatched_browser}, spacing surplus ${counts.spacing_strip}/${counts.spacing_browser} (strip/browser)`);
  if (offsets.length) say(`browser offset (browser y - strip y): first ${offsets[0]}pt, last ${offsets[offsets.length - 1]}pt, range ${Math.min(...offsets)}..${Math.max(...offsets)}pt; ` +
      `shift px: x ${JSON.stringify(report.dx_px_histogram)}, y ${JSON.stringify(report.dy_px_histogram)}`);
  if (sub) say(`sub-pixel offset of the ink (browser - strip, whole pixels taken out), over ${good.length} well-paired lines: ` +
      `y ${sub.y.mean} px (std ${sub.y.std}), x ${sub.x.mean} px (std ${sub.x.std})`);
  for (const s of report.spacing_steps.slice(0, 12)) say(`  spacing  between strip y ${s.between_strip_y.toFixed(2)} and ${s.and.toFixed(2)}: browser ${s.delta_pt.toFixed(2)}pt`);
  if (shiftTests.length) {
    const oc = shiftTests.map(t => t.outcome);
    say(`differing runs of ${a.shiftMin}+ rows tested for a shift: ${oc.length}: ${oc.filter(x => x === 'shifted').length} shifted, ` +
        `${oc.filter(x => x === 'in place').length} the same ink in place, ${oc.filter(x => x === 'not found').length} with a part not found`);
  }
  for (const p of report.worst_pairs.slice(0, 12)) {
    if (!p.differing_rows) break;
    say(`  differ   strip y ${p.strip_y0.toFixed(2)}..${p.strip_y1.toFixed(2)}  ${p.differing_rows}/${p.rows} rows, residual ${p.residual.toFixed(3)}, shift (${p.dx_px},${p.dy_px}) px`);
  }
  for (const u of [...unmatched].sort((p, q) => (q.rows as number) - (p.rows as number)).slice(0, 12)) say(`  unmatched ${u.side} y ${u.y0}..${u.y1}  (${u.rows} rows)`);
  say(`→ ${out}/diff.png, heat.png, overview.png, report.json`);
  return report;
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      ppp: { type: 'string', default: '2' }, margin: { type: 'string' }, region: { type: 'string', multiple: true }, slack: { type: 'string', default: '200' },
      out: { type: 'string' }, tol: { type: 'string', default: '96' }, frac: { type: 'string', default: '0.01' }, ink: { type: 'string', default: '80' },
      'band-gap': { type: 'string', default: '1' }, block: { type: 'string', default: '4' }, match: { type: 'string', default: '0.6' },
      'search-x': { type: 'string', default: '3' }, 'merge-min': { type: 'string', default: '3' }, accept: { type: 'string', default: '0.08' },
      'search-y': { type: 'string', default: '2' }, 'shift-min': { type: 'string', default: '6' }, 'shift-x': { type: 'string', default: '240' },
      'shift-y': { type: 'string', default: '40' }, 'shift-corr': { type: 'string', default: '0.9' }, 'shift-deep': { type: 'string', default: '0.97' },
      'shift-min-width': { type: 'string', default: '12' }, 'shift-min-px': { type: 'string', default: '2' }, gap: { type: 'string', default: '16' },
      'step-min': { type: 'string', default: '1.0' }, 'spacing-tol': { type: 'string', default: '1' }, bar: { type: 'string', default: '24' },
      tick: { type: 'string', default: '500' }, overview: { type: 'string', default: '8' }, 'no-full-image': { type: 'boolean', default: false },
      band: { type: 'string', default: '2000' }, 'browser-css': { type: 'string', default: '' }, 'chromium-args': { type: 'string', default: '' },
      supersample: { type: 'string', default: '1' }, reuse: { type: 'boolean', default: false }, 'wait-log': { type: 'string' },
      'strip-png': { type: 'string' },
    },
  });
  if (positionals.length !== 2) { console.error('usage: compare.ts <build dir | pageless.pdf> <page url> [options] (see the top of this file)'); process.exit(2); }
  const n = (k: string) => Number((v as Record<string, unknown>)[k]);
  // --region X0 Y0 X1 Y1: four numbers after one flag, or the flag four times
  const region = v.region ? v.region.flatMap(s => s.split(/[\s,]+/)).map(Number) : null;
  try {
    await compare(positionals[0], positionals[1], {
      ppp: n('ppp'), margin: v.margin === undefined ? undefined : n('margin'), region, slack: n('slack'), out: v.out, tol: n('tol'), frac: n('frac'),
      ink: n('ink'), bandGap: n('band-gap'), block: n('block'), match: n('match'), searchX: n('search-x'), mergeMin: n('merge-min'), accept: n('accept'),
      searchY: n('search-y'), shiftMin: n('shift-min'), shiftX: n('shift-x'), shiftY: n('shift-y'), shiftCorr: n('shift-corr'), shiftDeep: n('shift-deep'),
      shiftMinWidth: n('shift-min-width'), shiftMinPx: n('shift-min-px'), gap: n('gap'), stepMin: n('step-min'), spacingTol: n('spacing-tol'),
      bar: n('bar'), tick: n('tick'), overview: n('overview'), noFullImage: v['no-full-image'], band: n('band'), browserCss: v['browser-css'],
      chromiumArgs: v['chromium-args'], supersample: n('supersample'), reuse: v.reuse, waitLog: v['wait-log'], stripPng: v['strip-png'],
    });
  } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(1); }
}
