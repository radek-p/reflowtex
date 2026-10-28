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
//   * each piece – a paragraph (data-para), a display (data-item), a stream
//     standing in the flow (data-stream: a box, a hint, an accordion) – is
//     placed over its drawn lines or its box, invisible (opacity 0), letting
//     the pointer through; a stream's text is fitted into its box whole;
//   * inside a paragraph near the window, the text is rebuilt from the drawn
//     lines, as one flow of text – as an ordinary paragraph's, so VoiceOver
//     reads it through rather than stopping, with its click, at every
//     element: each drawn line one line of the flow (a line break after it,
//     a line height that sets it on the drawn line, a spacer for its indent);
//     each stretch of text a run set at the size whose text box – what
//     VoiceOver frames – is the drawn line's height, its letters spaced to
//     the stretch's drawn width; each formula its MathML, in a box of no
//     height of its own, scaled onto the formula's drawn glyphs. (A formula
//     broken over two lines has its MathML on its first part.)
//   * a display's MathML is scaled onto the display's drawing.
//
// The reader chooses how formulas are read (reflowtex.setAccessibleMath,
// remembered): as MathML – explorable; VoiceOver stops at each part – or as
// their spoken form (the alttext the build wrote), read on with the sentence.
//
// The layer follows the drawing: a piece is laid out line by line, fitted or
// scaled only once the segment it stands for is painted, from the lines the
// painter drew (each paint is followed by a placement: block-data.ts,
// announceLayout), and only when what it was laid out for has changed. The
// pieces of a segment not painted – far from the window, or left stale by a
// reflow until it comes near again – are only moved onto their boxes, their
// text unfitted at a bounded size: so a resize costs, for the layer, what it
// costs the drawing – the segments near the window. Every piece clips at its
// box, in both directions: whatever its text does, the layer never makes the
// page any larger. A placement that changes nothing writes nothing. Without
// the viewer the layer keeps its shipped form.

import { api } from './page.ts';
import { allData } from './block-data.ts';
import { maxOf, inkOf, runsOf } from './a11y-runs.ts';
import { insertShippedMath } from './a11y-math.ts';
import { MIN_PX, fitRuns, fitText, layOutRuns, scaleOnto, type FitItem, type Lined, type Place } from './a11y-fit.ts';
import type { BlockData } from './block-data.ts';
import type { ContentItem } from '../engine/model.ts';
import type { DomSegment } from '../engine/layout/types.ts';
import { screenCTM } from './screen-ctm.ts';

// The layer turns into a zero-height anchor the pieces hang from, and is moved
// before its block (as shipped it follows it): so every piece hangs below the
// anchor, at a positive offset. Hung upwards from an anchor after the block,
// the pieces gave Safari negative heights for the page and its landmarks, and
// VoiceOver drew its first outline at the block's end. Empty in the flow, the
// layer moves nothing on the page wherever it is. A piece is placed relative
// to it, so the page may move the block and its layer freely. It clips
// sideways at the block's width: a run fitted to its line can still be much
// wider than the line (letter spacing only goes so far below zero, see
// fitRuns), and unclipped it would widen the page.
const ANCHOR = 'position:relative;height:0;margin:0;padding:0;border:0;overflow-x:clip;overflow-y:visible';
const PIECE  = 'position:absolute;margin:0;padding:0;opacity:0;line-height:1.15;overflow:clip;'
             + 'white-space:normal;pointer-events:none;user-select:none;-webkit-user-select:none';
const LINE_HEIGHT = 1.15;          // the pieces' line-height, as in PIECE
const LINED    = ';font-size:0;line-height:0;white-space:nowrap';   // the runs' flow sets the lines

// ── How formulas are read ────────────────────────────────────────────────────
const MODE_KEY = 'reflowtex-a11y-math';
let mode: 'mathml' | 'spoken' = 'mathml';
try { if (localStorage.getItem(MODE_KEY) === 'spoken') mode = 'spoken'; } catch { /* no storage: the default */ }
/** 'mathml' or 'spoken'. */
export const accessibleMath = () => mode;
/** The reader's choice, remembered; every block's layer is laid again, and
 *  the page told (reflowtex:accessible-math, detail {mode}) so every control
 *  showing the choice follows. */
