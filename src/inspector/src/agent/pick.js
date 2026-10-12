// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, shown } from './context.js';
import { blockId, entries, lineId, parGapId, partId, segId, sideId } from './ids.js';
import { rootCache, rootsOf, segParts, segmentsOf } from './resolve.js';
import { geometry, rectOf, toScreen } from './geometry.js';
import { gapBefore, gapInfo, partRect } from './vspace.js';
import { pathOf, pathOfLine } from './paths.js';
import { redraw, state } from './overlay.js';

// ── Picking ────────────────────────────────────────────────────────────────────
// The node under a point: the smallest drawn rectangle containing it, over
// the segments whose <svg> contains it.
export function nodeAt(x, y) {
    let best = null, bestArea = Infinity;
    const pop = overPopover(x, y);
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        const inBlock = !(x < br.left || x > br.right || y < br.top || y > br.bottom);
        const bid = blockId(el);
        for (const sid of segmentsOf(bid)) {
            const { s } = segParts(sid);
            if (!shown(s.svg)) continue;
            // The block's own text where the block is; a surface's wherever it
            // is drawn; over an open popover, only what is in it.
            const inPop = !!s.svg.closest('#latex-footnote-pop');
            if (pop ? !inPop : (entries.get(sid).root == null ? !inBlock : inPop)) continue;
            const sr = s.svg.getBoundingClientRect();
            if (x < sr.left - 2 || x > sr.right + 2 || y < sr.top || y > sr.bottom) continue;
            const g = geometry(sid);
            if (!g) continue;
            for (const n of g.at.keys()) {
                const r = rectOf(g, n); if (!r || r.w <= 0) continue;
                const q = toScreen(g.svg, r); if (!q) continue;
                if (x >= q.left && x <= q.left + q.width && y >= q.top && y <= q.top + q.height) {
                    const a = q.width * q.height;
                    if (a < bestArea) { bestArea = a; best = { n, sid }; }
                }
            }
            // Above or below the ink but within a line: the line's own node
            // under x (a glyph's box is shorter than the line), else the line.
            if (!best) for (const L of g.lines) {
                const q = toScreen(g.svg, { x: L.x0, y: L.y - L.h, w: L.x1 - L.x0, h: L.h + L.d });
                if (!q || y < q.top || y > q.top + q.height) continue;
                best = { line: L.j, sid };
                for (const n of L.line.nodes) {
                    const r = rectOf(g, n), qq = r && r.w > 0 && toScreen(g.svg, r);
                    if (qq && x >= qq.left && x <= qq.left + qq.width) { best = { n, sid }; break; }
                }
            }
        }
    }
    if (!best) return gapAt(x, y);
    if (best.line != null) return { id: lineId(best.sid, best.line), path: pathOfLine(best.sid, best.line) };
    const path = pathOf(best.n, best.sid);
    return path && { id: path[path.length - 1], path };
}
// Between the lines: a vertical space, and the part of it under the pointer.
export function gapAt(x, y) {
    const inside = r => r && x >= r.left && x <= r.left + r.width && y >= r.top - 1 && y <= r.top + Math.max(r.height, 2) + 1;
    const pop = overPopover(x, y);
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        if (!pop && (x < br.left || x > br.right || y < br.top || y > br.bottom)) continue;
        const bid = blockId(el);
        for (const { gid, path } of gapsOf(bid)) {
            if (pop !== (path.length > 1 && entries.get(path[1]).kind === 'side')) continue;
            const g = gapInfo(gid);
            if (!g || !inside(g.band)) continue;
            for (let k = 0; k < g.parts.length; k++) {
                const pid = partId(gid, k);
                if (inside(partRect(pid)) && partRect(pid).height >= 1) return { id: pid, path: [...path, gid, pid] };
            }
            return { id: gid, path: [...path, gid] };
        }
    }
    return null;
}
// Every vertical space of a block, with the path of rows above it.
export function* gapsOf(bid) {
    const el = entries.get(bid).el;
    function* walk(cache, cachePath, path, root) {
        if (!cache || !cache.dom || !cache.layout) return;
        for (let i = 0; i < cache.layout.laid.length; i++) {
            const g = gapBefore(bid, cachePath, cache, i, root);
            if (g) yield { gid: g, path };
            const s = cache.dom.segs[i], L = cache.layout.laid[i], sid = segId(bid, cachePath, i, root);
            if (s && s.sub) yield* walk(s.sub, [...cachePath, i], [...path, sid], root);
            else if (L && L.itemStarts) for (let k = 1; k < L.itemStarts.length; k++) yield { gid: parGapId(sid, k), path: [...path, sid] };
        }
    }
    yield* walk(I.state(el).cache, [], [bid], null);
    for (const k of rootsOf(el)) yield* walk(rootCache(bid, k), [], [bid, sideId(bid, k)], k);
}
// Over the viewer's footnote popover, open: it floats above the text, so what
// is under the pointer is in it.
export function overPopover(x, y) {
    const pop = document.getElementById('latex-footnote-pop');
    if (!pop || !shown(pop)) return false;
    const r = pop.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
// On screen at all (not display: none, as a closed popover's body is).
// An inspector's own UI on the page (marked data-rtx-ui) is not part of it.
export const onUI = ev => !!(ev.target && ev.target.closest && ev.target.closest('[data-rtx-ui]'));
export function onMove(ev) {
    if (onUI(ev)) { if (state.pickHover != null) { state.pickHover = null; redraw(); } return; }
    const hit = nodeAt(ev.clientX, ev.clientY);
    const id = hit ? hit.id : null;
    if (id !== state.pickHover) { state.pickHover = id; redraw(); }
}
export function onClick(ev) {
    if (onUI(ev)) return;
    ev.preventDefault(); ev.stopPropagation();
    const hit = nodeAt(ev.clientX, ev.clientY);
    stopPick();
    if (hit) { state.selected = hit.id; state.picked = { id: hit.id, path: hit.path, seq: (state.picked ? state.picked.seq : 0) + 1 }; }
    redraw();
}
export const swallow = ev => { if (onUI(ev)) return; ev.preventDefault(); ev.stopPropagation(); };
export function onKey(ev) { if (ev.key === 'Escape') { stopPick(); redraw(); } }
export function startPick() {
    if (state.picking) return;
    state.picking = true;
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('mousedown', swallow, true);
    addEventListener('mouseup', swallow, true);
    addEventListener('keydown', onKey, true);
    document.documentElement.style.cursor = 'crosshair';
}
export function stopPick() {
    state.picking = false; state.pickHover = null;
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('mousedown', swallow, true);
    removeEventListener('mouseup', swallow, true);
    removeEventListener('keydown', onKey, true);
    document.documentElement.style.cursor = '';
}

// An element (the Elements panel's $0) → the node it draws.
export function fromElement(el) {
    if (!el || !el.closest) return null;
    const block = el.closest('[data-nodelist-b64], [data-latex-view]');
    if (!block || !I.state(block)) return null;
    const bid = blockId(block);
    for (const sid of segmentsOf(bid)) {
        const { cache } = segParts(sid);
        const g = geometry(sid);
        if (!g || !cache.dom) continue;
        for (let e = el; e && e !== block; e = e.parentNode) {
            for (const [n, drawn] of cache.dom.byNode) {
                if (drawn === e && g.at.has(n)) {
                    const path = pathOf(n, sid);
                    if (path) { state.selected = path[path.length - 1]; redraw(); return { id: state.selected, path }; }
                }
            }
        }
    }
    return null;
}
export function elementOf(id) {
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'block') return e.el;
    if (e.kind === 'seg') { const { s } = segParts(id); return s && (s.svg || s.box); }
    if (e.kind === 'side') { const c = rootCache(e.block, e.root); return c && c.dom && c.dom.root; }
    const sid = e.seg;
    const { cache, s } = segParts(sid);
    if (e.kind === 'node') {
        const direct = cache.dom.byNode.get(e.n);
        if (direct) return direct;
    }
    return s && s.svg;
}
