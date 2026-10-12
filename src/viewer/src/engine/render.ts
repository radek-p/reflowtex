// SPDX-License-Identifier: AGPL-3.0-or-later
// Walking a finished node list as TeX would set it: every glyph, rule,
// picture and space at its pen position, handed to a sink. The painter's
// sink draws them (sink.ts); others measure ink (layout/display.ts), lay the
// accessible text (runtime/a11y.ts) or replay a segment (host/inspect.ts).

import {
    RUNNING_RULE, SP_TO_PX, gW, glyphExpandScale, hlistGlueRatio, kernExpandScale, setGlue, vlistGlueRatio,
} from './core.ts';
import type {
    BoxNode, FontTable, GlueNode, GlyphNode, PictureNode, RuleNode, TexNode, TransformNode, ViewerFont, WidgetNode,
} from './model.ts';

/** What renderNodes hands each thing it meets, at its pen position (px; y
 *  the baseline, or a rule's top). The optional calls are for sinks that
 *  want them: a widget, a \webaside's mark, the gaps the affine model
 *  sizes, and every node with its advance (an inspection's replay). */
export interface Sink {
    beginTransform(n: TransformNode, tf: SvgMatrix): void;
    endTransform(): void;
    glyph(n: GlyphNode, x: number, y: number, fi: ViewerFont | undefined): void;
    /** An interword space (glue of subtype 13). */
    space(n: GlueNode, x: number, y: number): void;
    rule(n: RuleNode, x: number, y: number, w: number, h: number): void;
    picture(n: PictureNode, x: number, y: number): void;
    widget?(n: WidgetNode, x: number, y: number): void;
    aside?(n: BoxNode, x: number, y: number): void;
    gap?(n: TexNode, field: 'width' | 'kern' | 'surround', x: number, w: number): void;
    node?(n: TexNode, x: number, y: number, advance: number): void;
    /** A vertical list's item: its top and advance. */
    vnode?(n: TexNode, x: number, y: number, advance: number): void;
}

