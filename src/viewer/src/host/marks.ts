// SPDX-License-Identifier: AGPL-3.0-or-later
// Marks (\webid, \webclass in reflowtex.sty): runs of text the author named
// or classed. Every glyph inside carries the mark's index (Node.mark →
// Document.marks); the painter gives its element the mark's classes and
// data-rtx-id, so CSS reaches it however the lines break, and a page finds
// it: host.mark(id).
import { glyphScreenRect } from '../defaults/footnotes.js';
import type { MarkHandle } from './types.ts';

interface Mark { id?: string; classes?: string }

/** From paint.js: a glyph element of mark `index` (the layout's table). */
export function applyMark(el: Element, index: number, cache: { marks?: Mark[] }) {
    const m = cache.marks && cache.marks[index - 1];
    if (!m) return;
    if (m.id) (el as HTMLElement).dataset.rtxId = m.id;
    for (const c of (m.classes || '').split(/\s+/)) if (c) el.classList.add(c);
}

export function markHandle(id: string): MarkHandle {
    // The glyphs; the bands behind them (paint.js, paintMarkBands) carry the id too.
    const elements = () => [...document.querySelectorAll(`[data-rtx-id="${CSS.escape(id)}"]:not(rect.latex-mark)`)];
    return {
        id,
        elements,
        rects() {
            // One rect per line: glyphs on one baseline joined.
            const lines = new Map<number, { left: number; top: number; right: number; bottom: number }>();
            for (const el of elements()) {
                const r = glyphScreenRect(el);
                const key = Math.round(r.bottom);
                const l = lines.get(key);
                if (!l) lines.set(key, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
                else { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right);
                       l.top = Math.min(l.top, r.top); l.bottom = Math.max(l.bottom, r.bottom); }
            }
            return [...lines.values()].map(l => new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top));
        },
    };
}
