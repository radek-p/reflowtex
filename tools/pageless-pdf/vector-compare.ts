#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exact placement: the strip's glyphs and rules against the viewer's.
//
//     node tools/pageless-pdf/vector-compare.ts <build dir | pageless.pdf> <url> [--out DIR] [--margin PT]
//                                               [--window PT] [--line-tol PT] [--wait-log TEXT]
//
// No pixels. MuPDF (in WebAssembly) reads every glyph LuaTeX wrote into the
// strip with its origin (by each font's widths as written: traceStrip), and
// dom-dump.ts every glyph the viewer put on the page (tspan x/y) in the same
// frame: pt from the column's margin edge, pt from the top. Each viewer glyph is matched to the nearest strip glyph (within
// --window; no character matching: a CM glyph's text differs between the two),
// and the residuals say where the viewer's geometry departs from TeX's, to a
// hundredth of a point:
//
//  - vertical: after aligning the two at the top, the browser's height as a
//    function of position (a drift: its stacking loses or gains height);
//  - horizontal: per text line, the offset at its start (protrusion,
//    indentation) and the slope along it (a glue or expansion ratio that
//    differs from TeX's);
//  - rules: the viewer's rects against the strip's rules, corner by corner, at
//    any angle.
//
// Writes vector.json (every matched glyph's residual, the per-line table, the
// rule table) and prints the lines that are off. Run it before compare.ts:
// what it reports is geometry, not rasterisation.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as mupdf from 'mupdf';
import { dumpDom, type Dom } from './dom-dump.ts';
import { rasterBand } from './raster.ts';
import { Outline, filledRule, strokedRule, type Affine, type Pt } from './shapes.ts';

const PT_PER_BP = 72.27 / 72;

/** The names MuPDF gives the PDF's fonts that number their glyphs from a
 *  .notdef at 0 – every kind but Type 3, whose glyphs are numbered by their
 *  codes: by /BaseFont, the Type 0 font's and its descendant's. */
function notdefFonts(doc: mupdf.Document): Set<string> {
  const names = new Set<string>(), pdf = doc.asPDF();
  if (!pdf) return names;
  for (let i = 1; i < pdf.countObjects(); i++) {
    const o = pdf.newIndirect(i).resolve();
    if (!o.isDictionary() || !o.get('Type').isName() || o.get('Type').asName() !== 'Font') continue;
    const sub = o.get('Subtype'), base = o.get('BaseFont');
    if (sub.isName() && sub.asName() !== 'Type3' && base.isName()) names.add(base.asName());
  }
  return names;
}

/** How much finer than its widths a simple font's widths are read: see
 *  traceStrip. */
const WIDTH_SCALE = 1000;

/** The PDF opened with every simple font's widths (/Widths, a Type 1, TrueType
 *  or Type 3 font's) times `k`. */
function withWidths(bytes: Buffer, k: number): mupdf.Document {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf'), pdf = doc.asPDF();
  const done = new Set<number>();      // an array that two fonts share is scaled once
  if (pdf) for (let i = 1; i < pdf.countObjects(); i++) {
    const o = pdf.newIndirect(i).resolve();
    if (!o.isDictionary()) continue;
    const w = o.get('Widths');
    if (!w.isArray()) continue;
    if (w.isIndirect()) { if (done.has(w.asIndirect())) continue; done.add(w.asIndirect()); }
    const a = w.resolve();
    for (let j = 0; j < a.length; j++) a.put(j, a.get(j).asNumber() * k);
  }
  return doc;
}

/** The strip's glyph origins (pt, y down; a ligature's text-only characters
 *  left out) and its rules as four corners each. A font's .notdef is left
 *  out too: what the PDF shows for a character the font lacks (luaotfload
 *  sets it after each one TeX reports missing), it is no character's glyph,
 *  and the page draws nothing there.
 *
 *  MuPDF keeps a simple font's widths as whole thousandths of an em, and moves
 *  the pen by them; LuaTeX writes them to a tenth (a TFM width: 444.5 for
 *  Latin Modern's e) and places each glyph by the exact one. Read as they are,
 *  a line of a Type 1 font gains up to half a thousandth of an em at each
 *  glyph, 0.1 to 0.3 pt by its end. A glyph's origin is affine in the widths
 *  before it, so the strip is read twice: with every width 0, where the pen
 *  moves alone put each glyph, and with every width WIDTH_SCALE times its own,
 *  whole and exact; the origin with the widths as written is the first plus
 *  1/WIDTH_SCALE of the way to the second. */
