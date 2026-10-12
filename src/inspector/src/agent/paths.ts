// SPDX-License-Identifier: AGPL-3.0-or-later
// The chain of rows a panel expands to show a thing.

import { entries, lineId, nodeId, segId, segOf, sideId } from './ids.ts';
import { geometry } from './geometry.ts';
import type { TexNode } from '../../../viewer/src/engine/model.ts';
import type { Line } from '../../../viewer/src/engine/layout/types.ts';

// From a node to the chain of ids the panel expands to show it.
export function pathOf(n: TexNode, sid: number): number[] | null {
    const g = geometry(sid)!, chain: TexNode[] = [];
    let cur: TexNode | Line | undefined = n;
    while (cur && !(cur as Line).nodes) { chain.unshift(cur as TexNode); cur = g.parent.get(cur as TexNode); }
    const L = cur && g.lines.find(L => L.line === cur);
    if (!L) return null;
    const lid = lineId(sid, L.j), ids = [lid];
    let parent = lid;
    for (const c of chain) { parent = nodeId(c, sid, parent); ids.push(parent); }
    return [...segPath(sid), ...ids];
}
// The rows above a segment and the segment itself: its block, a popover's
// row, the streams it sits in.
export function segPath(sid: number): number[] {
    const seg = segOf(sid), out = [seg.block];
    if (seg.root != null) out.push(sideId(seg.block, seg.root));
    for (let k = 0; k < seg.cachePath.length; k++) out.push(segId(seg.block, seg.cachePath.slice(0, k), seg.cachePath[k], seg.root));
    out.push(sid);
    return out;
}
export function pathOfLine(sid: number, j: number): number[] {
    return [...segPath(sid), lineId(sid, j)];
}
// The rows down to an id, for a panel to open.
export function pathTo(id: number): number[] | null {
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'node' && e.seg != null) return pathOf(e.n, e.seg);
    if (e.kind === 'seg') return segPath(id);
    if (e.kind === 'line') return pathOfLine(e.seg, e.j);
    if (e.kind === 'side') return [e.block, id];
    return [id];
}
