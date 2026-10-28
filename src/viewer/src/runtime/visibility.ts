// SPDX-License-Identifier: AGPL-3.0-or-later

import { paintDocument, paintSegment } from '../engine/paint.ts';
import { announceLayout } from './block-data.ts';
import { blockData } from './blocks.ts';
import { frame } from './pending.ts';
import { BLOCK_SELECTOR } from './page.ts';
import { flushAll, paintLater } from './slices.ts';
import type { FontTable } from '../engine/model.ts';
import type { LayoutCache } from '../engine/layout/types.ts';

// ── Near the screen, through scroll boxes ────────────────────────────────────
// A segment is painted once it is *near* the screen: within one height of the
// window, or – in a scroll box of the page's (a pane with overflow: auto) –
// within one height of what that box shows, while the box is itself near the
// screen. An IntersectionObserver on the window alone cannot tell the second:
// a box clips what it holds, and the observer's rootMargin grows only the
// window's rectangle, not the box's, so what lies just below a box's fold
// counts as far until it scrolls in (and is blank meanwhile).
//
// So every segment's <svg> is watched by the window's observer, and also,
// when a scroll box cuts its block off, by an observer of that box's own
// (root: the box, the same margin – one height of the box). A box is watched
// the same way: by the window's observer, and by the observer of a box around
// it that cuts it off, and so on outwards. Then
//     near(x) = x near the window, or (x near its box, and its box near).
// The window's observer alone is what there was before, so this only ever
// adds lookahead. Which box cuts a block off is found from the elements
// (overflow-y not visible, and the block or box reaching past its client
// area) each time the block is painted after a layout, and again when an
// element the viewer did not know as such a box first scrolls: a box that
// appears later, or a block moved into one, is then followed too.
//
// The same holds in every engine: it uses observers with an element root,
// not the observers' scrollMargin (which only some engines have).
interface Band { top: number; bottom: number }          // a vertical range, in the window's coordinates
const LOOKAHEAD = '100% 0px';                            // one height above and one below
const vh = (): number => window.innerHeight || 800;
const meets = (r: Band, b: Band): boolean => r.bottom > b.top && r.top < b.bottom;
const grown = (b: Band): Band => { const h = b.bottom - b.top; return { top: b.top - h, bottom: b.bottom + h }; };
/** Where a box shows what it holds: its client area, in the window. */
function clientBand(box: Element): Band {
    const top = box.getBoundingClientRect().top + box.clientTop;
    return { top, bottom: top + box.clientHeight };
}

interface Watch { win: boolean; box: Element | null; inBox: boolean; near: boolean }
const watches = new WeakMap<Element, Watch>();          // a segment's <svg> or a box → what its observers said
interface Box { io: IntersectionObserver; bound: Set<Element> }
const boxes = new Map<Element, Box>();                  // a scroll box → its observer and what it watches

const winIO = new IntersectionObserver(es => seen(es, null), { rootMargin: LOOKAHEAD });

function watch(el: Element): void {
    if (watches.has(el)) return;
    watches.set(el, { win: false, box: null, inBox: false, near: false });
    winIO.observe(el);
}
/** Stop watching a segment's <svg> (it is detached for good). */
export function unwatch(el: Element): void {
    if (!watches.has(el)) return;
    winIO.unobserve(el);
    bind(el, null);
    watches.delete(el);
}
// Watch el (watched already) through `box` as well, or through no box; a box
// left watching nothing is let go.
function bind(el: Element, box: Element | null): void {
    const w = watches.get(el);
    if (!w || w.box === box) return;
    const was = w.box, old = was && boxes.get(was);
    w.box = box;
    w.inBox = false;
    if (old) {
        old.io.unobserve(el);
        old.bound.delete(el);
        if (!old.bound.size) { old.io.disconnect(); boxes.delete(was!); unwatch(was!); }
    }
    if (box) {
        let b = boxes.get(box);
        if (!b) {
            b = { io: new IntersectionObserver(es => seen(es, box), { root: box, rootMargin: LOOKAHEAD }), bound: new Set() };
            boxes.set(box, b);
            watch(box);
        }
        b.bound.add(el);
        b.io.observe(el);       // (its first report comes in a task, as the window's did)
    }
    refresh(el, null);
}

