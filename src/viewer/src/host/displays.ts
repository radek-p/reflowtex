// SPDX-License-Identifier: AGPL-3.0-or-later
// Wide displays, for the host API: whether they fade where their scroll box
// cuts them off (Block.setDisplayFade, Host.setDisplayFade), whether their
// box keeps to the column or widens to their natural width
// (Block.setDisplayFit, Host.setDisplayFit), and scrolling one so that a
// point of it is in view (Block.revealInDisplay).
//
// The fade is the page's CSS mask on .latex-display (README, Overflow). Off,
// the block element carries latex-no-fade, and the viewer's own rule
// (installViewerStyles) takes the mask away: a class, so nothing is laid out
// again and no scroll box loses its position.

import { materializeSegment } from '../engine/layout/document.js';
import { updateDisplayOverflowCue } from '../engine/layout/display.ts';

export const NO_FADE_CLASS = 'latex-no-fade';

let fadeDefault = true;
const fadeOwn = new WeakMap<Element, boolean>();   // a block's own setting

export const displayFadeDefault = () => fadeDefault;
export function setDisplayFadeDefault(on: boolean, els: Iterable<Element>) {
    fadeDefault = !!on;
    for (const el of els) applyFade(el);
}
export const displayFadeOf = (el: Element) => fadeOwn.get(el) ?? fadeDefault;
export function setDisplayFadeOf(el: Element, on: boolean | null) {
    if (on === null || on === undefined) fadeOwn.delete(el);
    else fadeOwn.set(el, !!on);
    applyFade(el);
}
export function applyFade(el: Element) {
    const off = !displayFadeOf(el);
    if (el.classList.contains(NO_FADE_CLASS) !== off) el.classList.toggle(NO_FADE_CLASS, off);
}
/** The block is gone: its setting and class with it. */
export function forgetFade(el: Element) {
    fadeOwn.delete(el);
    el.classList.remove(NO_FADE_CLASS);
}

// ── The fit ──────────────────────────────────────────────────────────────
// 'column' (the default): a wide display scrolls in a box the width of the
// column, peeking into the margins as the page's CSS says. 'natural': the
// box widens to the display's natural width, into the room beside the
// column, centred on it as far as the room on each side allows, up to the
// edges of the element the block sits in (its padding box) and never past
// the window; it scrolls only when wider still, and does not fade.
//
// The block element carries latex-fit-natural, and the room on each side as
// --latex-display-room-left/right (px, measured here); the viewer's own rule
// (installViewerStyles) sizes each scroll box from those and the display's
// width, which the layout gives it (--latex-display-width). Styles only: no
// line is broken or laid out again.

export type DisplayFit = 'natural' | 'column';
export const FIT_NATURAL_CLASS = 'latex-fit-natural';
const ROOM_LEFT = '--latex-display-room-left', ROOM_RIGHT = '--latex-display-room-right';

let fitDefault: DisplayFit = 'column';
const fitOwn = new WeakMap<Element, DisplayFit>();
const naturals = new Set<HTMLElement>();          // blocks fitted naturally now, measured again on a resize

function checkFit(fit: unknown): DisplayFit {
    if (fit === 'natural' || fit === 'column') return fit;
    throw new TypeError(`setDisplayFit: 'natural', 'column' or null, not ${String(fit)}`);
}
export const displayFitDefault = () => fitDefault;
export function setDisplayFitDefault(fit: DisplayFit, els: Iterable<Element>) {
    fitDefault = checkFit(fit);
    for (const el of els) applyFit(el);
}
export const displayFitOf = (el: Element): DisplayFit => fitOwn.get(el) ?? fitDefault;
export function setDisplayFitOf(el: Element, fit: DisplayFit | null) {
    // (set again to the same, it measures the room again: applyFit)
    if (fit === null || fit === undefined) fitOwn.delete(el);
    else fitOwn.set(el, checkFit(fit));
    applyFit(el);
}
/** Whether its displays fade now: not while they are fitted naturally. */
export const fadesNow = (el: Element) => displayFadeOf(el) && displayFitOf(el) !== 'natural';

