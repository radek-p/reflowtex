// SPDX-License-Identifier: AGPL-3.0-or-later
// The accessible layer's text, read off the drawn lines (a11y.ts): a
// paragraph's lines as runs of words and formulas, each where it is drawn,
// and a display's ink. Reads the layout only; writes nothing.

import { BREAK_NODES, SP_TO_PX, useGlyphMetrics } from '../engine/core.ts';
import { renderNodes } from '../engine/render.ts';
import { glyphText } from '../../../shared/glyph-text.ts';
import type { BlockData } from './block-data.ts';
import type { TexNode } from '../engine/model.ts';
import type { InkItem, SegmentLayout } from '../engine/layout/types.ts';

interface RunPlace {
    /** Its stretch of the line, and its top and bottom (svg units). */
    x0: number; x1: number; y0: number; y1: number;
    /** A space before it, in the source. */
    sp: boolean;
    /** Its line, and that line's top and bottom. */
    line: number; ly0: number; ly1: number;
}
/** A run of words on a drawn line. */
export interface TextRun extends RunPlace {
    text: string;
    mathml?: undefined;
    /** It starts with the space owed after a formula. */
    lead: boolean;
    /** Its last word goes on on the next line. */
    hyphen?: boolean;
}
/** A formula on a drawn line: its MathML. */
export interface MathRun extends RunPlace { mathml: string; text?: undefined }
export type LayerRun = TextRun | MathRun;

export const maxOf = (profile: InkItem[] | undefined, key: 'h' | 'd'): number => (profile || []).reduce((m, it) => Math.max(m, it[key]), 0);

// ── Line by line ─────────────────────────────────────────────────────────────

/** The text of a box's contents (a \mbox, a footnote mark). */
function textOf(nodes: TexNode[] | undefined): string {
    let s = '';
    for (const n of nodes || []) {
        if (n.type === 'glyph' && n.char !== undefined) s += glyphText(n.char);
        else if (n.type === 'glue' && ((n.width || 0) > 0 || (n.stretch || 0) > 0)) s += ' ';   // as runsOf
        else if (n.type === 'disc') s += textOf(n.replace);
        else if (n.actual_text !== undefined) s += n.actual_text;
        else if (n.children) s += textOf(n.children);
    }
    return s;
}

/** The paragraph's lines a..b of segment i as runs, in svg units: text
 *  { text, x0, x1, y0, y1 } and formulas { mathml, x0, x1, y0, y1 }. Null
 *  when the segment has no lines laid out. (The pen positions are replayed
 *  as the painter would place them: api.inspect.replay's way.) */
