// SPDX-License-Identifier: AGPL-3.0-or-later
// Marks (\webid, \webclass in reflowtex.sty): runs of text the author named
// or classed. Every glyph inside carries the mark's index (Node.mark →
// Document.marks); the painter gives its element the mark's classes and
// data-rtx-id, so CSS reaches it however the lines break, and a page finds
// it: host.mark(id).
//
// Live marks (host.addMark): the same, made while the page is open – a
// reader's highlight. They are held here, not in the document: a live mark
// is a set of glyph nodes, and the painter asks liveOn(node) for each glyph
// it draws, so the band follows the text through every reflow, and lines
// drawn later (as the reader nears them) have it too. A glyph's place is
// its position in the block's text: every glyph, in reading order (glyphIndex
// below), which is the same on every load of the same document.
import { glyphScreenRect } from '../defaults/footnotes.js';
import { allData } from '../runtime/block-data.js';
import { markDirty } from '../runtime/blocks.js';
import { paintVisibleNow } from '../runtime/visibility.js';
import { surfacesOf } from './surface.ts';
import type { LiveMark, LiveMarkOptions, MarkHandle, TextRange } from './types.ts';

interface Mark { id?: string; classes?: string }

/** From paint.js: a glyph element of mark `index` (the layout's table). */
export function applyMark(el: Element, index: number, cache: { marks?: Mark[] }) {
    const m = cache.marks && cache.marks[index - 1];
    if (!m) return;
    if (m.id) (el as HTMLElement).dataset.rtxId = m.id;
    for (const c of (m.classes || '').split(/\s+/)) if (c) el.classList.add(c);
}

function handle(id: string, selector: string): MarkHandle {
    // The glyphs; the bands behind them (paint.js, paintMarkBands) carry the id too.
    const elements = () => [...document.querySelectorAll(selector)].filter(e => !e.matches('rect.latex-mark'));
    return {
        id,
        elements,
        rects() {
            // One rect per line: glyphs on one baseline joined.
            const lines = new Map<number, { left: number; top: number; right: number; bottom: number }>();
            for (const el of elements()) {
                const r = glyphScreenRect(el);
                const key = Math.round(r.bottom);
                const l = lines.get(key);
                if (!l) lines.set(key, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
                else { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right);
                       l.top = Math.min(l.top, r.top); l.bottom = Math.max(l.bottom, r.bottom); }
            }
            return [...lines.values()].map(l => new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top));
        },
    };
}

export function markHandle(id: string): MarkHandle {
    const q = CSS.escape(id);
    return handle(id, `[data-rtx-id="${q}"], [data-rtx-marks~="${q}"]`);
}

// ── Glyph positions ─────────────────────────────────────────────────────────

type GNode = { type?: string; char?: number; text?: string; stream?: number;
              children?: GNode[]; pre?: GNode[]; post?: GNode[]; replace?: GNode[] };
type Item = { kind?: string; para?: number; box?: GNode; stream?: number };
type Doc = { paragraphs?: { nodes?: GNode[] }[]; content?: Item[]; streams?: { content?: Item[] }[] };
interface BlockData { doc: Doc; el: HTMLElement; fontInfo: unknown; cache: { blockKey?: string } }

interface GlyphIndex {
    nodes: GNode[];
    at: WeakMap<GNode, number>;
    /** Each glyph's text, and where it starts in `text` (all of them
     *  joined; a glyph drawn only at a line break has none). */
    text: string;
    starts: number[];
}
const indexes = new WeakMap<Doc, GlyphIndex>();

