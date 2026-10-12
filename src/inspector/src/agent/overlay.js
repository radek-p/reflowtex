// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, near, shown } from './context.js';
import { blockId } from './ids.js';
import { segParts, segmentsOf } from './resolve.js';
import { geometry, readingMatrices, rectOf, toScreen } from './geometry.js';
import { affineFields, badnessOf } from './format.js';
import { displayBand, screenRectOf } from './rects.js';
import { children, summary } from './describe.js';
import { drawAccessible } from './a11y.js';

// ── Overlay ────────────────────────────────────────────────────────────────────
export const COLORS = {
    box: ['rgba(111,168,220,.30)', '#4a90d9'], glyph: ['rgba(111,168,220,.25)', '#4a90d9'],
    glue: ['rgba(147,196,125,.55)', '#5c9e3f'], kern: ['rgba(190,140,230,.55)', '#8e44ad'],
    math: ['rgba(246,178,107,.5)', '#d9822b'], penalty: ['rgba(224,102,102,.8)', '#c0392b'],
    line: ['rgba(255,229,153,.25)', '#c9a227'], other: ['rgba(160,160,160,.3)', '#888'],
};
export const colorOf = t => COLORS[t === 'hlist' || t === 'vlist' || t === 'block' || t === 'text' || t === 'display' || t === 'stream' || t === 'picture' || t === 'widget' || t === 'rule' ? 'box'
    : t === 'glyph' ? 'glyph' : t === 'glue' || t === 'vspace' ? 'glue' : t === 'kern' ? 'kern' : t === 'math' ? 'math'
    : t === 'penalty' ? 'penalty' : t === 'line' ? 'line' : 'other'];