function seen(entries: IntersectionObserverEntry[], box: Element | null): void {
    const painted = new Set<HTMLElement>();
    for (const e of entries) {
        const w = watches.get(e.target);
        if (!w) continue;
        if (!box) w.win = e.isIntersecting;
        else if (w.box === box) w.inBox = e.isIntersecting;
        else continue;          // (from a box it has since left)
        refresh(e.target, painted, e.boundingClientRect);
    }
    // Newly drawn lines may hold aside marks a page places things by.
    for (const block of painted) announceLayout(block);
}

// Whether el is near now; a segment near is painted (when `painted` collects
// the blocks drawn in), and a box that came near or went far passes it on to
// what it holds.
function refresh(el: Element, painted: Set<HTMLElement> | null, rect?: DOMRectReadOnly): void {
    const w = watches.get(el);
    if (!w) return;
    const near = w.win || (w.inBox && !!w.box && !!watches.get(w.box)?.near);
    const changed = near !== w.near;
    w.near = near;
    const ref = segRef.get(el);
    const s = ref && ref.cache.dom && ref.cache.dom.segs[ref.i];
    if (s) {
        s.intersecting = near;
        if (near && painted && (!s.painted || s.dirty)) {
            const r = rect || el.getBoundingClientRect();
            const view = slicedPaint(ref!.cache) ? shown(w.box) : null;
            if (!(view && !meets(r, view) && laterFor(ref!.cache, ref!.i, r, view))) {
                paintSegment(ref!.cache.fontInfo!, ref!.cache, ref!.i);
                const block = ref!.cache.dom!.root.closest<HTMLElement>(BLOCK_SELECTOR);
                if (block) painted.add(block);
            }
        }
    }
    const b = changed && boxes.get(el);
    if (b) for (const t of [...b.bound]) refresh(t, near ? painted : null);
}

/** What the reader sees of what `box` holds: the window, cut by the box and
 *  every box around it that is watched. */
function shown(box: Element | null): Band {
    let band: Band = { top: 0, bottom: vh() };
    for (let b = box; b; b = watches.get(b)?.box ?? null) {
        const c = clientBand(b);
        band = { top: Math.max(band.top, c.top), bottom: Math.min(band.bottom, c.bottom) };
    }
    return band;
}

// The element an element is drawn in: across a shadow root's edge and into
// the slot it is assigned to.
function parentOf(el: Element): Element | null {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const root = el.parentNode;
    return root instanceof ShadowRoot ? root.host : null;
}
// Whether `p` is a scroll box that cuts off a box at r: its overflow clips,
// and r reaches past its client area. (A box that holds r whole is passed
// over: a wrapper with overflow-x: hidden, say, as tall as what it holds.)
function cuts(p: Element, r: Band): boolean {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'visible' || oy === 'clip') return false;
    const c = clientBand(p);
    return r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5;
}
interface Outer { at: Element; boxes: Element[] }
/** The scroll boxes that cut `el` off, nearest first; from `outer.at` (an
 *  element holding el) outwards, those found for it. */
function boxesAround(el: Element, outer?: Outer): Element[] {
    const out: Element[] = [];
    let r: Band = el.getBoundingClientRect();
    const html = document.documentElement;
    for (let p = parentOf(el); p && p !== html; p = parentOf(p)) {
        if (outer && p === outer.at) return out.concat(outer.boxes);
        // (<body>'s overflow is the window's, unless <html> has its own)
        if (p === document.body && getComputedStyle(html).overflowY === 'visible') break;
        if (cuts(p, r)) { out.push(p); r = p.getBoundingClientRect(); }
    }
    return out;
}
// Find the boxes a layout's segments are in, and watch them through those.
// null: the layout is not rendered (not in the document, display: none), so
// nothing can be told; it keeps what it was watched through.
function bindBoxes(cache: LayoutCache, outer?: Outer): Element[] | null {
    const root = cache.dom && cache.dom.root;
    if (!root || !root.isConnected || !root.getClientRects().length) return null;
    const chain = boxesAround(root, outer);
    for (const s of cache.dom!.segs) if (s.svg) bind(s.svg, chain[0] || null);
    for (let k = 0; k < chain.length; k++) bind(chain[k], chain[k + 1] || null);
    return chain;
}