// Every glyph of a document in reading order: the content items in turn,
// a stream's content where the stream stands, a footnote's after the glyph
// that refers to it, and any stream not reached (an aside) at the end. A
// disc's three lists all count, whichever the lines use. The order depends
// on the document only, so a position means the same glyph on every load.
function glyphIndex(doc: Doc): GlyphIndex {
    let ix = indexes.get(doc);
    if (ix) return ix;
    const nodes: GNode[] = [], seen = new Set<GNode>(), streams = new Set<number>();
    const atBreak = new Set<GNode>();      // a disc's pre and post: drawn only where a line breaks
    const node = (n: GNode, broken = false) => {
        if (seen.has(n)) return;
        seen.add(n);
        if (n.type === 'glyph') {
            nodes.push(n);
            if (broken) atBreak.add(n);
            if (n.stream) stream(n.stream);
            return;
        }
        for (const c of n.children || []) node(c, broken);
        for (const c of n.pre || []) node(c, true);
        for (const c of n.post || []) node(c, true);
        for (const c of n.replace || []) node(c, broken);
    };
    const items = (list: Item[] | undefined) => {
        for (const it of list || []) {
            if (it.kind === 'paragraph' && it.para) for (const n of doc.paragraphs?.[it.para - 1]?.nodes || []) node(n);
            else if (it.kind === 'display' && it.box) node(it.box);
            else if (it.kind === 'stream' && it.stream) stream(it.stream);
        }
    };
    const stream = (i: number) => {
        if (streams.has(i)) return;
        streams.add(i);
        items(doc.streams?.[i - 1]?.content);
    };
    items(doc.content);
    for (let i = 1; i <= (doc.streams || []).length; i++) stream(i);
    const at = new WeakMap<GNode, number>(), starts: number[] = [];
    let text = '';
    nodes.forEach((n, i) => {
        at.set(n, i);
        starts.push(text.length);
        // The text as read, unbroken: a hyphen TeX may put at a line's
        // end has a position (it can be marked where drawn) but no text.
        if (!atBreak.has(n)) text += n.text !== undefined ? n.text : String.fromCodePoint(n.char || 0xfffd);
    });
    indexes.set(doc, ix = { nodes, at, text, starts });
    return ix;
}

const textOf = (ix: GlyphIndex, from: number, to: number) =>
    ix.text.slice(ix.starts[from], to + 1 < ix.starts.length ? ix.starts[to + 1] : ix.text.length);

const blockByKey = (key: string): BlockData | undefined =>
    (allData as BlockData[]).find(d => d.cache.blockKey === key && d.el.isConnected);

// A painted glyph element → its node (paint.js registers each as it makes it).
const nodeOfEl = new WeakMap<Element, GNode>();
export function registerGlyph(el: Element, n: GNode) { nodeOfEl.set(el, n); }

/** The block (data) whose document holds glyph node n. */
function dataOfNode(n: GNode): BlockData | undefined {
    for (const d of allData as BlockData[]) if (d.el.isConnected && glyphIndex(d.doc).at.has(n)) return d;
    return undefined;
}

/** From host.rangesOf: the glyphs a DOM range covers, one range per block. */
export function rangesOf(range: Range): TextRange[] {
    if (range.collapsed) return [];
    const root = range.commonAncestorContainer;
    const scope = root.nodeType === Node.ELEMENT_NODE ? root as Element : root.parentElement;
    if (!scope) return [];
    const els: Element[] = scope.matches('tspan') ? [scope] : [...scope.querySelectorAll('tspan')];
    // A glyph counts when some of its text is inside: a range that starts at
    // the end of one glyph's text, or ends at the start of one, does not take it.
    const inside = (el: Element) => {
        if (!range.intersectsNode(el)) return false;
        const t = el.firstChild;
        if (t && range.startContainer === t && range.startOffset >= (t.textContent || '').length) return false;
        if (t && range.endContainer === t && range.endOffset === 0) return false;
        if (range.endContainer === el && range.endOffset === 0) return false;
        return true;
    };
    const spans = new Map<BlockData, { from: number; to: number }>();
    for (const el of els) {
        const n = nodeOfEl.get(el);
        if (!n || !inside(el)) continue;
        const d = dataOfNode(n);
        if (!d) continue;
        const i = glyphIndex(d.doc).at.get(n)!;
        const s = spans.get(d);
        if (!s) spans.set(d, { from: i, to: i });
        else { s.from = Math.min(s.from, i); s.to = Math.max(s.to, i); }
    }
    return [...spans].map(([d, s]) => ({ block: d.cache.blockKey || '', ...s, text: textOf(glyphIndex(d.doc), s.from, s.to) }));
}

// Where a range's text now stands in the block: in its old place when it
// still reads the same; else the occurrence nearest that place (the
// document changed around it); else nowhere.
function resolve(r: TextRange): { data: BlockData; from: number; to: number } | null {
    const data = blockByKey(r.block);
    if (!data) return null;
    const ix = glyphIndex(data.doc), n = ix.nodes.length;
    const from = Math.floor(r.from), to = Math.floor(r.to);
    if (!(from >= 0 && to >= from && to < n)) { if (!r.text) return null; }
    else if (!r.text || textOf(ix, from, to) === r.text) return { data, from, to };
    let best = -1;
    const want = from >= 0 && from < n ? ix.starts[from] : 0;
    for (let at = ix.text.indexOf(r.text); at >= 0; at = ix.text.indexOf(r.text, at + 1))
        if (best < 0 || Math.abs(at - want) < Math.abs(best - want)) best = at;
    if (best < 0) return null;
    // Back from characters to glyphs.
    const glyphAt = (c: number) => { let lo = 0, hi = n - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.starts[m] <= c) lo = m; else hi = m - 1; } return lo; };
    const f = glyphAt(best), t = glyphAt(best + r.text.length - 1);
    return textOf(ix, f, t) === r.text ? { data, from: f, to: t } : null;
}