// The room beside the block's column, in its own CSS px: to the padding box
// of the element it sits in, within the window.
function measureRoom(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    if (!r.width || !el.offsetWidth) return;              // not shown: keep what it had
    const scale = r.width / el.offsetWidth;               // CSS zoom, a transform
    const cs = getComputedStyle(el);
    const colL = r.left + (el.clientLeft + (parseFloat(cs.paddingLeft) || 0)) * scale;
    const colR = colL + (el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)) * scale;
    let lo = 0, hi = document.documentElement.clientWidth;
    let p = el.parentElement;
    while (p && p !== document.documentElement && getComputedStyle(p).display === 'contents') p = p.parentElement;
    if (p && p !== document.documentElement) {
        const pr = p.getBoundingClientRect(), ps = pr.width / (p.offsetWidth || pr.width || 1);
        lo = Math.max(lo, pr.left + p.clientLeft * ps);
        hi = Math.min(hi, pr.left + (p.clientLeft + p.clientWidth) * ps);
    }
    const px = (v: number) => `${Math.max(0, Math.floor(v / scale * 100) / 100)}px`;
    const st = (el as HTMLElement).style;
    if (st.getPropertyValue(ROOM_LEFT) !== px(colL - lo)) st.setProperty(ROOM_LEFT, px(colL - lo));
    if (st.getPropertyValue(ROOM_RIGHT) !== px(hi - colR)) st.setProperty(ROOM_RIGHT, px(hi - colR));
}

// Measured again when the window is resized, the element a block sits in
// is, or the block is laid out at a new width; and whenever the fit is set,
// which is how a host that moves a block some other way has it measured.
let listening = false, parents: ResizeObserver | null = null;
const observed = new WeakSet<Element>();
function listen(el: HTMLElement) {
    const p = el.parentElement;
    if (p && typeof ResizeObserver === 'function') {
        parents ??= new ResizeObserver(es => {
            const ps = new Set(es.map(e => e.target));
            for (const n of naturals) if (n.parentElement && ps.has(n.parentElement)) measureRoom(n);
        });
        if (!observed.has(p)) { observed.add(p); parents.observe(p); }
    }
    if (listening) return;
    listening = true;
    const again = () => { for (const n of naturals) measureRoom(n); };
    addEventListener('resize', again, { passive: true });
    document.addEventListener('reflowtex:layout', e => {
        const el = (e as CustomEvent).detail?.block;
        if (naturals.has(el)) measureRoom(el);
    });
}

export function applyFit(el: Element) {
    const on = displayFitOf(el) === 'natural';
    const h = el as HTMLElement;
    if (on) { naturals.add(h); listen(h); measureRoom(h); }
    else naturals.delete(h);
    if (h.classList.contains(FIT_NATURAL_CLASS) === on) return;
    // Every glyph stays where it is on screen as far as its box allows: each
    // scroll box is scrolled by as much as its display moved.
    const wraps = h.isConnected ? [...h.querySelectorAll<HTMLElement>('.latex-display')] : [];
    const at = wraps.map(w => w.firstElementChild?.getBoundingClientRect().left ?? 0);
    h.classList.toggle(FIT_NATURAL_CLASS, on);
    if (!on) { h.style.removeProperty(ROOM_LEFT); h.style.removeProperty(ROOM_RIGHT); }
    wraps.forEach((w, i) => {
        const now = w.firstElementChild?.getBoundingClientRect().left ?? 0;
        const r = w.getBoundingClientRect(), scale = w.offsetWidth ? r.width / w.offsetWidth : 1;
        if (now !== at[i]) w.scrollLeft += (now - at[i]) / scale;
        updateDisplayOverflowCue(w);
    });
}
/** The block is gone: its settings and classes with it. */
export function forgetFit(el: Element) {
    fitOwn.delete(el);
    naturals.delete(el as HTMLElement);
    el.classList.remove(FIT_NATURAL_CLASS);
    (el as HTMLElement).style?.removeProperty(ROOM_LEFT);
    (el as HTMLElement).style?.removeProperty(ROOM_RIGHT);
}

