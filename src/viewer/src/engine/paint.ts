// SPDX-License-Identifier: AGPL-3.0-or-later
// Painting a segment: its laid-out lines drawn into its <svg> (renderNodes
// through the reconciling sink), with the hit areas of its references and the
// bands of its marks and of the selection.

import { SP_TO_PX, useGlyphMetrics } from './core.ts';
import { renderNodes, renderVlistBody } from './render.ts';
import { reconcileSink, svgEl } from './sink.ts';
import { updateDisplayOverflowCue } from './layout/display.ts';
import { materializeSegment } from './layout/document.ts';
import { restoreLinkStates } from '../host/links.ts';
import { liveInfo } from '../host/marks.ts';
import { keepSelection } from '../host/selection.ts';
import type { FontTable, Mark } from './model.ts';
import type { DomSegment, LayoutCache, LinePair, SegmentLayout } from './layout/types.ts';
import type { ElementRun, Run } from './sink.ts';
import type { Sink } from './render.ts';

export let paintCount = 0;

// Paint one segment: reconcile its lines' glyphs into its own <svg>. The reconcile
// is scoped to this segment (its own `live` set) because a node always lands in
// exactly one segment – segmentation is width-independent – so segments can be
// painted independently. That independence is what makes per-segment painting
// possible (see observeSegments / paintVisibleNow): a long document only pays the
// DOM cost for the segments that have been on screen, not for all of them at once.
export function paintSegment(fontInfo: FontTable, cache: LayoutCache, i: number): void {
    paintCount++;
    restoreLinkStates();              // once this paint is done (a microtask)
    materializeSegment(cache, i);     // a deferred layout is only ever run here
    useGlyphMetrics(cache.metrics);   // a paint may run after another block laid out
    const dom = cache.dom!;
    const L   = cache.layout!.laid[i];
    const s   = dom.segs[i];
    const svg = s.svg!;
    const restoreSelection = keepSelection(svg);   // (glyphs moved between lines take it with them: see there)
    const stats = cache.stats || (cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 });
    const used  = new Set<Element>();
    const sink  = reconcileSink(dom.byNode, used, stats, cache);
    const linkRuns: ElementRun[] = [], markRuns: [number | string, ElementRun][] = [], selRuns: Run[] = [];

    // Grow/shrink the pool of per-line group pairs. Detached pairs are kept for
    // later regrowth; their stale children are swept by the live set.
    while (s.pairs.length < L.lines.length) {
        const g = svgEl('g', {'aria-hidden':'true', style:'user-select:none;pointer-events:none'});
        const text = svgEl('text', {});
        text.style.cssText = 'font-weight:normal;font-style:normal';
        s.pairs.push({ g, text, attached: false });
    }
    for (let j = 0; j < s.pairs.length; j++) {
        const pair = s.pairs[j];
        if (j < L.lines.length && !pair.attached) {
            svg.appendChild(pair.g);
            svg.appendChild(pair.text);
            pair.attached = true;
        } else if (j >= L.lines.length && pair.attached) {
            pair.g.remove();
            pair.text.remove();
            pair.attached = false;
        }
    }

    for (let j = 0; j < L.lines.length; j++) {
        const { ratio, er, x0, fillRatio, fillOrder } = L.lrp![j];
        sink.beginLine(s.pairs[j].text, s.pairs[j].g);
        // On a fill line finite glue is already at natural width (ratio 0), so the
        // single ratio slot carries the fill ratio and fillOrder selects the fill.
        // A rule's running height and depth are the line's: TeX's line is a box
        // packed from its contents' ink, which is the line's profile.
        const ink = L.profiles?.[j] ?? [];
        const lineH = ink.reduce((m, it) => Math.max(m, it.h), 0) / SP_TO_PX;
        const lineD = ink.reduce((m, it) => Math.max(m, it.d), 0) / SP_TO_PX;
        renderNodes(fontInfo, sink, L.lines[j].nodes, x0, L.baselineYs![j],
                    fillOrder ? fillRatio : ratio, er, fillOrder || 0, lineH, lineD);
        paintAdjusts(fontInfo, sink, L, j, cache.layoutCtx?.columnPx ?? L.W);
        linkRuns.push(...sink.takeLinkRuns());
        markRuns.push(...sink.takeMarkRuns());
        const sel = sink.takeSelectionRun();
        if (sel) selRuns.push(sel);
    }
    paintLinkHits(s, linkRuns);
    paintMarkBands(s, markRuns, cache);
    paintSelectionBands(s, selRuns);

    // Detach this segment's elements no longer rendered (disc paths toggled off,
    // spaces consumed by new break points). They stay cached in byNode.
    if (s.live) for (const el of s.live) if (!used.has(el)) { el.remove(); stats.removed++; }
    s.live = used;
    s.painted = true;
    s.dirty = false;
    restoreSelection?.();

    // Overflow cues only. The wrapper's vertical geometry – the headroom padding
    // and the margins that take it back – is fixed at layout time (see
    // layoutDocument). Measuring painted ink here with getBBox was a trap: for
    // SVG text it returns the font's ascent/descent box, not the glyph outlines,
    // so the wrapper was padded for phantom overshoot and every scrollable
    // display carried visibly inflated space above and below.
    if (s.wrap && svg.parentNode === s.wrap) {
        updateDisplayOverflowCue(s.wrap);
    }
}