export function setAccessibleMath(m: string): void {
    mode = m === 'spoken' ? 'spoken' : 'mathml';
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* not remembered */ }
    document.dispatchEvent(new CustomEvent('reflowtex:accessible-math', { detail: { mode } }));
    for (const data of allData) {
        const layer = layerOf(data.el);
        if (!layer) continue;
        for (const piece of layer.children as HTMLCollectionOf<HTMLElement>) { restore(piece); laid.delete(piece); }
        placeAccessibleLayer(data);
    }
}
api.accessibleMath = accessibleMath;
api.setAccessibleMath = setAccessibleMath;

// ── Seeing it (a debugging aid, for a while) ─────────────────────────────────
// reflowtex.setAccessibleDebug(true) shows the layer where it lies: its text
// in red over the drawing, each piece outlined, each run – the elements a
// screen reader frames – tinted, neighbours in turn blue and pink (formulas
// green), each stream a purple frame. Remembered; for checking the placement
// on a phone (the reading options offer it, as the inspector does).
const DEBUG_KEY = 'reflowtex-a11y-debug';
const DEBUG_CSS = `
html.latex-a11y-debug .latex-a11y > * { opacity: 1 !important; color: #d0021b !important; background: rgb(255 170 0 / .12);
  outline: 1px dashed rgb(255 120 0 / .9); outline-offset: -1px; }
html.latex-a11y-debug .latex-a11y [data-run]:nth-child(odd) { background: rgb(0 120 255 / .24); }
html.latex-a11y-debug .latex-a11y [data-run]:nth-child(even) { background: rgb(255 0 150 / .2); }
html.latex-a11y-debug .latex-a11y [data-run="math"], html.latex-a11y-debug .latex-a11y [data-run="display"],
html.latex-a11y-debug .latex-a11y > div > math { background: rgb(0 170 70 / .3); }
html.latex-a11y-debug .latex-a11y [data-stream] { outline: 2px solid rgb(130 0 255 / .7); }
html.latex-a11y-debug .latex-a11y [role="note"] { background: rgb(130 0 255 / .1); }`;
let debug = false;
try { debug = localStorage.getItem(DEBUG_KEY) === '1'; } catch { /* no storage: off */ }
/** Whether the layer is shown (a debugging aid). */
export const accessibleDebug = () => debug;
/** Show the layer or hide it again; remembered, and the page told
 *  (reflowtex:accessible-debug, detail {on}). */
export function setAccessibleDebug(on: boolean): void {
    debug = !!on;
    try { if (debug) localStorage.setItem(DEBUG_KEY, '1'); else localStorage.removeItem(DEBUG_KEY); } catch { /* not remembered */ }
    showDebug();
    document.dispatchEvent(new CustomEvent('reflowtex:accessible-debug', { detail: { on: debug } }));
}
function showDebug() {
    if (typeof document === 'undefined') return;
    if (debug && !document.getElementById('latex-a11y-debug-css')) {
        const st = document.createElement('style');
        st.id = 'latex-a11y-debug-css';
        st.textContent = DEBUG_CSS;
        document.head.appendChild(st);
    }
    document.documentElement.classList.toggle('latex-a11y-debug', debug);
}
if (debug) showDebug();
api.accessibleDebug = accessibleDebug;
api.setAccessibleDebug = setAccessibleDebug;

