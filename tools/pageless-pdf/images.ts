// SPDX-License-Identifier: AGPL-3.0-or-later
// The image work of compare.ts, on typed arrays: RGB images, ink, bands of ink
// rows, their profiles and alignment, the pixel shift within a pair, the search
// for a moved fragment. Written as numpy wrote it in compare.py, so the two
// agree to the pixel.
import sharp from 'sharp';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

/** An RGB image, row after row, 3 bytes a pixel. */
export interface Rgb { data: Uint8Array; w: number; h: number }
/** A one-channel image of numbers (ink, blurred ink). */
export interface Gray { data: Float32Array | Int16Array; w: number; h: number }

export async function readRgb(file: string): Promise<Rgb> {
  const { data, info } = await sharp(file, { limitInputPixels: false }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}
export async function writePng(file: string, img: Rgb): Promise<void> {
  await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 3 }, limitInputPixels: false }).png().toFile(file);
}
export function blank(w: number, h: number, colour: [number, number, number] = [255, 255, 255]): Rgb {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < data.length; i += 3) { data[i] = colour[0]; data[i + 1] = colour[1]; data[i + 2] = colour[2]; }
  return { data, w, h };
}
/** Columns x0..x1 of every row. */
export function cropColumns(img: Rgb, x0: number, x1: number): Rgb {
  const w = x1 - x0, out = new Uint8Array(w * img.h * 3);
  for (let y = 0; y < img.h; y++) out.set(img.data.subarray((y * img.w + x0) * 3, (y * img.w + x1) * 3), y * w * 3);
  return { data: out, w, h: img.h };
}

/** 255 − the darkest channel: 0 white .. 255 black. */
export function inkOf({ data, w, h }: Rgb): Gray {
  const ink = new Int16Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) ink[i] = 255 - Math.min(data[p], data[p + 1], data[p + 2]);
  return { data: ink, w, h };
}
/** Rows `rows` of an ink image (a new image). */
export function inkRows(ink: Gray, rows: number[]): Gray {
  const out = new Int16Array(rows.length * ink.w);
  rows.forEach((r, k) => out.set(ink.data.subarray(r * ink.w, (r + 1) * ink.w), k * ink.w));
  return { data: out, w: ink.w, h: rows.length };
}
/** Columns c0..c1 of an ink image. */
export function inkCols(ink: Gray, c0: number, c1: number): Gray {
  const w = c1 - c0, out = new Float32Array(w * ink.h);
  for (let y = 0; y < ink.h; y++) for (let x = 0; x < w; x++) out[y * w + x] = ink.data[y * ink.w + c0 + x];
  return { data: out, w, h: ink.h };
}
export const rowMax = (ink: Gray, r: number) => { let m = -Infinity; for (let x = 0; x < ink.w; x++) m = Math.max(m, ink.data[r * ink.w + x]); return m; };

/** [start, end) of each run of true. */
export function runsOf(flags: ArrayLike<boolean | number>): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    const f = i < flags.length && flags[i];
    if (f && s < 0) s = i; else if (!f && s >= 0) { out.push([s, i]); s = -1; }
  }
  return out;
}

/** [(y0, y1)] runs of rows with a pixel darker than thr; runs separated by
 *  fewer than `gap` blank rows are one band – the tolerance that makes the cut
 *  the same on both sides (a line 1 pt above a display is fused with it by one
 *  rasteriser's anti-aliasing and not by the other's). */
export function bandsOf(ink: Gray, thr: number, gap = 1): [number, number][] {
  const rows = new Uint8Array(ink.h);
  for (let r = 0; r < ink.h; r++) for (let x = 0; x < ink.w; x++) if (ink.data[r * ink.w + x] > thr) { rows[r] = 1; break; }
  const out: [number, number][] = [];
  for (const [y0, y1] of runsOf(rows)) {
    if (out.length && y0 - out[out.length - 1][1] < gap) out[out.length - 1][1] = y1; else out.push([y0, y1]);
  }
  return out;
}

/** Column ranges of ink in a block of rows, runs closer than `gap` merged,
 *  each widened by `pad`. */
export function fragmentsOf(ink: Gray, thr: number, gap: number, pad = 2): [number, number][] {
  const cols = new Uint8Array(ink.w);
  for (let y = 0; y < ink.h; y++) for (let x = 0; x < ink.w; x++) if (ink.data[y * ink.w + x] > thr) cols[x] = 1;
  const out: [number, number][] = [];
  for (const [c0, c1] of runsOf(cols)) {
    if (out.length && c0 - out[out.length - 1][1] < gap) out[out.length - 1][1] = c1; else out.push([c0, c1]);
  }
  return out.map(([c0, c1]) => [Math.max(0, c0 - pad), Math.min(ink.w, c1 + pad)]);
}

