// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    BREAK_NODES, breakKind, LEFT_PROTRUSION, RIGHT_PROTRUSION, charW, discardedMath, expandableSp, gW, isChar, isCharBox,
    nodeWidthSp, sumWidthSp,
} from './core.ts';
import { unreachable } from '../../../shared/unreachable.ts';
import type { Expansion, FontTable, GlueNode, Paragraph, TexNode, ViewerFont } from './model.ts';
import type { Line } from './layout/types.ts';
import type { Params } from '../runtime/params.ts';

/** The widths of a node list, or of one of a discretionary's three: natural
 *  (w), expandable (g), and TeX's font stretch and shrink (fs, fz), sp. */
export interface Widths { w: number; g: number; fs: number; fz: number }
/** A place a line may end (buildBreakCandidates). */
export interface BreakCandidate {
    kind: 'start' | 'end' | 'space' | 'disc' | 'penalty';
    nodeIdx: number;
    penalty: number;
    pre: Widths; post: Widths; replace: Widths;
    leadW: number; leadS: number; leadZ: number; leadFill: number;
    trailW: number; trailN: number;
    cumW: number; cumS: number; cumZ: number; cumGlyphW: number; cumFS: number; cumFZ: number; cumFill: number;
    rightProtrusion: number;
    leftProtrusion: number;
    /** The end: the last line's right protrusion, counted when it is packed. */
    packRightProtrusion?: number;
    /** A discretionary that was in the source (\\discretionary, \\-, a hyphen). */
    explicit?: boolean;
    /** A widget's split: its own two parts. */
    preNodes?: TexNode[];
    postNodes?: TexNode[];
}
/** A paragraph's candidates, and its expansion limits when it expands. */
export type BreakCandidates = BreakCandidate[] & { expansion?: Expansion | null; adjustSpacing?: number };
/** A line's measures between two candidates (lineMetrics). */
export interface LineMetrics { w: number; s: number; z: number; g: number; fs: number; fz: number }
/** One chosen break: its candidate, fitness class and total demerits. */
export interface Break { bcIdx: number; fc: number; demerits: number }
interface Active { demerits: number; prev_j: number; prev_l: number; prev_fc: number; hyphenated: boolean; overfull?: boolean }

/** The measure a paragraph's lines are broken to (sp): one for every line,
 *  or, for a shaped paragraph (\parshape, \hangindent), one per line from
 *  its first, the last for every line after. */
export type Measure = number | readonly number[];
/** The measure of line k (0-based) of the paragraph. */
export function lineWidthAt(measure: Measure, k: number): number {
    return typeof measure === 'number' ? measure : measure[Math.min(k, measure.length - 1)];
}

// ── Protrusion ────────────────────────────────────────────────────────────────

// What LuaTeX steps over looking for the character at a line's edge
// (cp_skipable, linebreak.h): penalties, a \vadjust, empty glue, a font kern
// or an empty one, a math node without surround, an empty discretionary, a
// rule of size zero, and a box of size zero with nothing in it (the empty
// nucleus of $^1$, a \label's anchor, an empty \hbox{}). LuaTeX also steps
// over whatsits, marks, inserts, boundaries and direction nodes, which reach
// the viewer as such empty boxes (pipeline: stripUnsupportedNodes). An
// italic correction or an explicit kern stops the search, so the character
// before it does not hang.
const zeroSize = (n: { width: number; height: number; depth: number }) => !n.width && !n.height && !n.depth;
export function protSkipable(n: TexNode): boolean {
    switch (n.type) {
        case 'penalty': case 'adjust': case 'local_par': return true;
        case 'glue':    return !n.width && !n.stretch && !n.shrink;
        case 'kern':    return !n.kern || (n.subtype || 0) === 0;
        case 'math':    return !n.surround;
        case 'disc':    return !(n.pre || []).length && !(n.post || []).length && !(n.replace || []).length;
        case 'rule':    return zeroSize(n);
        case 'hlist':   return !isCharBox(n) && !(n.children || []).length && zeroSize(n);
        case 'glyph': case 'vlist': case 'picture': case 'transform': case 'widget': case 'wdisc':
            return false;
        default:        return unreachable(n, 'node');
    }
}
// A box the search goes into: one with something in it. (A virtual font's
// character in its box is that character: core.ts, isCharBox.)
const searchedInto = (n: TexNode): n is TexNode & { children: TexNode[] } =>
    n.type === 'hlist' && !isCharBox(n) && !!(n.children || []).length;
// The character at the right edge of nodes[0..idx), as LuaTeX's
// find_protchar_right finds it: stepping back over what protSkipable allows,
// into a box to its last character, and over a box with nothing in it but
// such things (an anchor, an empty \hbox). A virtual font's character in its
// box is that character (core.ts, isCharBox).
export function findLastGlyph(nodes: TexNode[], idx: number): TexNode | null {
    for (let k=idx-1;k>=0;k--) {
        const n=nodes[k];
        if (protSkipable(n)) continue;
        if (isCharBox(n)) return n;
        if (n.type==='hlist') {
            const kids=n.children||[];
            if (kids.every(protSkipable)) continue;
            return findLastGlyph(kids, kids.length);
        }
        return n.type==='glyph'?n:null;
    }
    return null;
}
// The character at the left edge from nodes[idx], as LuaTeX's
// find_protchar_left finds it: over what protSkipable allows, into a box to
// its first character. A box that holds nothing but such things ends the
// search: LuaTeX steps out of it (and of every box it ends) to the node
// after, and takes that node as it is – a character protrudes, anything else
// does not. LuaTeX first steps over the empty boxes and the local_par a
// paragraph starts with, which protSkipable steps over too. Called from a
// break, it then skips the discardables there (its `d` pass, which also
// takes every kern); the viewer looks from where the break's discards end
// (lead), as post_line_break does.
export function findFirstGlyph(nodes: TexNode[], idx: number): TexNode | null {
    if (idx >= nodes.length) return null;
    const up: [TexNode[], number][] = [];
    let list = nodes, k = idx;
    for (;;) {
        const n = list[k];
        if (searchedInto(n)) { up.push([list, k]); list = n.children; k = 0; continue; }
        if (!protSkipable(n)) break;
        if (k + 1 < list.length) { k++; continue; }
        if (!up.length) break;
        while (k + 1 >= list.length && up.length) [list, k] = up.pop()!;
        if (k + 1 < list.length) k++;
        break;
    }
    const n = list[k];
    return isChar(n) ? n : null;
}