// An element first seen scrolling may be a box that came later (or one a
// block was moved into): the blocks in it look again.
const looked = new WeakSet<EventTarget>();
let rebinding: Set<Element> | null = null;
document.addEventListener('scroll', e => {
    const t = e.target;
    if (!(t instanceof Element) || boxes.has(t) || looked.has(t)) return;
    looked.add(t);
    if (!rebinding) {
        rebinding = new Set();
        frame('scroll boxes', () => {
            const els = [...rebinding!];
            rebinding = null;
            for (const el of observedBlocks) {
                const data = blockData.get(el);
                if (data && els.some(b => b.contains(el))) watchBoxes(data.cache);
            }
        });
    }
    rebinding.add(t);
}, { capture: true, passive: true });
function watchBoxes(cache: LayoutCache, outer?: Outer): void {
    const chain = bindBoxes(cache, outer);
    if (!chain || !cache.dom) return;
    for (const s of cache.dom.segs) if (s.sub) watchBoxes(s.sub, { at: cache.dom.root, boxes: chain });
    // (what is near now and was not is painted by the observers' first reports)
}

// A block laid out in slices (slices.ts) paints only what is on the screen at
// once; what is near it is painted in slices too, nearest first.
const slicedPaint = (cache: LayoutCache): boolean => !!cache.lastSliced;
const laterFor = (cache: LayoutCache, i: number, r: Band, view: Band): boolean => {
    const data = cache.blockEl && blockData.get(cache.blockEl);
    if (!data) return false;
    paintLater(data, cache, i, r.bottom <= view.top ? view.top - r.bottom : r.top - view.bottom);
    return true;
};

// ── Per-segment painting (grow-only) ──────────────────────────────────────────
// Layout always covers the whole block (cheap pure computation, and it must, so
// the block's height keeps scroll geometry exact). Painting – placing tens of
// thousands of glyph elements – is the DOM-heavy part, so a segment is painted
// only once it comes near the screen (above). Which segments those are is
// tracked by IntersectionObservers on each segment's own <svg>, i.e. from the
// real element positions. It is deliberately NOT computed from a running height
// model: a model would have to reproduce every margin and wrapper detail of the
// real layout (a scrollable display's headroom padding and compensating margins,
// say – see layoutDocument), so it drifts from it and, near the bottom of a long
// page, mis-gates segments that are in fact on screen. Observing the elements has
// no such drift and costs no per-frame measurement.
//
// Painting is grow-only: a segment, once painted, is never hidden. Scrolling can
// only ever add ink, never remove it, so text never vanishes as the page moves. A
// width change re-draws the painted segments in place (their glyphs move) – the
// visible ones at once, the rest when scrolled to – but still never blanks them.
export const observedBlocks = new Set<HTMLElement>();       // blocks (for font-repaint + print)
export const segRef = new WeakMap<Element, { cache: LayoutCache; i: number }>();           // a segment's <svg> → { cache, i }

// Observe each not-yet-observed segment of a block. Idempotent: a segment's <svg>
// is created once and reused across reflows, so its observation persists (only a
// font rerender, which rebuilds the DOM, makes new ones – see rerenderBlock).
// The scroll boxes it is watched through are found when it is painted
// (paintVisibleNow): a first layout is not in the document yet.
export function observeSegments(cache: LayoutCache): void {
    const segs = cache.dom!.segs;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.observed || !s.svg) continue;   // a stream segment has no <svg> of its own
        segRef.set(s.svg, { cache, i });
        watch(s.svg);
        s.observed = true;
    }
}

