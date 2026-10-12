// SPDX-License-Identifier: AGPL-3.0-or-later
// The painter's sink (render.js): it draws what renderNodes walks into a
// segment's <svg>, reusing the elements of the previous paint.

import { registerStreamSource } from '../defaults/footnotes.ts';
import { BREAK_NODES, SP_TO_PX, gD, gH, gW } from './core.ts';
import { affineOf } from './render.ts';
import { registerLinkGlyph } from '../host/links.ts';
import { colorFill } from '../runtime/colour.ts';
import { renderPiece } from '../host/inline.ts';
import { applyMark, liveOn, registerGlyph } from '../host/marks.ts';
import { registerSpace, selectedGlyph, selectionEdges } from '../host/selection.ts';
import type { GlyphNode, TexNode, ViewerFont } from './model.ts';
import type { Sink, SvgMatrix } from './render.ts';
import type { LayoutCache, PaintStats } from './layout/types.ts';

/** A run of glyphs on a line (px): a reference's, a mark's, the selection's. */
export interface Run { x0: number; x1: number; top: number; bottom: number }
export interface ElementRun extends Run { el: SVGElement }
/** The painter's sink: renderNodes' calls, and what paintSegment asks of it. */
export interface PaintSink extends Sink {
    beginLine(textEl: SVGTextElement, auxEl: SVGGElement): void;
    missing(n: TexNode, x: number, y: number): void;
    takeLinkRuns(): ElementRun[];
    takeMarkRuns(): [number | string, ElementRun][];
    takeSelectionRun(): Run | null;
}

// ── SVG renderer ──────────────────────────────────────────────────────────────

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,String(v));
    return el;
}

// renderNodes emits glyphs, spaces, and rules through a sink object. The sink
// reconciles against the SVG elements of the previous render instead of
// recreating them: every element is keyed by the identity of the node-list
// object it renders (node objects are decoded once per block and never
// change). Because lines are contiguous slices of one fixed node sequence,
// the global emission order is break-invariant – a reflow can move elements
// between lines and toggle conditional ones (disc pre/post vs replace,
// boundary spaces) on and off, but never reorder them. So reconciliation is
// a single forward merge: reused elements in place cost two attribute writes,
// out-of-place ones a single insertBefore, and toggled-off ones are detached
// (kept in the byNode cache for later reattachment, so after both paths of a
// disc have been seen once, reflows allocate nothing at all).


// A band's least height, in em of the glyphs' size: a parenthesis's, as in
// Computer Modern (0.75 em up, 0.25 down), which just covers capitals,
// ascenders and descenders. (LaTeX's \strut, 0.84 and 0.36 em, fills the
// whole line spacing: bands that met, and sat loose around the letters.)
// Lines 1.2 em apart keep a gap of 0.2 em between their bands.
export const BAND_MIN = { up: 0.75, down: 0.25 };