// TeX's round_xn_over_d: x·n/d rounded half away from zero, in integers.
export function roundXnOverD(x: number, n: number, d: number): number {
    const s = x < 0 ? -1 : 1;
    return s * Math.floor((Math.abs(x) * n + Math.floor(d / 2)) / d);
}

// How far a character hangs into the margin. A bundle that records the
// fonts' quads carries what TeX had: the character's \lpcode/\rpcode in
// thousandths of its font's quad (LuaTeX's char_pw), and only when the
// paragraph was set with \protrudechars on – so a document without microtype
// does not protrude at all, just as in its PDF. An older bundle without that
// information keeps the viewer's own table of hanging punctuation.
//
// A word of live text (a slot's node: host/slots.ts) is one glyph-like node
// carrying its text instead of a character. TeX would have set it as a run
// of characters of the same font, and protruded the first or the last of
// them: so its codes are those of its first character at a line's start and
// of its last at a line's end ("[Gaj+20," hangs by the comma's \rpcode).
export function edgeChar(g: TexNode, left: boolean): number | undefined {
    if (g.text === undefined) return g.char;
    // (a word joiner or U+FEFF at its edge has no width: past it)
    const cps = [...String(g.text).replace(/^[\u2060\uFEFF]+|[\u2060\uFEFF]+$/g, '')];
    const c = left ? cps[0] : cps[cps.length - 1];
    return c === undefined ? undefined : c.codePointAt(0);
}
export function protrusionOf(fontInfo: FontTable | null | undefined, para: Partial<Paragraph> | null | undefined,
                             g: TexNode | null, left: boolean): number {
    if (!g) return 0;
    const fi = fontInfo && fontInfo[String(g.font)];
    const ch = edgeChar(g, left);
    if (fi && fi.quad > 0) {
        if (!(para && (para.protrude_chars ?? 0) > 0)) return 0;
        const c = fi.codes && fi.codes.get(ch);
        const code = c ? (left ? c.lp : c.rp) || 0 : 0;
        return code ? roundXnOverD(fi.quad, code, 1000) : 0;
    }
    // (the fallback is a share of the character's own width, which a word
    // of live text does not record: it protrudes nothing there)
    if (g.text !== undefined) return 0;
    return ((left ? LEFT_PROTRUSION : RIGHT_PROTRUSION)[ch!] || 0) * gW(g);
}

// ── Font expansion in the breaker ────────────────────────────────────────────

// LuaTeX's char_stretch/char_shrink and kern_stretch/kern_shrink: how much a
// glyph, or a font kern between two glyphs, widens (shrink: narrows) at its
// font's full \expandglyphsinfont limit, in sp, with TeX's rounding.
export function efCodeOf(fi: ViewerFont | null | undefined, n: TexNode): number {
    const c = fi && fi.codes && fi.codes.get(n.char);
    return c && c.ef !== undefined ? c.ef : 1000;
}
export function expandLimit(fontInfo: FontTable | null | undefined, n: TexNode, shrink: boolean): number {
    const fi = fontInfo && fontInfo[String(n.font)];
    return fi && fi.expand ? (shrink ? fi.expand.shrink : fi.expand.stretch) || 0 : 0;
}
export function fontStretchSp(fontInfo: FontTable, ns: TexNode[], i: number, shrink: boolean): number {
    const n = ns[i];
    if (isChar(n)) {
        const m = expandLimit(fontInfo, n, shrink);
        if (!(m > 0) || n.text !== undefined) return 0;
        const ef = efCodeOf(fontInfo[String(n.font)], n);
        if (!(ef > 0)) return 0;
        const w = charW(n);
        const dw = shrink ? w - roundXnOverD(w, 1000 - m, 1000) : roundXnOverD(w, 1000 + m, 1000) - w;
        return dw > 0 ? roundXnOverD(dw, ef, 1000) : 0;
    }
    if (n.type === 'kern' && (n.subtype || 0) === 0 && n.kern) {
        const l = ns[i - 1], r = ns[i + 1];
        if (!l || !r || !isChar(l) || !isChar(r)) return 0;
        const m = Math.trunc((expandLimit(fontInfo, l, shrink) + expandLimit(fontInfo, r, shrink)) / 2);
        if (!m) return 0;
        const w = n.kern, d = roundXnOverD(w, shrink ? 1000 - m : 1000 + m, 1000);
        const e = Math.trunc((efCodeOf(fontInfo[String(l.font)], l) + efCodeOf(fontInfo[String(r.font)], r)) / 2);
        const x = shrink ? w - d : d - w;
        return e === 1000 ? x : roundXnOverD(x, e, 1000);
    }
    return 0;
}

// \expandglyphsinfont's limits and step for a paragraph (LuaTeX insists they
// are the same for every font in it), or null when nothing in it expands.
export function paragraphExpansion(fontInfo: FontTable, nodes: TexNode[]): Expansion | null {
    const walk = (ns: TexNode[] | undefined): Expansion | null => {
        for (const n of ns || []) {
            if (isChar(n)) {
                const fi = fontInfo && fontInfo[String(n.font)];
                if (fi && fi.expand && fi.expand.step > 0) return fi.expand;
            } else if (n.type === 'disc') {
                const e = walk(n.pre) || walk(n.post) || walk(n.replace);
                if (e) return e;
            }
        }
        return null;
    };
    return walk(nodes);
}

// ── Knuth-Plass: break candidates ────────────────────────────────────────────