export function runsOf(data: BlockData, i: number, a: number, b: number): LayerRun[] | null {
    const L = data.cache.layout!.laid[i];
    if (!L || L.deferred || !L.lines || !L.lrp) return null;
    useGlyphMetrics(data.cache.metrics);
    const noop = () => {};
    const runs: LayerRun[] = [];
    // A formula going on past a line's end: where it ends in its paragraph's
    // nodes. Every node up to there on the next lines is the formula's. (Its
    // end cannot be looked for on the lines themselves: a formula that ends
    // where the line breaks loses its end-math node, as TeX discards a math
    // node at a break – and the rest of the paragraph read as formula, that
    // is, not at all.)
    let carryEnd = -1;
    const order = paragraphOrder(data, L);
    // A word hyphenated at a line's end is read whole, on its first line: the
    // run there takes the letters of the next line up to its first space
    // (the run after them starts where they end). "para- graph" would be read
    // as two words.
    let joinTo: TextRun | null = null;
    // Word by word: each word its own run, placed on its drawn word (VoiceOver
    // frames, and steps through, the words it reads: a run spread over several
    // drawn words matched them only at its ends). A space between two runs is
    // noted on the second (`sp`) and put in as text of no width.
    let spaceNext = false;
    // A space is owed after a formula when the source had one before the next
    // words (a glue, or a line break), and not before punctuation, which has
    // none: a run after a formula then starts with it.
    let owed = false;
    for (let j = a; j <= b; j++) {
        // every node's pen position and advance; every glyph's ink, up and down
        // (a formula's run spans its own glyphs: limits and fractions reach
        // past the line's text)
        const pos = new Map<TexNode, { x: number; w: number }>(), ink: { x: number; x1: number; top: number; bottom: number }[] = [];
        const metrics = data.cache.metrics || [];
        const sink = { glyph: noop, missing: noop, space: noop, rule: noop, picture: noop,
                       beginTransform: noop, endTransform: noop, node: (n: TexNode, x: number, y: number, w: number) => {
                           pos.set(n, { x, w });
                           if (n.type === 'glyph') {
                               const g: { height?: number; depth?: number } = n.metrics ? metrics[n.metrics - 1] || {} : n;
                               ink.push({ x, x1: x + w, top: y - (g.height || 0) * SP_TO_PX, bottom: y + (g.depth || 0) * SP_TO_PX });
                           }
                       } };
        const { ratio, er, x0, fillRatio, fillOrder } = L.lrp[j];
        const nodes = L.lines[j].nodes;
        renderNodes(data.fontInfo, sink, nodes, x0, L.baselineYs![j], fillOrder ? fillRatio : ratio, er, fillOrder || 0);
        const y0 = L.baselineYs![j] - maxOf(L.profiles![j], 'h'), y1 = L.baselineYs![j] + maxOf(L.profiles![j], 'd');
        let text = null as TextRun | null;   // (set in addText)
        const flush = () => { if (text && text.text.trim()) runs.push(text); text = null; };
        const addText = (s: string, n: TexNode) => {
            const p = pos.get(n);
            if (!s) return;
            if (joinTo) {
                if (s.trim()) { joinTo.text += s; return; }
                joinTo.text += ' ';                          // the space after the word
                joinTo = null;
                return;
            }
            if (text && !s.trim()) {                          // a word ends
                if (text.text.trim()) { flush(); spaceNext = true; }
                return;
            }
            if (!text) {
                if (!s.trim()) { owed = runs.length > 0 && !!runs[runs.length - 1].mathml; if (runs.length) spaceNext = true; return; }
                // a run starts with a space only where one is owed after a formula
                text = { text: owed ? ' ' : '', lead: owed, sp: spaceNext && !owed, x0: Infinity, x1: -Infinity, y0, y1, line: j, ly0: y0, ly1: y1 };
                spaceNext = false;
            }
            owed = false;
            text.text += s;
            if (p && s.trim()) { text.x0 = Math.min(text.x0, p.x); text.x1 = Math.max(text.x1, p.x + p.w); }
        };
        const at = order(j);
        for (let k = 0; k < nodes.length; k++) {
            const n = nodes[k];
            if (carryEnd >= 0) {                             // the rest of a formula begun above
                const p = at.get(n);
                if (p === undefined || p <= carryEnd) continue;
                carryEnd = -1;
            }
            if (n.type === 'math' && (n.subtype || 0) === 0 && n.mathml) {
                joinTo = null;
                flush();
                let depth = 1, e = k + 1;
                for (; e < nodes.length; e++) {
                    if (nodes[e].type === 'math') depth += (nodes[e].subtype || 0) === 0 ? 1 : -1;
                    if (depth === 0) break;
                }
                const start = pos.get(n), end = e < nodes.length ? pos.get(nodes[e]) : null;
                const last = pos.get(nodes[nodes.length - 1]);
                const x1 = end ? end.x : (last ? last.x + last.w : start!.x);
                const mine = ink.filter(g => g.x >= start!.x - 0.5 && g.x1 <= x1 + 0.5);
                // the line's height, as a text run has, and more where its limits
                // and fractions reach past the line
                const my0 = Math.min(y0, ...mine.map(g => g.top));
                const my1 = Math.max(y1, ...mine.map(g => g.bottom));
                runs.push({ mathml: n.mathml, sp: spaceNext, x0: start!.x, x1: Math.max(x1, start!.x + 1), y0: my0, y1: my1, line: j, ly0: y0, ly1: y1 });
                spaceNext = false;
                if (e >= nodes.length) carryEnd = formulaEndIn(at, n);   // it goes on on the next line
                k = e;
                continue;
            }
            // what the line break put at the line's end (breaker.ts): the
            // hyphen of a word broken here, no part of it; or a hyphen the
            // author typed, kept. The word goes on on the next line.
            if (BREAK_NODES.has(n)) {
                if (BREAK_NODES.get(n) === 'keep') addText(glyphText(n.char ?? 0x2D), n);
                if (text) text.hyphen = true;
                continue;
            }
            if (n.type === 'glyph' && n.char !== undefined) addText(glyphText(n.char), n);
            else if (n.type === 'glue') { if ((n.width || 0) > 0 || (n.stretch || 0) > 0) addText(' ', n); }
            else if (n.type === 'disc') {
                // a hyphen at the line's end is no part of the word
                if (k < nodes.length - 1) addText(textOf(n.replace), n);
                else if (text) text.hyphen = true;
            }
            else if (n.type === 'hlist' || n.type === 'vlist') addText(n.actual_text ?? textOf(n.children), n);
        }
        if (text && !text.hyphen) text.text = text.text.replace(/\s*$/, ' ');   // the line break reads as a space
        if (text) text.text = text.text.replace(/^\s+/, text.lead ? ' ' : '');
        // a line that ends with a formula: the line break is the space owed
        if (!text && runs.length && runs[runs.length - 1].mathml) owed = true;
        const hyphenated = text && text.hyphen ? text : null;
        flush();
        joinTo = hyphenated;
    }
    return runs;
}

