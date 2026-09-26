// SPDX-License-Identifier: AGPL-3.0-or-later

// The accessible layer (src/pipeline/a11y.ts), laid over what it stands for.
//
// A page built with it has, right after a block, the block's text and
// formulas (MathML) for screen readers, while the drawing is hidden from them.
// As shipped, the layer is one visually hidden element after the block – so a
// screen reader, which scrolls to what it reads (and VoiceOver draws its
// cursor around it), would jump to the block's end at every paragraph. Once
// the block is laid out, each piece of the layer is moved over its own lines
// instead: a paragraph (data-para) over the lines the viewer broke it into, a
// display (data-item) over its drawing. The pieces stay invisible
// (opacity 0) and let the pointer through; they are placed again after every
// layout. Without the viewer the layer keeps its shipped form, which reads
// in the right order.

// The layer turns into a zero-height anchor the pieces hang from; a piece is
// placed relative to it, so the page may move the block and its layer freely.
const ANCHOR = 'position:relative;height:0;margin:0;padding:0;border:0;overflow:visible';
const PIECE  = 'position:absolute;margin:0;padding:0;overflow:hidden;opacity:0;'
             + 'pointer-events:none;user-select:none;-webkit-user-select:none';

const maxOf = (profile, key) => (profile || []).reduce((m, it) => Math.max(m, it[key]), 0);

/** Lay the block's accessible layer, if it has one, over its lines. */
export function placeAccessibleLayer(data) {
    const el = data && data.el;
    const layer = el && el.nextElementSibling;
    if (!layer || !layer.classList.contains('latex-a11y')) return;
    const cache = data.cache;
    const laid = cache.layout && cache.layout.laid;
    if (!laid || !cache.dom) return;
    const segs = laid.map(L => L.seg);

    // What each segment draws: its paragraphs (by number, with their place in
    // the segment), or the display whose first row it starts with.
    const byPara = new Map(), byItem = new Map();
    segs.forEach((seg, i) => {
        if (seg.kind === 'text') seg.items.forEach((it, j) => byPara.set(it.index, [i, j]));
        else if (seg.kind === 'display') byItem.set(seg.rows[0].item, i);
    });
    const content = data.doc.content || [];

    if (layer.dataset.placed !== '1') { layer.style.cssText = ANCHOR; layer.dataset.placed = '1'; }
    // All reads first, then all writes: one layout pass, however long the block.
    const origin = layer.getBoundingClientRect();
    const places = [...layer.children].map(piece => {
        let i, j = -1;
        if (piece.dataset.para) [i, j] = byPara.get(+piece.dataset.para) || [];
        else if (piece.dataset.item) i = byItem.get(content[+piece.dataset.item - 1]);
        const s = i === undefined ? null : cache.dom.segs[i];
        if (!s || !s.box) return null;
        const r = s.box.getBoundingClientRect();
        let y0 = 0, y1 = r.height;
        // A paragraph among several in one segment: from its first line's top
        // to its last line's bottom (a segment laid out later, off screen,
        // has no lines yet and stands whole until it is drawn).
        const L = laid[i];
        if (j >= 0 && L.itemStarts && L.lines && L.lines.length) {
            const a = L.itemStarts[j];
            const b = (j + 1 < L.itemStarts.length ? L.itemStarts[j + 1] : L.lines.length) - 1;
            if (a <= b) {
                y0 = L.baselineYs[a] - maxOf(L.profiles[a], 'h');
                y1 = L.baselineYs[b] + maxOf(L.profiles[b], 'd');
            }
        }
        return { top: r.top - origin.top + y0, left: r.left - origin.left, width: r.width, height: Math.max(1, y1 - y0) };
    });
    [...layer.children].forEach((piece, k) => {
        const p = places[k] || { top: 0, left: 0, width: 1, height: 1 };   // nothing drawn for it: out of sight
        piece.style.cssText = `${PIECE};top:${p.top}px;left:${p.left}px;width:${p.width}px;height:${p.height}px`;
    });
}