// What a break discards at the start of the next line (TeX's break_width,
// §837, and post_line_break's pruning, §879): glue, penalties, \kern and \/
// kerns, and math nodes with their \mathsurround – so a formula at a line's
// start loses its surround and any glue it opens with (a \,). A character,
// a box, a font's or an accent's kern is kept, and ends it.
const EXPLICIT_KERN = 1, ITALIC_KERN = 3;
export function discardable(n: TexNode): boolean {
    switch (n.type) {
        case 'glue': case 'penalty': case 'math': return true;
        case 'kern': return n.subtype === EXPLICIT_KERN || n.subtype === ITALIC_KERN;
        default:     return false;
    }
}

// Nodes after which glue is a legal breakpoint (TeX's precedes_break, which
// a \vadjust is in, plus the viewer's own drawn-box kinds).
export const PRECEDES_BREAK = new Set<string>(['glyph', 'hlist', 'vlist', 'rule', 'disc', 'wdisc', 'picture', 'widget', 'transform', 'adjust']);

// Every candidate carries the running totals up to its node: natural width
// (cumW), finite stretch and shrink (cumS, cumZ), infinite fills (cumFill:
// how many glues of infinite stretch order),
// *expandable* width (cumGlyphW, per unit of expansion as the renderer
// applies it – see expandableSp) and TeX's font stretch and shrink at the
// full expansion limit (cumFS, cumFZ); a discretionary has the same four
// widths for each of its three lists. `lead*` is what a break there discards
// at the start of the next line, `trail*` what it drops from the end of this
// one (TeX breaks *at* an explicit kern or a math node before glue, so they
// leave with the glue).
export function buildBreakCandidates(nodes: TexNode[], fontInfo: FontTable, para?: Partial<Paragraph> | null): BreakCandidates {
    para = para || {};
    const adjust = para.adjust_spacing || 0;
    const fsOf = (ns: TexNode[], i: number, shrink: boolean) => adjust > 0 ? fontStretchSp(fontInfo, ns, i, shrink) : 0;
    const part = (ns: TexNode[] | undefined): Widths => {
        const r = { w: 0, g: 0, fs: 0, fz: 0 };
        for (let i = 0; i < (ns || []).length; i++) {
            r.w += nodeWidthSp(ns![i]); r.g += expandableSp(fontInfo, ns!, i);
            r.fs += fsOf(ns!, i, false); r.fz += fsOf(ns!, i, true);
        }
        return r;
    };
    const prot = (g: TexNode | null, left: boolean) => protrusionOf(fontInfo, para, g, left);
    const NONE: Widths = { w: 0, g: 0, fs: 0, fz: 0 };
    let cumW=0, cumS=0, cumZ=0, cumGlyphW=0, cumFS=0, cumFZ=0, cumFill=0;
    const cand = (kind: BreakCandidate['kind'], i: number, penalty: number, extra?: Partial<BreakCandidate>): BreakCandidate => ({
        kind, nodeIdx: i, penalty, pre: NONE, post: NONE, replace: NONE,
        leadW: 0, leadS: 0, leadZ: 0, leadFill: 0, trailW: 0, trailN: 0,
        cumW, cumS, cumZ, cumGlyphW, cumFS, cumFZ, cumFill,
        rightProtrusion: 0, leftProtrusion: 0, ...extra,
    });
    // What a break at node i discards after itself (discardable), up to the
    // next thing that is kept – an infinite fill among them too, so the next
    // line does not count it as its own. A break that discards everything up
    // to the paragraph's end discards its \parfillskip too: the line after it
    // is empty, and has no fill (§837).
    const lead = (from: number) => {
        let W = 0, S = 0, Z = 0, F = 0, k = from;
        for (; k < nodes.length; k++) {
            const m = nodes[k];
            if (!discardable(m)) break;
            W += nodeWidthSp(m);
            if (m.type === 'glue') {
                S += !m.stretch_order ? m.stretch : 0; Z += !m.shrink_order ? m.shrink : 0;
                if (m.stretch_order) F++;
            }
        }
        return { leadW: W, leadS: S, leadZ: Z, leadFill: F, leftProtrusion: prot(findFirstGlyph(nodes, k), true) };
    };
    const bcs: BreakCandidates = [cand('start', -1, 0, { leftProtrusion: prot(findFirstGlyph(nodes, 0), true) })];
    bcs.expansion = adjust > 0 ? paragraphExpansion(fontInfo, nodes) : null;
    bcs.adjustSpacing = bcs.expansion ? adjust : 0;
    let inMath = false;

    for (let i=0; i<nodes.length; i++) {
        const n = nodes[i];
        if (n.type==='local_par') continue;

        // \parfillskip (LuaTeX subtype 15) terminates the paragraph, whatever its
        // stretch. The usual value is "0pt plus 1fil" (a ragged last line), but
        // \centering / \raggedleft set it rigid ("0pt") – and keying the end on
        // stretch>0, as before, gave a centred paragraph (a title, \begin{center})
        // no end candidate at all: kpPass then returned nothing and the greedy
        // fallback emitted no final line, so the whole paragraph vanished whenever
        // it happened to fit on one line. Key on the subtype instead. The last
        // line holds it as any glue: its width, stretch and shrink count (a
        // table of contents' entry sets it to -\rightskip, so that its last
        // line reaches into the margin skip), and its stretch fills the line –
        // or, rigid, leaves the slack to the margin skips. The last line's
        // right protrusion counts only when the line is packed: the breaker
        // (ext_try_break) has no character to look from at the end.
        if (n.type==='glue' && n.subtype===15) {
            cumW+=n.width; cumS+=!n.stretch_order?n.stretch:0; cumZ+=!n.shrink_order?n.shrink:0;
            if (n.stretch_order) cumFill+=1;
            // (the breaker leaves it out, but the line is packed with it)
            bcs.push(cand('end', i, -10000, { packRightProtrusion: prot(findLastGlyph(nodes, i), false) }));
            break;
        }
        if (n.type==='glue') {
            // Glue is a legal breakpoint outside maths when what precedes it is
            // kept at a break (a character, a box, a discretionary) or is a font
            // kern – so never after a penalty: ~ is \nobreak\ , and the \hfil of
            // \\ follows its \nobreak. After an explicit kern (an italic
            // correction, \,) or a math node TeX breaks at that node instead,
            // which drops it from the end of the line. Its stretch does not
            // matter (§866): LaTeX's \and between authors is \hskip 1em plus
            // .17fil, and a row of them too wide for the line breaks there. An
            // infinite fill marks the line that keeps it as filled (cumFill):
            // its slack goes to the fill, as on a last line.
            const prev = nodes[i-1];
            let ok = false, trailN = 0;
            if (!inMath && prev) {
                if (PRECEDES_BREAK.has(prev.type)) ok = true;
                else if (prev.type==='kern' && ((prev.subtype||0)===0 || prev.subtype===2)) ok = true;
                else if ((prev.type==='kern' && (prev.subtype===1 || prev.subtype===3)) || prev.type==='math') { ok = true; trailN = 1; }
            }
            if (ok) {
                const trailW = trailN ? nodeWidthSp(prev) : 0;
                bcs.push(cand('space', i, 0, { trailW, trailN,
                    rightProtrusion: prot(findLastGlyph(nodes, i - trailN), false), ...lead(i) }));
            }
            cumW+=n.width; cumS+=!n.stretch_order?n.stretch:0; cumZ+=!n.shrink_order?n.shrink:0;
            if (n.stretch_order) cumFill+=1;
        } else if (n.type==='disc') {
            const pre=part(n.pre), post=part(n.post), replace=part(n.replace);
            const preGs=(n.pre||[]).filter(isChar), postGs=(n.post||[]).filter(isChar);
            // LuaTeX subtypes 0–2 (\discretionary, \-, an explicit hyphen) were in
            // the source; 3 and up are its own hyphenation. A break with no
            // post-break text discards what follows, as a break at glue does.
            bcs.push(cand('disc', i, n.penalty??50, { pre, post, replace, explicit: (n.subtype||0) <= 2,
                rightProtrusion: prot(preGs.length>0?preGs[preGs.length-1]:findLastGlyph(nodes,i), false),
                ...((n.post||[]).length ? { leftProtrusion: prot(postGs.length>0?postGs[0]:findFirstGlyph(nodes,i+1), true) } : lead(i+1)) }));
            cumW+=replace.w; cumGlyphW+=replace.g; cumFS+=replace.fs; cumFZ+=replace.fz;
        } else if (n.type==='wdisc') {
            // A widget that may be split (see Widgets): one candidate per split,
            // each carrying its own two parts – a discretionary with several
            // pre/post pairs over the one unbroken replacement.
            const replace={ ...NONE, w: sumWidthSp(n.replace) };
            for (const o of n.options) {
                bcs.push(cand('disc', i, o.penalty, { preNodes: o.pre, postNodes: o.post,
                    pre: { ...NONE, w: sumWidthSp(o.pre) }, post: { ...NONE, w: sumWidthSp(o.post) }, replace }));
            }
            cumW+=replace.w;
        } else if (n.type==='penalty' && n.penalty<10000) {
            bcs.push(cand('penalty', i, n.penalty, { rightProtrusion: prot(findLastGlyph(nodes,i), false), ...lead(i+1) }));
        } else {
            if (n.type==='math') inMath = (n.subtype||0) === 0;
            cumW+=nodeWidthSp(n);
            cumGlyphW+=expandableSp(fontInfo,nodes,i);
            cumFS+=fsOf(nodes,i,false); cumFZ+=fsOf(nodes,i,true);
        }
    }
    return bcs;
}

