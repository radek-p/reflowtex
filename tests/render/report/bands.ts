// SPDX-License-Identifier: AGPL-3.0-or-later
// The report page's bands: a long document's two sides, cut across so that
// the page draws only what is near the view (app.ts). A strip.svg of a
// hundred pages is hundreds of thousands of elements, and a comparison can
// have as many boxes; drawn whole, the browser parses, styles and lays out
// them all before it shows any.
//
// Both are cut into bands of BAND_PT, in the stage's pt (from the top of the
// strip, as vector-compare.ts measures). An element goes to the band its top
// is in, and is drawn once, where it is; each band knows how far down its
// content reaches, so that a band is drawn while any of it is near the view.
// Pure functions, no DOM: app.ts draws them; tests/unit tests them.

/** strip.svg and viewer.png are drawn 2 px per pt (vector-compare.ts). */
export const PX_PER_PT = 2;
/** A band's height, in pt. */
export const BAND_PT = 500;

/** The bands (BAND_PT each; `bottom`: how far down each one's content
 *  reaches) with something in y0..y1 (pt). */
export function bandsIn(bottom: number[], y0: number, y1: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < bottom.length && k * BAND_PT <= y1; k++) if (bottom[k] >= y0) out.push(k);
    return out;
}

// ── Boxes ────────────────────────────────────────────────────────────────────
/** A box in pt. */
export interface Box { x: number; y: number; w: number; h: number }
/** One side's boxes in bands, by their top: each band's items (their indices,
 *  in order), how far down each band's boxes reach, and each item's band (-1:
 *  none on this side). */
export interface BoxIndex { bands: number[][]; bottom: number[]; bandOf: Int32Array }
/** `boxes`: one side's box of each item, or none. (2 pt either way: the
 *  room report draws round a box.) */
export function indexBoxes(boxes: (Box | undefined)[]): BoxIndex {
    const ix: BoxIndex = { bands: [], bottom: [], bandOf: new Int32Array(boxes.length).fill(-1) };
    boxes.forEach((b, i) => {
        if (!b) return;
        const k = Math.max(0, Math.floor((b.y - 2) / BAND_PT));
        while (ix.bands.length <= k) { ix.bands.push([]); ix.bottom.push(-Infinity); }
        ix.bands[k].push(i);
        ix.bottom[k] = Math.max(ix.bottom[k], b.y + Math.max(b.h, 3) + 2);
        ix.bandOf[i] = k;
    });
    return ix;
}

// ── strip.svg ────────────────────────────────────────────────────────────────
// Read as text, not parsed into a document: a scan of its tags. What it
// defines (glyph outlines, clip paths) is kept together and drawn with every
// band; every other element, with the groups it is in, goes to its band. Where
// an element is is read from its transform and its own extent: a path's
// numbers, a glyph's (a <use> of a defined path), a rect's or an image's box.
// What cannot be placed so goes to `always`, drawn with every band.

/** strip.svg, cut: its size in pt (its width and height are 2 px per pt), its
 *  viewBox, its definitions, what has no place that could be told (`always`),
 *  and its bands, top to bottom, with how far down each one reaches (pt). */
export interface Strip { size: [number, number]; viewBox: string; defs: string; always: string; bands: string[]; bottom: number[] }
type Matrix = [number, number, number, number, number, number];
type Extent = [number, number, number, number];
const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const numbers = (s: string): number[] => (s.match(NUM) ?? []).map(Number);
const times = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** A transform attribute as one matrix; null if it has what is not read here. */
function transformOf(t: string | undefined): Matrix | null {
    let m = IDENTITY;
    if (!t) return m;
    for (const [, f, a] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
        const n = numbers(a);
        if (f === 'matrix' && n.length === 6) m = times(m, n as Matrix);
        else if (f === 'translate') m = times(m, [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]);
        else if (f === 'scale') m = times(m, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]);
        else return null;
    }
    return m;
}
/** An attribute's value in a tag. */
const attr = (tag: string, name: string): string | undefined =>
    tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))?.slice(1).find(v => v !== undefined);
/** A path's extent in its own space: every number in it taken for either
 *  axis, which holds all it draws while its commands are absolute (as MuPDF
 *  writes them); null if any is relative. */
