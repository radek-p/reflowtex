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
//
// Inside a piece, the text is set as large as fits the piece, so it wraps
// much as the drawn lines do: VoiceOver frames the words it reads, and text
// at the page's own size would wrap elsewhere, frame the wrong place and run
// past the piece's edge – where it is clipped, and a screen reader skips
// clipped text. Fitting costs a layout of every piece fitted, so only pieces
// within a few screens of the window are fitted; the rest follow as they come
// near (the viewer places the layer again whenever it draws lines there).
// Until then a piece does not clip its text vertically: sized roughly, but
// nothing in it hidden.

// The layer turns into a zero-height anchor the pieces hang from; a piece is
// placed relative to it, so the page may move the block and its layer freely.
const ANCHOR = 'position:relative;height:0;margin:0;padding:0;border:0;overflow:visible';
const PIECE  = 'position:absolute;margin:0;padding:0;opacity:0;line-height:1.15;'
             + 'white-space:normal;pointer-events:none;user-select:none;-webkit-user-select:none';
const LINE_HEIGHT = 1.15;          // the pieces' line-height, as in PIECE
const MIN_PX = 1;
const FITTED   = ';overflow:hidden';
const UNFITTED = ';overflow-x:clip;overflow-y:visible';   // no sideways page scroll from wide maths
/** Near the window: within this many window heights above or below it. */
const NEAR = 2;

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
        let y0 = 0, y1 = r.height, lines = 1;
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
                lines = b - a + 1;
            }
        }
        return { top: r.top - origin.top + y0, left: r.left - origin.left, width: r.width, height: Math.max(1, y1 - y0), lines };
    });
    const pieces = [...layer.children];
    const refit = [];
    const h = window.innerHeight;
    pieces.forEach((piece, k) => {
        const p = places[k] || { top: 0, left: 0, width: 1, height: 1, lines: 1 };   // nothing drawn for it: out of sight
        const size = `${Math.round(p.width)}x${Math.round(p.height)}`;
        const fitted = piece.dataset.size === size;
        const top = origin.top + p.top;                    // relative to the window
        const near = top + p.height > -NEAR * h && top < (NEAR + 1) * h;
        const guess = Math.max(MIN_PX, p.height / p.lines / LINE_HEIGHT);
        const font = fitted ? piece.style.fontSize : `${guess}px`;
        piece.style.cssText = `${PIECE};top:${p.top}px;left:${p.left}px;width:${p.width}px;height:${p.height}px;font-size:${font}`
                            + (fitted || near ? FITTED : UNFITTED);
        if (!fitted) {
            if (near) { piece.dataset.size = size; refit.push({ piece, px: guess }); }
            else delete piece.dataset.size;
        }
    });
    fitText(refit);
}

/** Each piece's text at the size that fills it. First guess: the drawn line
 *  pitch (a paragraph's height over its lines). Text that does not fit is
 *  scaled down in one step – its height goes roughly with the square of the
 *  size – then checked again; the few that still overflow (a table does
 *  not scale evenly) shrink a little each round. All pieces at once, so a
 *  round costs one layout: two for nearly every page. */
function fitText(fits) {
    const overflows = p => p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1;
    for (const f of fits) f.piece.style.fontSize = `${f.px}px`;
    for (let round = 0; round < 8 && fits.length; round++) {
        const scale = fits.map(f => {
            const p = f.piece;
            if (!overflows(p)) return 1;
            const r = Math.min(p.clientHeight / p.scrollHeight, p.clientWidth / p.scrollWidth);
            return round === 0 ? Math.sqrt(r) * 0.95 : Math.min(r, 0.9);
        });
        fits = fits.filter((f, k) => {
            if (scale[k] === 1) return false;
            f.px = Math.max(MIN_PX, f.px * scale[k]);
            f.piece.style.fontSize = `${f.px}px`;
            return true;
        });
    }
}
