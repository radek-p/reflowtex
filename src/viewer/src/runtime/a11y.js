// SPDX-License-Identifier: AGPL-3.0-or-later

// The accessible layer (src/pipeline/a11y.ts), laid over what it stands for.
//
// A page built with it has, right after a block, the block's text and
// formulas (MathML) for screen readers, while the drawing is hidden from them.
// As shipped, the layer is one visually hidden element after the block, in
// reading order. A screen reader scrolls to what it reads, and VoiceOver
// outlines each run of text and each formula it reads – so once the block is
// laid out, the layer is laid over the drawing, piece by piece and line by
// line:
//
//   * each piece – a paragraph (data-para), a display (data-item) – is placed
//     over its drawn lines, invisible (opacity 0), letting the pointer through;
//   * inside a paragraph near the window, the text is rebuilt from the drawn
//     lines: for every stretch of a line between formulas, a run of its text
//     placed on that stretch and stretched to its drawn width; for every
//     formula, its MathML placed and scaled onto the formula's drawn box. So
//     each outline VoiceOver draws lies on the glyphs it stands for. (A
//     formula broken over two lines has its MathML on its first part.)
//   * a display's MathML is scaled onto the display's drawing.
//
// Pieces far from the window keep the shipped text, sized roughly, until they
// come near (the viewer places the layer again whenever it draws lines
// there); until then they do not clip vertically, so nothing in them is hidden
// (a screen reader skips clipped text). Without the viewer the layer keeps its
// shipped form.

import { SP_TO_PX, useGlyphMetrics } from '../engine/core.js';
import { renderNodes } from '../engine/paint.js';

// The layer turns into a zero-height anchor the pieces hang from; a piece is
// placed relative to it, so the page may move the block and its layer freely.
const ANCHOR = 'position:relative;height:0;margin:0;padding:0;border:0;overflow:visible';
const PIECE  = 'position:absolute;margin:0;padding:0;opacity:0;line-height:1.15;'
             + 'white-space:normal;pointer-events:none;user-select:none;-webkit-user-select:none';
const LINE_HEIGHT = 1.15;          // the pieces' line-height, as in PIECE
const MIN_PX = 1;
const FITTED   = ';overflow:hidden';
const UNFITTED = ';overflow-x:clip;overflow-y:visible';   // no sideways page scroll from wide maths
const LINED    = ';overflow:visible';                     // runs lie on the lines, inside the piece
// A run: placed at its stretch of a line, scaled from its natural size to it.
const RUN = 'position:absolute;margin:0;padding:0;white-space:pre;transform-origin:0 0;display:block';
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
        let y0 = 0, y1 = r.height, lines = 1, a = -1, b = -1;
        // A paragraph among several in one segment: from its first line's top
        // to its last line's bottom (a segment laid out later, off screen,
        // has no lines yet and stands whole until it is drawn).
        const L = laid[i];
        if (j >= 0 && L.itemStarts && L.lines && L.lines.length) {
            a = L.itemStarts[j];
            b = (j + 1 < L.itemStarts.length ? L.itemStarts[j + 1] : L.lines.length) - 1;
            if (a <= b) {
                y0 = L.baselineYs[a] - maxOf(L.profiles[a], 'h');
                y1 = L.baselineYs[b] + maxOf(L.profiles[b], 'd');
                lines = b - a + 1;
            }
        }
        const ctm = s.svg && s.svg.getScreenCTM && s.svg.getScreenCTM();
        return { top: r.top - origin.top + y0, left: r.left - origin.left, width: r.width, height: Math.max(1, y1 - y0),
                 lines, seg: i, a, b, ctm, display: !!piece.dataset.item };
    });
    const pieces = [...layer.children];
    const refit = [], lined = [], scaled = [];
    const h = window.innerHeight;
    pieces.forEach((piece, k) => {
        const p = places[k] || { top: 0, left: 0, width: 1, height: 1, lines: 1 };   // nothing drawn for it: out of sight
        const top = origin.top + p.top;                    // relative to the window
        const near = top + p.height > -NEAR * h && top < (NEAR + 1) * h;
        const box = `${PIECE};top:${p.top}px;left:${p.left}px;width:${p.width}px;height:${p.height}px`;
        // A paragraph near the window whose lines are laid out: line by line.
        if (near && p.a >= 0 && p.ctm) {
            const key = `${Math.round(p.width)}x${Math.round(p.height)}@${p.a}-${p.b}`;
            piece.style.cssText = box + LINED;
            if (piece.dataset.lines !== key) {
                const runs = runsOf(data, p.seg, p.a, p.b);
                if (runs) { piece.dataset.lines = key; lined.push({ piece, p, runs, origin }); return; }
            } else return;
        }
        // A display near the window: its MathML scaled onto the drawing's ink
        // (the piece spans the display's whole band; the formula is narrower).
        if (near && p.display && p.ctm) {
            const math = piece.querySelector('math');
            const ink = math && inkOf(data, p.seg);
            if (ink) {
                const m = p.ctm, left = m.a * ink.x0 + m.e - origin.left, top = m.d * ink.y0 + m.f - origin.top;
                const w = Math.max(1, m.a * (ink.x1 - ink.x0)), hh = Math.max(1, m.d * (ink.y1 - ink.y0));
                piece.style.cssText = `${PIECE};top:${top}px;left:${left}px;width:${w}px;height:${hh}px` + LINED;
                math.dataset.run = 'display';
                math.style.display = 'inline-block';           // its own size, not the piece's width
                scaled.push({ el: math, w, h: hh });
                return;
            }
        }
        const size = `${Math.round(p.width)}x${Math.round(p.height)}`;
        const fitted = piece.dataset.size === size && !piece.dataset.lines;
        const guess = Math.max(MIN_PX, p.height / p.lines / LINE_HEIGHT);
        const font = fitted ? piece.style.fontSize : `${guess}px`;
        piece.style.cssText = `${box};font-size:${font}` + (fitted || near ? FITTED : UNFITTED);
        if (!fitted) {
            if (near) { piece.dataset.size = size; refit.push({ piece, px: guess }); }
            else delete piece.dataset.size;
        }
    });
    for (const l of lined) scaled.push(...layOutRuns(l));
    fitText(refit);
    scaleOnto(scaled);
}