export function traceStrip(pdf: string): { glyphs: Pt[]; rules: Pt[][] } {
  const bytes = readFileSync(pdf);
  const moves = withWidths(bytes, 0), scaled = withWidths(bytes, WIDTH_SCALE), notdef = notdefFonts(moves);
  const rules: Pt[][] = [];
  // the device's matrix (bp, y down) taken on to pt
  const toPt = (m: mupdf.Matrix): Affine => m.map(v => v * PT_PER_BP) as Affine;
  const outline = (path: mupdf.Path) => { const o = new Outline(); path.walk(o); return o; };
  // every glyph shown, in order, and whether it is one to count
  const trace = (doc: mupdf.Document, shapes: boolean): { at: Pt; counted: boolean }[] => {
    const shown: { at: Pt; counted: boolean }[] = [];
    const device = new mupdf.Device({
      fillText(text: mupdf.Text, ctm: mupdf.Matrix) {
        const m = toPt(ctm);
        text.walk({
          showGlyph(font: mupdf.Font, trm: mupdf.Matrix, gid: number) {
            shown.push({ at: [m[0] * trm[4] + m[2] * trm[5] + m[4], m[1] * trm[4] + m[3] * trm[5] + m[5]],
                         counted: !(gid < 0 || (gid === 0 && notdef.has(font.getName()))) });
          },
        });
      },
      // LuaTeX strokes a rule along its centre line, lw thick, under \rotatebox
      // through a rotating transform; a picture's straight lines and
      // four-cornered fills are the same shapes, and count as the viewer's do
      // (shapes.ts).
      strokePath(path: mupdf.Path, stroke: mupdf.StrokeState, ctm: mupdf.Matrix) {
        if (!shapes) return;
        const r = strokedRule(outline(path), stroke.getLineWidth(), stroke.getLineCap() !== 0, toPt(ctm));
        if (r) rules.push(r);
      },
      fillPath(path: mupdf.Path, _evenOdd: boolean, ctm: mupdf.Matrix) {
        if (!shapes) return;
        const r = filledRule(outline(path), toPt(ctm));
        if (r) rules.push(r);
      },
    });
    doc.loadPage(0).run(device, mupdf.Matrix.identity);
    device.close();
    return shown;
  };
  const at0 = trace(moves, true), atK = trace(scaled, false);
  if (at0.length !== atK.length) throw new Error(`${pdf}: ${at0.length} glyphs, but ${atK.length} with its widths scaled`);
  const glyphs = at0.flatMap(({ at: [x, y], counted }, i): Pt[] => {
    const [xk, yk] = atK[i].at;
    return counted ? [[x + (xk - x) / WIDTH_SCALE, y + (yk - y) / WIDTH_SCALE]] : [];
  });
  return { glyphs, rules };
}

/** The strip as SVG: MuPDF's drawing of it, vectors throughout (text as its
 *  glyphs' outlines), so it is sharp at any zoom. Its viewBox is in bp; its size
 *  is given as 2 px per TeX pt, as viewer.png's is. */
export function stripSvg(pdf: string): string {
  const page = mupdf.Document.openDocument(readFileSync(pdf), 'application/pdf').loadPage(0);
  const [x0, y0, x1, y1] = page.getBounds();
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, 'svg', 'text=path');
  page.run(writer.beginPage([x0, y0, x1, y1]), mupdf.Matrix.identity);
  writer.endPage();
  writer.close();
  const px = (bp: number) => (bp * PT_PER_BP * 2).toFixed(3);
  return buf.asString().replace(/(<svg\b[^>]*?) width="[^"]*" height="[^"]*"/, `$1 width="${px(x1 - x0)}" height="${px(y1 - y0)}"`);
}

