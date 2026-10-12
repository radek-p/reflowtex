// SPDX-License-Identifier: AGPL-3.0-or-later
// The accessible layer's text fitted onto the drawing (a11y.js): runs laid
// out as one flow of text over their drawn lines, their letters spaced to
// their drawn width, formulas scaled onto their glyphs, and a piece's text
// sized to fill it. Measures first, then writes: one layout each.

export const MIN_PX = 1;
const unescape = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** A formula's words: its alttext. */
const wordsOf = mathml => { const m = /\balttext="([^"]*)"/.exec(mathml); return m ? unescape(m[1]) : ''; };

/** The runs as one flow of text in the piece (svg units → the piece's own
 *  px, through the segment's screen matrix): line by line, each line set on
 *  its drawn line by its line height (its text box's top on the drawn
 *  line's top, the box as tall as the line), a spacer before each run that
 *  does not start where the one before ended. Returns what is still to be
 *  fitted: the runs' letter spacing, the formulas' scale. */
export function layOutRuns({ piece, p, runs, origin }, mode) {
    const m = p.ctm, pieceLeft = origin.left + p.left, pieceTop = origin.top + p.top;
    const ratio = textBoxRatio(piece.parentElement);
    const byLine = new Map();
    for (const r of runs) {
        if (!byLine.has(r.line)) byLine.set(r.line, { y0: r.ly0, y1: r.ly1, runs: [] });
        byLine.get(r.line).runs.push(r);
    }
    const frag = document.createDocumentFragment(), fit = [];
    let flowTop = 0, first = true;
    for (const ln of byLine.values()) {
        if (!first) frag.appendChild(document.createElement('br'));
        first = false;
        const top = m.d * ln.y0 + m.f - pieceTop, c = Math.max(1, m.d * (ln.y1 - ln.y0));
        // the line box's height: its text box (c, centred in it) lands on top
        const lh = Math.max(0, 2 * (top - flowTop) + c), lineTop = flowTop;
        flowTop += lh;
        let x = 0;
        for (const r of ln.runs) {
            if (r.sp) frag.appendChild(document.createTextNode(' '));   // (the piece's font has no size: no width)
            const left = m.a * r.x0 + m.e - pieceLeft, w = Math.max(1, m.a * (r.x1 - r.x0));
            // where it does not start where the last ended (an indent, a gap
            // the runs leave out): a margin of its own – no element between
            const gap = Math.abs(left - x) > 0.25 ? `;margin-left:${left - x}px` : '';
            if (r.mathml && mode === 'mathml') {
                // a box as wide as the formula and of no height (so no line
                // grows), the MathML in it on the formula's own glyphs
                const box = document.createElement('span');
                box.style.cssText = `display:inline-block;position:relative;width:${w}px;height:0;vertical-align:top${gap}`;
                box.innerHTML = r.mathml;
                const math = box.firstElementChild;
                math.dataset.run = 'math';
                // (its own size: the flow around it has none)
                math.style.cssText = `position:absolute;left:0;top:${m.d * r.y0 + m.f - pieceTop - lineTop}px;display:inline-block;transform-origin:0 0;font-size:${c / ratio}px;line-height:normal;white-space:nowrap`;
                frag.appendChild(box);
                fit.push({ el: math, w, h: Math.max(1, m.d * (r.y1 - r.y0)), scale: true });
            } else {
                const span = document.createElement('span');
                span.dataset.run = r.mathml ? 'spoken' : 'text';
                // a formula's words, no spaces of their own: the text around
                // them has the source's ("The ith", not "The i th")
                span.textContent = r.mathml ? wordsOf(r.mathml) : r.text;
                span.style.cssText = `white-space:pre;font-size:${c / ratio}px;line-height:${lh}px${gap}`;
                frag.appendChild(span);
                fit.push({ el: span, w });
            }
            x = left + w;
        }
    }
    piece.replaceChildren(frag);
    return fit;
}

/** The text box's height for a font size of 1px, in the layer's font:
 *  measured once per layer. */
const ratios = new WeakMap();
function textBoxRatio(layer) {
    if (ratios.has(layer)) return ratios.get(layer);
    const probe = document.createElement('span');
    probe.textContent = 'Hxgy';
    probe.style.cssText = 'position:absolute;font-size:100px;line-height:normal;white-space:pre;opacity:0';
    layer.appendChild(probe);
    const range = document.createRange();
    range.selectNodeContents(probe);
    const r = range.getBoundingClientRect().height / 100 || 1.2;
    probe.remove();
    ratios.set(layer, r);
    return r;
}

/** The runs fitted to their stretches: a run's letters spaced so its text is
 *  as wide as its stretch; a formula scaled onto its glyphs. All measured
 *  first, then all set: one layout. */
export function fitRuns(items) {
    for (const it of items) if (it.scale) it.el.style.transform = 'none'; else it.el.style.letterSpacing = '0px';
    const sizes = items.map(({ el }) => {
        const r = el.localName === 'math' ? el.getBoundingClientRect()
            : (() => { const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect(); })();
        return [r.width, r.height];
    });
    items.forEach((it, k) => {
        const [nw, nh] = sizes[k];
        it.nw = nw;
        if (it.scale) { if (nw > 0 && nh > 0) it.el.style.transform = `scale(${it.w / nw}, ${it.h / nh})`; return; }
        const n = [...(it.el.textContent || '')].length;
        if (n && nw > 0) { it.ls = (it.w - nw) / n; it.el.style.letterSpacing = `${it.ls}px`; }
    });
    // Measured once more: Chromium spaces every letter, WebKit all but the
    // last, so a run squeezed hard (a formula's words) comes out a letter's
    // spacing too wide. What a letter's spacing actually added corrects it.
    const spaced = items.filter(it => it.ls);
    const widths = spaced.map(it => textWidth(it.el));
    spaced.forEach((it, k) => {
        const letters = (widths[k] - it.nw) / it.ls;
        if (letters > 0.5 && Math.abs(widths[k] - it.w) > 0.25) it.el.style.letterSpacing = `${(it.w - it.nw) / letters}px`;
    });
    // A run squeezed so hard that letters would need a negative width (WebKit
    // stops at none) stays wider than its stretch: a negative margin as wide
    // as the excess brings what follows back where it is drawn.
    const final = spaced.map(it => textWidth(it.el));
    spaced.forEach((it, k) => { if (final[k] > it.w + 0.25) it.el.style.marginRight = `${it.w - final[k]}px`; });
}
function textWidth(el) { const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect().width; }

/** Each element scaled from its natural size onto w × h – all measured first,
 *  then all scaled: one layout. The scale a layout before left is taken off
 *  first: the browser measures an element as transformed. */
export function scaleOnto(items) {
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
export function fitText(fits) {
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
