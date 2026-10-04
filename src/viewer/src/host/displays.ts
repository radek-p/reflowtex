// SPDX-License-Identifier: AGPL-3.0-or-later
// Wide displays, for the host API: whether they fade where their scroll box
// cuts them off (Block.setDisplayFade, Host.setDisplayFade), and scrolling
// one so that a point of it is in view (Block.revealInDisplay).
//
// The fade is the page's CSS mask on .latex-display (README, Overflow). Off,
// the block element carries latex-no-fade, and the viewer's own rule
// (installViewerStyles) takes the mask away: a class, so nothing is laid out
// again and no scroll box loses its position.

import { materializeSegment } from '../engine/layout/document.js';
import { updateDisplayOverflowCue } from '../engine/layout/display.js';

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