// ── numpy's few operations ──────────────────────────────────────────────────
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
/** the largest of a list of any length (Math.max(...a) overflows the stack past about 120 000) */
const maxOf = (a: number[]) => a.reduce((m, x) => Math.max(m, x), -Infinity);
/** first index i with s[i] >= v (numpy.searchsorted, side='left') */
const searchsorted = (s: number[], v: number) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo; };
/** the slope of the least-squares line (numpy.polyfit(x, y, 1)[0]) */
const slopeOf = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let n = 0, d = 0; x.forEach((xi, i) => { n += (xi - mx) * (y[i] - my); d += (xi - mx) ** 2; }); return n / d; };
const round = (x: number, k: number) => Math.round(x * 10 ** k) / 10 ** k;

/** `images`: also strip.svg (the PDF, drawn by MuPDF as vectors, text as outlines) and
 *  viewer.png (the page), in the one frame and both sized 2 px per pt, for
 *  tests/render/report. */
export interface CompareOptions { out?: string; margin?: number; window?: number; lineTol?: number; waitLog?: string; images?: boolean; log?: (s: string) => void }

export async function vectorCompare(build: string, url: string, o: CompareOptions = {}): Promise<Record<string, unknown>> {
  const log = o.log ?? (s => console.log(s));
  const win = o.window ?? 0.7, lineTol = o.lineTol ?? 0.1;
  const pdf = existsSync(build) && statSync(build).isDirectory() ? join(build, 'pageless.pdf') : build;
  const meta = JSON.parse(readFileSync(join(dirname(pdf), 'pageless.json'), 'utf8'));
  const sp = meta.sp_per_pt, hsize = meta.hsize / sp, stripMargin = meta.margin / sp;
  const margin = o.margin ?? stripMargin;
  const out = o.out ?? join(dirname(pdf), 'vector');
  mkdirSync(out, { recursive: true });

  const { glyphs: P, rules } = traceStrip(pdf);
  const dom: Dom = await dumpDom(url, { hsize, margin, waitLog: o.waitLog, screenshot: o.images ? join(out, 'viewer.png') : undefined, log });
  if (o.images) writeFileSync(join(out, 'strip.svg'), stripSvg(pdf));
  writeFileSync(join(out, 'dom.json'), JSON.stringify(dom));
  const G = dom.glyphs;
  log(`strip: ${P.length} glyphs, ${rules.length} rules; viewer: ${G.length} glyphs, ${dom.rects.length} rects`);

  // the viewer's frame starts `margin` left of the column; the strip's `stripMargin`
  const shift = stripMargin - margin;
  const D = G.map(g => [g.x + shift, g.y] as Pt);
  const order = P.map((_, i) => i).sort((a, b) => P[a][1] - P[b][1]);
  const Py = order.map(i => P[i][1]);
  const matched: [number, number, number, number][] = [];            // (dom index, strip index, dx, dy), strip − viewer
  G.forEach((g, j) => {
    if (!g.text.trim()) return;
    const ty = D[j][1];
    const lo = searchsorted(Py, ty - win), hi = searchsorted(Py, ty + win);
    let best = -1, bestD = Infinity;
    for (let c = lo; c < hi; c++) {
      const i = order[c], dx = Math.abs(P[i][0] - D[j][0]), dy = Math.abs(P[i][1] - D[j][1]);
      if (dx < win && dx + dy < bestD) { bestD = dx + dy; best = i; }
    }
    if (best >= 0) matched.push([j, best, P[best][0] - D[j][0], P[best][1] - D[j][1]]);
  });
  const nInk = G.filter(g => g.text.trim()).length;
  log(`matched ${matched.length} of ${nInk} viewer glyphs within ${win} pt`);
  if (!matched.length) throw new Error('nothing matched: are the two the same document at the same width?');
  const dys = matched.map(m => m[3]), ys = matched.map(m => G[m[0]].y);

  // vertical: the drift, as the median dy per 250 pt of height
  const drift: (number | null)[] = [];
  for (let e0 = 0; e0 < maxOf(ys); e0 += 250) {
    const s = dys.filter((_, k) => ys[k] >= e0 && ys[k] < e0 + 250);
    drift.push(s.length > 10 ? round(median(s), 3) : null);
  }
  const shown = drift.filter(d => d !== null);
  log(`vertical (strip − viewer, pt): mean ${mean(dys).toFixed(3)}, sd ${std(dys).toFixed(3)}, largest ${maxOf(dys.map(Math.abs)).toFixed(3)}; ` +
      `drift per 250 pt: ${JSON.stringify(shown.slice(0, 8))} … ${JSON.stringify(shown.slice(-3))}`);

  // horizontal, per line (glyphs sharing a baseline): offset at the start, slope along it
  const lines = new Map<number, [number, number, string][]>();
  for (const [j, , dx] of matched) {
    const y = round(G[j].y, 2);
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y)!.push([D[j][0], dx, G[j].text]);
  }
  const table = [...lines].sort((a, b) => a[0] - b[0]).map(([y, pts]) => {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const x = pts.map(p => p[0]), dx = pts.map(p => p[1]);
    const slope = pts.length >= 6 && Math.max(...x) - Math.min(...x) > 50 ? slopeOf(x, dx) * 100 : 0;
    return { y, glyphs: pts.length, start_dx: round(dx[0], 3), end_dx: round(dx[dx.length - 1], 3),
             max_abs_dx: round(Math.max(...dx.map(Math.abs)), 3), slope_pt_per_100pt: round(slope, 3), text: pts.map(p => p[2]).join('').slice(0, 60) };
  });
  const off = table.filter(t => t.max_abs_dx > lineTol);
  log(`horizontal: ${table.length} lines, ${off.length} with a glyph off by more than ${lineTol} pt`);
  for (const t of [...off].sort((a, b) => b.max_abs_dx - a.max_abs_dx).slice(0, 25))
    log(`  y ${t.y.toFixed(2).padStart(9)}  start ${t.start_dx.toFixed(2)}  end ${t.end_dx.toFixed(2)}  slope ${t.slope_pt_per_100pt.toFixed(3)}/100pt  ${JSON.stringify(t.text)}`);

  // rules: each viewer rect against the strip rule whose corners are nearest,
  // of those no other rect has taken: a shape drawn twice on both sides
  // (nicematrix strokes its vertical rules twice) pairs copy with copy.
  // `off` is the farthest any corner of either is from the other's nearest
  // corner (pt): position, size and angle in one number; dx/dy the move
  // between their centres (strip − viewer).
  const cornerDistance = (A: Pt[], B: Pt[]) => {
    const near = (p: Pt, Q: Pt[]) => Math.min(...Q.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])));
    return Math.max(Math.max(...A.map(p => near(p, B))), Math.max(...B.map(q => near(q, A))));
  };
  const centre = (Q: Pt[]): Pt => [mean(Q.map(q => q[0])), mean(Q.map(q => q[1]))];
  const centres = rules.map(centre);
  const ruleRows: Record<string, unknown>[] = [], drawn = new Set<number>();
  for (const r of dom.rects) {
    if (r.w <= 0 || r.h <= 0) continue;
    const V = r.pts.map(([x, y]) => [x + shift, y] as Pt);
    const c = centre(V);
    const ptp = Math.max(Math.max(...V.map(v => v[0])) - Math.min(...V.map(v => v[0])), Math.max(...V.map(v => v[1])) - Math.min(...V.map(v => v[1])));
    let bestD = Infinity, k = -1;
    for (let i = 0; i < centres.length; i++) {
      if (drawn.has(i) || Math.max(Math.abs(centres[i][0] - c[0]), Math.abs(centres[i][1] - c[1])) >= 2 + ptp / 2) continue;
      const d = cornerDistance(V, rules[i]);
      if (d < bestD) { bestD = d; k = i; }
    }
    if (k >= 0 && bestD < 2) {
      const d = bestD;
      drawn.add(k);
      ruleRows.push({ y: round(r.y, 2), x: round(r.x + shift, 2), w: round(r.w, 2), h: round(r.h, 2), off: round(d, 3), dx: round(centres[k][0] - c[0], 3), dy: round(centres[k][1] - c[1], 3) });
    } else ruleRows.push({ y: round(r.y, 2), x: round(r.x + shift, 2), unmatched: true, w: round(r.w, 2), h: round(r.h, 2) });
  }
  // and the rules TeX drew that the browser did not
  const missing = rules.map((q, k) => [q, k] as const).filter(([, k]) => !drawn.has(k))
    .map(([q]) => ({ y: round(Math.min(...q.map(p => p[1])), 2), x: round(Math.min(...q.map(p => p[0])), 2),
      w: round(Math.max(...q.map(p => p[0])) - Math.min(...q.map(p => p[0])), 2), h: round(Math.max(...q.map(p => p[1])) - Math.min(...q.map(p => p[1])), 2) }));
  const rm = ruleRows.filter(r => 'dx' in r) as { dx: number; dy: number; off: number; y: number }[];
  if (rm.length) {
    log(`rules: ${rm.length} matched of ${ruleRows.length} drawn, ${missing.length} of TeX's not drawn; strip − viewer x sd ${std(rm.map(r => r.dx)).toFixed(3)}, ` +
        `y sd ${std(rm.map(r => r.dy)).toFixed(3)}, largest corner distance ${Math.max(...rm.map(r => r.off)).toFixed(3)} pt`);
    for (const r of rm.filter(r => r.off > lineTol).sort((a, b) => b.off - a.off).slice(0, 10))
      log(`  rule at y ${r.y.toFixed(2).padStart(9)}: corners ${r.off.toFixed(2)} pt off, centre dx ${r.dx.toFixed(2)} dy ${r.dy.toFixed(2)} pt`);
  }
  const takenViewer = new Set(matched.map(m => m[0])), takenStrip = new Set(matched.map(m => m[1]));
  const result = {
    hsize_pt: hsize, margin_pt: margin, window_pt: win,
    glyphs: { strip: P.length, viewer: nInk, matched: matched.length },
    vertical: { mean: round(mean(dys), 4), sd: round(std(dys), 4), max_abs: round(maxOf(dys.map(Math.abs)), 4), drift_per_250pt: drift },
    lines: table, lines_off: off, rules: ruleRows, rules_missing: missing,
    matched: matched.map(([j, , dx, dy]) => ({ y: round(G[j].y, 2), x: round(D[j][0], 2), text: G[j].text, font: G[j].font, w: round(G[j].w, 2), size: round(G[j].size, 2), dx: round(dx, 3), dy: round(dy, 3) })),
    // what has no partner: the browser's glyphs with no glyph of TeX's near, and TeX's no browser glyph took
    viewer_unmatched: G.map((g, j) => [g, j] as const).filter(([g, j]) => g.text.trim() && !takenViewer.has(j))
      .map(([g, j]) => ({ y: round(g.y, 2), x: round(D[j][0], 2), text: g.text, w: round(g.w, 2), size: round(g.size, 2) })),
    strip_unmatched: P.map((p, i) => [p, i] as const).filter(([, i]) => !takenStrip.has(i)).map(([p]) => ({ x: round(p[0], 2), y: round(p[1], 2) })),
  };
  writeFileSync(join(out, 'vector.json'), JSON.stringify(result, null, 1));
  log(`→ ${join(out, 'vector.json')}`);
  return result;
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, margin: { type: 'string' }, window: { type: 'string', default: '0.7' },
               'line-tol': { type: 'string', default: '0.1' }, 'wait-log': { type: 'string' } },
  });
  if (positionals.length !== 2) { console.error('usage: vector-compare.ts <build dir | pageless.pdf> <url> [--out DIR] [--margin PT] [--window PT] [--line-tol PT] [--wait-log TEXT]'); process.exit(2); }
  try {
    await vectorCompare(positionals[0], positionals[1], { out: v.out, margin: v.margin === undefined ? undefined : Number(v.margin),
      window: Number(v.window), lineTol: Number(v['line-tol']), waitLog: v['wait-log'] });
  } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(1); }
}
