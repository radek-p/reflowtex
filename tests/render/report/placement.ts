// SPDX-License-Identifier: AGPL-3.0-or-later
// Placement: what does not match once each of the browser's lines is set on
// the baseline of the TeX line it is paired with. A comparison in absolute
// position (vector-compare.ts's own matching) loses every glyph after one
// vertical offset: a title a few points lower, and the whole document is
// wrong. Here a vertical offset costs nothing where it holds; it is reported
// once, as a jump, where it changes.
//
// The line pairing is lines.json's (beside vector.json, where a build has
// one): for each line of the browser's, in order, the TeX line it pairs with
// (strip_y) and their dy (strip − browser). Within a paired line, each of
// TeX's glyphs pairs with at most one of the browser's within the threshold
// along the line; the rest are off along it, or in the line on one side only.
// Every glyph of a line with no partner is on one side only. Rules: a rule
// is moved by the dy of the line at its height before it is compared.
//
// No DOM here: the report (app.ts) and the unit tests use it.

/** A glyph: its origin (pt, the strip's frame), its advance and size (pt; 0
 *  where not known) and its text. */
export interface Glyph { x: number; y: number; w: number; size: number; text: string }

/** What placement reads of vector.json (vector-compare.ts). */
export interface VectorGlyphs {
    hsize_pt?: number;
    margin_pt?: number;
    /** each of the browser's glyphs with a glyph of TeX's within the window, and how far that is (strip − viewer);
     *  tw, ts: TeX's glyph's advance and size where they differ from the browser's */
    matched?: (Glyph & { font?: string; dx: number; dy: number; tw?: number; ts?: number })[];
    viewer_unmatched?: Glyph[];
    /** (older builds give only x and y) */
    strip_unmatched?: (Pick<Glyph, 'x' | 'y'> & Partial<Glyph>)[];
    rules?: { x?: number; y: number; w?: number; h?: number; unmatched?: boolean; off?: number; dx?: number; dy?: number }[];
    rules_missing?: { x: number; y: number; w?: number; h?: number }[];
}
/** What placement reads of lines.json: each of the browser's lines, in order. */
export interface LineData { lines: { viewer_y: number; strip_y: number | null; dy: number | null; text?: string }[] }

export type Off =
    | { kind: 'along'; viewer: Glyph; strip: Glyph; dx: number }
    | { kind: 'viewer'; viewer: Glyph; lone: boolean }
    | { kind: 'strip'; strip: Glyph; lone: boolean }
    | { kind: 'rule'; viewer: Box; strip: Box; off: number }
    | { kind: 'rule-viewer'; viewer: Box }
    | { kind: 'rule-strip'; strip: Box };
export interface Box { x: number; y: number; w: number; h: number }
/** Where dy changes by more than the threshold between consecutive paired
 *  lines (the first against 0: the tops of both). */
export interface Jump { viewer_y: number; strip_y: number; before: number; after: number; change: number; text: string }
export interface Placement { off: Off[]; jumps: Jump[]; texGlyphs: number; placed: number }

/** vector-compare's window: glyphs further apart are not one glyph off. */
export const WINDOW = 0.7;
/** A rule as far as this from TeX's, once moved by its line's dy, is the same rule, off. */
const RULE_WINDOW = 2;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const key = (y: number) => Math.round(y * 100);

/** The pairs of a's and b's (both sorted by x) within tol, as the greedy merge makes them (a largest such pairing). */
function pairAlong<T extends { x: number }>(a: T[], b: T[], tol: number): { pairs: [T, T][]; a: T[]; b: T[] } {
    const pairs: [T, T][] = [], ra: T[] = [], rb: T[] = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        if (Math.abs(a[i].x - b[j].x) <= tol) pairs.push([a[i++], b[j++]]);
        else if (a[i].x < b[j].x) ra.push(a[i++]);
        else rb.push(b[j++]);
    }
    return { pairs, a: [...ra, ...a.slice(i)], b: [...rb, ...b.slice(j)] };
}

/** TeX's glyphs, as vector.json has them: those a browser glyph matched (once each) and those none did. */
function stripGlyphs(v: VectorGlyphs): Glyph[] {
    const seen = new Set<string>(), out: Glyph[] = [];
    for (const m of v.matched ?? []) {
        const g = { x: r3(m.x + m.dx), y: r3(m.y + m.dy), w: m.tw ?? m.w, size: m.ts ?? m.size, text: m.text };
        const k = `${Math.round(g.x * 100)} ${Math.round(g.y * 100)}`;
        if (!seen.has(k)) { seen.add(k); out.push(g); }
    }
    for (const s of v.strip_unmatched ?? []) out.push({ x: s.x, y: s.y, w: s.w ?? 0, size: s.size ?? 0, text: s.text ?? '' });
    return out;
}

