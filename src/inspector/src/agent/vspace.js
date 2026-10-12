// SPDX-License-Identifier: AGPL-3.0-or-later

import { SP } from './context.js';
import { entries, gapId } from './ids.js';
import { rootCache, segParts } from './resolve.js';
import { toScreen } from './geometry.js';
import { GLUE_SUB, glueSpec, maxOf, pt } from './format.js';

// ── Vertical space ─────────────────────────────────────────────────────────────
// What TeX put between two paragraphs, or around a heading or a display: the
// glue on its vertical list, shown as TeX's own items. A vertical space row
// holds the glue the document recorded (the vspace item's `glue`: an
// author's or a heading's skip, \parskip, a display skip) and the interline
// glue, \baselineskip or \lineskip, as it comes out for these lines at this
// width. On the page each is a band, stacked in that order.
//
// Two places hold one: before a segment (between blocks of text, displays,
// streams), and between two paragraphs within a run of text.
// The interline glue between a depth above and a height below, and TeX's name
// for it: \baselineskip unless that would leave less than \lineskiplimit.
export function interline(prevDepth, ascent, lm, px) {
    if (!lm) return { width: px / SP(), subtype: 2 };
    const b = lm.bskip - prevDepth - ascent;
    return { width: px / SP(), subtype: b >= lm.lskiplimit ? 2 : 1,
             rule: { baselineskip: lm.bskip / SP(), lineskip: lm.lskip / SP(), lineskiplimit: lm.lskiplimit / SP(),
                     depthAbove: prevDepth / SP(), heightBelow: ascent / SP() } };
}
// The parts of a gap, in TeX's order, each { n: a glue- or kern-like node,
// interline?: its rule }, and the gap's total and band (viewport px).
export function gapInfo(id) {
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'vgap') {
        let cache = rootCache(e.block, e.root);
        for (const k of e.cachePath) cache = cache && cache.dom && cache.dom.segs[k] && cache.dom.segs[k].sub;
        const L = cache && cache.layout && cache.layout.laid[e.i], s = cache && cache.dom && cache.dom.segs[e.i];
        if (!L || !s || !s.gap) return null;
        const totalSp = (parseFloat(s.gap.style.height) || 0) / SP();
        const vs = L.seg.vspace;
        const parts = [];
        for (const g of (vs && vs.glue) || []) {
            if (g.type === 'glue' && (g.subtype === 1 || g.subtype === 2)) continue;   // redone below
            let n = g;
            // A display's above skip: the full or the short one, as chosen at this width.
            if (g.type === 'glue' && (g.subtype === 4 || g.subtype === 6) && L.seg.kind === 'display' && L.displayFull != null) {
                const it = L.seg.rows[0].item;
                n = { ...g, subtype: L.displayFull ? 4 : 6, width: L.displayFull ? it.display_above : it.display_above_short };
            }
            parts.push({ n });
        }
        const sum = parts.reduce((a, p) => a + (p.n.type === 'kern' ? p.n.kern || 0 : p.n.width || 0), 0);
        const rest = totalSp - sum;
        if (Math.abs(rest) > 655) {                       // more than 0.01pt left: the interline glue
            const prev = e.i > 0 && cache.layout.laid[e.i - 1];
            const il = interline(prev ? prev.lastDepth || 0 : 0, L.firstAscent || 0, L.firstMeta, rest * SP());
            parts.push({ n: { type: 'glue', subtype: il.subtype, width: rest }, interline: il.rule || {} });
        }
        const r = s.gap.getBoundingClientRect();
        return { totalSp, amount: vs ? vs.amount || 0 : null, parts,
                 band: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }
    if (e.kind === 'vpar') {
        const { laid, s } = segParts(e.seg);
        if (!laid || !laid.itemStarts || !laid.profiles || !s || !s.svg) return null;
        const j = laid.itemStarts[e.k];
        if (!(j > 0) || j >= laid.lines.length) return null;
        const prevD = maxOf(laid.profiles[j - 1], 'd'), asc = maxOf(laid.profiles[j], 'h');
        const px = laid.baselineYs[j] - laid.baselineYs[j - 1] - prevD - asc;
        const vs = laid.seg.items[e.k] && laid.seg.items[e.k].vspace;
        const parts = ((vs && vs.glue) || []).map(n => ({ n }));
        const il = interline(prevD, asc, laid.meta && laid.meta[j], px);
        parts.push({ n: { type: 'glue', subtype: il.subtype, width: il.width }, interline: il.rule || {} });
        const top = laid.baselineYs[j - 1] + prevD;
        const band = toScreen(s.svg, { x: 0, y: top, w: s.svg.viewBox.baseVal.width || s.svg.getBoundingClientRect().width, h: px });
        return { totalSp: px / SP(), amount: vs ? vs.amount || 0 : null, parts, band };
    }
    return null;
}
// A part's band: its share of the gap's, in order from the top.
export function partRect(id) {
    const e = entries.get(id), g = e && gapInfo(e.gap);
    if (!g || !g.band) return null;
    const scale = g.totalSp ? g.band.height / g.totalSp : 0;
    let y = g.band.top;
    for (let k = 0; k < g.parts.length; k++) {
        const n = g.parts[k].n, h = (n.type === 'kern' ? n.kern || 0 : n.width || 0) * scale;
        if (k === e.k) return { left: g.band.left, top: Math.min(y, y + h), width: g.band.width, height: Math.abs(h) };
        y += h;
    }
    return null;
}
// Where a gap is listed: before segment i (if there is space, or TeX's glue).
export function gapBefore(bid, cachePath, cache, i, root = null) {
    const L = cache.layout.laid[i], s = cache.dom && cache.dom.segs[i];
    const px = s && s.gap ? parseFloat(s.gap.style.height) || 0 : 0;
    return (L && L.seg.vspace) || px > 0.05 ? gapId(bid, cachePath, i, root) : null;
}
export const GAP_NAME = n => n.type === 'kern' ? 'kern' : n.subtype ? '\\' + GLUE_SUB[n.subtype] : 'skip';
export function gapSummary(id, out) {
    const g = gapInfo(id);
    out.type = 'vspace';
    out.label = 'vertical space';
    if (!g) { out.note = 'not laid out yet'; return; }
    out.note = `${pt(g.totalSp)} · ${g.parts.map(p => GAP_NAME(p.n)).join(' + ') || 'glue'}`;
    out.hasChildren = g.parts.length > 0;
    out.drawn = true;
}
export function partSummary(id, out) {
    const e = entries.get(id), g = gapInfo(e.gap), p = g && g.parts[e.k];
    if (!p) { out.type = 'glue'; out.label = 'glue'; out.note = 'gone'; return; }
    const n = p.n;
    out.type = n.type;
    out.drawn = true;
    if (n.type === 'kern') { out.label = 'kern'; out.note = pt(n.kern || 0); return; }
    out.label = 'glue ' + (n.subtype ? '\\' + GLUE_SUB[n.subtype] : '(skip)');
    out.note = p.interline ? `→ ${pt(n.width || 0)}` : glueSpec(n);
}
export function gapDetails(id, rows) {
    const e = entries.get(id);
    if (e.kind === 'vpart') {
        const g = gapInfo(e.gap), p = g && g.parts[e.k];
        if (!p) return;
        const n = p.n;
        if (n.type === 'kern') rows.push(['kern', pt(n.kern || 0)]);
        else if (p.interline) {
            const r = p.interline;
            rows.push(['set to', pt(n.width || 0)]);
            if (r.baselineskip != null) rows.push(['\\baselineskip', pt(r.baselineskip)], ['depth above', pt(r.depthAbove)],
                ['height below', pt(r.heightBelow)], ['\\lineskiplimit', pt(r.lineskiplimit)], ['\\lineskip', pt(r.lineskip)]);
            rows.push(['rule', n.subtype === 2 ? '\\baselineskip − depth above − height below'
                                                : 'that would leave less than \\lineskiplimit: \\lineskip instead']);
        } else {
            rows.push(['glue', glueSpec(n)], ['kind', n.subtype ? '\\' + GLUE_SUB[n.subtype]
                : 'an explicit skip: \\vspace, \\vskip, \\addvspace, a heading\'s before or after skip']);
        }
        return;
    }
    const g = gapInfo(id);
    if (!g) return;
    rows.push(['total', pt(g.totalSp)]);
    if (g.amount != null) rows.push(['recorded by TeX', pt(g.amount)]);
}
