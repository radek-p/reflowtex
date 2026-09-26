// SPDX-License-Identifier: AGPL-3.0-or-later
// Typeset parts and their surfaces (types.ts): a part's content laid out
// into an element the page owns, at a width the page chooses, for as long as
// the page keeps it. Each surface is a layout of its own – its own cache,
// its own segments – so a part may be shown in several places at once.
//
// Painting is the viewer's usual lazy painting: layoutDocument registers a
// surface's segments with the IntersectionObserver, so a surface painted
// only as far as it is on screen, and one inside a hidden element (a
// collapsed pane) painted when it is shown. Nothing to call.

import { SP_TO_PX, ZOOM, sumWidthSp } from '../engine/core.js';
import { layoutDocument } from '../engine/layout/document.js';
import { NATURAL_PROBE_PT, markDirty, unobserveAll } from '../runtime/blocks.js';
import { paintVisibleNow } from '../runtime/visibility.js';
import { paintDocument } from '../engine/paint.js';
import { disposePieces } from './inline.ts';
import type { Doc, DocStream } from './instances.ts';
import type { Instance, MountOptions, Surface, SurfaceMetrics, TypesetPart } from './types.ts';

/** What a part needs of its block: the viewer's per-block data. */
export interface BlockData {
    el: HTMLElement;
    doc: Doc;
    fontInfo: unknown;
    params: Record<string, unknown>;
}

// Live surfaces per block element, for the font re-render (rerenderSurfaces),
// and all of them, for print.
const live = new WeakMap<HTMLElement, Set<SurfaceImpl>>();
const all = new Set<SurfaceImpl>();

/** A layout's cache, as far as the host modules use it. `blockEl` and
 *  `relayout` travel down into nested caches: the block whose instances the
 *  layout holds, and how to lay out again the layout that owns it (the
 *  block, or a surface). `hosts` holds its block instances' hosts
 *  (block-hosts.ts), by stream index. */
export type Cache = {
    bcs: unknown; dom: any; layout: any; stats: unknown;
    blockEl?: HTMLElement; relayout?: () => void; hosts?: Map<number, unknown>;
};

/** What a layout's first and last lines give the text around it. */
export interface Edges { firstAscent: number; firstMeta: unknown; textFirst: boolean; lastDepth: number; textLast: boolean }
export function edgesOf(cache: Cache): Edges {
    const laid = (cache.layout && cache.layout.laid) || [];
    const first = laid[0], last = laid[laid.length - 1];
    const textAt = (L: any) => !!(L && L.seg && L.seg.kind === 'text');
    return { firstAscent: first ? first.firstAscent : 0, firstMeta: first ? first.firstMeta : null,
             textFirst: textAt(first), lastDepth: last ? last.lastDepth : 0, textLast: textAt(last) };
}

/** Set by block-hosts.ts: a surface appeared or went, and a layout's hosts
 *  must go with it. (A hook rather than an import, to keep the two apart.) */
export const surfaceHooks = {
    changed: (_s: SurfaceImpl) => {},
    disposeHosts: (_cache: Cache) => {},
};

/** The live surfaces of a block (every part of its instances, wherever mounted). */
export function surfacesOf(blockEl: HTMLElement): Iterable<SurfaceImpl> {
    return live.get(blockEl) || [];
}

export class TypesetPartImpl implements TypesetPart {
    readonly type = 'typeset' as const;
    private natural: number | null = null;
    readonly doc: Doc;
    constructor(readonly role: string, readonly instance: Instance, readonly data: BlockData, stream: DocStream) {
        this.doc = { ...data.doc, content: stream.content || [] };
    }
    /** Lay the part out at `px` into a fresh cache (or the one given). */
    layout(px: number, cache: Cache = this.newCache()): { cache: Cache; root: HTMLElement } {
        const root = layoutDocument(this.data.fontInfo, this.doc, px / ZOOM, this.data.params, cache) as HTMLElement;
        return { cache, root };
    }
    newCache(relayout?: () => void): Cache {
        return { bcs: null, dom: null, layout: null, stats: null, blockEl: this.data.el, relayout };
    }
    naturalWidth(): number {
        if (this.natural === null) {
            const { cache } = this.layout(NATURAL_PROBE_PT * ZOOM);
            let w = 0;
            for (const L of cache.layout.laid)
                (L.lines || []).forEach((ln: any, j: number) => {
                    w = Math.max(w, ((L.lrp && L.lrp[j]) ? L.lrp[j].x0 : 0) + sumWidthSp(ln.nodes) * SP_TO_PX);
                });
            this.natural = Math.ceil(w + 0.5);
        }
        return this.natural;
    }
    mount(el: HTMLElement, options: MountOptions = {}): Surface {
        return new SurfaceImpl(this, el, options.width ?? 'container');
    }
}

