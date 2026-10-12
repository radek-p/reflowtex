// SPDX-License-Identifier: AGPL-3.0-or-later

import { I } from './context.js';
import { entries, segId } from './ids.js';

// ── Resolving ──────────────────────────────────────────────────────────────────
// The layout cache a flow starts from: the block's, or a surface's.
export function rootCache(bid, root) {
    const st = I.state(entries.get(bid).el);
    if (!st) return null;
    if (root == null) return st.cache;
    const sf = surfaceOf(bid, root);
    return sf ? sf.cache : null;
}
// The surfaces of a block (older viewers have none to list).
export const surfacesOf = el => (I.surfaces ? I.surfaces(el) : []);
export const surfaceOf = (bid, key) => surfacesOf(entries.get(bid).el).find(sf => sf.key === key);
export const WHERE = { popover: 'in the popover', margin: 'in the margin', page: 'drawn by the page' };
// The surface stream k's popover laid out, if it is open or was: its key.
export const popoverRoot = (bid, k) => {
    const sf = surfacesOf(entries.get(bid).el).find(x => x.where === 'popover' && x.instance.endsWith(`/s${k}`));
    return sf ? sf.key : null;
};
export function cacheOf(seg) {
    let cache = rootCache(seg.block, seg.root);
    for (const k of seg.cachePath) cache = cache && cache.dom && cache.dom.segs[k] && cache.dom.segs[k].sub;
    return cache;
}
export function segParts(sid) {
    const seg = entries.get(sid), cache = cacheOf(seg);
    const el = entries.get(seg.block).el;
    const laid = cache && cache.layout && cache.layout.laid[seg.i];
    const s = cache && cache.dom && cache.dom.segs[seg.i];
    return { seg, cache, el, laid, s };
}

// Every segment of a block (streams' nested ones included) that has an svg,
// and then those of its footnotes' popovers, if laid out.
export function* segmentsOf(bid) {
    const el = entries.get(bid).el;
    function* walk(cache, cachePath, root) {
        if (!cache || !cache.dom) return;
        for (let i = 0; i < cache.dom.segs.length; i++) {
            const s = cache.dom.segs[i];
            if (s.sub) yield* walk(s.sub, [...cachePath, i], root);
            else if (s.svg) yield segId(bid, cachePath, i, root);
        }
    }
    yield* walk(I.state(el).cache, [], null);
    for (const k of rootsOf(el)) yield* walk(rootCache(bid, k), [], k);
}
// A block's surfaces, by key.
export const rootsOf = el => surfacesOf(el).map(sf => sf.key);
