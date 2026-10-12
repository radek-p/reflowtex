// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a row's thing is on screen (viewport px), and a display's band.

import { SP, shown } from './context.ts';
import { entries } from './ids.ts';
import { rootCache, segParts } from './resolve.ts';
import { geometry, rectOf, toScreen, type ScreenRect } from './geometry.ts';
import { gapInfo, partRect } from './vspace.ts';

export function screenRectOf(id: number | null | undefined): ScreenRect | null {
    if (id == null) return null;
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'vgap' || e.kind === 'vpar') { const g = gapInfo(id); return g && g.band; }
    if (e.kind === 'vpart') return partRect(id);
    if (e.kind === 'block') { const r = e.el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
    if (e.kind === 'side') {
        const c = rootCache(e.block, e.root), el = c && c.dom && c.dom.root;
        if (!shown(el)) return null;
        const r = el!.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    if (e.kind === 'seg') {
        const { s } = segParts(id);
        const box = s && (s.svg || s.box);
        if (!box) return null;
        const r = box.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    if (e.kind === 'line') {
        const g = geometry(e.seg); const L = g && g.lines[e.j];
        return L ? toScreen(g!.svg, { x: L.x0, y: L.y - L.h, w: L.x1 - L.x0, h: L.h + L.d, base: L.y }) : null;
    }
    const g = e.seg ? geometry(e.seg) : null;
    const r = g && rectOf(g, e.n);
    return r ? toScreen(g!.svg, r) : null;
}


// ── A display's band ───────────────────────────────────────────────────────────
// The stretch of the column a display row occupies, [display_indent,
// display_indent + display_width] as evaluated at this width – which its box
// need not fill: an amsmath alignment ends every row with a tag column that
// opens with \kern-\tagshift@, backing the box up over the right margin, so
// the box stops a margin short even though the margin's \tabskip is there.
// For a display's line, or the row box on it; null for anything else.
export function displayBand(id: number): { rect: ScreenRect | null; widthSp: number; boxSp: number } | null {
    const e = entries.get(id);
    if (!e) return null;
    let sid: number, j: number;
    if (e.kind === 'line') { sid = e.seg; j = e.j; }
    else if (e.kind === 'node' && e.seg != null) {
        const g = geometry(e.seg);
        const n = e.n;
        const L = g && g.lines.find(L => L.line.nodes[0] === n);
        if (!L) return null;
        sid = e.seg; j = L.j;
    } else return null;
    const { laid } = segParts(sid), g = geometry(sid);
    const item = laid && laid.affine && laid.affine.items && laid.affine.items[j];   // as evaluated at this width
    const L = g && g.lines[j];
    if (!item || !L || item.display_width == null) return null;
    const k = SP(), x = (item.display_indent || 0) * k;
    return { rect: toScreen(g!.svg, { x, y: L.y - L.h, w: item.display_width * k, h: L.h + L.d }),
             widthSp: item.display_width, boxSp: (L.x1 - L.x0) / k };
}