export function placementOf(v: VectorGlyphs, l: LineData, tol: number, ruleTol: number): Placement {
    const off: Off[] = [], jumps: Jump[] = [];
    // the browser's glyphs by baseline, as the lines were made (y to 0.01 pt)
    const viewerBy = new Map<number, Glyph[]>();
    for (const g of [...(v.matched ?? []), ...(v.viewer_unmatched ?? [])]) {
        const k = key(g.y);
        (viewerBy.get(k) ?? viewerBy.set(k, []).get(k)!).push({ x: g.x, y: g.y, w: g.w, size: g.size, text: g.text });
    }
    // TeX's, by the paired line they are on (vector.json's positions are rounded: the nearest within 0.03 pt)
    const strip = stripGlyphs(v);
    const lineYs = [...new Set(l.lines.flatMap(m => (m.strip_y === null ? [] : [m.strip_y])))].sort((a, b) => a - b);
    const stripBy = new Map<number, Glyph[]>(), lone: Glyph[] = [];
    for (const g of strip) {
        let lo = 0, hi = lineYs.length;
        while (lo < hi) { const h = (lo + hi) >> 1; if (lineYs[h] < g.y) lo = h + 1; else hi = h; }
        const near = [lo - 1, lo].filter(i => i >= 0 && i < lineYs.length).sort((a, b) => Math.abs(lineYs[a] - g.y) - Math.abs(lineYs[b] - g.y))[0];
        if (near === undefined || Math.abs(lineYs[near] - g.y) > 0.03) { lone.push(g); continue; }
        const k = key(lineYs[near]);
        (stripBy.get(k) ?? stripBy.set(k, []).get(k)!).push(g);
    }
    let placed = 0, prev = 0;
    const used = new Set<number>(), seenViewer = new Set<number>();
    for (const m of l.lines) {
        const vk = key(m.viewer_y);
        if (seenViewer.has(vk)) continue;
        seenViewer.add(vk);
        const vs = (viewerBy.get(vk) ?? []).sort((a, b) => a.x - b.x);
        if (m.strip_y === null || m.dy === null || used.has(key(m.strip_y))) {
            for (const g of vs) off.push({ kind: 'viewer', viewer: g, lone: true });
            continue;
        }
        const sk = key(m.strip_y);
        used.add(sk);
        const change = r3(m.dy - prev);
        if (Math.abs(change) > tol) jumps.push({ viewer_y: m.viewer_y, strip_y: m.strip_y, before: prev, after: m.dy, change, text: m.text ?? '' });
        prev = m.dy;
        const ss = (stripBy.get(sk) ?? []).sort((a, b) => a.x - b.x);
        const within = pairAlong(vs, ss, tol);
        placed += within.pairs.length;
        // what is left: off along the line (within the window), or on one side only
        const near = pairAlong(within.a, within.b, WINDOW);
        for (const [a, b] of near.pairs)
            off.push({ kind: 'along', viewer: a, strip: { ...b, w: b.w || a.w, size: b.size || a.size, text: b.text || a.text }, dx: r3(b.x - a.x) });
        for (const g of near.a) off.push({ kind: 'viewer', viewer: g, lone: false });
        for (const g of near.b) off.push({ kind: 'strip', strip: g, lone: false });
    }
    for (const [k, gs] of stripBy) if (!used.has(k)) for (const g of gs) off.push({ kind: 'strip', strip: g, lone: true });
    for (const g of lone) off.push({ kind: 'strip', strip: g, lone: true });
    off.push(...placeRules(v, l, ruleTol));
    return { off, jumps, texGlyphs: strip.length, placed };
}

/** The rules, each of the browser's moved by the dy of the paired line at
 *  its height (the nearest above it, else the first): those vector-compare
 *  paired, off by what is left once their move is less that dy; those it did
 *  not, paired again with TeX's left over, corner by corner. */
function placeRules(v: VectorGlyphs, l: LineData, tol: number): Off[] {
    const out: Off[] = [];
    const paired = l.lines.filter(m => m.dy !== null).sort((a, b) => a.viewer_y - b.viewer_y);
    const dyAt = (y: number): number => {
        let lo = 0, hi = paired.length;
        while (lo < hi) { const h = (lo + hi) >> 1; if (paired[h].viewer_y <= y) lo = h + 1; else hi = h; }
        return paired.length ? paired[Math.max(0, lo - 1)].dy! : 0;
    };
    const box = (r: { x?: number; y: number; w?: number; h?: number }): Box => ({ x: r.x ?? 0, y: r.y, w: r.w ?? 1, h: r.h ?? 1 });
    const loose: Box[] = [];
    for (const r of v.rules ?? []) {
        if (r.unmatched) { loose.push(box(r)); continue; }
        const d = dyAt(r.y), dx = r.dx ?? 0, dy = r.dy ?? 0;
        // (the triangle inequality: exact for a rule only moved)
        const o = r3(Math.max(0, (r.off ?? 0) - Math.hypot(dx, dy)) + Math.hypot(dx, dy - d));
        if (o > tol) { const b = box(r); out.push({ kind: 'rule', viewer: b, strip: { ...b, x: b.x + dx, y: b.y + dy }, off: o }); }
    }
    const missing = (v.rules_missing ?? []).map(box).sort((a, b) => a.y - b.y), taken = new Set<number>();
    for (const b of loose) {
        const d = dyAt(b.y), y = b.y + d;
        let best = -1, bestD = Infinity;
        for (let i = 0; i < missing.length; i++) {
            const t = missing[i];
            if (t.y > y + RULE_WINDOW) break;
            if (taken.has(i) || t.y < y - RULE_WINDOW) continue;
            const dist = Math.max(Math.abs(t.x - b.x), Math.abs(t.y - y), Math.abs(t.x + t.w - b.x - b.w), Math.abs(t.y + t.h - y - b.h));
            if (dist < bestD) { bestD = dist; best = i; }
        }
        if (best >= 0 && bestD < RULE_WINDOW) {
            taken.add(best);
            if (bestD > tol) out.push({ kind: 'rule', viewer: b, strip: missing[best], off: r3(bestD) });
        } else out.push({ kind: 'rule-viewer', viewer: b });
    }
    missing.forEach((t, i) => { if (!taken.has(i)) out.push({ kind: 'rule-strip', strip: t }); });
    return out;
}