// A paragraph's margin skips, \leftskip and \rightskip, are in every line
// (TeX's background, §827): their fixed parts are out of the measure
// already, their finite stretch and their shrink (which TeX makes finite,
// §826) count in every line's, and an infinite stretch in either makes
// every line filled.
const finiteStretch = (g: GlueNode | undefined) => g && !(g.stretch_order || 0) ? g.stretch || 0 : 0;
export const marginStretch = (p: Params): number => finiteStretch(p.leftSkip) + finiteStretch(p.rightSkip);
export const marginShrink = (p: Params): number => (p.leftSkip?.shrink || 0) + (p.rightSkip?.shrink || 0);
const fills = (g: GlueNode | undefined) => !!g && (g.stretch_order || 0) > 0 && !!g.stretch;
export const marginFilled = (p: Params): boolean => fills(p.leftSkip) || fills(p.rightSkip);

// A line from candidate a to candidate b, as TeX measures it: natural width
// (w, less the protrusion at both ends), finite glue stretch and shrink
// (s, z, the margin skips' with them), font stretch and shrink (fs, fz) and
// the expandable width the renderer's expansion factor acts on (g).
export function lineMetrics(a: BreakCandidate, b: BreakCandidate, p: Params): LineMetrics {
    const protrude = p.useProtrusion ? a.leftProtrusion + b.rightProtrusion : 0;
    // Where the line starts (after the break at a, less what that break
    // discards) and ends (at b, with a discretionary's pre-break text).
    const from = (key: 'cumW' | 'cumGlyphW' | 'cumFS' | 'cumFZ', lead: keyof Widths) => a[key] + (a.kind==='disc' ? a.replace[lead] - a.post[lead] : 0);
    const upto = (key: 'cumW' | 'cumGlyphW' | 'cumFS' | 'cumFZ', part: keyof Widths) => b[key] + (b.kind==='disc' ? b.pre[part] : 0);
    const on = p.useExpansion !== false;
    return {
        w:  upto('cumW', 'w') - b.trailW - from('cumW', 'w') - a.leadW - protrude,
        s:  b.cumS - a.cumS - a.leadS + marginStretch(p),
        z:  b.cumZ - a.cumZ - a.leadZ + marginShrink(p),
        g:  on ? upto('cumGlyphW', 'g') - from('cumGlyphW', 'g') : 0,
        fs: on ? upto('cumFS', 'fs') - from('cumFS', 'fs') : 0,
        fz: on ? upto('cumFZ', 'fz') - from('cumFZ', 'fz') : 0,
    };
}

