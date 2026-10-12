// SPDX-License-Identifier: AGPL-3.0-or-later

// ── Ids ────────────────────────────────────────────────────────────────────────
// The panel refers to everything by number. Blocks and nodes are keyed by
// object identity (node objects live as long as the block). Segments and
// lines are keyed by position – "block 1, segment 3, line 2" – and resolved
// afresh on every use, because a reflow makes new line objects but the
// panel's expanded rows should survive it.
export let nextId = 1;
export const byObj = new WeakMap(), byKey = new Map(), entries = new Map();
export function register(obj, key, make) {
    let id = obj ? byObj.get(obj) : byKey.get(key);
    if (id === undefined) {
        id = nextId++;
        if (obj) byObj.set(obj, id); else byKey.set(key, id);
        entries.set(id, make());
    }
    return id;
}
export const blockId = el => register(el, null, () => ({ kind: 'block', el }));
// A segment: `cachePath` is [] for the block's own cache, [k, …] for the
// nested cache of stream segment k (and so on down). `root` is null for the
// block's flow, or the key of a surface: a part of one of its instances laid
// out elsewhere (the viewer's inspect.surfaces: a popover's footnote, a
// margin note, a pane or a Lean part a component drew).
export const segId = (bid, cachePath, i, root = null) => register(null, `s${bid}/${root ?? ''}/${cachePath.join('.')}/${i}`,
    () => ({ kind: 'seg', block: bid, cachePath, i, root }));
// A surface: a row of its own under its block, holding its segments once it has
// been opened (and so laid out).
export const sideId = (bid, root) => register(null, `f${bid}/${root}`, () => ({ kind: 'side', block: bid, root }));
export const lineId = (sid, j) => register(null, `l${sid}/${j}`, () => ({ kind: 'line', seg: sid, j }));
// A display's nodes are copies made afresh at every width (see affineRows);
// they are keyed by the node they were made from, so a row stays the same row
// across reflows, and point at the latest copy.
export function nodeId(n, sid, parent) {
    const id = register(n.affineSource || n, null, () => ({ kind: 'node', n }));
    const e = entries.get(id);
    e.n = n;
    if (sid !== undefined) { e.seg = sid; e.parent = parent; }
    return id;
}
// What TeX put between two paragraphs, or around a heading or a display: the
// glue on its vertical list, shown as TeX's own items. A vertical space row
// holds the glue the document recorded (the vspace item's `glue`: an
// author's or a heading's skip, \parskip, a display skip) and the interline
// glue, \baselineskip or \lineskip, as it comes out for these lines at this
// width. On the page each is a band, stacked in that order.
//
// Two places hold one: before a segment (between blocks of text, displays,
// streams), and between two paragraphs within a run of text.
export const gapId = (bid, cachePath, i, root = null) => register(null, `g${bid}/${root ?? ''}/${cachePath.join('.')}/${i}`,
    () => ({ kind: 'vgap', block: bid, cachePath, i, root }));
export const parGapId = (sid, k) => register(null, `p${sid}/${k}`, () => ({ kind: 'vpar', seg: sid, k }));
export const partId = (gid, k) => register(null, `v${gid}/${k}`, () => ({ kind: 'vpart', gap: gid, k }));
// A node's id, found other than through the tree.
export function nodeRef(n, sid) {
    const id = register(n.affineSource || n, null, () => ({ kind: 'node', n }));
    const e = entries.get(id);
    e.n = n; e.seg = sid;
    return id;
}