interface Seg { svg: SVGSVGElement; wrap: HTMLElement | null; mount?: Element }
interface LayoutCache {
    dom?: { segs: Seg[] } | null;
    layout?: { laid: { deferred?: boolean }[] } | null;
    layoutCtx?: { segs: { kind: string }[] };
}

// The screen x of a point in an SVG element's own coordinates.
function screenX(el: Element, x: number): number | null {
    const ctm = (el as SVGGraphicsElement).getScreenCTM?.();
    return ctm ? new DOMPoint(x, 0).matrixTransform(ctm).x : null;
}
// An element's horizontal extent on screen. From its SVG attributes where it
// has them: WebKit gives a <tspan>'s box as its whole line's.
function extent(el: Element): [number, number] | null {
    const ax = el.getAttribute('x');
    if (ax !== null && el instanceof SVGElement) {
        const x = parseFloat(ax) || 0;
        let w = parseFloat(el.getAttribute('width') || '');
        if (!(w >= 0) && el instanceof SVGTextContentElement) {
            try { w = el.getComputedTextLength(); } catch { w = 0; }
        }
        const a = screenX(el, x), b = screenX(el, x + (w > 0 ? w : 0));
        if (a !== null && b !== null) return [Math.min(a, b), Math.max(a, b)];
    }
    const r = el.getBoundingClientRect();
    return [r.left, r.right];
}

export function revealInDisplay(cache: LayoutCache, fades: boolean, display: number | Element,
                                x?: number, options: { margin?: number } = {}): boolean {
    const segs = cache.dom?.segs, kinds = cache.layoutCtx?.segs;
    if (!segs || !kinds) return false;
    let i = -1;
    if (typeof display === 'number') {
        let n = -1;
        for (let k = 0; k < kinds.length; k++) {
            if (kinds[k].kind === 'display' && ++n === display) { i = k; break; }
        }
    } else if (display instanceof Element) {
        i = segs.findIndex(s => s.svg.contains(display));
        if (i >= 0 && kinds[i].kind !== 'display') i = -1;
    }
    if (i < 0) return false;
    // A display laid out from cached geometry only (off screen): its real
    // layout now, so that its box is the one it will have.
    if (cache.layout?.laid[i]?.deferred) materializeSegment(cache, i);
    const s = segs[i], wrap = s.wrap;
    if (!wrap || s.mount !== wrap || !wrap.isConnected) return true;   // it fits: all in view
    let span: [number, number] | null;
    if (typeof x === 'number') {
        const p = screenX(s.svg, x);
        span = p === null ? null : [p, p];
    } else {
        span = display instanceof Element ? extent(display) : null;
    }
    if (!span) return true;
    const r = wrap.getBoundingClientRect();
    const scale = wrap.offsetWidth ? r.width / wrap.offsetWidth : 1;   // CSS zoom, a transform
    // The fully visible band: while it fades, the column (the box less the
    // peek the start padding holds, on either side); else the whole box.
    const peek = fades ? parseFloat(getComputedStyle(wrap).paddingLeft) || 0 : 0;
    const inset = (peek + Math.max(0, options.margin || 0)) * scale;
    const lo = r.left + wrap.clientLeft * scale + inset;
    const hi = r.left + (wrap.clientLeft + wrap.clientWidth) * scale - inset;
    const [a, b] = span;
    let d = 0;
    if (b - a > hi - lo || a < lo) d = a - lo;      // (too wide for it: its start)
    else if (b > hi) d = b - hi;
    if (d) wrap.scrollLeft += d / scale;
    updateDisplayOverflowCue(wrap);
    return true;
}