function pathExtent(d: string): Extent | null {
    if (/[a-df-z]/.test(d)) return null;
    const n = numbers(d);
    if (!n.length) return null;
    let lo = Infinity, hi = -Infinity;
    for (const x of n) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return [lo, lo, hi, hi];
}
/** An element's extent in its own space, if its tag tells it. */
function ownExtent(name: string, tag: string, defined: Map<string, Extent | null>): Extent | null {
    const n = (a: string) => Number(attr(tag, a) ?? 0);
    if (name === 'path') return pathExtent(attr(tag, 'd') ?? '');
    if (name === 'use') {
        const b = defined.get((attr(tag, 'xlink:href') ?? attr(tag, 'href') ?? '').replace(/^#/, ''));
        return b ? [b[0] + n('x'), b[1] + n('y'), b[2] + n('x'), b[3] + n('y')] : null;
    }
    if (name === 'rect' || name === 'image') return [n('x'), n('y'), n('x') + n('width'), n('y') + n('height')];
    return null;
}
const DEFINES = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'marker', 'linearGradient', 'radialGradient', 'filter', 'style']);
const GROUPS = new Set(['g', 'a', 'switch']);
const TAGS = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([\w:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** strip.svg cut into bands; null if it is not an SVG with a size. */
export function cutStrip(text: string): Strip | null {
    const root = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(text);
    if (!root) return null;
    const w = Number(attr(root[0], 'width')?.replace(/px$/, '')), h = Number(attr(root[0], 'height')?.replace(/px$/, ''));
    const vb = numbers(attr(root[0], 'viewBox') ?? `0 0 ${w} ${h}`);
    if (!(w > 0 && h > 0 && vb.length === 4 && vb[3] > 0)) return null;
    const ptPerUnit = h / PX_PER_PT / vb[3];
    const defined = new Map<string, Extent | null>();
    const defs: string[] = [];
    // the groups met (their tags and transforms), and those open here
    const groups: { tag: string; name: string; m: Matrix | null }[] = [];
    const stack: number[] = [];
    interface Out { parts: string[]; open: number[]; bottom: number }
    const bands: Out[] = [], always: Out = { parts: [], open: [], bottom: Infinity };
    /** A piece into a band, inside the groups open here: the band's own open
     *  groups closed or opened to match first. */
    const put = (into: Out, piece: string) => {
        let k = 0;
        while (k < into.open.length && k < stack.length && into.open[k] === stack[k]) k++;
        while (into.open.length > k) into.parts.push(`</${groups[into.open.pop()!].name}>`);
        for (; k < stack.length; k++) { into.parts.push(groups[stack[k]].tag); into.open.push(stack[k]); }
        into.parts.push(piece);
    };
    const place = (name: string, tag: string, piece: string) => {
        let m: Matrix | null = IDENTITY;
        for (const g of stack) m = m && groups[g].m && times(m, groups[g].m!);
        const own = transformOf(attr(tag, 'transform'));
        m = m && own && times(m, own);
        const e = m && ownExtent(name, tag, defined);
        if (!m || !e) { put(always, piece); return; }
        const ys = [[e[0], e[1]], [e[2], e[1]], [e[0], e[3]], [e[2], e[3]]].map(([x, y]) => m![1] * x + m![3] * y + m![5]);
        // (pt from the strip's top, with room for a stroke)
        const top = (Math.min(...ys) - vb[1]) * ptPerUnit - 2, bottom = (Math.max(...ys) - vb[1]) * ptPerUnit + 2;
        const k = Math.max(0, Math.floor(top / BAND_PT));
        while (bands.length <= k) bands.push({ parts: [], open: [], bottom: -Infinity });
        bands[k].bottom = Math.max(bands[k].bottom, bottom);
        put(bands[k], piece);
    };
    let defining = 0;                                     // how deep in a definition
    let leaf: { name: string; tag: string; depth: number; from: number } | null = null;   // an element with content, taken whole
    const tags = new RegExp(TAGS);
    tags.lastIndex = root.index + root[0].length;
    for (let end = tags.lastIndex, t = tags.exec(text); t; end = tags.lastIndex, t = tags.exec(text)) {
        const [whole, close, name, , self] = t;
        if (defining) defs.push(text.slice(end, t.index));   // (a definition's text, as it is)
        if (leaf) {
            if (name === leaf.name) leaf.depth += close ? -1 : self ? 0 : 1;
            if (!leaf.depth) { place(leaf.name, leaf.tag, text.slice(leaf.from, t.index + whole.length)); leaf = null; }
            continue;
        }
        if (!name) { if (defining) defs.push(whole); continue; }   // a comment, or the like
        if (defining || DEFINES.has(name)) {
            if (name === 'path' && !close) { const id = attr(whole, 'id'); if (id) defined.set(id, pathExtent(attr(whole, 'd') ?? '')); }
            if (close) defining--; else if (!self) defining++;
            if (name !== 'defs') defs.push(whole);
            continue;
        }
        if (name === 'svg' && close) break;
        if (GROUPS.has(name)) {
            if (close) stack.pop();
            else if (!self) { groups.push({ tag: whole, name, m: transformOf(attr(whole, 'transform')) }); stack.push(groups.length - 1); }
            continue;
        }
        if (close) continue;
        if (self) place(name, whole, whole);
        else leaf = { name, tag: whole, depth: 1, from: t.index };
    }
    const done = (b: Out) => { while (b.open.length) b.parts.push(`</${groups[b.open.pop()!].name}>`); return b.parts.join(''); };
    // (joined: new strings, which do not keep the whole text alive)
    return { size: [w / PX_PER_PT, h / PX_PER_PT], viewBox: vb.join(' '), defs: defs.join(''), always: done(always),
             bands: bands.map(done), bottom: bands.map(b => b.bottom) };
}
