// SPDX-License-Identifier: AGPL-3.0-or-later
// The browser's lines paired with TeX's (lines.ts), as an order-preserving
// alignment. No file access and no MuPDF, so the unit tests can use it on
// lines made up for them.
//
// Both sides are lists of lines in reading order (sorted by y). A pair (browser
// line i, strip line j) is allowed when the glyphs' x positions overlap by at
// least 0.8 (overlap(), within 0.7 pt, vector-compare's window), and the pairs
// never cross: i < i' ⇔ j < j'. Of all such alignments the cheapest is taken:
//
//   - a pair costs its text dissimilarity, 1 − overlap (0 … 0.2);
//   - a change of dy (strip − browser y) from the pair before it by more than
//     0.05 pt costs STEP, plus STEP_GRADE · min(|change|, 75 pt) / 75 pt: a step is
//     allowed, but a continuous dy is preferred, and a small step to a large one;
//   - a line left without a partner, on either side, costs GAP.
//
// A block of two or more lines really displaced and back keeps its pairs: two
// steps (at most 2 · 1.9) cost less than leaving each of its lines unpaired on
// both sides (2 · GAP a line). A single line does when it is displaced by less
// than about 30 pt; one paired further away and back is nearly always a
// coincidence in a paragraph broken differently (a one-glyph line, a URL line of
// the next entry), and is left unpaired, the net step reported once.
//
// A short line ('1950.') with an identical twin hundreds of points away cannot
// reach it without crossing the pairs around it, or skipping every strip
// line in between at GAP each, so it stays with its own partner, or unpaired.
//
// The search is a Viterbi pass over the browser lines. A state is the last pair
// made (its strip line j and its dy) with the cost so far; a browser line either
// opens a state for each candidate strip line, from the cheapest earlier state
// with a smaller j, or is skipped (every state pays GAP). A state is dropped once
// another with j' ≤ j is cheaper by at least the largest step cost, counting the
// strip lines that the other may still pair (it can do anything this one can, at
// no more cost), or once it is more than MARGIN above the cheapest (a beam).
// Candidates for line i are the strip lines within ±300 pt of where each live
// state puts it (the band follows the running dy); only when none of those
// overlap enough, and the line has at least 8 glyphs, is the rest of the strip
// searched (a shift past the band, after content lost or gained).
export interface Line { y: number; xs: number[]; text: string }
export interface LineMatch { viewer_y: number; strip_y: number | null; dy: number | null; glyphs: number; score: number; text: string;
  /** with the line matched: its glyphs paired with TeX's by nearest x (within 0.7 pt), the largest |dx| and how many are beyond 0.092 pt */
  max_dx?: number; beyond?: number; paired?: number }
export interface Step { viewer_y: number; strip_y: number; dy_before: number; dy_after: number; change: number; text: string }
export interface LineResult { lines: LineMatch[]; steps: Step[]; unmatched_viewer: number; unmatched_strip: number; matched_lines: number }

export const GAP = 1, STEP = 0.4, STEP_GRADE = 1.5, GRADE_TO = 75, MIN_OVERLAP = 0.8, BAND = 300, WIDE_MIN_GLYPHS = 8;
/** a change of dy below this is no step (the steps list's own threshold) */
export const STEP_TOL = 0.05;
const MARGIN = 20, MAX_STATES = 256;

/** glyphs whose y differ by at most this from the previous one (in order of y) share a baseline */
export const LINE_GAP = 0.02;

/** points sharing a baseline: sorted by y, a new line where y moves on by more
 *  than LINE_GAP from the glyph before (rounding y would split a baseline at
 *  2281.134 and 2281.136 in two); a line's y is its glyphs' mean, to 0.01 pt,
 *  and its x positions are sorted */
export function group(points: { x: number; y: number; text?: string }[]): Line[] {
  const sorted = [...points].sort((a, b) => a.y - b.y);
  const runs: { x: number; y: number; text?: string }[][] = [];
  let prev = -Infinity;
  for (const p of sorted) {
    if (p.y - prev > LINE_GAP) runs.push([]);
    runs[runs.length - 1].push(p);
    prev = p.y;
  }
  return runs.map(g => {
    const y = Math.round(g.reduce((a, p) => a + p.y, 0) / g.length * 100) / 100;
    g.sort((a, b) => a.x - b.x);
    return { y, xs: g.map(q => q.x), text: g.map(q => q.text ?? '').join('').slice(0, 70) };
  });
}

/** the share of a's x positions with one of b's within tol (both sorted) */
export function overlap(a: number[], b: number[], tol = 0.7): number {
  let i = 0, j = 0, hit = 0;
  while (i < a.length && j < b.length) {
    if (Math.abs(a[i] - b[j]) <= tol) { hit++; i++; j++; } else if (a[i] < b[j]) i++; else j++;
  }
  return hit / Math.max(a.length, b.length);
}

/** each of a's x positions against the nearest of b's (sorted), b − a, within 0.7 pt */
export function pairDx(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (const x of a) {
    while (j + 1 < b.length && Math.abs(b[j + 1] - x) <= Math.abs(b[j] - x)) j++;
    if (b.length && Math.abs(b[j] - x) <= 0.7) out.push(b[j] - x);
  }
  return out;
}

/** the cost of dy changing from prev to dy (no cost for the first pair) */
export function stepCost(prev: number | null, dy: number): number {
  if (prev === null) return 0;
  const d = Math.abs(dy - prev);
  return d <= STEP_TOL ? 0 : STEP + STEP_GRADE * Math.min(d, GRADE_TO) / GRADE_TO;
}

