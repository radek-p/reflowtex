// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, near } from './context.js';
import { entries } from './ids.js';
import { segParts } from './resolve.js';
import { geometry } from './geometry.js';

// ── Accessibility ──────────────────────────────────────────────────────────────
// A block built with the accessible layer (src/pipeline/a11y.ts) has it beside
// it: pieces – a paragraph (data-para), a display (data-item) – which
// the viewer lays over the drawing, a paragraph near the window line by line
// as runs (data-run: text, math). The inspector says what the layer holds for
// a box, and draws where it lies.
// (before its block once the viewer placed it, after it as shipped)
export const layerOf = el => (el ? [el.previousElementSibling, el.nextElementSibling] : []).find(l => l && l.classList.contains('latex-a11y')) || null;
// The layer's pieces for a row: a block's, all; a segment's, its paragraphs'
// or its display's; a line's or a node's, its paragraph's.
export function accessiblePieces(id) {
    const e = entries.get(id);
    if (!e) return { el: null, pieces: [] };
    if (e.kind === 'block') { const l = layerOf(e.el); return { el: e.el, pieces: l ? [...l.children] : [] }; }
    let sid = e.kind === 'seg' ? id : e.kind === 'line' ? e.seg : e.kind === 'node' ? e.seg : null;
    if (sid == null) return { el: null, pieces: [] };
    const { seg, laid, el } = segParts(sid);
    const layer = layerOf(el);
    if (!layer || !laid || seg.cachePath.length || seg.root != null) return { el, pieces: [] };
    const doc = (I.state(el) || {}).doc || {};
    const byPara = n => layer.querySelector(`:scope > [data-para="${n}"]`);
    if (laid.seg.kind === 'display') {
        const k = (doc.content || []).indexOf(laid.seg.rows[0].item) + 1;
        const p = k > 0 && layer.querySelector(`:scope > [data-item="${k}"]`);
        return { el, pieces: p ? [p] : [] };
    }
    if (laid.seg.kind !== 'text') return { el, pieces: [] };
    const items = laid.seg.items;
    if (e.kind === 'seg') return { el, pieces: items.map(it => byPara(it.index)).filter(Boolean) };
    // a line's paragraph: the item whose lines hold it
    let j = e.kind === 'line' ? e.j : -1;
    if (e.kind === 'node') {
        const g = geometry(sid);
        let n = e.n;
        while (g && g.parent.has(n) && !g.lines.some(L => L.line === g.parent.get(n))) n = g.parent.get(n);
        const L = g && g.lines.find(L => L.line === g.parent.get(n));
        j = L ? L.j : -1;
    }
    const starts = laid.itemStarts || [];
    let k = -1;
    for (let q = 0; q < starts.length; q++) if (starts[q] <= j) k = q;
    const p = k >= 0 && byPara(items[k].index);
    return { el, pieces: p ? [p] : [] };
}
// A piece's content, as a reader gets it: text, and each formula as its
// MathML and its words (alttext).
export function accessibleParts(piece) {
    const parts = [];
    const text = t => { if (!t) return; const last = parts[parts.length - 1];
        if (last && last.type === 'text') last.text += t; else parts.push({ type: 'text', text: t }); };
    const walk = n => {
        if (n.nodeType === 3) { text(n.nodeValue); return; }
        if (n.nodeType !== 1) return;
        if (n.localName === 'math') { parts.push({ type: 'math', mathml: n.outerHTML.replace(/ style="[^"]*"/, '').replace(/ data-run="[^"]*"/, ''), alttext: n.getAttribute('alttext') || '' }); return; }
        for (const c of n.childNodes) walk(c);
    };
    walk(piece);
    for (const p of parts) if (p.type === 'text') p.text = p.text.replace(/\s+/g, ' ');
    return parts;
}
export function accessible(id) {
    const { el, pieces } = accessiblePieces(id);
    return {
        layer: !!layerOf(el),
        pieces: pieces.map(p => ({ kind: p.dataset.para ? 'paragraph' : 'display', lined: !!p.querySelector('[data-run]'), parts: accessibleParts(p) })),
    };
}
// The overlay: every piece near the window dashed, its runs outlined – text
// orange, formulas green – so a run that misses its glyphs shows.
export function drawAccessible(ink) {
    const box = (r, css, kind) => {
        const d = document.createElement('div');
        d.dataset.a11y = kind;
        d.style.cssText = `position:absolute;box-sizing:border-box;left:${r.left}px;top:${r.top}px;width:${Math.max(r.width, 1)}px;height:${Math.max(r.height, 1)}px;${css}`;
        ink.appendChild(d);
    };
    for (const el of I.blocks()) {
        const layer = layerOf(el);
        if (!layer) continue;
        for (const piece of layer.children) {
            const r = piece.getBoundingClientRect();
            if (!near(r)) continue;
            box(r, 'border:1px dashed rgba(123,31,162,.7)', 'piece');
            const runs = piece.querySelectorAll('[data-run]');
            for (const run of runs) {
                const m = run.dataset.run !== 'text';
                box(run.getBoundingClientRect(), m ? 'outline:1px solid rgba(46,125,50,.9);background:rgba(46,125,50,.12)'
                                                   : 'outline:1px solid rgba(230,81,0,.9);background:rgba(230,81,0,.10)', m ? 'math' : 'run');
            }
            // a piece not laid line by line: its formulas, where the browser put them
            if (!runs.length) for (const m of piece.querySelectorAll('math')) box(m.getBoundingClientRect(), 'outline:1px solid rgba(46,125,50,.9)', 'math');
        }
    }
}
