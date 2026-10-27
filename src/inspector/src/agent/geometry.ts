// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, RUNNING, SP } from './context.ts';
import { segParts } from './resolve.ts';
import { unreachable } from '../../../shared/unreachable.ts';
import type { GlyphMetrics, TexNode } from '../../../viewer/src/engine/model.ts';
import type { Line, SegmentLayout } from '../../../viewer/src/engine/layout/types.ts';
import { screenCTM } from '../../../viewer/src/runtime/screen-ctm.ts';

/** A node's pen position (svg units): on a line, x, the baseline y and its
 *  advance; in a vertical list, x, its top and its height. */
export type Pen = { x: number; y: number; w: number; vertical?: undefined } | { x: number; top: number; h: number; vertical: true };
/** A line as replayed: where it starts and ends, its baseline, its height and depth. */
export interface GLine { line: Line; j: number; x0: number; y: number; h: number; d: number; x1: number }
/** One replay of a segment (geometry). */
export interface Geometry {
    paints: number;
    laid: SegmentLayout;
    svg: SVGSVGElement;
    at: Map<TexNode, Pen>;
    /** Every node's parent: a box, or the line it is on. */
    parent: Map<TexNode, TexNode | Line>;
    lines: GLine[];
    metrics: GlyphMetrics[];
}
/** A rectangle in svg units, with its baseline. */
export interface SvgRect { x: number; y: number; w: number; h: number; base?: number | null }
/** A rectangle in viewport px, with its baseline. */
export interface ScreenRect { left: number; top: number; width: number; height: number; base?: number }

// The svg matrices read during a redraw (overlay.ts), each once: null between.
let ctms: Map<SVGGraphicsElement, DOMMatrix | null> | null = null;
export function readingMatrices(on: boolean): void { ctms = on ? new Map() : null; }
// ── Geometry ───────────────────────────────────────────────────────────────────
// One replay of a segment gives every node's pen position and advance; the
// box extents come from the nodes themselves. Memoised until the next paint.
const geomMemo = new Map<number, Geometry>();
export function geometry(sid: number): Geometry | null {
    const { seg, cache, el, laid, s } = segParts(sid);
    if (!laid || !s || !s.svg) return null;
    const memo = geomMemo.get(sid);
    if (memo && memo.paints === I.paints && memo.laid === laid) return memo;
    const at = new Map<TexNode, Pen>(), parent = new Map<TexNode, TexNode | Line>(), lines: GLine[] = [];
    const link = (list: TexNode[] | undefined, p: TexNode | Line) => {
        for (const c of list || []) {
            parent.set(c, p);
            link(c.children, c); link(c.replace, c);
            if (c.leader) parent.set(c.leader, c);
        }
    };
    const ok = I.replay(el, seg.i, {
        line(j, line, x0, y) { lines.push({ line, j, x0, y } as GLine); link(line.nodes, line); },
        node(n, x, y, w) { at.set(n, { x, y, w }); },
        vnode(n, x, top, h) { at.set(n, { x, top, h, vertical: true }); },
    }, cache!);
    if (!ok) return null;
    const g: Geometry = { paints: I.paints, laid, svg: s.svg, at, parent, lines, metrics: cache!.metrics || [] };
    for (const L of lines) {                      // a line's extent: its nodes'
        let h = 0, d = 0, x1 = L.x0;
        for (const n of L.line.nodes) {
            const e = extentOf(g, n);
            if (e) { h = Math.max(h, e.h); d = Math.max(d, e.d); }
            const p = at.get(n);
            if (p && !p.vertical) x1 = Math.max(x1, p.x + p.w);
        }
        Object.assign(L, { h, d, x1 });
    }
    geomMemo.set(sid, g);
    return g;
}

// Height and depth (svg units, above/below the pen's baseline) of a node that
// has its own; null for glue, kerns and the like, which take their parent's.
export function extentOf(g: Geometry, n: TexNode): { h: number; d: number } | null {
    const k = SP();
    switch (n.type) {
        case 'glyph': {
            const m: { height?: number; depth?: number } = n.metrics ? g.metrics[n.metrics - 1] || {} : n;
            return { h: (m.height || 0) * k, d: (m.depth || 0) * k };
        }
        case 'hlist': case 'vlist': {
            const sh = n.shift || 0;                  // down, in an hlist
            return { h: ((n.height || 0) - sh) * k, d: ((n.depth || 0) + sh) * k };
        }
        case 'rule':
            if (n.height === RUNNING || n.depth === RUNNING) return null;
            return { h: (n.height || 0) * k, d: (n.depth || 0) * k };
        case 'picture': case 'widget':
            return { h: (n.height || 0) * k, d: (n.depth || 0) * k };
        case 'glue': case 'kern': case 'penalty': case 'math': case 'disc': case 'wdisc': case 'transform': case 'adjust': case 'local_par':
            return null;
        default: return unreachable(n, 'node');
    }
}
// A node's rectangle in svg units, or null if it was not drawn on this layout.
// (A line, given as itself, has its own.)
export function rectOf(g: Geometry, n: TexNode | Line): SvgRect | null {
    const p = g.at.get(n as TexNode);
    if (!p) {
        const L = g.lines.find(L => L.line === n);
        return L ? { x: L.x0, y: L.y - L.h, w: L.x1 - L.x0, h: L.h + L.d, base: L.y } : null;
    }
    const node = n as TexNode;
    const k = SP(), par = g.parent.get(node);
    if (p.vertical) {
        let w = (node.type === 'hlist' || node.type === 'vlist' || (node.type === 'rule' && node.width !== RUNNING))
            ? (node.width || 0) * k : (par && (par as TexNode).width || 0) * k;
        return { x: p.x + (node.shift || 0) * k, y: p.top, w, h: p.h, base: node.type === 'hlist' ? p.top + (node.height || 0) * k : null };
    }
    let e = extentOf(g, node);
    if (!e) {                                      // take the enclosing box's
        if (par && (par as Line).nodes) { const L = g.lines.find(L => L.line === par); e = L ? { h: L.h, d: L.d } : { h: 0, d: 0 }; }
        else if (par) {
            const box = par as TexNode, pp = g.at.get(box);
            if (pp && pp.vertical) { const pr = rectOf(g, box)!; e = { h: pr.base! - pr.y, d: pr.y + pr.h - pr.base! }; }
            else e = { h: (box.height || 0) * k, d: (box.depth || 0) * k };
        } else e = { h: 0, d: 0 };
    }
    return { x: p.x, y: p.y - e.h, w: p.w, h: e.h + e.d, base: p.y };
}
// svg units → viewport pixels. During a redraw, each svg's matrix is read once.
export function toScreen(svg: SVGGraphicsElement, r: SvgRect): ScreenRect | null {
    let m = ctms ? ctms.get(svg) : undefined;
    if (m === undefined) { m = screenCTM(svg); if (ctms) ctms.set(svg, m); }
    if (!m) return null;
    const x1 = m.a * r.x + m.c * r.y + m.e, y1 = m.b * r.x + m.d * r.y + m.f;
    const x2 = m.a * (r.x + r.w) + m.c * (r.y + r.h) + m.e, y2 = m.b * (r.x + r.w) + m.d * (r.y + r.h) + m.f;
    const out: ScreenRect = { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    if (r.base != null) out.base = m.b * r.x + m.d * r.base + m.f;
    return out;
}
