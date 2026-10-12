// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, RUNNING, SP } from './context.js';
import { segParts } from './resolve.js';

// The svg matrices read during a redraw (overlay.js), each once: null between.
export let ctms = null;
export function readingMatrices(on) { ctms = on ? new Map() : null; }
// ── Geometry ───────────────────────────────────────────────────────────────────
// One replay of a segment gives every node's pen position and advance; the
// box extents come from the nodes themselves. Memoised until the next paint.
export const geomMemo = new Map();
export function geometry(sid) {
    const { seg, cache, el, laid, s } = segParts(sid);
    if (!laid || !s || !s.svg) return null;
    const memo = geomMemo.get(sid);
    if (memo && memo.paints === I.paints && memo.laid === laid) return memo;
    const at = new Map(), parent = new Map(), lines = [];
    const link = (list, p) => {
        for (const c of list || []) {
            parent.set(c, p);
            link(c.children, c); link(c.replace, c);
            if (c.leader) parent.set(c.leader, c);
        }
    };
    const ok = I.replay(el, seg.i, {
        line(j, line, x0, y) { lines.push({ line, j, x0, y }); link(line.nodes, line); },
        node(n, x, y, w) { at.set(n, { x, y, w }); },
        vnode(n, x, top, h) { at.set(n, { x, top, h, vertical: true }); },
    }, cache);
    if (!ok) return null;
    const g = { paints: I.paints, laid, svg: s.svg, at, parent, lines, metrics: cache.metrics || [] };
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
export function extentOf(g, n) {
    const k = SP();
    switch (n.type) {
        case 'glyph': {
            const m = n.metrics ? g.metrics[n.metrics - 1] || {} : n;
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
    }
    return null;
}
// A node's rectangle in svg units, or null if it was not drawn on this layout.
export function rectOf(g, n) {
    const p = g.at.get(n);
    if (!p) {
        const L = g.lines.find(L => L.line === n);
        return L ? { x: L.x0, y: L.y - L.h, w: L.x1 - L.x0, h: L.h + L.d, base: L.y } : null;
    }
    const k = SP(), par = g.parent.get(n);
    if (p.vertical) {
        let w = (n.type === 'hlist' || n.type === 'vlist' || (n.type === 'rule' && n.width !== RUNNING))
            ? (n.width || 0) * k : (par && par.width || 0) * k;
        return { x: p.x + (n.shift || 0) * k, y: p.top, w, h: p.h, base: n.type === 'hlist' ? p.top + (n.height || 0) * k : null };
    }
    let e = extentOf(g, n);
    if (!e) {                                      // take the enclosing box's
        if (par && par.nodes) { const L = g.lines.find(L => L.line === par); e = L ? { h: L.h, d: L.d } : { h: 0, d: 0 }; }
        else if (par) {
            const pp = g.at.get(par);
            if (pp && pp.vertical) { const pr = rectOf(g, par); e = { h: pr.base - pr.y, d: pr.y + pr.h - pr.base }; }
            else e = { h: (par.height || 0) * k, d: (par.depth || 0) * k };
        } else e = { h: 0, d: 0 };
    }
    return { x: p.x, y: p.y - e.h, w: p.w, h: e.h + e.d, base: p.y };
}
// svg units → viewport pixels. During a redraw, each svg's matrix is read once.
export function toScreen(svg, r) {
    let m = ctms ? ctms.get(svg) : undefined;
    if (m === undefined) { m = svg.getScreenCTM(); if (ctms) ctms.set(svg, m); }
    if (!m) return null;
    const x1 = m.a * r.x + m.c * r.y + m.e, y1 = m.b * r.x + m.d * r.y + m.f;
    const x2 = m.a * (r.x + r.w) + m.c * (r.y + r.h) + m.e, y2 = m.b * (r.x + r.w) + m.d * (r.y + r.h) + m.f;
    const out = { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    if (r.base != null) out.base = m.b * r.x + m.d * r.base + m.f;
    return out;
}
