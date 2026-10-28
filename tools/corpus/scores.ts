// SPDX-License-Identifier: AGPL-3.0-or-later
// The scores of a paper (its metrics.json "scores"), from the line alignment
// (linematch.ts) and the glyphs of both sides. No file access, no MuPDF, so the
// unit tests can use it on made-up lines.
//
//   placement  the headline: the share of TeX's glyphs that are in a matched
//              line and within TOL (0.092 pt) along it, once the line is set on
//              TeX's baseline (each glyph of TeX's paired with at most one of
//              the browser's). Glyphs in lines without a partner count as
//              wrong, so lost or rebroken content costs; a vertical offset does
//              not.
//   vertical   the gaps between consecutive matched lines, and the one before
//              the first (against dy 0, the top of both): a gap is right when dy
//              (TeX − browser) changes across it by at most TOL. A jump counts
//              once, where it happens, however much follows it.
//   absolute   vector-compare's own measure (TeX's glyphs with a browser glyph
//              within TOL in both x and y, glyph by glyph in absolute
//              position), recomputed from dom.json with the same matching: one
//              offset near the top makes every glyph after it wrong. Kept for
//              reference.
import type { Line, LineResult } from './linematch.ts';

export const TOL = 0.092;
/** vector-compare's window: a browser glyph pairs with a strip glyph closer than this */
export const WINDOW = 0.7;

/** how many of a's positions pair one to one with b's within tol (both sorted;
 *  the greedy merge is a largest such pairing) */
export function pairedWithin(a: number[], b: number[], tol = TOL): number {
  let i = 0, j = 0, hit = 0;
  while (i < a.length && j < b.length) {
    if (Math.abs(a[i] - b[j]) <= tol) { hit++; i++; j++; } else if (a[i] < b[j]) i++; else j++;
  }
  return hit;
}

export interface Placement {
  share: number; placed: number; tex_glyphs: number;
  tex_glyphs_in_matched_lines: number; tex_glyphs_in_unmatched_lines: number; browser_glyphs_in_unmatched_lines: number;
  matched_lines: number; tex_lines: number; browser_lines: number;
}

/** placement from the alignment: viewer and strip are the lines matchLines was given */
export function placement(viewer: Line[], strip: Line[], r: LineResult, tol = TOL): Placement {
  const byY = new Map(strip.map(l => [l.y, l] as const));
  const texGlyphs = strip.reduce((a, l) => a + l.xs.length, 0);
  let placed = 0, inMatched = 0, viewerUnmatched = 0;
  r.lines.forEach((m, i) => {
    const s = m.strip_y === null ? undefined : byY.get(m.strip_y);
    if (!s) { viewerUnmatched += viewer[i].xs.length; return; }
    inMatched += s.xs.length;
    placed += pairedWithin(viewer[i].xs, s.xs, tol);
  });
  return { share: round(placed / Math.max(1, texGlyphs), 5), placed, tex_glyphs: texGlyphs,
    tex_glyphs_in_matched_lines: inMatched, tex_glyphs_in_unmatched_lines: texGlyphs - inMatched, browser_glyphs_in_unmatched_lines: viewerUnmatched,
    matched_lines: r.matched_lines, tex_lines: strip.length, browser_lines: viewer.length };
}

export interface Jump { viewer_y: number; strip_y: number; dy_before: number; dy_after: number; change: number; text: string; at_start?: true }
export interface Vertical { gaps: number; right: number; share_right: number; jumps: number; sum_abs_pt: number; max_abs_pt: number; dy_at_end: number | null; largest: Jump[] }

/** the vertical errors: each gap between consecutive matched lines (and the
 *  one before the first, from dy 0) whose dy changes by more than tol */
export function vertical(r: LineResult, tol = TOL, keep = 10): Vertical {
  const all: Jump[] = [];
  let prev = 0, gaps = 0, first = true;
  for (const m of r.lines) {
    if (m.dy === null) continue;
    gaps++;
    const change = round(m.dy - prev, 3);
    if (Math.abs(change) > tol)
      all.push({ viewer_y: m.viewer_y, strip_y: m.strip_y!, dy_before: prev, dy_after: m.dy, change, text: m.text, ...(first ? { at_start: true as const } : {}) });
    prev = m.dy;
    first = false;
  }
  const abs = all.map(j => Math.abs(j.change));
  return { gaps, right: gaps - all.length, share_right: round((gaps - all.length) / Math.max(1, gaps), 5), jumps: all.length,
    sum_abs_pt: round(abs.reduce((a, x) => a + x, 0), 3), max_abs_pt: round(abs.reduce((a, x) => Math.max(a, x), 0), 3),
    dy_at_end: gaps ? prev : null, largest: [...all].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, keep) };
}

export interface Absolute { share: number; share_0_05: number; tex_glyphs: number; drawn: number; matched: number; missing: number; extra: number }

/** vector-compare.ts's glyph matching (each browser glyph to the nearest strip
 *  glyph within the window, by |dx| + |dy|, |dx| and |dy| under it), and the
 *  share of TeX's glyphs within tol in both; points in the strip's frame */
export function absolute(viewer: { x: number; y: number }[], strip: [number, number][], tol = TOL, win = WINDOW): Absolute {
  const order = strip.map((_, i) => i).sort((a, b) => strip[a][1] - strip[b][1]);
  const ys = order.map(i => strip[i][1]);
  const lo = (y: number) => { let a = 0, b = ys.length; while (a < b) { const h = (a + b) >> 1; if (ys[h] < y) a = h + 1; else b = h; } return a; };
  const taken = new Set<number>();
  let matched = 0, within = 0, within05 = 0;
  for (const g of viewer) {
    let best = -1, bestD = Infinity;
    for (let c = lo(g.y - win), hi = lo(g.y + win); c < hi; c++) {
      const i = order[c], dx = Math.abs(strip[i][0] - g.x), dy = Math.abs(strip[i][1] - g.y);
      if (dx < win && dx + dy < bestD) { bestD = dx + dy; best = i; }
    }
    if (best < 0) continue;
    matched++;
    taken.add(best);
    const d = Math.max(Math.abs(round(strip[best][0] - g.x, 3)), Math.abs(round(strip[best][1] - g.y, 3)));
    if (d <= tol) within++;
    if (d <= 0.05) within05++;
  }
  const n = Math.max(1, strip.length);
  return { share: round(within / n, 5), share_0_05: round(within05 / n, 5), tex_glyphs: strip.length, drawn: viewer.length, matched,
    missing: strip.length - taken.size, extra: viewer.length - matched };
}

export interface Scores { tolerance: number; placement: Placement; vertical: Vertical; absolute: Absolute }

export function scoresOf(viewer: Line[], strip: Line[], r: LineResult, abs: Absolute, tol = TOL): Scores {
  return { tolerance: tol, placement: placement(viewer, strip, r, tol), vertical: vertical(r, tol), absolute: abs };
}

function round(x: number, d: number): number { const k = 10 ** d; return Math.round(x * k) / k; }