// Paint, synchronously, every segment that needs it (never painted, or dirtied by
// a reflow) and is near the screen (within a height of the window, or of a scroll
// box it is in – as the observers tell it). Reads each segment's real box, so it
// shares the observers' immunity to height drift and is correct under page zoom
// (getBoundingClientRect and innerHeight are the same space). Two passes –
// measure all, then paint – because painting mutates the DOM and would otherwise
// force a fresh layout between measurements. Used for the first paint and after a
// reflow; the observers cover whatever scrolls into view later. Finds, first, the
// scroll boxes the block is in (see above), so a block that has moved is watched
// through the boxes it is in now.
export function paintVisibleNow(fontInfo: FontTable, cache: LayoutCache): number {
    return paintNear(fontInfo, cache);
}
function paintNear(fontInfo: FontTable, cache: LayoutCache, outer?: Outer): number {
    if (!cache.dom) return 0;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    const segs = cache.dom.segs;
    const chain = bindBoxes(cache, outer) || [];
    const h = vh(), win: Band = { top: -h, bottom: 2 * h };
    // Near the nearest box: within its height of what it shows, while the box
    // itself is near (within a height of the window, or of the box around it).
    const boxNear = (k: number): boolean => {
        if (k >= chain.length) return false;
        const r = chain[k].getBoundingClientRect();
        return meets(r, win) || (k + 1 < chain.length && meets(r, grown(clientBand(chain[k + 1]))) && boxNear(k + 1));
    };
    const inBox = chain.length && boxNear(0) ? grown(clientBand(chain[0])) : null;
    const view = shown(chain[0] || null);
    const todo: number[] = [], nested: LayoutCache[] = [], rects: DOMRect[] = [];
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        // A stream segment paints through its nested cache – after this pass,
        // so the measurements below are not interleaved with DOM writes.
        if (!s.svg) { if (s.sub) nested.push(s.sub); continue; }
        if (s.painted && !s.dirty) continue;
        // Not rendered at all (inside a collapsed stream, say): its rect is all
        // zeros, which would pass the test below. The IntersectionObserver
        // paints it once it is shown.
        if (!s.svg.getClientRects().length) continue;
        const r = s.svg.getBoundingClientRect();
        if (meets(r, win) || (inBox && meets(r, inBox))) { todo.push(i); rects.push(r); }
    }
    let k = 0;
    for (const i of todo) {
        const r = rects[k++];
        if (slicedPaint(cache) && !meets(r, view) && laterFor(cache, i, r, view)) continue;
        paintSegment(fontInfo, cache, i);
    }
    let n = todo.length;
    for (const c of nested) n += paintNear(fontInfo, c, { at: cache.dom.root, boxes: chain });
    return n;
}

export let vpScheduled = false;
export function scheduleViewportPaint(): void {
    if (vpScheduled) return;
    vpScheduled = true;
    frame('viewport paint', () => {
        vpScheduled = false;
        for (const el of observedBlocks) {
            const data = blockData.get(el);
            if (data) paintVisibleNow(data.fontInfo, data.cache);
        }
    });
}
// Scrolling is handled by the IntersectionObservers (no per-frame work). A viewport
// resize – or the synthetic resize the zoom control fires – can change which
// segments are on screen without the observer necessarily re-firing, so re-check
// the visible set then.
window.addEventListener('resize', scheduleViewportPaint, { passive: true });

// Print needs every segment painted (off-screen ones are empty until then). Grow-
// only means they simply stay painted afterwards, so there is nothing to restore.
window.addEventListener('beforeprint', () => {
    flushAll();         // (what slices had left: laid out now)
    for (const el of observedBlocks) {
        const data = blockData.get(el);
        if (data) paintDocument(data.fontInfo, data.cache);
    }
});
