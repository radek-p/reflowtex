// SPDX-License-Identifier: AGPL-3.0-or-later

import { I } from './context.ts';
import { blockOf, segId, segOf, type GapEntry, type SegEntry } from './ids.ts';
import type { InspectSurface } from '../../../viewer/src/host/inspect.ts';
import type { BlockData } from '../../../viewer/src/runtime/block-data.ts';
import type { DomSegment, LayoutCache, SegmentLayout } from '../../../viewer/src/engine/layout/types.ts';

// ── Resolving ──────────────────────────────────────────────────────────────────
// The layout cache a flow starts from: the block's, or a surface's.
export function rootCache(bid: number, root: string | null | undefined): LayoutCache | null {
    const st = I.state(blockOf(bid).el);
    if (!st) return null;
    if (root == null) return st.cache;
    const sf = surfaceOf(bid, root);
    return sf ? sf.cache : null;
}
// The surfaces of a block (older viewers have none to list).
export const surfacesOf = (el: HTMLElement): InspectSurface[] => (I.surfaces ? I.surfaces(el) : []);
export const surfaceOf = (bid: number, key: string): InspectSurface | undefined => surfacesOf(blockOf(bid).el).find(sf => sf.key === key);
export const WHERE: Record<string, string> = { popover: 'in the popover', margin: 'in the margin', page: 'drawn by the page' };
// The surface stream k's popover laid out, if it is open or was: its key.
export const popoverRoot = (bid: number, k: number): string | null => {
    const sf = surfacesOf(blockOf(bid).el).find(x => x.where === 'popover' && x.instance.endsWith(`/s${k}`));
    return sf ? sf.key : null;
};
export function cacheOf(seg: SegEntry | GapEntry): LayoutCache | null | undefined {
    let cache: LayoutCache | null | undefined = rootCache(seg.block, seg.root);
    for (const k of seg.cachePath) cache = cache && cache.dom && cache.dom.segs[k] && cache.dom.segs[k].sub;
    return cache;
}
/** A segment row's segment, its cache, its block's element, its layout and its elements. */
export interface SegParts {
    seg: SegEntry;
    cache: LayoutCache | null | undefined;
    el: HTMLElement;
    laid: SegmentLayout | null | undefined;
    s: DomSegment | null | undefined;
}
export function segParts(sid: number): SegParts {
    const seg = segOf(sid), cache = cacheOf(seg);
    const el = blockOf(seg.block).el;
    const laid = cache && cache.layout && cache.layout.laid[seg.i];
    const s = cache && cache.dom && cache.dom.segs[seg.i];
    return { seg, cache, el, laid, s };
}

/** The viewer's data for the block segment `sid` is in. */
export const stateOfSeg = (sid: number): BlockData => I.state(blockOf(segOf(sid).block).el)!;

// Every segment of a block (streams' nested ones included) that has an svg,
// and then those of its footnotes' popovers, if laid out.
export function* segmentsOf(bid: number): Generator<number> {
    const el = blockOf(bid).el;
    function* walk(cache: LayoutCache | null | undefined, cachePath: number[], root: string | null): Generator<number> {
        if (!cache || !cache.dom) return;
        for (let i = 0; i < cache.dom.segs.length; i++) {
            const s = cache.dom.segs[i];
            if (s.sub) yield* walk(s.sub, [...cachePath, i], root);
            else if (s.svg) yield segId(bid, cachePath, i, root);
        }
    }
    yield* walk(I.state(el)!.cache, [], null);
    for (const k of rootsOf(el)) yield* walk(rootCache(bid, k), [], k);
}
// A block's surfaces, by key.
export const rootsOf = (el: HTMLElement): string[] => surfacesOf(el).map(sf => sf.key);