// The viewer's last resort (data-emergency-tolerance, 10000) admits every
// line, and badness is capped at 10000, so every line past the cap would cost
// the same flat 1e8 demerits: the breaker could then put the one unavoidable
// bad line anywhere – and does put it first, as a single-word line, since that
// lets every later line be perfect. In that pass lines are therefore weighed
// by their real, uncapped looseness, so a slightly loose line always beats a
// nearly empty one. TeX's own passes are not: a paragraph with \tolerance
// 10000 is broken as TeX breaks it.
export function rawBadness(shortage: number, total: number): number {
    if (shortage === 0) return 0;
    if (total <= 0) return 1e7;
    const r = shortage / total;
    return Math.min(1e7, 100 * r * r * r);
}

// TeX's badness, in its own integer arithmetic (§108): about 100·(t/s)³, but
// the rounding decides where a line crosses the 12 and 99 of the fitness
// classes and the tolerances, so it has to be TeX's.
export function badness(t: number, s: number): number {
    t = Math.round(t); s = Math.round(s);
    if (t <= 0) return 0;
    if (s <= 0) return 10000;
    let r;
    if (t <= 7230584) r = Math.floor(t * 297 / s);
    else if (s >= 1663497) r = Math.floor(t / Math.floor(s / 297));
    else r = t;
    return r > 1290 ? 10000 : Math.floor((r * r * r + 0x20000) / 0x40000);
}

// LuaTeX lets font expansion take up a line's shortfall before its glue does
// (ext_try_break): a line its glyphs can absorb entirely is scored as if half
// an expansion step were left over, and otherwise only what they cannot absorb
// is weighed against the glue. LuaTeX's shrinking branch comes out with the
// sign flipped – a line its glyphs can narrow enough counts as a hair short –
// and so does this one.
export function expansionShortfall(shortfall: number, m: LineMetrics, ex: Expansion | null | undefined): number {
    if (!ex || shortfall === 0) return shortfall;
    if (shortfall > 0 && m.fs > 0)
        return m.fs > shortfall ? Math.trunc(Math.trunc(m.fs / Math.max(1, Math.trunc(ex.stretch / ex.step))) / 2)
                                : shortfall - m.fs;
    if (shortfall < 0 && m.fz > 0)
        return m.fz > -shortfall ? Math.trunc(Math.trunc(m.fz / Math.max(1, Math.trunc(ex.shrink / ex.step))) / 2)
                                 : shortfall + m.fz;
    return shortfall;
}

// A line carrying an infinite-order fill (\hfil from \\, \hfill, the
// \parfillskip of the last line) absorbs positive slack instead of justifying:
// badness 0. So does every line of a paragraph whose margin skips stretch
// infinitely: \raggedright, \centering and \raggedleft set \rightskip or
// \leftskip to 0pt plus 1fil, so any line that fits costs nothing and TeX
// takes the fewest lines, hyphenating only when it must. An empty last line
// after a break that discarded the \parfillskip has no fill (§837).
export function lineFilled(a: BreakCandidate, b: BreakCandidate, p: Params): boolean {
    return marginFilled(p) || b.cumFill > a.cumFill + a.leadFill;
}

// ── KP DP (one pass) ─────────────────────────────────────────────────────────

/** How a pass is run: TeX's first pass (no hyphenation of its own), its
 *  final one, the stretch \emergencystretch adds to every line, and the
 *  viewer's own last resort (`uncapped`). */
export interface PassOptions { firstPass?: boolean; final?: boolean; background?: number; uncapped?: boolean }

