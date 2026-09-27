// SPDX-License-Identifier: AGPL-3.0-or-later
// The reader's selection, drawn as bands (a feature flag, off by default).
//
// The browser draws a selection of SVG text glyph by glyph: a box per
// glyph, as tall as that glyph's font says, with nothing over the spaces,
// which are glue. With data-latex-selection="bands" on <html> or on a block
// (the nearest wins; "native" turns it off again inside), the browser's own
// highlight is hidden in the text, and the viewer draws the selection as it
// draws a mark's band (marks.ts, paint.js): one rect per line, from the
// first selected glyph to the last, spaces included, all of one height for
// one size of type. The selection itself stays the browser's: copying,
// dragging, the keyboard and getSelection() are as ever.
//
// It runs beside marks, not through them: a separate set of glyph nodes
// (selectedGlyph, asked by the painter) and a separate layer of rects
// (rect.latex-selection, over marks' bands, under the text).
import { allData } from '../runtime/block-data.js';
import { glyphNodeOf, nodesOf, rangesOf, repaint, type BlockData } from './marks.ts';
import { frame as nextFrame } from '../runtime/pending.js';

let selected = new Set<object>();
let blocks = new Set<BlockData>();
// Where the selection's ends fall between glyphs, as the browser puts
// them: at the end of a glyph ("word[ word]" starts at the end of the d),
// or in a word space (the painter draws each as a tspan of its own). The
// band then reaches that edge on the line, so the space between two words
// can be selected, alone or with them. Each end is a node and a side:
//   start: 'right' of a glyph, or 'left' of a space;
//   end:   'left' of a glyph, 'left' of a space, or 'right' of a space
//          (the next glyph's left).
interface Edge { node: object; side: 'left' | 'right' }
let edges: { start: Edge | null; end: Edge | null } = { start: null, end: null };
const sameEdge = (a: Edge | null, b: Edge | null) => a === b || (!!a && !!b && a.node === b.node && a.side === b.side);

// Word spaces' elements → their glue nodes (paint.js registers them).
const spaceOfEl = new WeakMap<Element, object>();
export function registerSpace(el: Element, n: object) { spaceOfEl.set(el, n); }

function edgeAt(container: Node, offset: number, which: 'start' | 'end'): Edge | null {
    if (container.nodeType !== Node.TEXT_NODE) return null;
    const el = container.parentElement;
    if (!el || !bandsIn(el)) return null;
    const len = (container.textContent || '').length;
    const glyph = glyphNodeOf(el), space = spaceOfEl.get(el);
    if (glyph && which === 'start' && offset >= len) return { node: glyph, side: 'right' };
    if (glyph && which === 'end' && offset === 0) return { node: glyph, side: 'left' };
    if (space && which === 'start' && offset === 0) return { node: space, side: 'left' };
    if (space && which === 'end') return { node: space, side: offset === 0 ? 'left' : 'right' };
    return null;
}

/** The block (data) an edge's element is in. */
const dataOfEl = (el: Element | null) => el && (allData as BlockData[]).find(d => d.el.contains(el));

/** From paint.js: is this glyph node in the selection, drawn as bands? */
export const selectedGlyph = (n: object) => selected.has(n);
/** From paint.js: the edges the selection's ends fall on (see Edge). */
export const selectionEdges = () => edges;

/** Is the selection drawn as bands in this element (a block's)? */
export function bandsIn(el: Element): boolean {
    const at = el.closest('[data-latex-selection]');
    return !!at && at.getAttribute('data-latex-selection') === 'bands';
}

function update() {
    frame = 0;
    const next = new Set<object>(), nextBlocks = new Set<BlockData>();
    const sel = getSelection();
    const nextEdges: typeof edges = { start: null, end: null };
    if (sel && !sel.isCollapsed && sel.rangeCount) {
        const first = sel.getRangeAt(0), last = sel.getRangeAt(sel.rangeCount - 1);
        nextEdges.start = edgeAt(first.startContainer, first.startOffset, 'start');
        nextEdges.end = edgeAt(last.endContainer, last.endOffset, 'end');
        for (const c of [first.startContainer, last.endContainer]) {
            const d = dataOfEl(c.parentElement);
            if (d && bandsIn(d.el)) nextBlocks.add(d);
        }
        for (let i = 0; i < sel.rangeCount; i++) {
            for (const r of rangesOf(sel.getRangeAt(i))) {
                const at = nodesOf(r);
                if (!at || !bandsIn(at.data.el)) continue;
                nextBlocks.add(at.data);
                for (const n of at.nodes) next.add(n);
            }
        }
    }
    if (next.size === selected.size && [...next].every(n => selected.has(n))
        && sameEdge(nextEdges.start, edges.start) && sameEdge(nextEdges.end, edges.end)) return;
    const touched = new Set([...blocks, ...nextBlocks]);
    selected = next;
    edges = nextEdges;
    blocks = nextBlocks;
    repaint(touched);
}

let frame = 0;
const schedule = () => { if (!frame) frame = nextFrame('selection bands', update); };

/** Once, from the entry module. */
export function installSelection() {
    document.addEventListener('selectionchange', schedule);
    // The flag switched (a reader's option, a page's script): draw again.
    // update() draws again the blocks that had bands and those that have them.
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-latex-selection'] });
}

/** The viewer's styles for it (index.js puts them in the page). */
export const SELECTION_CSS = `
  /* The selection as bands (host/selection.ts): the browser's highlight
     hidden in the text, a band per line drawn under it instead. */
  [data-latex-selection="bands"] .latex-block :is(text, tspan):not([data-latex-selection="native"] *)::selection {
    background: transparent;
  }
  .latex-block rect.latex-selection { fill: var(--latex-selection-color, Highlight); }
`;