/** Centred, normalised ink profile of every band, pooled over `block` px. */
export function profilesOf(ink: Gray, bands: [number, number][], block: number): { P: Float32Array; cols: number } {
  const w = ink.w, pad = ((-w % block) + block) % block, cols = (w + pad) / block;
  const P = new Float32Array(bands.length * cols);
  const prof = new Float64Array(w + pad);
  bands.forEach(([a, b], k) => {
    prof.fill(0);
    for (let y = a; y < b; y++) for (let x = 0; x < w; x++) prof[x] += ink.data[y * w + x];
    for (let x = 0; x < w; x++) prof[x] /= b - a;
    for (let c = 0; c < cols; c++) { let s = 0; for (let j = 0; j < block; j++) s += prof[c * block + j]; P[k * cols + c] = Math.fround(s / block); }
    let mean = 0;
    for (let c = 0; c < cols; c++) mean += P[k * cols + c];
    mean = Math.fround(mean / cols);
    let n = 0;
    for (let c = 0; c < cols; c++) { P[k * cols + c] -= mean; n += P[k * cols + c] ** 2; }
    n = Math.sqrt(n) || 1;
    for (let c = 0; c < cols; c++) P[k * cols + c] /= n;
  });
  return { P, cols };
}

// ── The shifted similarity ──────────────────────────────────────────────────
// S[i][j] = max over |sh| ≤ K of shift(PA, sh)[i] · PB[j], less half the
// log of the bands' height ratio (bands of unlike height are unlike). A pair
// whose best possible score – profiles are unit vectors, so at most 1, less
// that penalty – cannot exceed `match` is never paired by the alignment (a
// non-positive gain loses to the free gap): it is skipped. Rows go to worker
// threads.

interface SimJob { PA: Float32Array; PB: Float32Array; cols: number; nb: number; K: number; ha: Float64Array; hb: Float64Array; match: number; i0: number; i1: number }

function simRows({ PA, PB, cols, nb, K, ha, hb, match, i0, i1 }: SimJob): Float32Array {
  const out = new Float32Array((i1 - i0) * nb).fill(-1e30);
  for (let i = i0; i < i1; i++) {
    const a = PA.subarray(i * cols, (i + 1) * cols);
    for (let j = 0; j < nb; j++) {
      const pen = 0.5 * Math.abs(Math.log(ha[i] / hb[j]));
      if (1 - pen <= match) continue;
      const b = PB.subarray(j * cols, (j + 1) * cols);
      let best = -Infinity;
      for (let sh = -K; sh <= K; sh++) {
        let s = 0;
        const lo = Math.max(0, sh), hi = Math.min(cols, cols + sh);
        for (let c = lo; c < hi; c++) s += a[c - sh] * b[c];
        if (s > best) best = s;
      }
      out[(i - i0) * nb + j] = best - pen;
    }
  }
  return out;
}
if (!isMainThread && workerData?.simJob) parentPort!.postMessage(simRows(workerData.simJob));

export async function similarity(PA: Float32Array, PB: Float32Array, cols: number, na: number, nb: number, K: number,
                                 ha: number[], hb: number[], match: number): Promise<Float32Array> {
  const n = Math.min(availableParallelism(), Math.max(1, na));
  const step = Math.ceil(na / n);
  const parts = await Promise.all(Array.from({ length: n }, (_, k) => new Promise<[number, Float32Array]>((ok, fail) => {
    const i0 = k * step, i1 = Math.min(na, i0 + step);
    if (i0 >= i1) { ok([i0, new Float32Array(0)]); return; }
    const w = new Worker(new URL(import.meta.url), { workerData: { simJob: { PA, PB, cols, nb, K, ha: Float64Array.from(ha), hb: Float64Array.from(hb), match, i0, i1 } } });
    w.once('message', m => { ok([i0, m]); void w.terminate(); });
    w.once('error', fail);
  })));
  const S = new Float32Array(na * nb);
  for (const [i0, m] of parts) S.set(m, i0 * nb);
  return S;
}

/** Monotone pairing (i, j) maximising the sum of (S[i][j] − match) over the
 *  pairs, gaps free: sequence alignment, the diff of two band lists. */