// A start from which a line has become overfull is dropped for good, in every
// pass (§851): a later line from it, made narrower by negative glue, is never
// tried. With `final` the pass is TeX's last one (§854): when the only start
// left dies with nothing feasible found yet – its line overfull, or too loose
// at a forced break or the end – that line is taken anyway at no cost
// (artificial demerits), so the pass always ends with a paragraph – as a PDF
// shows it, a line sticking out rather than a very loose one.
// `background` is stretch every line has besides its glue: TeX's third pass
// adds \emergencystretch so (§863), for the badness only – a line is still
// set with its own glue.
//
// A shaped paragraph's lines differ in measure, so a start is told apart by
// the number of the line it begins as well (TeX's line_number), up to the
// shape's last line: every line after that has the same measure, and those
// starts are one (§835, easy_line). Lines from the starts of one number, and
// from the last two, make one set of breaks at each place (§835, §845):
// TeX keeps the best of them per fitness class, and their order – by line
// number, then place (newest first before the last number), then class –
// decides a tie, the later winning.
export function kpPass(bcs: BreakCandidates, measure: Measure, threshold: number, p: Params, o: PassOptions = {}):
        { breaks: Break[] | null; minRejectedBadness: number | null; overfull?: boolean } {
    const { firstPass = false, final = false, background = 0, uncapped = false } = o;
    // (TeX's threshold is at most inf_bad: every line is feasible at 10000)
    threshold = Math.min(threshold, 10000);
    const N=bcs.length;
    // starts by line number: 0 .. L, the last for every line from the
    // shape's last on
    const L = typeof measure === 'number' ? 0 : measure.length - 1;
    const dp=Array.from({length:N},()=>Array.from({length:L+1},(): (Active | null)[]=>[null,null,null,null]));
    const alive=dp.map(ls=>ls.map(()=>[true,true,true,true]));
    dp[0][0][2]={demerits:0,prev_j:-1,prev_l:-1,prev_fc:-1,hyphenated:false};
    let minRejectedBadness: number | null=null;
    // Font expansion enters the breaker only under \adjustspacing=2.
    const ex = (bcs.adjustSpacing ?? 0) > 1 ? bcs.expansion : null;

    // A forced break (penalty <= -10000, e.g. from \\) is mandatory: no line may
    // span across it. lastForced[j] is the candidate index of the nearest forced
    // break before j, so a line from i to j is legal only when i >= lastForced[j].
    const lastForced=new Array(N).fill(-1);
    for (let k=1,lf=-1;k<N;k++){ lastForced[k]=lf; if(bcs[k].kind==='penalty'&&bcs[k].penalty<=-10000) lf=k; }

    for (let j=1;j<N;j++) {
        const bcJ=bcs[j];
        // TeX's first pass (\pretolerance) tries no hyphenation, but LuaTeX
        // has hyphenated already and still offers the discretionaries that
        // were in the source: explicit hyphens and \-.
        if (firstPass&&bcJ.kind==='disc'&&!bcJ.explicit) continue;
        if (bcJ.penalty>=10000) continue;
        const isEnd = bcJ.kind==='end';
        let feasibleAtJ = false;
        // Is (i, l, fc) the only start still in play for a line ending at j?
        const onlyStart = (i: number, l: number, fc: number) => {
            for (let k=Math.max(0,lastForced[j]);k<j;k++) for (let g=0;g<=L;g++) for (let f=0;f<4;f++)
                if (dp[k][g][f] && alive[k][g][f] && !(k===i && g===l && f===fc)) return false;
            return true;
        };
        const metrics: (LineMetrics | null)[] = [];
        for (let l=0;l<=L;l++) {
            // the line from a start of number l, and the breaks it makes here
            // (TeX puts the starts of one number before the shape's last in
            // its list newest first, and the rest oldest first)
            const lineWidthSp = lineWidthAt(measure, l), dpJ = dp[j][Math.min(l+1, L)];
            for (let n=0;n<j;n++) {
                const i = l < L ? j-1-n : n;
                if (i<lastForced[j]) continue;   // line would span a forced break
                // Two candidates at one node (a widget's alternative splits) are
                // one place: a line may not start and end there.
                if (bcs[i].nodeIdx===bcJ.nodeIdx) continue;
                let m: LineMetrics | null=metrics[i] ?? null;
                for (let fc_i=0;fc_i<4;fc_i++) {
                    const si=dp[i][l][fc_i]; if(!si) continue;
                    if (!alive[i][l][fc_i]) continue;
                    if (!m) m=metrics[i]=lineMetrics(bcs[i],bcJ,p);
                    const hasFill = lineFilled(bcs[i], bcJ, p);
                    const shortfall = expansionShortfall(lineWidthSp-m.w, m, ex);
                    let b: number, fc_j: number;
                    if (shortfall>0) {
                        if (hasFill) { b=0; fc_j=2; }
                        else { b=badness(shortfall,m.s+background); fc_j=b>99?0:b>12?1:2; }
                    } else if (shortfall<0) {
                        if (-shortfall>m.z) {                         // overfull
                            alive[i][l][fc_i] = false;
                            if (final && !feasibleAtJ && onlyStart(i, l, fc_i) && (!dpJ[3] || si.demerits<=dpJ[3]!.demerits))
                                dpJ[3]={demerits:si.demerits,prev_j:i,prev_l:l,prev_fc:fc_i,hyphenated:bcJ.kind==='disc',overfull:true};
                            continue;
                        }
                        b=badness(-shortfall,m.z); fc_j=b>12?3:2;
                    } else { b=0; fc_j=2; }
                    if (b!>threshold) {
                        if(minRejectedBadness===null||b<minRejectedBadness) minRejectedBadness=b;
                        // At a forced break or the end (TeX's eject penalty) the start
                        // is dropped too, and the final pass takes the line anyway
                        // when that start is the only one left (§851, §854): the
                        // empty last line after \\ at a paragraph's end.
                        if (bcJ.penalty<=-10000) {
                            alive[i][l][fc_i] = false;
                            if (final && !feasibleAtJ && onlyStart(i, l, fc_i) && (!dpJ[fc_j] || si.demerits<=dpJ[fc_j]!.demerits))
                                dpJ[fc_j]={demerits:si.demerits,prev_j:i,prev_l:l,prev_fc:fc_i,hyphenated:bcJ.kind==='disc'};
                        }
                        continue;
                    }
                    feasibleAtJ = true;
                    const bd = uncapped&&!(hasFill&&shortfall>=0) ? rawBadness(Math.abs(shortfall),shortfall>=0?m.s+background:m.z) : b;
                    const lp=p.linePenalty+bd; let d=uncapped ? lp*lp : (Math.abs(lp)>=10000?100000000:lp*lp);
                    if(bcJ.penalty>0) d+=bcJ.penalty*bcJ.penalty;
                    else if(bcJ.penalty>-10000) d-=bcJ.penalty*bcJ.penalty;
                    if(si.hyphenated) {
                        if(bcJ.kind==='disc') d+=p.doubleHyphenDemerits;
                        else if(isEnd) d+=p.finalHyphenDemerits;
                    }
                    if(Math.abs(fc_j-fc_i)>1) d+=p.adjDemerits;
                    // Not TeX, and off unless a page asks for it: a last line
                    // shorter than lastLineMin of the measure costs lastLinePenalty.
                    if(isEnd && p.lastLineMin>0 && m.w<p.lastLineMin*lineWidthSp) d+=p.lastLinePenalty;
                    const td=si.demerits+d;
                    // Ties go to the later start, as in TeX (`d <= minimal_demerits`,
                    // scanning the active list in order): the earlier lines longer.
                    if(!dpJ[fc_j]||td<=dpJ[fc_j]!.demerits) dpJ[fc_j]={demerits:td,prev_j:i,prev_l:l,prev_fc:fc_i,hyphenated:bcJ.kind==='disc'};
                }
            }
        }
        // TeX keeps a break only in the fitness classes within \adjdemerits of
        // its best (§836). No other could win, but in the final pass one
        // that is kept is one more start in play, and decides whether an
        // overfull line is taken from the other.
        for (const dpJ of dp[j]) {
            let best=Infinity;
            for(let fc=0;fc<4;fc++) if(dpJ[fc]&&dpJ[fc]!.demerits<best) best=dpJ[fc]!.demerits;
            for(let fc=0;fc<4;fc++) if(dpJ[fc]&&dpJ[fc]!.demerits>best+Math.abs(p.adjDemerits)) dpJ[fc]=null;
        }
    }
    const endIdx=N-1; if(bcs[endIdx].kind!=='end') return {breaks:null,minRejectedBadness};
    // (TeX's best of all: the first of the lowest, in the active list's order)
    let bestL=-1, bestFc=-1, bestD=Infinity;
    for(let l=0;l<=L;l++) for(let fc=0;fc<4;fc++) { const a=dp[endIdx][l][fc]; if(a&&a.demerits<bestD){bestD=a.demerits;bestL=l;bestFc=fc;} }
    if(bestFc===-1) return {breaks:null,minRejectedBadness};
    const breaks: Break[]=[]; let j=endIdx,l=bestL,fc=bestFc,overfull=false;
    while(j>0){const a=dp[j][l][fc]!;breaks.push({bcIdx:j,fc,demerits:a.demerits});if(a.overfull)overfull=true;j=a.prev_j;l=a.prev_l;fc=a.prev_fc;}
    // overfull: the final pass set a line it could not shrink to fit
    breaks.reverse(); return {breaks,minRejectedBadness,overfull};
}

