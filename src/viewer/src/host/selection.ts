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
import { nodesOf, rangesOf, repaint, type BlockData } from './marks.ts';

let selected = new Set<object>();
let blocks = new Set<BlockData>();

/** From paint.js: is this glyph node in the selection, drawn as bands? */
export const selectedGlyph = (n: object) => selected.has(n);

/** Is the selection drawn as bands in this element (a block's)? */
export function bandsIn(el: Element): boolean {
    const at = el.closest('[data-latex-selection]');
    return !!at && at.getAttribute('data-latex-selection') === 'bands';
}

function update() {
    frame = 0;
    const next = new Set<object>(), nextBlocks = new Set<BlockData>();
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
        for (let i = 0; i < sel.rangeCount; i++) {
            for (const r of rangesOf(sel.getRangeAt(i))) {
                const at = nodesOf(r);
                if (!at || !bandsIn(at.data.el)) continue;
                nextBlocks.add(at.data);
                for (const n of at.nodes) next.add(n);
            }
        }
    }
    if (next.size === selected.size && [...next].every(n => selected.has(n))) return;
    const touched = new Set([...blocks, ...nextBlocks]);
    selected = next;
    blocks = nextBlocks;
    repaint(touched);
}

let frame = 0;
const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

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