export function alignBands(S: Float32Array, na: number, nb: number, match: number): [number, number][] {
  const W = nb + 1, dp = new Float32Array((na + 1) * W);
  for (let i = 1; i <= na; i++) {
    let run = -Infinity;
    for (let j = 1; j <= nb; j++) {
      const cand = Math.max(dp[(i - 1) * W + j], Math.fround(dp[(i - 1) * W + j - 1] + Math.fround(S[(i - 1) * nb + j - 1] - match)));
      run = Math.max(run, cand);
      dp[i * W + j] = run;
    }
  }
  const pairs: [number, number][] = [];
  let i = na, j = nb;
  while (i > 0 && j > 0) {
    const v = dp[i * W + j], g = Math.fround(S[(i - 1) * nb + j - 1] - match);
    if (g > 0 && v === Math.fround(dp[(i - 1) * W + j - 1] + g)) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (v === dp[(i - 1) * W + j]) i--; else j--;
  }
  return pairs.reverse();
}

/** [dx, dy, residual]: the shift of B's rows b0.. against A's a0..a0+n with
 *  the fewest pixels differing by more than tol; null at the image's edge. */
export function bestShift(A: Rgb, B: Rgb, a0: number, b0: number, n: number, sx: number, sy: number, tol: number): [number, number, number] | null {
  if (a0 < 0 || a0 + n > A.h) return null;
  const W = A.w;
  let best: [number, number, number] | null = null;
  for (let dy = -sy; dy <= sy; dy++) {
    const bb0 = b0 + dy;
    if (bb0 < 0 || bb0 + n > B.h) continue;
    for (let dx = -sx; dx <= sx; dx++) {
      const ax0 = Math.max(0, dx), bx0 = Math.max(0, -dx), w = W - Math.abs(dx);
      let bad = 0;
      for (let y = 0; y < n; y++) {
        const pa = ((a0 + y) * W + ax0) * 3, pb = ((bb0 + y) * B.w + bx0) * 3;
        for (let x = 0; x < w * 3; x += 3) {
          const d = Math.max(Math.abs(A.data[pa + x] - B.data[pb + x]), Math.abs(A.data[pa + x + 1] - B.data[pb + x + 1]), Math.abs(A.data[pa + x + 2] - B.data[pb + x + 2]));
          if (d > tol) bad++;
        }
      }
      const r = bad / (n * w);
      if (best === null || r < best[2]) best = [dx, dy, r];
    }
  }
  return best;
}

/** Per row pair: DIFFER when more than frac of its pixels differ by more than
 *  tol (the pair's horizontal shift applied), else EQUAL. */
export function rowVerdicts(A: Rgb, B: Rgb, ia: number[], ib: number[], dx: number, tol: number, frac: number, EQUAL: number, DIFFER: number): number[] {
  const W = A.w, ax0 = Math.max(0, dx), bx0 = Math.max(0, -dx), w = W - Math.abs(dx);
  return ia.map((ra, k) => {
    const pa = (ra * W + ax0) * 3, pb = (ib[k] * B.w + bx0) * 3;
    let bad = 0;
    for (let x = 0; x < w * 3; x += 3) {
      const d = Math.max(Math.abs(A.data[pa + x] - B.data[pb + x]), Math.abs(A.data[pa + x + 1] - B.data[pb + x + 1]), Math.abs(A.data[pa + x + 2] - B.data[pb + x + 2]));
      if (d > tol) bad++;
    }
    return bad > frac * W ? DIFFER : EQUAL;
  });
}

/** [y, x] of B's ink centroid minus A's (rows paired one to one, B shifted by
 *  dx columns), whole pixels taken out: the sub-pixel part of where the two
 *  renderers put the same line. */
export function centroidOffset(a: Gray, b: Gray, dx: number): [number, number] {
  const stats = (g: Gray) => {
    let wsum = 0, ys = 0, xs = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { const v = g.data[y * g.w + x]; wsum += v; ys += y * v; xs += x * v; }
    return [wsum, ys, xs];
  };
  const [wa, ya, xa] = stats(a), [wb, yb, xb] = stats(b);
  if (wa <= 0 || wb <= 0) return [0, 0];
  const dy = yb / wb - ya / wa, dx2 = xb / wb - xa / wa - dx;
  const pyRound = (v: number) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r; };   // Python's round: half to even
  return [dy - pyRound(dy), dx2 - pyRound(dx2)];
}

/** 3×3 box blur, edge-replicated: absorbs sub-pixel phase before a correlation. */
export function blur3(src: Gray): Gray {
  const { w, h } = src, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) s += src.data[Math.min(h - 1, Math.max(0, y + i)) * w + Math.min(w - 1, Math.max(0, x + j))];
    out[y * w + x] = s / 9;
  }
  return { data: out, w, h };
}

// ── Normalised cross-correlation (ncc_search) ───────────────────────────────