// ── Screen reader mode ───────────────────────────────────────────────────────
// Google Docs' way, while WebKit lets VoiceOver onto hidden text (its text
// navigation ignores aria-hidden: WebKit bug 161740). A click lands
// VoiceOver where the text under the pointer is – on the drawing's glyphs,
// selectable text though hidden – and it reads on from there past the
// block. With the mode on (reflowtex.setScreenReaderMode, remembered; the
// reading options and a prompt at the page's start offer it), the layer
// takes the clicks and the selection instead: its words lie on the drawn
// ones, selectable, with the selection shown over them; the drawing's text
// is not selectable; a click on a drawn link, footnote mark or control goes
// on to it, under the layer. Off, everything is as it was – the drawing's
// text is what a reader selects.
const READER_KEY = 'reflowtex-a11y-reader';
const READER_CSS = `
html.latex-reader-mode .latex-block svg { -webkit-user-select: none; user-select: none; }
html.latex-reader-mode .latex-a11y > *, html.latex-reader-mode .latex-a11y > * * {
  pointer-events: auto !important; -webkit-user-select: text !important; user-select: text !important; }
html.latex-reader-mode .latex-a11y > * { opacity: 1 !important; color: transparent !important; }
html.latex-reader-mode .latex-a11y ::selection { background: rgb(0 110 255 / .3); color: transparent; }
html.latex-reader-probe .latex-a11y, html.latex-reader-probe .latex-a11y * { pointer-events: none !important; }
.latex-reader-prompt { position: absolute; left: -9999px; top: 0; }
.latex-reader-prompt:focus { left: 8px; top: 8px; z-index: 2147483647; padding: 8px 12px; font: 14px system-ui, sans-serif;
  background: Canvas; color: CanvasText; border: 2px solid Highlight; border-radius: 6px; }`;
let reader = false;
try { reader = localStorage.getItem(READER_KEY) === '1'; } catch { /* no storage: off */ }
/** Whether the layer takes clicks and the selection (screen reader mode). */
export const screenReaderMode = () => reader;
/** Screen reader mode on or off; remembered, and the page told
 *  (reflowtex:screen-reader-mode, detail {on}). */