// What a line's \vadjust material draws (a box, a rule), stacked as TeX
// stacks it on the vertical list, from the column's left edge: below the
// line's depth, or, for \vadjust pre, above the interline glue over the line
// (at a segment's first line that glue is above the segment, and the
// material sits on the line's ascent). Its space is in the layout already.
export function paintAdjusts(fontInfo: FontTable, sink: Sink, L: SegmentLayout, j: number, columnPx: number): void {
    const nodes = L.lines[j].nodes;
    if (!nodes.some(n => n.type === 'adjust' && n.children?.length)) return;
    const maxOf = (k: 'h' | 'd', i: number) => (L.profiles?.[i] ?? []).reduce((m, it) => Math.max(m, it[k]), 0);
    const adj = (i: number) => L.adjust?.[i] ?? { above: 0, below: 0 };
    const y = L.baselineYs![j];
    const glue = j > 0 ? y - L.baselineYs![j - 1] - maxOf('d', j - 1) - adj(j - 1).below - adj(j).above - maxOf('h', j) : 0;
    let above = y - maxOf('h', j) - glue - adj(j).above, below = y + maxOf('d', j);
    for (const n of nodes) {
        if (n.type !== 'adjust') continue;
        const pre = n.subtype === 1;
        if (n.children?.length) {
            renderVlistBody(fontInfo, sink, { type: 'vlist', width: columnPx / SP_TO_PX, height: 0, depth: n.height,
                                              children: n.children }, 0, pre ? above : below);
        }
        if (pre) above += (n.height || 0) * SP_TO_PX; else below += (n.height || 0) * SP_TO_PX;
    }
}

// A reference's hit area: one transparent rect per line it is on, from its
// first glyph to its last, as tall as its glyphs, carrying the reference's
// data-link attributes. The spaces inside a reference are glue, drawn as
// nothing, so without it the pointer between two words of "Section 2" is on
// no link: no underline, and a click does nothing. The rects lie under the
// glyphs (first in the <svg>), so a glyph still takes the pointer over its
// own ink. Rebuilt on every paint – a segment holds a handful at most.
export function paintLinkHits(s: DomSegment, runs: ElementRun[]): void {
    if (!runs.length && !s.hits) return;
    if (!s.hits) {
        s.hits = svgEl('g', { 'aria-hidden': 'true' });
        s.svg!.insertBefore(s.hits, s.svg!.firstChild);
    }
    s.hits.replaceChildren(...runs.map(r => {
        const rect = svgEl('rect', { x: r.x0, y: r.top, width: Math.max(0, r.x1 - r.x0),
                                     height: Math.max(0, r.bottom - r.top) });
        rect.setAttribute('class', 'latex-link-hit');
        for (const k of ['link', 'linkHref', 'linkLabel', 'linkAction'] as const)
            if (r.el.dataset[k] !== undefined) rect.dataset[k] = r.el.dataset[k];
        rect.style.cssText = 'fill:transparent;cursor:pointer';
        return rect;
    }));
}