// ── Line by line ─────────────────────────────────────────────────────────────

/** A glyph's text: private-use code points (glyphs addressed by index,
 *  unencoded variants) say nothing; ligatures read as their letters. As the
 *  builder reads them (src/pipeline/a11y.ts). */
function glyphText(cp) {
    if ((cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000) return '';
    const ch = String.fromCodePoint(cp);
    return cp >= 0xFB00 && cp <= 0xFB06 ? ch.normalize('NFKC') : ch;
}
/** The text of a box's contents (a \mbox, a footnote mark). */
function textOf(nodes) {
    let s = '';
    for (const n of nodes || []) {
        if (n.type === 'glyph' && n.char !== undefined) s += glyphText(n.char);
        else if (n.type === 'glue' && (n.width || 0) > 0) s += ' ';
        else if (n.type === 'disc') s += textOf(n.replace);
        else if (n.children) s += textOf(n.children);
    }
    return s;
}

/** The paragraph's lines a..b of segment i as runs, in svg units: text
 *  { text, x0, x1, y0, y1 } and formulas { mathml, x0, x1, y0, y1 }. Null
 *  when the segment has no lines laid out. (The pen positions are replayed
 *  as the painter would place them: api.inspect.replay's way.) */
function runsOf(data, i, a, b) {
    const L = data.cache.layout.laid[i];
    if (!L || L.deferred || !L.lines || !L.lrp) return null;
    useGlyphMetrics(data.cache.metrics);
    const noop = () => {};
    const runs = [];
    let inFormula = 0;                    // depth of a formula carried over from the line before
    for (let j = a; j <= b; j++) {
        // every node's pen position and advance; every glyph's ink, up and down
        // (a formula's run spans its own glyphs: limits and fractions reach
        // past the line's text)
        const pos = new Map(), ink = [];
        const metrics = data.cache.metrics || [];
        const sink = { glyph: noop, missing: noop, space: noop, rule: noop, picture: noop,
                       beginTransform: noop, endTransform: noop, node: (n, x, y, w) => {
                           pos.set(n, { x, w });
                           if (n.type === 'glyph') {
                               const g = n.metrics ? metrics[n.metrics - 1] || {} : n;
                               ink.push({ x, x1: x + w, top: y - (g.height || 0) * SP_TO_PX, bottom: y + (g.depth || 0) * SP_TO_PX });
                           }
                       } };
        const { ratio, er, x0, fillRatio, fillOrder } = L.lrp[j];
        const nodes = L.lines[j].nodes;
        renderNodes(data.fontInfo, sink, nodes, x0, L.baselineYs[j], fillOrder ? fillRatio : ratio, er, fillOrder || 0);
        const y0 = L.baselineYs[j] - maxOf(L.profiles[j], 'h'), y1 = L.baselineYs[j] + maxOf(L.profiles[j], 'd');
        let text = null;
        const flush = () => { if (text && text.text.trim()) runs.push(text); text = null; };
        const addText = (s, n) => {
            const p = pos.get(n);
            if (!s) return;
            if (!text) {
                if (!s.trim()) return;                       // no run starts with a space
                text = { text: '', x0: Infinity, x1: -Infinity, y0, y1 };
            }
            text.text += s;
            if (p && s.trim()) { text.x0 = Math.min(text.x0, p.x); text.x1 = Math.max(text.x1, p.x + p.w); }
        };
        for (let k = 0; k < nodes.length; k++) {
            const n = nodes[k];
            if (inFormula) {                                 // the rest of a formula begun above
                if (n.type === 'math') inFormula += (n.subtype || 0) === 0 ? 1 : -1;
                continue;
            }
            if (n.type === 'math' && (n.subtype || 0) === 0 && n.mathml) {
                flush();
                let depth = 1, e = k + 1;
                for (; e < nodes.length; e++) {
                    if (nodes[e].type === 'math') depth += (nodes[e].subtype || 0) === 0 ? 1 : -1;
                    if (depth === 0) break;
                }
                const start = pos.get(n), end = e < nodes.length ? pos.get(nodes[e]) : null;
                const last = pos.get(nodes[nodes.length - 1]);
                const x1 = end ? end.x : (last ? last.x + last.w : start.x);
                const mine = ink.filter(g => g.x >= start.x - 0.5 && g.x1 <= x1 + 0.5);
                const my0 = mine.length ? Math.min(...mine.map(g => g.top)) : y0;
                const my1 = mine.length ? Math.max(...mine.map(g => g.bottom)) : y1;
                runs.push({ mathml: n.mathml, x0: start.x, x1: Math.max(x1, start.x + 1), y0: my0, y1: my1 });
                if (e >= nodes.length) inFormula = depth;    // it goes on on the next line
                k = e;
                continue;
            }
            if (n.type === 'glyph' && n.char !== undefined) addText(glyphText(n.char), n);
            else if (n.type === 'glue') { if ((n.width || 0) > 0 || (n.stretch || 0) > 0) addText(' ', n); }
            else if (n.type === 'disc') {
                // a hyphen at the line's end is no part of the word
                if (k < nodes.length - 1) addText(textOf(n.replace), n);
                else if (text) text.hyphen = true;
            }
            else if (n.type === 'hlist' || n.type === 'vlist') addText(textOf(n.children), n);
        }
        if (text && !text.hyphen) text.text = text.text.replace(/\s*$/, ' ');   // the line break reads as a space
        if (text) text.text = text.text.replace(/^\s+/, '');
        flush();
    }
    return runs;
}

/** A display segment's ink, in svg units: from its leftmost glyph to its
 *  rightmost, its first line's top to its last line's bottom. Null when it
 *  has no lines laid out. */
function inkOf(data, i) {
    const L = data.cache.layout.laid[i];
    if (!L || L.deferred || !L.lines || !L.lrp) return null;
    useGlyphMetrics(data.cache.metrics);
    const noop = () => {};
    let x0 = Infinity, x1 = -Infinity;
    const sink = { glyph: noop, missing: noop, space: noop, rule: noop, picture: noop, beginTransform: noop, endTransform: noop,
                   node: (n, x, y, w) => { if (n.type === 'glyph' || n.type === 'rule') { x0 = Math.min(x0, x); x1 = Math.max(x1, x + w); } } };
    for (let j = 0; j < L.lines.length; j++) {
        const { ratio, er, x0: lx, fillRatio, fillOrder } = L.lrp[j];
        renderNodes(data.fontInfo, sink, L.lines[j].nodes, lx, L.baselineYs[j], fillOrder ? fillRatio : ratio, er, fillOrder || 0);
    }
    if (!(x1 > x0)) return null;
    const last = L.lines.length - 1;
    return { x0, x1, y0: L.baselineYs[0] - maxOf(L.profiles[0], 'h'), y1: L.baselineYs[last] + maxOf(L.profiles[last], 'd') };
}

/** The runs as elements in the piece, placed on their stretches of the lines
 *  (svg units → the piece's own px, through the segment's screen matrix).
 *  Returns what is to be scaled onto those stretches. */
function layOutRuns({ piece, p, runs, origin }) {
    const m = p.ctm, pieceLeft = origin.left + p.left, pieceTop = origin.top + p.top;
    const frag = document.createDocumentFragment(), scale = [];
    for (const r of runs) {
        const left = m.a * r.x0 + m.e - pieceLeft, top = m.d * r.y0 + m.f - pieceTop;
        const w = Math.max(1, m.a * (r.x1 - r.x0)), h = Math.max(1, m.d * (r.y1 - r.y0));
        const span = document.createElement('span');
        span.dataset.run = r.mathml ? 'math' : 'text';
        // the natural size is measured at a size near the drawn one, then scaled
        span.style.cssText = `${RUN};left:${left}px;top:${top}px;font-size:${h / LINE_HEIGHT}px;line-height:${h}px`;
        if (r.mathml) span.innerHTML = r.mathml;
        else span.textContent = r.text;
        frag.appendChild(span);
        scale.push({ el: span, w, h });
    }
    piece.replaceChildren(frag);
    return scale;
}

/** Each element scaled from its natural size onto w × h – all measured first,
 *  then all scaled: one layout. The scale a layout before left is taken off
 *  first: the browser measures an element as transformed. */
function scaleOnto(items) {
    for (const { el } of items) el.style.transform = 'none';
    const sizes = items.map(({ el }) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
    items.forEach(({ el, w, h }, k) => {
        const [nw, nh] = sizes[k];
        if (!(nw > 0 && nh > 0)) return;
        el.style.transformOrigin = '0 0';
        el.style.transform = `scale(${w / nw}, ${h / nh})`;
    });
}

/** Each piece's text at the size that fills it (a piece not laid out line by
 *  line). First guess: the drawn line pitch (a paragraph's height over its
 *  lines). Text that does not fit is scaled down in one step – its height
 *  goes roughly with the square of the size – then checked again; the few
 *  that still overflow (a table does not scale evenly) shrink a little each
 *  round. All pieces at once, so a round costs one layout: two for nearly
 *  every page. */
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