function fft(re: Float64Array, im: Float64Array, inv: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang), half = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + half] * cr - im[i + k + half] * ci, bi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + half] = ar - br; im[i + k + half] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function fft2(re: Float64Array, im: Float64Array, R: number, C: number, inv: boolean): void {
  const rr = new Float64Array(C), ri = new Float64Array(C);
  for (let r = 0; r < R; r++) {
    rr.set(re.subarray(r * C, r * C + C)); ri.set(im.subarray(r * C, r * C + C));
    fft(rr, ri, inv); re.set(rr, r * C); im.set(ri, r * C);
  }
  const cr = new Float64Array(R), ci = new Float64Array(R);
  for (let c = 0; c < C; c++) {
    for (let r = 0; r < R; r++) { cr[r] = re[r * C + c]; ci[r] = im[r * C + c]; }
    fft(cr, ci, inv);
    for (let r = 0; r < R; r++) { re[r * C + c] = cr[r]; im[r * C + c] = ci[r]; }
  }
}
const pow2 = (n: number) => 1 << Math.ceil(Math.log2(n));

/** Normalised cross-correlation of template a at every position inside b:
 *  [corr, dy, dx, corr in place] of the best position relative to the
 *  in-place one (cy, cx); null when a has no contrast. FFT for the sums of
 *  products (padded to powers of two: no wrap in the valid region), integral
 *  images for the window statistics. */
export function nccSearch(a: Gray, b: Gray, cy: number, cx: number): [number, number, number, number] | null {
  const { w, h } = a, { w: W, h: H } = b;
  let mean = 0;
  for (const v of a.data) mean += v;
  mean /= a.data.length;
  const a0 = Float64Array.from(a.data, v => v - mean);
  let na = 0;
  for (const v of a0) na += v * v;
  na = Math.sqrt(na);
  if (na < 1e-6) return null;
  const R = pow2(H), C = pow2(W);
  const br = new Float64Array(R * C), bi = new Float64Array(R * C), ar = new Float64Array(R * C), ai = new Float64Array(R * C);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) br[y * C + x] = b.data[y * W + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ar[y * C + x] = a0[y * w + x];
  fft2(br, bi, R, C, false); fft2(ar, ai, R, C, false);
  for (let i = 0; i < R * C; i++) { const re = br[i] * ar[i] + bi[i] * ai[i], im = bi[i] * ar[i] - br[i] * ai[i]; br[i] = re; bi[i] = im; }
  fft2(br, bi, R, C, true);
  const ii = new Float64Array((H + 1) * (W + 1)), ii2 = new Float64Array((H + 1) * (W + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = b.data[y * W + x], o = (y + 1) * (W + 1) + x + 1;
    ii[o] = v + ii[o - 1] + ii[o - W - 1] - ii[o - W - 2];
    ii2[o] = v * v + ii2[o - 1] + ii2[o - W - 1] - ii2[o - W - 2];
  }
  const oh = H - h + 1, ow = W - w + 1, at = (t: Float64Array, y: number, x: number) => t[y * (W + 1) + x];
  cy = Math.min(Math.max(cy, 0), oh - 1); cx = Math.min(Math.max(cx, 0), ow - 1);
  let bestK = 0, bestV = -Infinity, inPlace = 0;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const S1 = at(ii, y + h, x + w) - at(ii, y, x + w) - at(ii, y + h, x) + at(ii, y, x);
    const S2 = at(ii2, y + h, x + w) - at(ii2, y, x + w) - at(ii2, y + h, x) + at(ii2, y, x);
    const v = Math.max(S2 - (S1 * S1) / (h * w), 1e-6);
    const c = v < 1e-3 ? 0 : br[y * C + x] / (na * Math.sqrt(v));
    if (y === cy && x === cx) inPlace = c;
    const score = c - 1e-3 * (Math.abs(y - cy) + Math.abs(x - cx));        // nearest of equals
    if (score > bestV) { bestV = score; bestK = y * ow + x; }
  }
  const dy = Math.floor(bestK / ow), dx = bestK % ow;
  // the correlation at the best position, recomputed as above
  const S1 = at(ii, dy + h, dx + w) - at(ii, dy, dx + w) - at(ii, dy + h, dx) + at(ii, dy, dx);
  const S2 = at(ii2, dy + h, dx + w) - at(ii2, dy, dx + w) - at(ii2, dy + h, dx) + at(ii2, dy, dx);
  const v = Math.max(S2 - (S1 * S1) / (h * w), 1e-6);
  return [v < 1e-3 ? 0 : br[dy * C + dx] / (na * Math.sqrt(v)), dy - cy, dx - cx, inPlace];
}