// Set one line as TeX's hpack does with \adjustspacing: font expansion takes
// the slack first, as a whole number of steps up to the font's limit (LuaTeX's
// font_expand_ratio and fix_expand_value), and the glue takes the rest. A
// filled line (fil glue, a last line with room) neither expands nor stretches.
// Returns the glue ratio and the line's expansion (a fraction; the renderer
// widens each glyph by it, times the glyph's \efcode).
export function packLine(bcs: BreakCandidates, a: BreakCandidate, b: BreakCandidate, lineWidthSp: number, p: Params, hasFill: boolean):
        { ratio: number; expand: number } {
    const m = lineMetrics(a, b, p);
    const x = lineWidthSp - m.w + (p.useProtrusion ? b.packRightProtrusion || 0 : 0);
    if (x === 0 || (hasFill && x > 0)) return { ratio: 0, expand: 0 };
    let expand = 0, rest = x;
    const ex = bcs.expansion;
    const f = x > 0 ? m.fs : m.fz;
    if (ex && f > 0 && m.g > 0) {
        const limit = x > 0 ? ex.stretch : ex.shrink;
        const r = Math.max(-1000, Math.min(1000, Math.round(x * 1000 / f)));   // font_expand_ratio
        let e = Math.abs(Math.round(r * limit / 1000));
        if (e > limit) e = limit;
        else if (ex.step > 1 && e % ex.step) e = ex.step * roundXnOverD(e, 1, ex.step);
        expand = (x > 0 ? e : -e) / 1000;
        rest = x - expand * m.g;
    }
    // What the expansion leaves goes to the glue. On a filled line (one
    // shrunk by its fonts, whose steps overshoot) a surplus goes to the fill,
    // as hpack's second pass gives it, and the spaces keep their width. An
    // overfull line shrinks its glue fully and no further (glue_set 1).
    const ratio = rest > 0 ? (hasFill || !(m.s > 0) ? 0 : rest / m.s)
                : rest < 0 ? (m.z > 0 ? Math.max(-1, rest / m.z) : 0) : 0;
    return { ratio, expand };
}

export function extractLineNodes(startBC: BreakCandidate, endBC: BreakCandidate, nodes: TexNode[]): TexNode[] {
    const result: TexNode[]=[]; let from: number;
    if(startBC.kind==='start'){from=0;}
    else{if(startBC.kind==='disc') for(const pn of (startBC.postNodes||nodes[startBC.nodeIdx].post!)) result.push(pn); from=startBC.nodeIdx+1;}
    // (the last line holds the \parfillskip, as TeX's does)
    const to=endBC.kind==='end'?endBC.nodeIdx+1:endBC.nodeIdx-(endBC.trailN||0);
    // What a break discards (discardable) goes, but only at a *break*: at the
    // very start of a paragraph it is real content. \subparagraph* and
    // friends make this visible – \@xsect drops the usual \parindent box and
    // re-inserts the indent as \hskip\parindent glue, which stripping here
    // would delete from the render while the break candidates still counted
    // its width, leaving the first line short by exactly the indent. A math
    // node goes with its surround, but the line keeps the mark of where its
    // formula begins (discardedMath).
    if(startBC.kind!=='start'&&result.length===0){
        for(;from<to&&discardable(nodes[from]);from++){
            const n=nodes[from];
            if(n.type==='math') result.push(n.surround?discardedMath(n):n);
        }
    }
    for(let i=from;i<to;i++) if(nodes[i].type!=='local_par') result.push(nodes[i]);
    if(endBC.kind==='disc') { const kind = breakKind(nodes[endBC.nodeIdx]);
        for(const pn of (endBC.preNodes||nodes[endBC.nodeIdx].pre!)) { BREAK_NODES.set(pn, kind); result.push(pn); } }
    return result;
}

export function greedyFallback(bcs: BreakCandidates, nodes: TexNode[], measure: Measure, p: Params): Break[] {
    const breaks: Break[]=[]; let s=0;
    for(let j=1;j<bcs.length;j++){
        const {w}=lineMetrics(bcs[s],bcs[j],p);
        if(bcs[j].kind==='end'){breaks.push({bcIdx:j,fc:2,demerits:0});break;}
        if(w>lineWidthAt(measure, breaks.length)&&j>s+1){breaks.push({bcIdx:j-1,fc:2,demerits:0});s=j-1;}
    }
    return breaks;
}