export class SurfaceImpl implements Surface {
    private box = document.createElement('div');
    private cache: Cache;
    private px = 0;                              // the measure last laid out at
    private listeners = new Set<(m: SurfaceMetrics) => void>();
    private ro: ResizeObserver | null = null;
    private frame = 0;
    private disposed = false;
    private last: SurfaceMetrics = { width: 0, height: 0, firstBaseline: 0, lastDepth: 0 };

    constructor(readonly part: TypesetPartImpl, readonly el: HTMLElement, private width: MountOptions['width']) {
        // A key of its own (layoutDocument gives one): a link inside gets its
        // own tab stop, which it would not if it shared the block's key with
        // the same link drawn in the text.
        this.cache = part.newCache(() => this.relayout(true));
        this.box.className = 'latex-block latex-part';
        // Whose text this is: a control pressed in it acts for this instance
        // (actions.ts), wherever the page shows it.
        this.box.dataset.instance = part.instance.id;
        // Its own size and nothing else: no margin a page gives its blocks.
        this.box.style.margin = '0';
        let set = live.get(part.data.el);
        if (!set) live.set(part.data.el, set = new Set());
        set.add(this);
        all.add(this);
        this.apply();
    }

    private measure(): number {
        const w = this.width;
        if (typeof w === 'number') return w;
        if (w === 'natural') return this.part.naturalWidth();
        const cs = getComputedStyle(this.el);
        const inner = this.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        // Not rendered (display: none, or not in the document yet): keep the
        // last measure, or fall back to the block's own width.
        return inner > 0 ? inner : (this.px || this.part.data.el.clientWidth || 600);
    }

    private apply() {
        if (this.width === 'container') {
            if (!this.ro) {
                this.ro = new ResizeObserver(() => {
                    // In a frame: laying out changes el's height, which must
                    // not be reported back into this same callback.
                    if (this.frame) return;
                    this.frame = requestAnimationFrame(() => { this.frame = 0; this.relayout(); });
                });
                this.ro.observe(this.el);
            }
        } else if (this.ro) {
            this.ro.disconnect(); this.ro = null;
        }
        this.relayout(true);
    }

    relayout(force = false) {
        if (this.disposed) return;
        const px = this.measure();
        if (!force && Math.abs(px - this.px) < 0.5) return;
        this.px = px;
        const { root } = this.part.layout(px, this.cache);
        this.box.style.width = `${px}px`;
        if (root.parentNode !== this.box) this.box.replaceChildren(root);
        if (this.box.parentNode !== this.el) this.el.replaceChildren(this.box);
        markDirty(this.cache);
        paintVisibleNow(this.part.data.fontInfo, this.cache);
        const laid = this.cache.layout.laid;
        const first = laid[0], lastL = laid[laid.length - 1];
        this.last = {
            width: px,
            height: this.box.offsetHeight,
            firstBaseline: first ? first.firstAscent : 0,
            lastDepth: lastL ? lastL.lastDepth : 0,
        };
        this.box.dataset.baseline = String(this.last.firstBaseline);
        for (const fn of [...this.listeners]) {
            try { fn(this.last); } catch (e) { console.error('[latex-viewer] surface listener:', e); }
        }
        surfaceHooks.changed(this);
    }

    edges(): Edges { return edgesOf(this.cache); }
    /** Every segment, on screen or not (print). */
    paintAll() { if (!this.disposed) paintDocument(this.part.data.fontInfo, this.cache); }
    get isDisposed() { return this.disposed; }

    /** New elements for every glyph (the face that just loaded), same layout. */
    rerender() {
        if (this.disposed) return;
        unobserveAll(this.cache);
        disposePieces(this.cache);
        this.cache.dom = null; this.cache.layout = null;
        this.relayout(true);
    }

    metrics() { return this.last; }
    setWidth(width: MountOptions['width']) { this.width = width ?? 'container'; this.apply(); }
    onChange(fn: (m: SurfaceMetrics) => void) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.ro) this.ro.disconnect();
        if (this.frame) cancelAnimationFrame(this.frame);
        unobserveAll(this.cache);
        disposePieces(this.cache);
        surfaceHooks.disposeHosts(this.cache);
        this.listeners.clear();
        if (this.box.parentNode === this.el) this.el.removeChild(this.box);
        live.get(this.part.data.el)?.delete(this);
        all.delete(this);
        surfaceHooks.changed(this);
    }
}

/** After webfonts load: redraw every surface of a block (see rerenderBlock). */
export function rerenderSurfaces(blockEl: HTMLElement) {
    for (const s of live.get(blockEl) || []) s.rerender();
}

// Print needs every line of every surface (a pane not shown on screen may be
// the one print shows), as it does the blocks' (see visibility.js).
window.addEventListener('beforeprint', () => { for (const s of all) s.paintAll(); });