/** A transform's matrix as SVG takes it, about the point (x, y). */
export interface SvgMatrix { a: number; b: number; c: number; d: number; x: number; y: number }
/** An affine map (a, b, c, d, e, f): x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [number, number, number, number, number, number];

// ── Transforms ────────────────────────────────────────────────────────────────
// A `transform` node (\rotatebox and friends) carries a PDF matrix applied
// about the current point; see the serializer, which folds TeX's save/setmatrix/
// restore whatsits into it. Two conversions are needed to get to SVG:
//
//   * PDF's y axis points up, SVG's points down. The SVG matrix is the PDF one
//     conjugated by the flip diag(1,-1), which negates the off-diagonal terms:
//     [a b c d] becomes matrix(a, -b, -c, d). Skip this and rotations come out
//     mirrored – 90° turns the wrong way.
//   * The matrix acts about the reference point, not the origin, so it is
//     wrapped in translate(±ref).
export function svgMatrixOf(n: TexNode, x: number, y: number): SvgMatrix {
    return { a: n.m_a ?? 1, b: -(n.m_b ?? 0), c: -(n.m_c ?? 0), d: n.m_d ?? 1, x, y };
}

// The affine (a,b,c,d,e,f) of a transform about its reference point, in the
// order SVG's matrix() takes: x' = a·x + c·y + e, y' = b·x + d·y + f.
export function affineOf(t: SvgMatrix): Affine {
    return [t.a, t.b, t.c, t.d,
            t.x - (t.a * t.x + t.c * t.y),
            t.y - (t.b * t.x + t.d * t.y)];
}

// m1 ∘ m2 – apply m2, then m1.
export function affineMul(m1: Affine | null, m2: Affine | null): Affine | null {
    if (!m1) return m2;
    if (!m2) return m1;
    const [a1,b1,c1,d1,e1,f1] = m1, [a2,b2,c2,d2,e2,f2] = m2;
    return [a1*a2 + c1*b2,       b1*a2 + d1*b2,
            a1*c2 + c1*d2,       b1*c2 + d1*d2,
            a1*e2 + c1*f2 + e1,  b1*e2 + d1*f2 + f1];
}
// ── Leaders ───────────────────────────────────────────────────────────────────
// Leader glue carries a box that TeX repeats across the glue's set width rather
// than leaving it blank; \xrightarrow is an arrow tail, a \cleaders run of
// en-dashes, and an arrowhead. The set width is whatever the enclosing box's
// glue setting produced, so the copies are laid out here rather than baked in.
//
// Placement follows TeX82 §626-627: as many whole copies as fit, then
//   \cleaders – the remainder is split evenly at the two ends (centred);
//   \xleaders – the remainder is spread evenly into count+1 gaps;
//   \leaders / \gleaders – copies align to a grid on the *enclosing* box rather
//     than to this glue, which is not information the node carries, so they are
//     packed from the left. Nothing in this pipeline uses them today.
export const GLUE_LEADERS = 100, GLUE_CLEADERS = 101, GLUE_XLEADERS = 102;

// The DOM reconciler is keyed by node identity, so every tiled copy needs its
// own node objects: drawing one leader box N times would look up the same
// element N times, move it, and leave a single copy at the last position. The
// clones are cached on the glue node and reused while the count holds, which
// keeps the elements – and the reconciler's work – stable across reflows.
export function deepCloneNode<T>(o: T): T {
    if(Array.isArray(o)) return o.map(deepCloneNode) as T;
    if(o&&typeof o==='object'){
        const r: Record<string, unknown>={};
        for(const k of Object.keys(o)) r[k]=deepCloneNode((o as Record<string, unknown>)[k]);
        return r as T;
    }
    return o;
}

export function leaderCopies(n: GlueNode, count: number): TexNode[] {
    if(!n._leaderCopies || n._leaderCopies.length!==count){
        n._leaderCopies=[];
        for(let i=0;i<count;i++) n._leaderCopies.push(deepCloneNode(n.leader!));
    }
    return n._leaderCopies;
}

export function renderLeaders(fontInfo: FontTable, sink: Sink, n: GlueNode, x: number, baselineY: number, wSp: number): void {
    const L=n.leader;
    if(!L || wSp<=0) return;

    // A rule leader is not tiled: TeX simply runs the rule the whole length
    // (\hrulefill). Running dimensions inherit from the enclosing box, which is
    // not reachable here, so they fall back to the rule's own.
    if(L.type==='rule'){
        const h=(L.height===RUNNING_RULE?0:(L.height??0))*SP_TO_PX;
        const d=(L.depth ===RUNNING_RULE?0:(L.depth ??0))*SP_TO_PX;
        if(h+d>0) sink.rule(L, x, baselineY-h, wSp*SP_TO_PX, h+d);
        return;
    }

    const Lw=L.width??0;
    if(Lw<=0) return;                     // would tile forever
    const count=Math.floor(wSp/Lw);
    if(count<1) return;                   // not even one copy fits: TeX draws nothing

    const slack=wSp-count*Lw;
    let start, step=Lw;
    if(n.subtype===GLUE_XLEADERS){ const gap=slack/(count+1); start=gap; step=Lw+gap; }
    else if(n.subtype===GLUE_CLEADERS){ start=slack/2; }
    else { start=0; }                     // \leaders / \gleaders – see note above

    const copies=leaderCopies(n,count);
    for(let i=0;i<count;i++){
        renderNodes(fontInfo,sink,[copies[i]],x+(start+i*step)*SP_TO_PX,baselineY,0,0,0);
    }
}

// Stack a vlist's children top-to-bottom. refY is the vlist's reference baseline
// and vlistX its left edge; both are supplied by the caller (already resolving any
// shift for the context the vlist appears in). Split out of renderNodes so a vlist
// nested inside another vlist can reuse it – without this, a vlist child was
// dropped, which silently deleted the inner half of a stacked construction
// (double math accents, \substack, nested roots, …), leaving one piece too high.
export function renderVlistBody(fontInfo: FontTable, sink: Sink, n: BoxNode, vlistX: number, refY: number): void {
    const{ratio:vr,fillOrder:vfo}=vlistGlueRatio(n);
    const vlistW=n.width;
    let curY=refY-n.height*SP_TO_PX;
    for(const child of n.children){
        const y0=curY;
        if(child.type==='kern'){curY+=child.kern*SP_TO_PX;}
        else if(child.type==='glue'){curY+=setGlue(child,vr,vfo)*SP_TO_PX;}
        else if(child.type==='rule'){
            const rw=(child.width===RUNNING_RULE?vlistW:child.width)*SP_TO_PX;
            const rh=(child.height+child.depth)*SP_TO_PX;
            sink.rule(child,vlistX,curY,rw,rh);
            curY+=rh;
        } else if(child.type==='hlist'){
            const cb=curY+child.height*SP_TO_PX;
            const{ratio:hr,fillOrder:hfo}=hlistGlueRatio(child);
            renderNodes(fontInfo,sink,child.children,vlistX+(child.shift??0)*SP_TO_PX,cb,hr,0,hfo,child.height,child.depth);
            curY+=(child.height+child.depth)*SP_TO_PX;
        } else if(child.type==='vlist'){
            // Inside a vlist a box's shift is horizontal; the child's own baseline
            // sits child.height below the current pen, then we advance past it.
            renderVlistBody(fontInfo,sink,child,vlistX+(child.shift??0)*SP_TO_PX,curY+child.height*SP_TO_PX);
            curY+=(child.height+child.depth)*SP_TO_PX;
        }
        // Inspection: a vertical list item's top edge and advance.
        if(sink.vnode) sink.vnode(child, vlistX, y0, curY-y0);
    }
}

// runH/runD (sp) are the enclosing box's height and depth. A rule with a running
// dimension (the RUNNING_RULE sentinel) inherits it – that is how a \vrule stretches
// to the exact height of the \hbox it sits in (e.g. the two side edges of the amsthm
// QED box). Without this the rule is dropped and only the top/bottom edges show.
export function renderNodes(fontInfo: FontTable, sink: Sink, nodes: TexNode[], x: number, baselineY: number,
                            ratio?: number, expandRatio?: number, fillOrder?: number, runH?: number, runD?: number): number {
    ratio=ratio||0; expandRatio=expandRatio||0; fillOrder=fillOrder||0; runH=runH||0; runD=runD||0;
    for(let i=0;i<nodes.length;i++){
        const n=nodes[i], x0=x;
        switch(n.type){
            case 'rule':{
                // In an hlist a rule is a vrule: its width is set, its height/depth
                // run to the enclosing box. Draw it, then advance the pen by its width.
                const w =(n.width ===RUNNING_RULE?0:(n.width ??0));
                const h =(n.height===RUNNING_RULE?runH:(n.height??0));
                const d =(n.depth ===RUNNING_RULE?runD:(n.depth ??0));
                const hp=h*SP_TO_PX, dp=d*SP_TO_PX;
                if(w>0&&hp+dp>0) sink.rule(n, x, baselineY-hp, w*SP_TO_PX, hp+dp);
                x+=w*SP_TO_PX; break;
            }
            case 'glyph':{
                sink.glyph(n, x, baselineY, fontInfo[String(n.font)]);
                x+=gW(n)*glyphExpandScale(fontInfo,n,expandRatio)*SP_TO_PX; break;
            }
            case 'glue':{
                let w=n.width;
                if(ratio>0&&(n.stretch_order||0)===fillOrder&&n.stretch) w+=ratio*n.stretch;       // signed, as setGlue
                else if(ratio<0&&(n.shrink_order||0)===fillOrder&&n.shrink) w+=ratio*n.shrink;
                if(n.leader) renderLeaders(fontInfo,sink,n,x,baselineY,w);
                if(n.subtype===13) sink.space(n, x, baselineY);
                if(sink.gap) sink.gap(n,'width',x,w*SP_TO_PX);
                x+=w*SP_TO_PX; break;
            }
            case 'kern':{
                // Expansion stretches the font's own kerns (subtype 0) with the
                // glyphs, as an expanded font copy would; an explicit \kern,
                // an accent kern or an italic correction keeps its width.
                const w=n.kern*((n.subtype||0)===0?kernExpandScale(fontInfo,nodes[i-1],nodes[i+1],expandRatio):1)*SP_TO_PX;
                if(sink.gap) sink.gap(n,'kern',x,w);
                x+=w; break;
            }
            case 'picture':{
                // The picture fills its TeX box exactly; the box is what makes
                // it behave like any other box in text, math or an align row.
                sink.picture(n, x, baselineY);
                x+=n.width*SP_TO_PX; break;
            }
            case 'transform':{
                // The matrix is drawing-only: TeX advanced the pen by the
                // untransformed content and sized the *enclosing* box to the
                // rotated bbox, so the children still advance x exactly as
                // they did before the serializer grouped them. (graphicx makes
                // the content box zero-width, so in practice this is 0.) The
                // ratio/fillOrder pass through for the same reason – these
                // were siblings in the parent list and their glue is set by
                // the parent's packing.
                sink.beginTransform(n, svgMatrixOf(n, x, baselineY));
                x=renderNodes(fontInfo,sink,n.children,x,baselineY,ratio,expandRatio,fillOrder,runH,runD);
                sink.endTransform();
                break;
            }
            case 'disc':  x=renderNodes(fontInfo,sink,n.replace,x,baselineY,0,expandRatio,0,runH,runD); break;
            case 'wdisc': x=renderNodes(fontInfo,sink,n.replace,x,baselineY,0,0,0,runH,runD); break;
            case 'widget':
                if(sink.widget) sink.widget(n, x, baselineY);
                x+=n.width*SP_TO_PX; break;
            case 'math':{
                const w=n.surround*SP_TO_PX;
                if(sink.gap) sink.gap(n,'surround',x,w);
                x+=w; break;
            }
            case 'hlist':{
                if(n.aside&&sink.aside) sink.aside(n,x,baselineY);
                const{ratio:hr,fillOrder:hfo}=hlistGlueRatio(n);
                renderNodes(fontInfo,sink,n.children,x,baselineY+(n.shift??0)*SP_TO_PX,hr,0,hfo,n.height,n.depth);
                x+=n.width*SP_TO_PX; break;
            }
            case 'vlist':
                // A vlist encountered here sits in an hlist context, where a box's
                // shift is vertical (downward); renderVlistBody stacks its contents.
                renderVlistBody(fontInfo,sink,n,x,baselineY+(n.shift??0)*SP_TO_PX);
                x+=n.width*SP_TO_PX; break;
        }
        // Inspection (api.inspect.replay): every node's pen position and advance.
        if(sink.node) sink.node(n, x0, baselineY, x-x0);
    }
    return x;
}