// TeX's passes (§863, §873): the first at \pretolerance without its own
// hyphenation (none when it is negative), the second at \tolerance, and when
// \emergencystretch is positive a third, at \tolerance again with that much
// more stretch on every line. The last of them is TeX's final pass, which
// sets an overfull line when nothing fits.
export function kpBreakpoints(bcs: BreakCandidates, nodes: TexNode[], measure: Measure, p: Params): Break[] {
    let breaks: Break[] | null=null;
    if (p.pretolerance >= 0)
        breaks = kpPass(bcs,measure,p.pretolerance,p,{ firstPass: true }).breaks;
    // At the width TeX compiled for, its final pass is TeX's own result, but
    // at a narrower one a reader sees words run past the right edge. So the
    // viewer keeps the final pass's breaks unless they hold an overfull line,
    // and then tries its gentler passes – looser tolerances, which leave a
    // loose line instead – falling back on TeX's breaks only if those find
    // nothing either (a word wider than the measure).
    // data-tex-final-pass="strict" keeps TeX's breaks always, as a replay
    // against TeX needs; "false" skips the final pass altogether.
    let texBreaks: Break[] | null=null;
    const backgrounds = p.emergencyStretch > 0 ? [0, p.emergencyStretch] : [0];
    for (let k=0; !breaks && k<backgrounds.length; k++) {
        const final = !!p.texFinalPass && k === backgrounds.length-1;
        const r = kpPass(bcs,measure,p.tolerance,p,{ final, background: backgrounds[k] });
        if (!r.overfull || p.texFinalPass === 'strict') breaks = r.breaks;
        else texBreaks = r.breaks;
    }
    if(!breaks) breaks = kpPass(bcs,measure,p.tolerance2,p).breaks;
    if(!breaks) breaks = kpPass(bcs,measure,p.emergencyTolerance,p,{ uncapped: true }).breaks;
    if(!breaks) breaks = texBreaks;
    if(!breaks) breaks = greedyFallback(bcs,nodes,measure,p);
    return breaks;
}

/** The lines of a paragraph broken at `breaks`, each with its glue set. */
export function setLines(bcs: BreakCandidates, breaks: Break[], nodes: TexNode[], measure: Measure, p: Params): Line[] {
    const lines: Line[]=[];
    for(let k=0;k<breaks.length;k++){
        const startBC=k===0?bcs[0]:bcs[breaks[k-1].bcIdx], endBC=bcs[breaks[k].bcIdx];
        const hasFill = lineFilled(startBC, endBC, p);
        const { ratio, expand } = packLine(bcs, startBC, endBC, lineWidthAt(measure, k), p, hasFill);
        const rightProtrusion = (endBC.kind==='end' ? endBC.packRightProtrusion : endBC.rightProtrusion) || 0;
        lines.push({nodes:extractLineNodes(startBC,endBC,nodes),ratio,expand,fitness:breaks[k].fc,leftProtrusion:startBC.leftProtrusion,rightProtrusion});
    }
    return lines;
}

export function kpBreak(bcs: BreakCandidates, nodes: TexNode[], measure: Measure, p: Params): Line[] {
    return setLines(bcs, kpBreakpoints(bcs, nodes, measure, p), nodes, measure, p);
}

// LaTeX's \@flushglue, 0pt plus 1fil: \raggedright's \rightskip,
// \raggedleft's \leftskip, \centering's both.
const FLUSH_GLUE: GlueNode = { type: 'glue', width: 0, stretch: 65536, stretch_order: 2, shrink: 0 };

/** A paragraph's margin skips, less their fixed parts: TeX's, where the
 *  serializer recorded them (it records those that stretch or shrink); for
 *  a paragraph without any, those LaTeX's command for the block's alignment
 *  (data-align) sets. */
export function marginSkips(para: Partial<Paragraph>, align: string): { left?: GlueNode; right?: GlueNode } {
    if (para.left_skip || para.right_skip) return { left: para.left_skip, right: para.right_skip };
    return { left: align === 'center' || align === 'right' ? FLUSH_GLUE : undefined,
             right: align === 'center' || align === 'left' ? FLUSH_GLUE : undefined };
}

/** Whether a paragraph TeX justified is set as the block's alignment asks
 *  with its \parfillskip made rigid, as \centering and \raggedleft make it,
 *  so that its last line is centred or flush right too. */
export function blockRigidParFill(para: Partial<Paragraph>, align: string): boolean {
    return !para.left_skip && !para.right_skip && (align === 'center' || align === 'right');
}

/** The alignment a paragraph's margin skips make, named as data-align names
 *  it: centred, flush left or right where they stretch infinitely, else
 *  justified (a breaker of the page's own is told it). */
export function alignOf(p: Params): string {
    const l = fills(p.leftSkip), r = fills(p.rightSkip);
    return l && r ? 'center' : r ? 'left' : l ? 'right' : 'justify';
}

// A paragraph's own breaking parameters: TeX's where the serializer recorded
// them (it records those that differ from the defaults), the block's
// otherwise; and its margin skips (marginSkips).
const PARAGRAPH_PARAMS = [
    ['pretolerance', 'pretolerance'], ['tolerance', 'tolerance'], ['emergency_stretch', 'emergencyStretch'],
    ['line_penalty', 'linePenalty'], ['adj_demerits', 'adjDemerits'],
    ['double_hyphen_demerits', 'doubleHyphenDemerits'], ['final_hyphen_demerits', 'finalHyphenDemerits'],
] as const;
export function paragraphParams(p: Params, para: Partial<Paragraph>): Params {
    let own: Params | null = null;
    for (const [field, key] of PARAGRAPH_PARAMS) {
        const v = para[field];
        if (v !== undefined && v !== null) (own ??= { ...p })[key] = v;
    }
    const { left, right } = marginSkips(para, p.align);
    if (left || right || p.leftSkip || p.rightSkip) { own ??= { ...p }; own.leftSkip = left; own.rightSkip = right; }
    return own ?? p;
}