// What the panel hovers and selects, and what a pick has found: set from the
// API (index.js) and by picking (pick.js), drawn by redraw.
export const state = { hovered: null, selected: null, picking: false, picked: null, pickHover: null, marked: [] };
export let layer = null;
// A redraw measures everything first and adds its drawing to the page once, at
// the end: adding each outline as it is measured would make the browser lay the
// page out again for every one (thousands, for a font's glyphs). `ink` is the
// drawing under way, `ctms` the svg matrices read for it.
export let ink = null;
// A resource's uses and a hovered list are drawn only near the viewport (a
// screen above and below); scrolling further draws the rest.
export let culled = false, culledAt = 0;          // (and the scroll position it was drawn at)
export function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.setAttribute('data-rtx-inspector', '');
    // Anchored in the document at the scroll position it was drawn at (see
    // redraw), so the browser scrolls it with the text: a fixed layer redrawn
    // on scroll would trail the text by a frame.
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646';
    // Beneath a floating inspector panel, should it share our z-index (one
    // docked inside the page is not a child of <html>, and needs no care).
    const ui = [...document.documentElement.children].find(e => e.hasAttribute('data-rtx-ui'));
    document.documentElement.insertBefore(layer, ui || null);
    return layer;
}
export function drawRect(r, type, { strong = false, label = null, children = false, below = false, outline = false } = {}) {
    if (!r) return;
    const [fill, stroke] = colorOf(type);
    const d = document.createElement('div');
    const w = Math.max(r.width, type === 'penalty' || r.width === 0 ? 2 : r.width);
    d.style.cssText = `position:absolute;box-sizing:border-box;left:${r.left - (r.width === 0 ? 1 : 0)}px;top:${r.top}px;width:${w}px;height:${Math.max(r.height, 1)}px;`
        + (children ? `outline:1px solid ${stroke};background:${fill.replace(/[\d.]+\)$/, '0.18)')}`
                    : `background:${outline ? 'transparent' : fill};outline:${strong ? 2 : 1}px solid ${stroke}`)
        + ((type === 'glue' || type === 'vspace') && !children ? ';background-image:repeating-linear-gradient(135deg,transparent 0 3px,rgba(255,255,255,.35) 3px 5px)' : '');
    ink.appendChild(d);
    if (r.base != null && !children && (type === 'box' || type === 'hlist' || type === 'vlist' || type === 'line' || type === 'glyph')) {
        const b = document.createElement('div');
        b.style.cssText = `position:absolute;left:${r.left}px;top:${r.base}px;width:${r.width}px;border-top:1px dashed ${stroke}`;
        ink.appendChild(b);
    }
    if (label) {
        const t = document.createElement('div');
        t.textContent = label;
        const above = !below && r.top > 24;
        t.style.cssText = `position:absolute;left:${Math.max(2, r.left)}px;top:${above ? r.top - 22 : r.top + r.height + 3}px;`
            + 'font:11px/1.5 ui-monospace,Menlo,monospace;background:#1f2430;color:#fff;padding:1px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis';
        ink.appendChild(t);
    }
}
export function drawId(id, strong, below = false) {
    const s = summary(id);
    const r = screenRectOf(id);
    if (!r) return;
    // A selected box or line also shows what it is made of, one level down.
    if (strong && s.hasChildren && s.kind !== 'block' && s.type !== 'stream') {
        const kids = children(id);
        if (kids.length <= 400) for (const k of kids) drawRect(screenRectOf(k.id), k.type, { children: true });
    }
    if (r.base != null) drawBaseline(r, strong);
    // A display row's box, continued dotted over the rest of its band.
    const band = displayBand(id);
    if (band && band.rect) {
        const b = band.rect, stroke = colorOf(s.type)[1];
        const piece = (left, right) => {
            if (right - left < 1) return;
            const d = document.createElement('div');
            d.style.cssText = `position:absolute;box-sizing:border-box;left:${left}px;top:${r.top}px;width:${right - left}px;height:${Math.max(r.height, 1)}px;`
                + `border:1px dotted ${stroke};opacity:.8`;
            ink.appendChild(d);
        };
        piece(b.left, r.left);
        piece(r.left + r.width, b.left + b.width);
    }
    // A block or segment is outlined only: filled, it would wash out what it holds.
    drawRect(r, s.type, { strong, below, outline: s.kind === 'block' || s.kind === 'seg', label: `${s.label}  ${s.note}`.trim() });
}
// A guide along the node's baseline, across the whole viewport: what else
// sits on it – the neighbouring words, a formula's axis, the next column –
// is then plain to see. Tagged just past the node's right edge.
export function drawBaseline(r, strong) {
    const color = strong ? 'rgba(47,44,205,.75)' : 'rgba(47,44,205,.45)';
    const g = document.createElement('div');
    g.style.cssText = `position:absolute;left:0;width:${document.documentElement.clientWidth}px;top:${Math.round(r.base)}px;height:0;border-top:1px dashed ${color}`;
    ink.appendChild(g);
    const t = document.createElement('div');
    t.textContent = 'baseline';
    t.style.cssText = `position:absolute;left:${r.left + r.width + 6}px;top:${Math.round(r.base) - 13}px;`
        + `font:10px/1 ui-monospace,Menlo,monospace;color:${color};background:rgba(255,255,255,.8);padding:1px 3px;border-radius:2px`;
    ink.appendChild(t);
}
// ── Page-wide guides ───────────────────────────────────────────────────────────
// Options a panel can turn on: every line's baseline, and a bar past every
// line's end coloured by its badness. Drawn for the segments on screen.
// selection: whether the selected node (and a resource's marked uses) is
// drawn at all. A panel that outlines only what the pointer is over, as
// Chrome's does, turns it off and on again for keyboard navigation.
export const options = { baselines: false, badness: false, springs: false, a11y: false, selection: true };
// A spring across a glue whose width the display model recomputes: a zigzag,
// one coil per 6px, along the middle of the glue's height.
export function drawSpring(q) {
    if (!q || q.width < 2) return;
    const coils = Math.max(2, Math.round(q.width / 6)), amp = Math.min(3.5, Math.max(2, q.height / 5));
    const mid = amp + 1, pts = [`0,${mid}`];
    for (let i = 0; i < coils; i++) {
        const x0 = (i + 0.25) * q.width / coils, x1 = (i + 0.75) * q.width / coils;
        pts.push(`${x0.toFixed(1)},${(mid - amp).toFixed(1)}`, `${x1.toFixed(1)},${(mid + amp).toFixed(1)}`);
    }
    pts.push(`${q.width.toFixed(1)},${mid}`);
    const h = 2 * mid;
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${q.left}px;top:${q.top + q.height / 2 - mid}px;width:${q.width}px;height:${h}px`;
    d.innerHTML = `<svg width="${q.width}" height="${h}" viewBox="0 0 ${q.width} ${h}" style="display:block;overflow:visible">`
        + `<polyline points="${pts.join(' ')}" fill="none" stroke="#3f8f2a" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
    ink.appendChild(d);
}
export const BAD_COLOR = bad => bad.overfull ? '#8e24aa' : bad.b <= 12 ? '#43a047' : bad.b < 100 ? '#f0a500' : '#e53935';
export function drawGuides() {
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        if (br.bottom < 0 || br.top > innerHeight) continue;
        const bid = blockId(el);
        for (const sid of segmentsOf(bid)) {
            const { s, laid } = segParts(sid);
            if (!shown(s.svg)) continue;
            const sr = s.svg.getBoundingClientRect();
            if (sr.bottom < 0 || sr.top > innerHeight) continue;
            const g = geometry(sid);
            if (!g) continue;
            const text = laid.seg.kind !== 'display';
            if (options.springs && !text) {
                for (const n of g.at.keys()) {
                    if ((n.type === 'glue' || n.type === 'kern') && affineFields(n).some(f => f === 'width' || f === 'kern')) {
                        const r = rectOf(g, n);
                        if (r) drawSpring(toScreen(g.svg, r));
                    }
                }
            }
            for (const L of g.lines) {
                if (options.baselines) {
                    const q = toScreen(g.svg, { x: L.x0, y: L.y, w: L.x1 - L.x0, h: 0 });
                    if (q) {
                        const d = document.createElement('div');
                        d.style.cssText = `position:absolute;left:${q.left}px;top:${Math.round(q.top)}px;width:${q.width}px;height:0;border-top:1px solid rgba(47,44,205,.45)`;
                        ink.appendChild(d);
                    }
                }
                if (options.badness && text) {
                    const bad = badnessOf(laid.lrp[L.j]);
                    const q = toScreen(g.svg, { x: L.x1 + 3, y: L.y - L.h, w: 3, h: L.h + L.d });
                    if (q) {
                        const d = document.createElement('div');
                        d.style.cssText = `position:absolute;left:${q.left}px;top:${q.top}px;width:4px;height:${Math.max(q.height, 4)}px;border-radius:2px;background:${BAD_COLOR(bad)}`;
                        d.title = `badness ${bad.b}`;
                        ink.appendChild(d);
                    }
                }
            }
        }
    }
}
export let guidesPaints = -1;

