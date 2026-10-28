// SPDX-License-Identifier: AGPL-3.0-or-later

import { SP_TO_PX, useGlyphMetrics } from '../engine/core.ts';
import { paintAdjusts, paintCount } from '../engine/paint.ts';
import { renderNodes } from '../engine/render.ts';
import { blockData } from '../runtime/blocks.ts';
import { api } from '../runtime/page.ts';
import { surfacesOf } from './surface.ts';
import { definedKinds } from './kinds.ts';
import { idle, pending } from '../runtime/pending.ts';
import { scopeSizes } from './slots.ts';
import { sliceState } from '../runtime/slices.ts';
import type { SliceState } from '../runtime/slices.ts';
import { faceRecords } from '../runtime/fonts.ts';
import type { BlockData } from '../runtime/block-data.ts';
import type { TexNode } from '../engine/model.ts';
import type { LayoutCache, Line } from '../engine/layout/types.ts';

/** What replay calls, all optional (coordinates: the segment <svg>'s). */
export interface ReplaySink {
    line?(j: number, line: Line, x0: number, baselineY: number): void;
    node?(n: TexNode, x: number, baselineY: number, advance: number): void;
    vnode?(n: TexNode, x: number, top: number, advance: number): void;
}
/** A surface (a part laid out elsewhere), for tools. */
export interface InspectSurface {
    key: string; cache: LayoutCache; instance: string; kind: string; role: string; el: HTMLElement;
    where: 'popover' | 'margin' | 'page';
}
/** window.reflowtex.inspect (see the list above). */
export interface Inspect {
    readonly version: 1;
    readonly spToPx: number;
    blocks(): HTMLElement[];
    state(el: Element): BlockData | undefined;
    readonly paints: number;
    idle(): Promise<void>;
    pending(): string[];
    scopes(): Record<string, number>;
    slices(reset?: boolean): SliceState;
    surfaces(el: HTMLElement): InspectSurface[];
    kinds(): ReturnType<typeof definedKinds>;
    replay(el: Element, i: number, sink: ReplaySink, cache?: LayoutCache): boolean;
    faces(): ReturnType<typeof faceRecords>;
}

// ── Inspection ───────────────────────────────────────────────────────────────
// For developer tools – a browser extension that shows boxes and glue, a test
// harness. Read-only by convention: the state objects are the renderer's own,
// and their shapes are internal and may change between versions (hence the
// version number).
//
//   blocks()                every initialised block element on the page
//   state(el)               { doc, fontInfo, cache, lastWidth, params, … }
//   spToPx                  scaled points → the svg user units below
//   paints                  a counter, bumped by every segment paint: a tool
//                           polls it to notice a reflow
//   idle()                  a promise, resolved once the viewer has nothing
//                           still to come – no frame, timer, set-up or face it
//                           waits for, the fonts loaded, no animation running
//                           on the page – over three frames. A test waits for
//                           it after acting, instead of a fixed time
//                           (runtime/pending.ts).
//   pending()               the names of what is still to come, to tell why
//                           idle() has not resolved
//   surfaces(el)            the parts of el's instances laid out elsewhere
//                           (host API surfaces: a popover's footnote, a margin
//                           note, a pane a component drew): { key, cache,
//                           instance, kind, role, el, where } – key stable for
//                           the surface's life, where 'popover' | 'margin' |
//                           'page'. Their caches replay like the block's.
//   kinds()                 the kinds the page defines (host.define), with
//                           whether each measures (inline) – for listing.
//   faces()                 the font faces in effect: { file, family, status,
//                           url, bytes } – where each came from (a URL, or the
//                           bytes host.fonts.provide gave), for a tool that
//                           reads the font's file.
//   replay(el, i, sink[, cache])
//                           re-runs the drawing of segment i of `cache` (the
//                           block's own by default; a stream's nested one,
//                           cache.dom.segs[k].sub, for its segments) through
//                           `sink`, touching no DOM. sink.line(j, line, x0,
//                           baselineY), sink.node(n, x, baselineY, advance) and
//                           sink.vnode(n, x, top, advance) are all optional;
//                           coordinates are the segment <svg>'s user units
//                           (cache.dom.segs[i].svg). False when the segment has
//                           no lines yet (a stream, or a layout deferred until
//                           it scrolls near).
export const inspectable = new Set<HTMLElement>();
const surfaceKeys = new WeakMap<object, string>();
let surfaceSeq = 0;
const inspect: Inspect = {
    version: 1,
    spToPx: SP_TO_PX,          // scaled points → svg user units
    blocks: () => [...inspectable].filter(el => el.isConnected),
    state: el => blockData.get(el),
    get paints() { return paintCount; },
    idle,
    pending,
    scopes: () => scopeSizes(),   // scope → how many blocks it holds
    slices: reset => sliceState(reset),   // layout work left for idle time (runtime/slices.ts)
    surfaces(el) {
        return [...surfacesOf(el)].filter(s => !s.isDisposed).map(s => {
            let key = surfaceKeys.get(s);
            if (!key) surfaceKeys.set(s, key = `u${++surfaceSeq}`);
            const where: InspectSurface['where'] = s.el.closest('#latex-footnote-pop') ? 'popover' : s.el.closest('.latex-margin') ? 'margin' : 'page';
            const i = s.part.instance;
            return { key, cache: s.layoutCache, instance: i.id, kind: i.kind, role: s.part.role, el: s.el, where };
        });
    },
    kinds: () => definedKinds(),
    faces: () => faceRecords(),
    replay(el, i, sink, cache) {
        // (a block's own cache, or one given: a stream's nested one, a surface's)
        const data = blockData.get(el);
        cache = cache || (data && data.cache);
        return !!data && !!cache && replaySegment(data.fontInfo, cache, i, sink);
    },
};

/** Segment i of `cache` drawn again through `sink`, touching no DOM (inspect.replay, Segment.walk). False when it
 *  has no lines yet (a stream, or a layout deferred until it scrolls near). */
export function replaySegment(fontInfo: BlockData['fontInfo'], cache: LayoutCache, i: number, sink: ReplaySink): boolean {
    const L = cache.layout && cache.layout.laid[i];
    if (!L || L.deferred || !L.lines || !L.lrp) return false;
    useGlyphMetrics(cache.metrics);
    const noop = () => {};
    const s = { glyph: noop, space: noop, rule: noop, picture: noop,
                beginTransform: noop, endTransform: noop,
                node: sink.node, vnode: sink.vnode };
    for (let j = 0; j < L.lines.length; j++) {
        const { ratio, er, x0, fillRatio, fillOrder, edge } = L.lrp[j];
        if (sink.line) sink.line(j, L.lines[j], x0, L.baselineYs![j]);
        renderNodes(fontInfo, s, L.lines[j].nodes, x0, L.baselineYs![j],
                    fillOrder ? fillRatio : ratio, er, fillOrder || 0, 0, 0, 1, edge);
        paintAdjusts(fontInfo, s, L, j, cache.layoutCtx?.columnPx ?? L.W);
    }
    return true;
}
api.inspect = inspect;