export function reconcileSink(byNode: Map<TexNode, SVGElement>, used: Set<Element>, stats: PaintStats, cache: LayoutCache): PaintSink {
    let textParent: SVGElement | null = null, auxParent: SVGElement | null = null;
    let lastTspan: Element | null = null, lastRect: Element | null = null;
    const stack: { textParent: SVGElement | null; auxParent: SVGElement | null; lastTspan: Element | null; lastRect: Element | null }[] = [];
    const linkRuns = new Map<string, ElementRun>();   // data-link key → { el, x0, x1, top, bottom }
    const markRuns = new Map<number | string, ElementRun>();   // mark index, or live mark id → { el, x0, x1, top, bottom }
    let selRun: Run | null = null;            // the selection on this line, drawn as a band (host/selection.ts)
    // How far the line reaches above and below: each glyph's ink, and at
    // least a parenthesis at its size (BAND_MIN). A band – a mark's, the selection's –
    // is never less than the line: one over "one" is as tall as one over
    // "gyR", and all its lines are even, grown only by a taller glyph on
    // the line (a superscript, a big operator).
    let lineTop = Infinity, lineBottom = -Infinity;
    // Where the selection's ends fall between glyphs (host/selection.ts,
    // Edge), as x on this line: afterX where its band may start, beforeX
    // where it may end. An end after a space waits for the next glyph's x.
    const edges = selectionEdges();
    let afterX: number | null = null, beforeX: number | null = null, endAtNext = false;
    const edgeX = (n: TexNode, x: number, w: number) => {
        const { start, end } = edges;
        if (start && start.node === n) afterX = start.side === 'right' ? x + w : x;
        if (end && end.node === n) { if (end.side === 'left') beforeX = x; else endAtNext = true; }
    };
    const toLine = <R extends Run>(r: R): R => { r.top = Math.min(r.top, lineTop); r.bottom = Math.max(r.bottom, lineBottom); return r; };
    const extend = <K>(runs: Map<K, ElementRun>, key: K, el: SVGElement, x: number, n: TexNode, y: number) => {
        const x1 = x + gW(n) * SP_TO_PX, top = y - gH(n) * SP_TO_PX, bottom = y + gD(n) * SP_TO_PX;
        const r = runs.get(key);
        if (!r) runs.set(key, { el, x0: x, x1, top, bottom });
        else {
            r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x1);
            r.top = Math.min(r.top, top); r.bottom = Math.max(r.bottom, bottom);
        }
    };

    function place(parent: Element, last: Element | null, el: Element, isNew: boolean) {
        const expected = last ? last.nextSibling : parent.firstChild;
        if (el !== expected) {
            parent.insertBefore(el, expected);
            if (!isNew) stats.moved++;
        }
    }

    return {
        beginLine(textEl: SVGTextElement, auxEl: SVGGElement) {
            textParent = textEl; auxParent = auxEl; lastTspan = null; lastRect = null;
            lineTop = Infinity; lineBottom = -Infinity;
            afterX = null; beforeX = null; endAtNext = false;
        },
        // Rotated glyphs cannot go in the line's shared <text>: a tspan takes
        // no transform of its own (SVG 1.1), and x/y on a tspan would fight
        // the group's matrix anyway. So a transform gets its own <g> holding
        // its own <text>, and sits in the aux parent next to rules and
        // pictures. Nesting works because the parents are stacked.
        beginTransform(n: TexNode, tf: SvgMatrix) {
            let g = byNode.get(n);
            const isNew = !g;
            if (!g) {
                g = svgEl('g', {});
                const t = svgEl('text', {});
                t.style.cssText = 'font-weight:normal;font-style:normal';
                g.appendChild(t);
                byNode.set(n, g); stats.created++;
            } else { stats.repositioned++; }
            const [a,b,c,d,e,f] = affineOf(tf);
            g.setAttribute('transform', `matrix(${a} ${b} ${c} ${d} ${e} ${f})`);
            place(auxParent!, lastRect, g, isNew);
            used.add(g); lastRect = g;
            stack.push({ textParent, auxParent, lastTspan, lastRect });
            textParent = g.firstChild as SVGTextElement; auxParent = g;
            // The group's own <text> is not in `used`: it lives and goes with
            // the group. Swept on its own, it was taken out of a group that a
            // later paint reused, empty (and g.firstChild null from then on).
            lastTspan = null; lastRect = g.firstChild as Element;
        },
        endTransform() {
            const s = stack.pop()!;
            textParent = s.textParent; auxParent = s.auxParent;
            lastTspan = s.lastTspan; lastRect = s.lastRect;
        },
        glyph(n: GlyphNode, x: number, y: number, fi: ViewerFont | undefined) {
            // No loadable font for this glyph → draw its metric boxes instead of
            // an unshapeable character (see missing()).
            if (fi?.unresolved) { this.missing(n, x, y); return; }
            let el = byNode.get(n), isNew = !el;
            if (!el) {
                el = svgEl('tspan', {x, y, 'font-family': fi?.family ?? 'serif', 'font-size': fi?.size_px ?? 12});
                // A \webtext slot's word (see Slots) is a whole word, as text.
                el.textContent = n.text !== undefined ? n.text : String.fromCodePoint(n.char!);
                // Inline style so it wins over the page's `fill: currentColor`
                // rule; uncoloured glyphs keep currentColor (dark-mode aware).
                // Coloured ones go through the theme substitution maps.
                if (n.color) el.style.fill = colorFill(n.color);
                // a broken word's hyphen: copied without it ('keep': with it), the word joined
                if (BREAK_NODES.has(n)) el.dataset.break = BREAK_NODES.get(n) === 'keep' ? 'keep' : '';
                if (n.stream)     registerStreamSource(el, n.stream, cache);
                if (n.link)       registerLinkGlyph(el, n.link, cache);
                if (n.mark)       applyMark(el, n.mark, cache);
                // A \webtext's glyphs – TeX's default or a text the page gave
                // – carry its name, so a page can find (and style) where it is.
                if (n.slot && cache.slotNames && cache.slotNames[n.slot - 1] !== undefined)
                    el.dataset.slot = cache.slotNames[n.slot - 1];
                registerGlyph(el, n);
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', String(x)); el.setAttribute('y', String(y)); stats.repositioned++;
            }
            // Live marks (host.addMark, a reader's highlight) come and go
            // while the element stays: their ids are set on every paint.
            const live = liveOn(n);
            if (live) el.dataset.rtxMarks = live.join(' ');
            else if (el.dataset.rtxMarks !== undefined) delete el.dataset.rtxMarks;
            place(textParent!, lastTspan, el, isNew);
            used.add(el); lastTspan = el;
            // The extent of each reference on this line, for its hit area
            // (see paintLinkHits). Not inside a transform: that has its own
            // coordinates.
            if (el.dataset.link && !stack.length) extend(linkRuns, el.dataset.link, el, x, n, y);
            if (!stack.length) {
                const em = fi?.size_px ?? 12;
                lineTop = Math.min(lineTop, y - Math.max(BAND_MIN.up * em, gH(n) * SP_TO_PX));
                lineBottom = Math.max(lineBottom, y + Math.max(BAND_MIN.down * em, gD(n) * SP_TO_PX));
            }
            // And of each mark, for its band (see paintMarkBands).
            if (n.mark && !stack.length) extend(markRuns, n.mark, el, x, n, y);
            if (live && !stack.length) for (const id of live) extend(markRuns, id, el, x, n, y);
            // And of the selection, when it is drawn as bands (its height is
            // the line's, as a mark's: toLine).
            if (!stack.length) {
                if (endAtNext) { beforeX = x; endAtNext = false; }
                edgeX(n, x, gW(n) * SP_TO_PX);
            }
            if (!stack.length && selectedGlyph(n)) {
                const x1 = x + gW(n) * SP_TO_PX;
                if (!selRun) selRun = { x0: x, x1, top: y, bottom: y };
                else { selRun.x0 = Math.min(selRun.x0, x); selRun.x1 = Math.max(selRun.x1, x1); }
            }
        },
        // The references' extents on the line just drawn; starts afresh.
        takeLinkRuns() { const runs = [...linkRuns.values()]; linkRuns.clear(); return runs; },
        // The marks' and the selection's, at least as tall as the line.
        takeMarkRuns() { const runs = [...markRuns.entries()].map(([k, r]): [number | string, ElementRun] => [k, toLine(r)]); markRuns.clear(); return runs; },
        // The selection's, reaching the edges its ends fall on: over the
        // space after "word" when it starts at the end of the d; the space
        // alone when no glyph between is selected.
        takeSelectionRun() {
            let r = selRun;
            if (r) {
                if (afterX !== null && afterX < r.x0) r.x0 = afterX;
                if (beforeX !== null && beforeX > r.x1) r.x1 = beforeX;
            } else if (afterX !== null && beforeX !== null && beforeX > afterX) {
                r = { x0: afterX, x1: beforeX, top: Infinity, bottom: -Infinity };
            }
            selRun = null;
            return r && toLine(r);
        },
        // A glyph whose font could not be loaded: draw its TeX metric boxes – the
        // advance width by the height above the baseline, and by the depth below –
        // as two outlined rects, so the missing ink's place and size are visible.
        missing(n: TexNode, x: number, y: number) {
            let el = byNode.get(n), isNew = !el;
            const w = gW(n) * SP_TO_PX;
            const h = gH(n) * SP_TO_PX;                 // above the baseline
            const d = gD(n) * SP_TO_PX;                 // below the baseline
            const boxes: [number, number, number, number][] = [];
            if (h > 0) boxes.push([x, y - h, w, h]);
            if (d > 0) boxes.push([x, y,     w, d]);
            if (!el) {
                el = svgEl('g', { class: 'latex-missing-glyph' });
                for (const [bx, by, bw, bh] of boxes) {
                    const r = svgEl('rect', { x: bx, y: by, width: bw, height: bh });
                    r.style.fill = 'none';
                    r.style.stroke = 'var(--latex-color-ff0000, #cc0000)';
                    r.style.strokeWidth = '1';
                    r.style.opacity = '0.55';
                    el.appendChild(r);
                }
                byNode.set(n, el); stats.created++;
            } else {
                const rects = el.children;
                boxes.forEach(([bx, by, bw, bh], i) => {
                    rects[i].setAttribute('x', String(bx));     rects[i].setAttribute('y', String(by));
                    rects[i].setAttribute('width', String(bw)); rects[i].setAttribute('height', String(bh));
                });
                stats.repositioned++;
            }
            place(auxParent!, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
        space(n, x, y) {
            let el = byNode.get(n), isNew = !el;
            if (!el) {
                el = svgEl('tspan', {x, y});
                el.textContent = ' ';
                // Not a target: the pointer between two words of a reference
                // must reach the reference's hit area below (paintLinkHits).
                el.style.pointerEvents = 'none';
                registerSpace(el, n);
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', String(x)); el.setAttribute('y', String(y)); stats.repositioned++;
            }
            place(textParent!, lastTspan, el, isNew);
            used.add(el); lastTspan = el;
            if (!stack.length) edgeX(n, x, 0);
        },
        rule(n, x, y, w, h) {
            let el = byNode.get(n), isNew = !el;
            if (!el) {
                el = svgEl('rect', {x, y, width: w, height: h});
                // Always set the fill inline rather than leaving it to page
                // CSS: a blanket `rect { fill: currentColor }` would also hit
                // the shapes inside a tikzpicture and flatten their colours,
                // since CSS outranks the presentation attributes dvisvgm emits.
                el.style.fill = n.color ? colorFill(n.color)
                                        : 'var(--latex-color-000000, currentColor)';
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
                el.setAttribute('width', String(w)); el.setAttribute('height', String(h));
                stats.repositioned++;
            }
            place(auxParent!, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
        // Where a \webaside stood (see Asides): an empty rect at the pen
        // position on the baseline, drawing nothing, for aside.anchor().
        aside(n, x, y) {
            let el = byNode.get(n), isNew = !el;
            if (!el) {
                el = svgEl('rect', { x, y, width: 0, height: 0 });
                el.setAttribute('class', 'latex-aside-mark');
                el.dataset.aside = String(n.aside);
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
                stats.repositioned++;
            }
            place(auxParent!, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
        // A widget part (see Widgets): HTML in a foreignObject over the part's
        // box, so it moves with the text on every reflow. Drawn by the widget
        // once, when the element is made: a new measurement makes new nodes.
        widget(n, x, y) {
            let el = byNode.get(n), isNew = !el;
            const h = n.height * SP_TO_PX, d = n.depth * SP_TO_PX, w = n.width * SP_TO_PX;
            if (!el) {
                el = svgEl('foreignObject', { width: w, height: h + d });
                el.setAttribute('class', 'latex-widget');
                // every part of one widget shares a key, for the shared hover
                // and pressed states (installWidgetStates)
                el.dataset.widget = `${cache.blockKey}:${n.slot}`;
                el.style.overflow = 'visible';
                el.style.pointerEvents = 'auto';
                const box = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                box.style.cssText = `width:${w}px;height:${h + d}px;font-size:${n.fontPx}px;` +
                    `line-height:normal;color:${n.color ? colorFill(n.color) : 'currentColor'};` +
                    // content aligned by baseline, as ctx.measure measured it: the
                    // highest-reaching element's top at the widget's top, so the
                    // shared baseline lands on the line's
                    'display:flex;align-items:baseline;user-select:none;-webkit-user-select:none';
                el.appendChild(box);
                renderPiece(n, el, box, cache);
                byNode.set(n, el); stats.created++;
            } else {
                stats.repositioned++;
            }
            el.setAttribute('x', String(x)); el.setAttribute('y', String(y - h));
            place(auxParent!, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
        // A precompiled TikZ box or included PDF page. Its markup never changes,
        // so reflowing is only a new transform – the drawing is built once.
        picture(n, x, y) {
            let el = byNode.get(n), isNew = !el;
            const pic = n.pic;
            if (!el) {
                // A drawing carries its own colours (already rewritten to
                // the theme's custom properties), unlike glyph ink which is
                // themed wholesale. The class marks that boundary for page CSS
                // and for anyone inspecting the DOM.
                el = svgEl('g', { class: 'latex-picture' });
                if (pic) el.innerHTML = pic.svg;
                // dvisvgm omits fill on black paths (SVG's initial fill is
                // black), so the theme's default text colour is supplied here
                // by inheritance rather than rewritten into every path.
                el.setAttribute('fill', 'var(--latex-color-000000, currentColor)');
                byNode.set(n, el); stats.created++;
            } else {
                stats.repositioned++;
            }
            // The source viewBox is in bp; scaling it to the node's TeX width
            // makes the drawing fill its box exactly, at any zoom.
            const s = pic && pic.vb_w ? (n.width * SP_TO_PX) / pic.vb_w : 1;
            el.setAttribute('transform',
                `translate(${x} ${y - n.height * SP_TO_PX}) scale(${s})`);
            place(auxParent!, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
    };
}