// Hovering something else, the selection steps back to a pale wash – no
// outline, label, children or baseline to compete with what is hovered.
// Several ids hovered at once (a panel's row of letters) are washed in
// gently, backgrounds only.
export function redraw() {
    ensureLayer();
    ink = document.createDocumentFragment(); readingMatrices(true); culled = false;
    try {
        if (options.baselines || options.badness || options.springs) { drawGuides(); guidesPaints = I.paints; }
        if (options.a11y) drawAccessible(ink);
        const sel = options.selection ? state.selected : null;
        if (options.selection) for (const id of state.marked) drawMark(id);
        const h = state.picking ? state.pickHover : state.hovered;
        const other = h != null && h !== sel;
        if (sel != null) { if (other) drawPale(sel); else drawId(sel, true); }
        if (Array.isArray(h)) for (const id of h) drawPale(id, 'rgba(111,168,220,.35)', true);
        // with no selection drawn, what is hovered is shown in full
        else if (other) drawId(h, !state.picking && sel == null);
    } finally {
        // Everything is placed in viewport coordinates, inside a layer that
        // sits where the viewport's corner is now.
        const drawing = ink;
        ink = null; readingMatrices(false);
        layer.style.left = scrollX + 'px';
        layer.style.top = scrollY + 'px';
        layer.replaceChildren(drawing);
        culledAt = scrollY;
    }
}
// A resource's use: outlined in the inspector's accent, beneath the rest.
export function drawMark(id) {
    const r = screenRectOf(id);
    if (!r) return;
    if (!near(r)) { culled = true; return; }
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;box-sizing:border-box;left:${r.left - 1}px;top:${r.top - 1}px;width:${Math.max(r.width, 1) + 2}px;height:${Math.max(r.height, 1) + 2}px;`
        + 'background:rgba(47,44,205,.12);outline:1.5px solid rgba(47,44,205,.8);border-radius:1px';
    ink.appendChild(d);
}
export function drawPale(id, color = 'rgba(47,44,205,.07)', cull = false) {
    const r = screenRectOf(id);
    if (!r) return;
    if (cull && !near(r)) { culled = true; return; }
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${Math.max(r.width, 1)}px;height:${Math.max(r.height, 1)}px;`
        + `background:${color}`;
    ink.appendChild(d);
}
export let raf = 0;
export const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0;
    if (state.selected != null || state.hovered != null || state.pickHover != null || state.marked.length || options.baselines || options.badness || options.springs || options.a11y) redraw(); }); };
// The page's own scrolling carries the layer; a scroll box inside it (a wide
// display) moves what it holds, and needs a redraw. (Listened to from install.)
export function listen() {
// The page's own scrolling only needs a redraw when something was left undrawn
// (see near), for the part of it now coming into view.
addEventListener('scroll', e => {
    if (e.target !== document && e.target !== document.documentElement) schedule();
    else if (culled && Math.abs(scrollY - culledAt) > innerHeight / 2) schedule();
}, { passive: true, capture: true });
addEventListener('resize', schedule, { passive: true });
}
// Where the page stops being visible: the window's bottom, or the top of an
// inspector docked there (which publishes its height as --rtx-dock-bottom).
export const viewBottom = () => innerHeight - (parseFloat(document.documentElement.style.getPropertyValue('--rtx-dock-bottom')) || 0);
export function scrollIntoViewIfNeeded(id) {
    const r = id != null && screenRectOf(id);
    if (r && (r.top < 0 || r.top + r.height > viewBottom())) {
        scrollBy({ top: r.top - viewBottom() / 3, behavior: 'instant' });
        schedule();
    }
}