// A mark's band: one rect per line it is on, from its first glyph to its
// last and as tall as its line (at least a parenthesis: BAND_MIN), under the text – the spaces between its
// words are glue, drawn as nothing, so a background on the glyphs alone
// would break at every space. Class latex-mark, the mark's classes in
// data-mark (not as classes: a page's rule for the glyphs, `.key { fill }`,
// would fill the band too) and its id in data-rtx-id. Transparent (as an
// attribute, which any CSS outranks) unless a page styles it:
//   .latex-block rect.latex-mark[data-mark~="key"] { fill: #fde68a; }
// A live mark (host.addMark) has its band the same way, drawn after the
// document's own, so over them.
export function paintMarkBands(s: DomSegment, runs: [number | string, ElementRun][], cache: LayoutCache): void {
    if (!runs.length && !s.bands) return;
    if (!s.bands) {
        s.bands = svgEl('g', { 'aria-hidden': 'true', style: 'pointer-events:none' });
        s.svg!.insertBefore(s.bands, s.svg!.firstChild);
    }
    // The document's own marks first, then the live ones over them.
    runs = runs.filter(([k]) => typeof k !== 'string').concat(runs.filter(([k]) => typeof k === 'string'));
    s.bands.replaceChildren(...runs.map(([index, r]) => {
        const m: Mark = (typeof index === 'string' ? liveInfo(index) : cache.marks && cache.marks[index - 1]) || {};
        const rect = svgEl('rect', { x: r.x0, y: r.top, width: Math.max(0, r.x1 - r.x0),
                                     height: Math.max(0, r.bottom - r.top) });
        rect.setAttribute('class', 'latex-mark');
        if (m.classes) rect.dataset.mark = m.classes;
        if (m.id) rect.dataset.rtxId = m.id;
        rect.setAttribute('fill', 'transparent');     // an attribute: any page rule wins
        return rect;
    }));
}

// The selection, when drawn as bands (host/selection.ts): one rect per
// line, class latex-selection, over the marks' bands and under the text.
export function paintSelectionBands(s: DomSegment, runs: Run[]): void {
    if (!runs.length && !s.selBands) return;
    if (!s.selBands) {
        s.selBands = svgEl('g', { 'aria-hidden': 'true', style: 'pointer-events:none' });
        // After the marks' bands (and link hits), before the first line.
        const first = s.pairs.find((p: LinePair) => p.attached);
        s.svg!.insertBefore(s.selBands, first ? first.g : null);
    }
    s.selBands.replaceChildren(...runs.map(r => {
        const rect = svgEl('rect', { x: r.x0, y: r.top, width: Math.max(0, r.x1 - r.x0),
                                     height: Math.max(0, r.bottom - r.top) });
        rect.setAttribute('class', 'latex-selection');
        return rect;
    }));
}

// Paint every segment regardless of the viewport – for printing, where nothing may
// be left as an empty placeholder.
export function paintDocument(fontInfo: FontTable, cache: LayoutCache): void {
    if (!cache.layout) return;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    for (let i = 0; i < cache.layout.laid.length; i++) {
        const s = cache.dom!.segs[i];
        if (!s.svg) { if (s.sub) paintDocument(fontInfo, s.sub); continue; }
        paintSegment(fontInfo, cache, i);
    }
}