export function setScreenReaderMode(on: boolean): void {
    reader = !!on;
    try { if (reader) localStorage.setItem(READER_KEY, '1'); else localStorage.removeItem(READER_KEY); } catch { /* not remembered */ }
    showReader();
    document.dispatchEvent(new CustomEvent('reflowtex:screen-reader-mode', { detail: { on: reader } }));
}
function readerStyle() {
    if (document.getElementById('latex-reader-css')) return;
    const st = document.createElement('style');
    st.id = 'latex-reader-css';
    st.textContent = READER_CSS;
    document.head.appendChild(st);
}
function showReader() {
    readerStyle();
    document.documentElement.classList.toggle('latex-reader-mode', reader);
    const b = document.querySelector('.latex-reader-prompt');
    if (b) b.textContent = reader ? 'Screen reader mode is on: turn it off' : 'Turn on screen reader mode: click a word to hear it, and read on from there';
}
// The prompt: a page with a layer begins with a button a screen reader meets
// first (visible when it has the keyboard's focus, as a skip link is).
function addPrompt() {
    if (document.querySelector('.latex-reader-prompt') || !document.querySelector('.latex-a11y')) return;
    readerStyle();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'latex-reader-prompt';
    b.addEventListener('click', () => setScreenReaderMode(!reader));
    document.body.prepend(b);
    showReader();
}
// A click on the layer that is a click, not a selection, goes on to what the
// drawing has there: a link, a footnote mark, a control.
function passClick(e: MouseEvent) {
    if (!reader || !e.isTrusted || !(e.target instanceof Element) || !e.target.closest('.latex-a11y')) return;
    if (e.target.closest('summary, a, button, [role="button"]')) return;     // the layer's own (a hint's disclosure)
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const root = document.documentElement;
    root.classList.add('latex-reader-probe');
    const under = document.elementFromPoint(e.clientX, e.clientY);
    root.classList.remove('latex-reader-probe');
    if (!under || !under.closest('.latex-block')) return;
    e.stopPropagation();
    e.preventDefault();
    under.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window,
        clientX: e.clientX, clientY: e.clientY, button: 0 }));
}
if (typeof document !== 'undefined') {
    document.addEventListener('click', passClick, true);
    // the formulas of layers whose own script did not run (a11y-math.ts)
    const start = () => { insertShippedMath(document); addPrompt(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    if (reader) showReader();
}
api.screenReaderMode = screenReaderMode;
api.setScreenReaderMode = setScreenReaderMode;

/** A piece as shipped, before any of this changed it: kept, to lay again. */
const shipped = new WeakMap<Element, string>();
/** A layer's own style as shipped (hidden), before it was first placed. */
const shippedStyle = new WeakMap<Element, string | null>();
function remember(piece: Element) { if (!shipped.has(piece)) shipped.set(piece, piece.innerHTML); }
function restore(piece: Element) { if (shipped.has(piece)) piece.innerHTML = shipped.get(piece)!; }
/** A shipped piece in the reader's mode: spoken, each formula becomes its words. */
function inMode(piece: Element) {
    remember(piece);
    if (mode !== 'spoken') return;
    for (const m of piece.querySelectorAll('math')) {
        const span = document.createElement('span');
        span.dataset.spoken = '';
        span.textContent = m.getAttribute('alttext') || m.textContent;
        m.replaceWith(span);
    }
}


/** The layers the viewer made for views (copyLayer), by their element. */
const ownLayers = new WeakMap<Element, HTMLElement>();

/** A block's accessible layer: before it once placed, after it as shipped;
 *  a view's its own copy. */
export function layerOf(el: Element | null | undefined): HTMLElement | null {
    if (el && ownLayers.has(el)) return ownLayers.get(el)!;
    for (const s of el ? [el.previousElementSibling, el.nextElementSibling] : []) if (s && s.classList.contains('latex-a11y')) return s as HTMLElement;
    return null;
}

/** What placing made of a piece: its style as last written, and what its
 *  text was laid out or fitted for (lines: line by line, for a box of a
 *  size, these lines and this mode; size: fitted to a box of this size, or
 *  a display scaled onto its drawing; font: its font size; width: its
 *  width). Kept here, not on the element: a placement that changes nothing
 *  writes nothing. */
interface Laid { css?: string; lines?: string; size?: string; font?: string; width?: number }
const laid = new WeakMap<Element, Laid>();
function laidOf(piece: Element): Laid {
    let st = laid.get(piece);
    if (!st) laid.set(piece, st = {});
    return st;
}
function setCss(piece: HTMLElement, st: Laid, css: string): void {
    if (st.css === css) return;
    piece.style.cssText = css;
    st.css = css;
}
/** Whether a segment is drawn as it now is: painted since its last layout
 *  (a stream: any segment of its nested layout). */
function isDrawn(s: DomSegment | undefined): boolean {
    if (!s) return false;
    if (s.svg) return !!s.painted && !s.dirty;
    return !!s.sub && !!s.sub.dom && s.sub.dom.segs.some(isDrawn);
}
/** How many pieces placing has laid out, fitted or scaled: for tests
 *  (api.inspect.layerFits), to see a resize fit only what is drawn. */
export let layerFits = 0;

/** Lay the block's accessible layer, if it has one, over its lines; then
 *  send reflowtex:layer (bubbling, detail { block }). */
export function placeAccessibleLayer(data: BlockData | undefined): void {
    const el = data && data.el;
    const layer = layerOf(el);
    if (!layer) return;
    insertShippedMath(layer);
    // (a layer is found only by an element: data and el are there)
    if (layer === el!.nextElementSibling) el!.before(layer);
    const cache = data!.cache;
    const laid = cache.layout && cache.layout.laid;
    if (!laid || !cache.dom) return;
    const segs = laid.map(L => L.seg);

    // What each segment draws: its paragraphs (by number, with their place in
    // the segment), the display whose first row it starts with, or a stream.
    const byPara = new Map<number, [number, number]>(), byItem = new Map<ContentItem, number>(), byStream = new Map<number, number>();
    segs.forEach((seg, i) => {
        if (seg.kind === 'text') seg.items.forEach((it, j) => byPara.set(it.index, [i, j]));
        else if (seg.kind === 'display') byItem.set(seg.rows[0].item, i);
        else if (seg.kind === 'stream') byStream.set(seg.index, i);
    });
    const content = data!.doc.content || [];

    if (layer.dataset.placed !== '1') {
        shippedStyle.set(layer, layer.getAttribute('style'));
        layer.style.cssText = ANCHOR; layer.dataset.placed = '1';
    }
    // All reads first, then all writes: one layout pass, however long the block.
    const origin = layer.getBoundingClientRect();
    const dom = cache.dom;
    const places = ([...layer.children] as HTMLElement[]).map((piece): Place | null => {
        let i: number | undefined, j = -1;
        if (piece.dataset.para) [i, j] = byPara.get(+piece.dataset.para) || ([] as number[]);
        else if (piece.dataset.item) i = byItem.get(content[+piece.dataset.item - 1]);
        else if (piece.dataset.stream) i = byStream.get(+piece.dataset.stream);
        const s = i === undefined ? null : dom.segs[i];
        if (!s || !s.box) return null;
        const r = s.box.getBoundingClientRect();
        let y0 = 0, y1 = r.height, lines = 1, a = -1, b = -1;
        // A paragraph among several in one segment: from its first line's top
        // to its last line's bottom (a segment laid out later, off screen,
        // has no lines yet and stands whole until it is drawn).
        const L = laid[i!];
        if (j >= 0 && L.itemStarts && L.lines && L.lines.length) {
            a = L.itemStarts[j];
            b = (j + 1 < L.itemStarts.length ? L.itemStarts[j + 1] : L.lines.length) - 1;
            if (a <= b) {
                y0 = L.baselineYs![a] - maxOf(L.profiles![a], 'h');
                y1 = L.baselineYs![b] + maxOf(L.profiles![b], 'd');
                lines = b - a + 1;
            }
        }
        const ctm = screenCTM(s.svg);
        return { top: r.top - origin.top + y0, left: r.left - origin.left, width: r.width, height: Math.max(1, y1 - y0),
                 lines, seg: i!, a, b, ctm, display: !!piece.dataset.item };
    });
    const pieces = [...layer.children] as HTMLElement[];
    for (const piece of pieces) if (!laidOf(piece).lines) inMode(piece);
    const refit: { piece: HTMLElement; px: number }[] = [], lined: Lined[] = [];
    const scaled: { el: HTMLElement | MathMLElement; w: number; h: number }[] = [];
    // A piece of a segment not drawn as it now is (never painted, or left
    // stale by a reflow until it comes near again) keeps its text unfitted at
    // a bounded size: a line's height, from its height over its lines – but
    // no larger than a paragraph's line usually is here (a piece drawn as one
    // tall line, a listing set in a box, would have the whole box). It clips
    // at its box, so whatever its text does, the page is no larger.
    const pitches = places.filter((p): p is Place => !!p && p.lines > 1).map(p => p.height / p.lines / LINE_HEIGHT).sort((x, y) => x - y);
    const usual = pitches.length ? pitches[pitches.length >> 1] : Infinity;
    pieces.forEach((piece, k) => {
        const p = places[k] || ({ top: 0, left: 0, width: 1, height: 1, lines: 1, seg: -1, a: -1, b: -1 } as Place);   // nothing drawn for it: out of sight
        const st = laidOf(piece);
        const drawn = p.seg >= 0 && isDrawn(dom.segs[p.seg]);
        // (a piece not drawn keeps its width and its font: only moved, its
        // text is not laid out again – wider than its box now, the layer
        // clips it at the block's side)
        const width = drawn || st.width === undefined ? p.width : st.width;
        st.width = width;
        const box = `${PIECE};top:${p.top}px;left:${p.left}px;width:${width}px;height:${p.height}px`;
        // A paragraph whose segment is drawn: line by line. (Laid out so
        // before, on the lines it still has, it stays so; laid out for lines
        // since redrawn elsewhere, it keeps them until its segment is drawn
        // again – clipped, its words in their order.)
        if (p.a >= 0 && p.ctm) {
            const key = `${Math.round(p.width)}x${Math.round(p.height)}@${p.a}-${p.b}/${mode}`;
            if (st.lines === key || (st.lines && !drawn)) { setCss(piece, st, box + LINED); return; }
            const runs = drawn && runsOf(data!, p.seg, p.a, p.b);
            if (runs) { setCss(piece, st, box + LINED); st.lines = key; lined.push({ piece, p, runs, origin }); return; }
        }
        // (laid out line by line for lines it no longer has: as shipped again)
        if (st.lines) { restore(piece); inMode(piece); st.lines = undefined; st.size = undefined; st.font = undefined; }
        // A display whose segment is drawn: its MathML scaled onto the
        // drawing's ink (the piece spans the display's whole band; the
        // formula is narrower).
        if (drawn && p.display && p.ctm) {
            const math = piece.querySelector<HTMLElement | MathMLElement>('math, [data-spoken]');
            const ink = math && inkOf(data!, p.seg);
            if (ink) {
                const m = p.ctm, left = m.a * ink.x0 + m.e - origin.left, top = m.d * ink.y0 + m.f - origin.top;
                const w = Math.max(1, m.a * (ink.x1 - ink.x0)), hh = Math.max(1, m.d * (ink.y1 - ink.y0));
                const key = `${Math.round(w)}x${Math.round(hh)}/${mode}`;
                setCss(piece, st, `${PIECE};top:${top}px;left:${left}px;width:${w}px;height:${hh}px`);
                if (st.size === key) return;
                st.size = key; st.font = undefined;
                math!.dataset.run = math!.localName === 'math' ? 'display' : 'spoken';
                if (math!.localName !== 'math') math!.style.whiteSpace = 'nowrap';   // one line, scaled onto the formula
                // its own size, not the piece's width, on the piece's corner: out of
                // the flow, as a formula in a line is. (An inline-block in the
                // flow is what it was; Firefox lays a <math> out inline whatever
                // its display says, and an inline box takes no transform.)
                Object.assign(math!.style, { position: 'absolute', left: '0', top: '0', width: 'max-content' });
                scaled.push({ el: math!, w, h: hh });
                return;
            }
        }
        // Any other piece: its text fitted into its box once its segment is
        // drawn; until then at a bounded size (above).
        const size = `${Math.round(p.width)}x${Math.round(p.height)}`;
        const guess = Math.max(MIN_PX, p.height / p.lines / LINE_HEIGHT);
        if (st.size !== size && drawn) { st.size = size; st.font = `${guess}px`; refit.push({ piece, px: guess }); }
        else if (st.size !== size && !drawn && st.font === undefined) st.font = `${Math.max(MIN_PX, Math.min(guess, usual))}px`;
        setCss(piece, st, `${box};font-size:${st.font}`);
    });
    layerFits += refit.length + lined.length + scaled.length;
    const runs: FitItem[] = [];
    for (const l of lined) runs.push(...layOutRuns(l, mode));
    fitText(refit);
    for (const f of refit) { const st = laidOf(f.piece); st.font = `${f.px}px`; st.css = st.css!.replace(/font-size:[^;]*$/, `font-size:${st.font}`); }
    fitRuns(runs);
    scaleOnto(scaled);
    el!.dispatchEvent(new CustomEvent('reflowtex:layer', { bubbles: true, detail: { block: el } }));
}


/** For a view of a block mounted elsewhere (host.mount(el, { of })): a copy
 *  of the block's layer as shipped, after `el`, laid over the view's own
 *  lines from then on. The pieces are the shipped ones, not what placing
 *  made of them (those were fitted to the other view's lines). */
export function copyLayer(layer: HTMLElement | null, el: Element): HTMLElement | null {
    if (!layer || ownLayers.has(el)) return null;
    insertShippedMath(layer);
    const copy = layer.cloneNode(true) as HTMLElement;
    if (copy.dataset.placed === '1') {
        delete copy.dataset.placed;
        const style = shippedStyle.get(layer);
        if (style == null) copy.removeAttribute('style'); else copy.setAttribute('style', style);
    }
    ([...copy.children] as HTMLElement[]).forEach((piece, i) => {
        const shippedHTML = shipped.get(layer.children[i]);
        if (shippedHTML !== undefined) piece.innerHTML = shippedHTML;
        piece.removeAttribute('style');
    });
    el.after(copy);
    ownLayers.set(el, copy);
    return copy;
}

/** A view unmounted: its copy of the layer goes too. */
export function dropLayer(el: Element): void {
    const copy = ownLayers.get(el);
    if (!copy) return;
    ownLayers.delete(el);
    copy.remove();
}
