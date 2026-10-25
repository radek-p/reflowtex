// SPDX-License-Identifier: AGPL-3.0-or-later
// A box whose contents changed width (live text replaced inside it:
// host/slots.ts), packed again the way TeX packs it, so that the line
// holding it is laid out and broken with its new width. Only widths change:
// a box keeps its height and depth, so no baseline moves.
//
//   a box TeX set at its natural width (no glue set, no rate) grows or
//   shrinks by the change, and hands it on to the box around it;
//   a box set to a width – its glue stretched or shrunk (\hbox to, a line of
//   a paragraph, a centred caption), or a width the measure sets (it carries
//   a rate: display_model) – keeps that width, and its glue is set again
//   from its new natural width (TeX's hpack, §649–§667); the box around it
//   sees no change.
//
// A vlist is as wide as its widest row (TeX's vpack, §668), so it changes
// by what that does. The values are the compiled tree's, at the width the
// document was set at; a rate evaluated later (layout/display.ts) applies on
// top of them as before.

import { nodeWidthSp } from './core.ts';
import type { BoxNode, TexNode } from './model.ts';

// LuaTeX's glue orders: normal, fi, fil, fill, filll.
const ORDERS = 5;

/** `box` with `children` in place of its own, which made its contents
 *  `delta` sp wider (negative: narrower). */
export function resizeBox(box: BoxNode, children: TexNode[], delta: number): BoxNode {
    if (box.type === 'vlist') {
        if (box.width_rate !== undefined) return { ...box, children };
        const widest = (ns: TexNode[]) => Math.max(0, ...ns.map(n =>
            n.type === 'hlist' || n.type === 'vlist' ? n.width + (n.shift || 0) : n.type === 'rule' && n.width > 0 ? n.width : 0));
        return { ...box, children, width: box.width + widest(children) - widest(box.children) };
    }
    const setToWidth = box.glue_sign === 1 || box.glue_sign === 2 || box.width_rate !== undefined;
    if (!setToWidth) return { ...box, children, width: box.width + delta };
    if (!delta) return { ...box, children };
    // TeX's hpack to the box's width: the excess goes to the glue of the
    // highest order that has any; shrink of finite order stops at its total
    // (the box is then overfull, as TeX leaves it).
    let natural = 0;
    const stretch = new Array<number>(ORDERS).fill(0), shrink = new Array<number>(ORDERS).fill(0);
    for (const n of children) {
        natural += nodeWidthSp(n);
        if (n.type === 'glue') {
            stretch[n.stretch_order || 0] += n.stretch || 0;
            shrink[n.shrink_order || 0] += n.shrink || 0;
        }
    }
    const x = box.width - natural;
    const top = (t: number[]) => { for (let o = ORDERS - 1; o > 0; o--) if (t[o]) return o; return 0; };
    if (x > 0) {
        const o = top(stretch);
        if (stretch[o]) return { ...box, children, glue_sign: 1, glue_order: o, glue_set: x / stretch[o] };
    } else if (x < 0) {
        const o = top(shrink);
        if (shrink[o]) return { ...box, children, glue_sign: 2, glue_order: o,
                                glue_set: o ? -x / shrink[o] : Math.min(1, -x / shrink[o]) };
    }
    // (no glue to take it: the box stays as wide, under- or overfull)
    return box.glue_sign ? { ...box, children, glue_sign: 0, glue_order: 0, glue_set: 0 } : { ...box, children };
}