interface State { j: number; dy: number | null; cost: number; i: number; parent: State | null }

/** for each browser line, the index of its strip line or null, and the best overlap seen for it */
export function align(viewer: Line[], strip: Line[]): { pair: (number | null)[]; score: number[] } {
  const m = strip.length, ys = strip.map(l => l.y);
  const lo = (y: number) => { let a = 0, b = m; while (a < b) { const h = (a + b) >> 1; if (ys[h] < y) a = h + 1; else b = h; } return a; };
  const smax = STEP + STEP_GRADE;
  // the cost if nothing more is paired: every strip line after j unpaired
  const rest = (s: State) => s.cost + GAP * (m - 1 - s.j);
  let live: State[] = [{ j: -1, dy: null, cost: 0, i: -1, parent: null }];
  const score = viewer.map(() => 0);
  const seen = new Uint32Array(m);   // the line (+1) a strip line was last tried for
  viewer.forEach((l, i) => {
    const minJ = live.reduce((a, s) => Math.min(a, s.j), Infinity);
    const cands: { j: number; ov: number }[] = [];
    const tryLine = (k: number) => {
      if (k <= minJ || seen[k] === i + 1) return;
      seen[k] = i + 1;
      const ov = overlap(l.xs, strip[k].xs);
      if (ov > score[i]) score[i] = ov;
      if (ov >= MIN_OVERLAP) cands.push({ j: k, ov });
    };
    for (const s of live) {
      const at = l.y + (s.dy ?? 0);
      for (let k = lo(at - BAND); k < m && ys[k] <= at + BAND; k++) tryLine(k);
    }
    if (!cands.length && l.xs.length >= WIDE_MIN_GLYPHS)
      for (let k = Math.max(0, minJ + 1); k < m; k++) {
        const n = strip[k].xs.length;
        if (Math.min(n, l.xs.length) >= MIN_OVERLAP * Math.max(n, l.xs.length)) tryLine(k);
      }
    const born: State[] = [];
    for (const { j, ov } of cands) {
      const dy = ys[j] - l.y;
      let from: State | null = null, best = Infinity;
      for (const s of live) {
        if (s.j >= j) continue;
        const c = s.cost + GAP * (j - s.j - 1) + stepCost(s.dy, dy);
        if (c < best) { best = c; from = s; }
      }
      if (from) born.push({ j, dy, cost: best + (1 - ov), i, parent: from });
    }
    for (const s of live) s.cost += GAP;   // browser line i unpaired
    // drop the states another one with j' ≤ j makes needless, and those more
    // than MARGIN above the cheapest (a beam: a path that far behind does not
    // come back on these documents)
    const all = [...live, ...born].sort((a, b) => a.j - b.j || rest(a) - rest(b));
    const best = all.reduce((a, s) => Math.min(a, rest(s)), Infinity);
    const kept: State[] = [];
    let floor = Infinity;
    for (const s of all) {
      const r = rest(s);
      if (r >= floor + smax || r > best + MARGIN) continue;
      kept.push(s);
      floor = Math.min(floor, r);
    }
    live = kept.length > MAX_STATES ? kept.sort((a, b) => rest(a) - rest(b)).slice(0, MAX_STATES) : kept;
  });
  const pair: (number | null)[] = viewer.map(() => null);
  let end = live.reduce((a, s) => (rest(s) < rest(a) ? s : a));
  for (let s: State | null = end; s && s.i >= 0; s = s.parent) pair[s.i] = s.j;
  return { pair, score };
}

/** the browser's lines matched to the strip's, the steps between consecutive matched lines */
export function matchLines(viewer: Line[], strip: Line[]): LineResult {
  const { pair, score } = align(viewer, strip);
  const r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
  const lines: LineMatch[] = viewer.map((l, i) => {
    const j = pair[i];
    if (j === null) return { viewer_y: l.y, strip_y: null, dy: null, glyphs: l.xs.length, score: r2(score[i]), text: l.text };
    const s = strip[j], dxs = pairDx(l.xs, s.xs);
    return { viewer_y: l.y, strip_y: s.y, dy: r3(s.y - l.y), glyphs: l.xs.length, score: r2(overlap(l.xs, s.xs)), text: l.text,
      max_dx: r3(dxs.reduce((a, d) => Math.max(a, Math.abs(d)), 0)), beyond: dxs.filter(d => Math.abs(d) > 0.092).length, paired: dxs.length };
  });
  const steps = stepsOf(lines);
  const matched = lines.filter(l => l.dy !== null).length;
  return { lines, steps, unmatched_viewer: lines.length - matched, unmatched_strip: strip.length - matched, matched_lines: matched };
}

/** where dy changes between consecutive matched lines by more than 0.05 pt */
export function stepsOf(lines: LineMatch[]): Step[] {
  const steps: Step[] = [];
  let prev: LineMatch | null = null;
  for (const m of lines) {
    if (m.dy === null) continue;
    if (prev && Math.abs(m.dy - prev.dy!) > STEP_TOL)
      steps.push({ viewer_y: m.viewer_y, strip_y: m.strip_y!, dy_before: prev.dy!, dy_after: m.dy, change: Math.round((m.dy - prev.dy!) * 1000) / 1000, text: m.text });
    prev = m;
  }
  return steps;
}
