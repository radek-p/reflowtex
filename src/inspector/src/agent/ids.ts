// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TexNode } from '../../../viewer/src/engine/model.ts';

// ── Ids ────────────────────────────────────────────────────────────────────────
// The panel refers to everything by number. Blocks and nodes are keyed by
// object identity (node objects live as long as the block). Segments and
// lines are keyed by position – "block 1, segment 3, line 2" – and resolved
// afresh on every use, because a reflow makes new line objects but the
// panel's expanded rows should survive it.

/** A block element. */
export interface BlockEntry { kind: 'block'; el: HTMLElement }
/** A segment: `cachePath` is [] for the block's own cache, [k, …] for the
 *  nested cache of stream segment k (and so on down). `root` is null for the
 *  block's flow, or the key of a surface: a part of one of its instances laid
 *  out elsewhere (the viewer's inspect.surfaces: a popover's footnote, a
 *  margin note, a pane or a Lean part a component drew). */
export interface SegEntry { kind: 'seg'; block: number; cachePath: number[]; i: number; root: string | null }
/** A surface: a row of its own under its block. */
export interface SideEntry { kind: 'side'; block: number; root: string }
export interface LineEntry { kind: 'line'; seg: number; j: number }
/** A node, with the segment and the row it was last listed under. */
export interface NodeEntry { kind: 'node'; n: TexNode; seg?: number; parent?: number }
/** A vertical space before segment i of a flow (vspace.ts). */
export interface GapEntry { kind: 'vgap'; block: number; cachePath: number[]; i: number; root: string | null }
/** The vertical space before paragraph k of a text segment. */
export interface ParGapEntry { kind: 'vpar'; seg: number; k: number }
/** Part k of a vertical space: one glue or kern. */
export interface PartEntry { kind: 'vpart'; gap: number; k: number }
export type Entry = BlockEntry | SegEntry | SideEntry | LineEntry | NodeEntry | GapEntry | ParGapEntry | PartEntry;

let nextId = 1;
const byObj = new WeakMap<object, number>(), byKey = new Map<string, number>();
export const entries = new Map<number, Entry>();
function register(obj: object | null, key: string | null, make: () => Entry): number {
    let id = obj ? byObj.get(obj) : byKey.get(key!);
    if (id === undefined) {
        id = nextId++;
        if (obj) byObj.set(obj, id); else byKey.set(key!, id);
        entries.set(id, make());
    }
    return id;
}
// What an id is known to name, where the code knows it.
export const blockOf = (id: number): BlockEntry => entries.get(id) as BlockEntry;
export const segOf = (id: number): SegEntry => entries.get(id) as SegEntry;
export const nodeOf = (id: number): NodeEntry => entries.get(id) as NodeEntry;

export const blockId = (el: HTMLElement): number => register(el, null, () => ({ kind: 'block', el }));
export const segId = (bid: number, cachePath: number[], i: number, root: string | null = null): number =>
    register(null, `s${bid}/${root ?? ''}/${cachePath.join('.')}/${i}`, () => ({ kind: 'seg', block: bid, cachePath, i, root }));
// A surface: a row of its own under its block, holding its segments once it has
// been opened (and so laid out).
export const sideId = (bid: number, root: string): number => register(null, `f${bid}/${root}`, () => ({ kind: 'side', block: bid, root }));
export const lineId = (sid: number, j: number): number => register(null, `l${sid}/${j}`, () => ({ kind: 'line', seg: sid, j }));
// A display's nodes are copies made afresh at every width (see affineRows);
// they are keyed by the node they were made from, so a row stays the same row
// across reflows, and point at the latest copy.
export function nodeId(n: TexNode, sid?: number, parent?: number): number {
    const id = register(n.affineSource || n, null, () => ({ kind: 'node', n }));
    const e = nodeOf(id);
    e.n = n;
    if (sid !== undefined) { e.seg = sid; e.parent = parent; }
    return id;
}
// The vertical spaces (vspace.ts): before a segment, between two paragraphs
// of a text segment, and the parts of either.
export const gapId = (bid: number, cachePath: number[], i: number, root: string | null = null): number =>
    register(null, `g${bid}/${root ?? ''}/${cachePath.join('.')}/${i}`, () => ({ kind: 'vgap', block: bid, cachePath, i, root }));
export const parGapId = (sid: number, k: number): number => register(null, `p${sid}/${k}`, () => ({ kind: 'vpar', seg: sid, k }));
export const partId = (gid: number, k: number): number => register(null, `v${gid}/${k}`, () => ({ kind: 'vpart', gap: gid, k }));
// A node's id, found other than through the tree.
export function nodeRef(n: TexNode, sid: number): number {
    const id = register(n.affineSource || n, null, () => ({ kind: 'node', n }));
    const e = nodeOf(id);
    e.n = n; e.seg = sid;
    return id;
}