/** For line j of a laid-out text segment, each node of its paragraph with its
 *  place in the paragraph (the lines hold the paragraph's own nodes). */
function paragraphOrder(data: BlockData, L: SegmentLayout): (j: number) => Map<TexNode, number> {
    const maps = new Map<number, Map<TexNode, number>>();
    const paras = data.doc.paragraphs || [];
    return j => {
        let k = 0;
        const starts = L.itemStarts || [0];
        while (k + 1 < starts.length && starts[k + 1] <= j) k++;
        const item = L.seg.kind === 'text' ? L.seg.items[k] : undefined;
        if (!item) return new Map();
        if (!maps.has(item.index)) {
            const m = new Map<TexNode, number>();
            (paras[item.index - 1]?.nodes || []).forEach((n, i) => m.set(n, i));
            maps.set(item.index, m);
        }
        return maps.get(item.index)!;
    };
}

/** Where the formula begun by math node `n` ends in its paragraph: the place
 *  of its end-math node. -1 when `n` is not found (the formula is then taken
 *  to end with its line: text is never lost to it). */
function formulaEndIn(at: Map<TexNode, number>, n: TexNode): number {
    const start = at.get(n);
    if (start === undefined) return -1;
    const nodes = [...at.keys()];
    let depth = 0;
    for (let i = start; i < nodes.length; i++) {
        if (nodes[i].type === 'math') depth += (nodes[i].subtype || 0) === 0 ? 1 : -1;
        if (depth === 0) return i;
    }
    return nodes.length;
}

/** A display segment's ink, in svg units: from its leftmost glyph to its
 *  rightmost, its first line's top to its last line's bottom. Null when it
 *  has no lines laid out. */
export function inkOf(data: BlockData, i: number): { x0: number; x1: number; y0: number; y1: number } | null {
    const L = data.cache.layout!.laid[i];
    if (!L || L.deferred || !L.lines || !L.lrp) return null;
    useGlyphMetrics(data.cache.metrics);
    const noop = () => {};
    let x0 = Infinity, x1 = -Infinity;
    const sink = { glyph: noop, missing: noop, space: noop, rule: noop, picture: noop, beginTransform: noop, endTransform: noop,
                   node: (n: TexNode, x: number, y: number, w: number) => { if (n.type === 'glyph' || n.type === 'rule') { x0 = Math.min(x0, x); x1 = Math.max(x1, x + w); } } };
    for (let j = 0; j < L.lines.length; j++) {
        const { ratio, er, x0: lx, fillRatio, fillOrder } = L.lrp[j];
        renderNodes(data.fontInfo, sink, L.lines[j].nodes, lx, L.baselineYs![j], fillOrder ? fillRatio : ratio, er, fillOrder || 0);
    }
    if (!(x1 > x0)) return null;
    const last = L.lines.length - 1;
    return { x0, x1, y0: L.baselineYs![0] - maxOf(L.profiles![0], 'h'), y1: L.baselineYs![last] + maxOf(L.profiles![last], 'd') };
}
