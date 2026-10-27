// SPDX-License-Identifier: AGPL-3.0-or-later

import { RUNNING_RULE, SP_TO_PX, gD, gH, gW, glyphExpandScale, kernExpandScale, sumWidthSp } from '../core.ts';
import { unreachable } from '../../../../shared/unreachable.ts';
import type { FontTable, TexNode } from '../model.ts';
import type { InkItem, LineMeta } from './types.ts';

// ── Adaptive line spacing ─────────────────────────────────────────────────────

export function lineProfile(fontInfo: FontTable, nodes: TexNode[], xStart: number, ratio: number, expandRatio: number): InkItem[] {
    const items: InkItem[]=[];
    function walk(ns: TexNode[], x: number, r: number, er: number): number {
        for(let i=0;i<ns.length;i++){
            const n=ns[i];
            switch(n.type){
                case 'glyph':{
                    const w=gW(n)*glyphExpandScale(fontInfo,n,er)*SP_TO_PX;
                    const h=gH(n)*SP_TO_PX, d=gD(n)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h,d}); x+=w; break;
                }
                case 'glue':{let w=n.width; if(r>0&&!(n.stretch_order||0)&&n.stretch)w+=r*n.stretch; else if(r<0&&!(n.shrink_order||0)&&n.shrink)w+=r*n.shrink; x+=w*SP_TO_PX; break;}
                case 'kern': x+=n.kern*((n.subtype||0)===0?kernExpandScale(fontInfo,ns[i-1],ns[i+1],er):1)*SP_TO_PX; break;
                case 'disc': case 'wdisc': x=walk(n.replace,x,0,er); break;
                case 'math': x+=n.surround*SP_TO_PX; break;
                case 'widget': case 'picture':{
                    const w=(n.width??0)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h:(n.height??0)*SP_TO_PX,d:(n.depth??0)*SP_TO_PX});
                    x+=w; break;
                }
                case 'hlist':case 'vlist':{
                    const w=(n.width??0)*SP_TO_PX, shift=(n.shift??0)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h:Math.max(0,(n.height??0)*SP_TO_PX-shift),d:Math.max(0,(n.depth??0)*SP_TO_PX+shift)});
                    x+=w; break;
                }
                // A \vrule set in the line (a \strut is one): its height and
                // depth are ink as a box's are; a running one's run to the
                // line's own, and add nothing.
                case 'rule':{
                    const w=(n.width===RUNNING_RULE?0:n.width)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h:n.height===RUNNING_RULE?0:Math.max(0,n.height*SP_TO_PX),d:n.depth===RUNNING_RULE?0:Math.max(0,n.depth*SP_TO_PX)});
                    x+=w; break;
                }
                // \rotatebox's matrix: TeX sized the enclosing box to the
                // turned content, so the ink is that box's; its children
                // advance the pen as they did before they were grouped.
                case 'transform': x+=sumWidthSp(n.children)*SP_TO_PX; break;
                case 'penalty': case 'adjust': case 'local_par': break;
                default: unreachable(n, 'node');
            }
        }
        return x;
    }
    walk(nodes,xStart,ratio,expandRatio);
    return items;
}

export function minRequiredAdvance(upper: InkItem[], lower: InkItem[]): number {
    let req=0;
    for(const u of upper){if(u.d<=0)continue; for(const l of lower){if(l.h<=0)continue; if(u.x2>l.x1&&l.x2>u.x1) req=Math.max(req,u.d+l.h);}}
    return req;
}

// TeX's interline glue (§679), in px. Given the previous line's depth and this
// line's ascent, and the paragraph's \baselineskip / \lineskip / \lineskiplimit
// (all px): normally the baselineskip less the two, but when the two lines are
// tall enough that it would fall below lineskiplimit, the fixed lineskip
// instead. This is exactly the rule LaTeX applies, so lines land at the LaTeX
// distance. TeX takes the depth from \prevdepth, which is the line above's
// unless m.prevDepth says otherwise; at -Infinity (-1000pt) it sets no glue.
export function texInterlineGlue(prevDepth: number, thisAscent: number, m: LineMeta): number {
    const d = m.prevDepth ?? prevDepth;
    if (d === -Infinity) return 0;
    const b = m.bskip - d - thisAscent;
    return b >= m.lskiplimit ? b : m.lskip;
}
// The baseline-to-baseline advance that gives: the glue and the two abutting
// extents.
export function texInterlineAdvance(prevDepth: number, thisAscent: number, m: LineMeta): number {
    return prevDepth + texInterlineGlue(prevDepth, thisAscent, m) + thisAscent;
}