// ── Live marks ──────────────────────────────────────────────────────────────

interface Live { id: string; classes: string; ranges: TextRange[]; nodes: GNode[]; blocks: Set<BlockData> }
const live = new Map<string, Live>();
const onNode = new WeakMap<GNode, string[]>();
let seq = 0;

/** From paint.js: the live marks on a glyph node, in the order made. */
export function liveOn(n: GNode): string[] | undefined {
    const ids = onNode.get(n);
    return ids && ids.length ? ids : undefined;
}
/** From paint.js: a live mark's look, for its band. */
export function liveInfo(id: string): Mark | undefined {
    const m = live.get(id);
    return m && { id: m.id, classes: m.classes };
}

// Draw again the lines that are drawn (the rest will be, with the marks,
// when they are reached): the block's, and every part of it shown elsewhere.
function repaint(blocks: Iterable<BlockData>) {
    for (const d of blocks) {
        if (!d.el.isConnected) continue;
        markDirty(d.cache);
        paintVisibleNow(d.fontInfo, d.cache);
        for (const s of surfacesOf(d.el)) {
            if (s.isDisposed) continue;
            markDirty(s.layoutCache);
            paintVisibleNow(s.part.data.fontInfo, s.layoutCache);
        }
    }
}

function changed() {
    document.dispatchEvent(new CustomEvent('reflowtex:marks', { detail: { marks: liveMarks() } }));
}

function liveHandle(m: Live): LiveMark {
    const base = markHandle(m.id);
    return {
        ...base,
        get classes() { return m.classes; },
        get ranges() { return m.ranges.slice(); },
        get live() { return live.get(m.id) === m; },
        setClasses(classes: string) {
            if (live.get(m.id) !== m || m.classes === classes) return;
            m.classes = classes;
            repaint(m.blocks);
            changed();
        },
        remove() {
            if (live.get(m.id) !== m) return;
            live.delete(m.id);
            for (const n of m.nodes) {
                const ids = onNode.get(n);
                if (ids) onNode.set(n, ids.filter(x => x !== m.id));
            }
            repaint(m.blocks);
            changed();
        },
    };
}

/** From host.addMark. */
export function addMark(ranges: readonly TextRange[], options: LiveMarkOptions = {}): LiveMark | null {
    const id = options.id || `rtx-live-${++seq}`;
    live.get(id) && liveHandle(live.get(id)!).remove();
    const m: Live = { id, classes: options.classes || '', ranges: [], nodes: [], blocks: new Set() };
    for (const r of ranges) {
        const at = resolve(r);
        if (!at) continue;
        const ix = glyphIndex(at.data.doc);
        m.ranges.push({ block: r.block, from: at.from, to: at.to, text: textOf(ix, at.from, at.to) });
        m.blocks.add(at.data);
        for (let i = at.from; i <= at.to; i++) {
            const n = ix.nodes[i];
            const ids = onNode.get(n);
            onNode.set(n, ids ? [...ids, id] : [id]);
            m.nodes.push(n);
        }
    }
    if (!m.nodes.length) return null;
    live.set(id, m);
    repaint(m.blocks);
    changed();
    return liveHandle(m);
}

const overlaps = (a: TextRange, b: TextRange) => a.block === b.block && a.from <= b.to && b.from <= a.to;

/** From host.liveMarks: all, or those on a glyph element, or touching ranges. */
export function liveMarks(at?: Element | readonly TextRange[]): LiveMark[] {
    let ms = [...live.values()];
    if (at instanceof Element) {
        const n = nodeOfEl.get(at), ids = n ? onNode.get(n) || [] : [];
        ms = ms.filter(m => ids.includes(m.id));
    } else if (at) {
        ms = ms.filter(m => m.ranges.some(r => at.some(q => overlaps(r, q))));
    }
    return ms.map(liveHandle);
}
