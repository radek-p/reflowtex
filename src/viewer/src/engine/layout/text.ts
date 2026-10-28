// SPDX-License-Identifier: AGPL-3.0-or-later

import { alignOf, blockRigidParFill, buildBreakCandidates, kpBreak, paragraphParams } from '../breaker.ts';
import { HL_ALIGNMENT, IGNORE_DEPTH_SP, SP_TO_PX, ZOOM, gD, gH, gW, stretchByOrder, sumExpandableSp, sumWidthSp } from '../core.ts';
import { AFFINE_CHILD_LISTS, affineDisplayNode, preDisplaySizeSp } from './display.ts';
import { mergeWidgetRuns } from '../../host/widgets.ts';
import { paragraphLeading } from './lines.ts';
import type { BoxNode, ContentItem, Doc, FontTable, GlueNode, LineBand, Paragraph, TexNode } from '../model.ts';
import type { Line, LineAdjust, LineMeta, LinePlacement, Segment, Segments, SegmentGeometry, TextSegment } from './types.ts';
import type { LayoutCache } from './types.ts';
import type { Params } from '../../runtime/params.ts';

// A margin skip's stretch order when it stretches (LuaTeX's: 0 finite, 1 fi,
// 2 fil, 3 fill, 4 filll), and its stretch at an order.
const stretchAt = (g: GlueNode | undefined, order: number) => g && (g.stretch_order || 0) === order ? g.stretch || 0 : 0;

// A paragraph whose margin skips are a share of the measure (0pt plus
// .3\hsize) has their stretch and shrink with rates (display_model's
// attachParagraphRates): the skips at a measure deltaSp wider than TeX's.
function skipsAtWidth(para: Paragraph, deltaSp: number): Paragraph {
    const rated = (g: GlueNode | undefined) => !!g && (g.stretch_rate !== undefined || g.shrink_rate !== undefined);
    if (!deltaSp || !(rated(para.left_skip) || rated(para.right_skip))) return para;
    const at = (g: GlueNode | undefined) => g && affineDisplayNode(g, deltaSp) as GlueNode;
    return { ...para, left_skip: at(para.left_skip), right_skip: at(para.right_skip) };
}

// The nodes of a paragraph with its \parfillskip made rigid, kept per list.
const rigidParFills = new WeakMap<TexNode[], TexNode[]>();
function rigidParFill(nodes: TexNode[]): TexNode[] {
    let r = rigidParFills.get(nodes);
    if (!r) {
        r = nodes.map(n => n.type === 'glue' && n.subtype === 15 ? { ...n, width: 0, stretch: 0, stretch_order: 0, shrink: 0, shrink_order: 0 } : n);
        rigidParFills.set(nodes, r);
    }
    return r;
}

// ── Document → SVG element ────────────────────────────────────────────────────
// A block is an ordered stream of paragraphs and displays (see latex.proto).
// The two are laid out very differently but stack identically, so both are
// reduced to the same "line" shape – {nodes, ratio, er, x0} – and the existing
// profiling, spacing, and reconciliation machinery then treats them alike:
//
//   paragraph → Knuth-Plass re-breaks it at the reader's width, many lines
//   display   → one line whose single node is TeX's finished box
//
// Displays are not re-broken or re-packed. The pipeline recovers sparse affine
// width derivatives by matching complete display trees from three increasingly
// wide TeX runs, and those finished dimensions are evaluated at the reader's
// width. The renderer never guesses which node is a gap or activates glue which
// TeX deliberately left slack.
//
// Split into two phases so far-from-viewport blocks can be sized without being
// drawn: layoutDocument runs KP + line spacing and sets the svg's dimensions
// (storing the result in cache.layout); paintDocument materialises the most
// recent layout into glyph/rule elements via the reconciling sink.

// Older blocks carry no content stream; treat them as all-paragraphs.
export function contentStream(doc: Doc): ContentItem[] {
    if (doc.content && doc.content.length) return doc.content;
    return doc.paragraphs.map((_, i): ContentItem => ({ kind: 'paragraph', para: i + 1 }));
}

// A block is split into segments rather than drawn as one SVG: runs of text
// share an SVG, but every display gets its own. A display keeps its compiled
// width, so it can be wider than the column – in one shared SVG that overflow
// would scroll the whole block, dragging text that fits perfectly out of view.
// Giving each display its own scroll container (as MathJax and KaTeX do) keeps
// the text still and lets only the maths pan.
//
// Segmentation depends solely on the content stream, never on width, so the
// segment list is stable across reflows and every element stays reusable.

// Anchor markers that ended up *inside* what was typeset – a \label written
// mid-sentence, or one amsmath replayed into a display's own box. Their exact
// pen position is known but not useful: an anchor is a scroll destination, and
// the segment is the smallest thing worth scrolling to. Walked once per
// paragraph/box ever, since neither the tree nor the answer changes with width.
export const anchorIdsCache = new WeakMap<object, number[]>();
export function anchorIdsOf(key: object, roots: TexNode[] | undefined): number[] {
    let ids = anchorIdsCache.get(key);
    if (ids) return ids;
    ids = [];
    (function walk(ns: TexNode[] | undefined) {
        const found = ids;
        for (const n of ns || []) {
            if (n.anchor) found.push(n.anchor);
            walk(n.children); walk(n.pre); walk(n.post); walk(n.replace);
            if (n.leader) walk([n.leader]);
        }
    })(roots);
    anchorIdsCache.set(key, ids);
    return ids;
}

// A \begin{center}\includegraphics..\end{center}-style figure – a paragraph
// whose only ink is one or more pictures, no running text. \mypic in the
// transducers book is the motivating case, but the test is structural (picture
// present, no glyph present) so it holds for any front end's plain centred
// figure. Such a paragraph gets its own segment (isFigure, below) so a picture
// wider than the column can pan independently instead of bleeding into the
// margin, the same reasoning that gives every display its own scroll box.
// Cached per paragraph object, since segmentsOf reruns on every reflow.
export const figureParaCache = new WeakMap<Paragraph, boolean>();
export function isFigureParagraph(para: Paragraph): boolean {
    let v = figureParaCache.get(para);
    if (v !== undefined) return v;
    let hasPicture = false, hasGlyph = false;
    (function walk(ns: TexNode[] | undefined) {
        for (const n of ns || []) {
            if (n.type === 'picture') hasPicture = true;
            else if (n.type === 'glyph') hasGlyph = true;
            walk(n.children); walk(n.pre); walk(n.post); walk(n.replace);
            if (n.leader) walk([n.leader]);
        }
    })(para.nodes);
    // No running text, only boxes – a table, a framed box, a picture: it is
    // one unbreakable piece, which scrolls when it is wider than the column.
    // (Glyphs inside the boxes are theirs, not running text; a tabular's box
    // stands between two math nodes, markers of the $...$ LaTeX builds it in.)
    const top = para.nodes || [];
    const boxOnly = !top.some(n => n.type === 'glyph' || n.type === 'disc')
        && top.some(n => (n.type === 'hlist' || n.type === 'vlist') && (n.width || 0) > 0 && (n.children || []).length);
    v = (hasPicture && !hasGlyph) || boxOnly;
    figureParaCache.set(para, v);
    return v;
}

export function segmentsOf(doc: Doc): Segments {
    const segs: Segments = [];
    const pendingAnchors: number[] = [];
    const own = (seg: Segment, ids: number[]) => { if (ids.length) (seg.anchors ||= []).push(...ids); };
    // `vsp` is the vspace item behind `gap`, kept on what follows it for tools
    // that show what the space is made of (api.inspect); layout reads only gap.
    let text: TextSegment | null = null, gap = 0, vsp: ContentItem | null = null;
    for (const item of contentStream(doc)) {
        if (item.kind === 'vspace') { gap = (item.amount || 0) * SP_TO_PX; vsp = item; continue; }
        if (item.kind === 'anchorpoint') {
            // A label that stood between two items – nearly always straight
            // after a sectioning command, which is why it is in vertical mode
            // at all. Attach it to the item it *followed*, so jumping to it
            // lands on the heading rather than below it.
            //
            // Deliberately does not close the open text run or consume `gap`:
            // segmentation must depend only on what is typeset, or adding a
            // label would split a merged paragraph run and change its leading.
            const owner = segs[segs.length - 1];
            if (owner) (owner.anchors ||= []).push(item.anchor!);
            else pendingAnchors.push(item.anchor!);
            continue;
        }
        if (item.kind === 'stream') {
            // A separately typeset stream embedded here (what the companion
            // package's \begin{webstream} wraps). Its own segment: the
            // content is laid out as a nested block inside the segment's box,
            // at whatever width the page gives that box (see
            // layoutStreamSegment). Like a display it never merges with the
            // prose around it, and its anchors are the nested layout's concern.
            const stream = doc.streams && doc.streams[item.stream! - 1];
            if (stream) {
                segs.push({ kind: 'stream', stream, index: item.stream!, gapBefore: gap, vspace: vsp });
                text = null; gap = 0; vsp = null;
            }
            continue;
        }
        if (item.kind === 'display') {
            // Consecutive alignment rows are the rows of one align/gather, and
            // must be laid out together: they share a single offset so their
            // & alignment survives, and they pan as one unit rather than each
            // row scrolling separately. A \[..\] display is always its own
            // segment.
            const box = item.box!;
            const isAlign = box.subtype === HL_ALIGNMENT;
            const last    = segs[segs.length - 1];
            if (isAlign && last && last.kind === 'display' && last.isAlign) {
                last.rows.push({ item, gap, vspace: vsp });
            } else {
                segs.push({ kind: 'display', isAlign, rows: [{ item, gap: 0 }], gapBefore: gap, vspace: vsp });
            }
            own(segs[segs.length - 1], anchorIdsOf(box, box.children));
            text = null; gap = 0; vsp = null;
            continue;
        }
        const para = doc.paragraphs[item.para! - 1];
        if (!para) continue;
        if (isFigureParagraph(para)) {
            // Never merges with neighbouring prose (own(...) + closing the run
            // below), for the same reason a display never does: it needs its own
            // scroll box, and a shared one would let an oversized figure drag
            // perfectly-fitting text out of view with it.
            const fig: TextSegment = { kind: 'text', isFigure: true,
                          items: [{ index: item.para!, para, prevDepth: item.prev_depth }], gapBefore: gap, vspace: vsp };
            segs.push(fig);
            own(fig, anchorIdsOf(para, para.nodes));
            text = null; gap = 0; vsp = null;
            continue;
        }
        // Consecutive paragraphs normally merge into one text segment and stack
        // with TeX's interline glue. An explicit vspace before this paragraph (from
        // \vspace, or a section heading's before/after skip) breaks that merge:
        // the paragraph starts a new segment whose gapBefore reproduces exactly
        // the space TeX asked for (segment boxes stack baseline-to-baseline).
        if (!text || gap) { text = { kind: 'text', items: [], gapBefore: gap, vspace: vsp }; segs.push(text); vsp = null; }
        text.items.push({ index: item.para!, para, vspace: vsp, prevDepth: item.prev_depth });   // a gap of 0 within the run
        own(text, anchorIdsOf(para, para.nodes));
        gap = 0; vsp = null;
    }
    // A label before anything was typeset has nothing to trail, so it leads.
    if (pendingAnchors.length && segs.length) own(segs[0], pendingAnchors);
    // Space after the last item. The main flow has none worth keeping, but a
    // stream can end with its environment's closing skip (a proof's \topsep
    // inside an accordion pane), which must still separate it from what
    // follows the stream – so layoutDocument ends with a spacer this high.
    segs.trailingGap = gap;
    return segs;
}

// Lay a text segment out: KP-break each paragraph at the reader's width and
// stack the lines with TeX's interline glue.
// A paragraph's nodes at a measure. Boxes the pipeline found set to the
// measure carry *_rate fields (display_model.attach_paragraph_rates); they are
// evaluated like a display's tree, but never narrower than their floors allow –
// a table's column gaps closed, its natural width – and a paragraph without
// rates is returned as it is. The evaluation is kept for the last width asked.
export const paraEval = new WeakMap<Paragraph, { rated: boolean; floorSp?: number; deltaSp?: number; nodes?: TexNode[] }>();
export function nodesHaveRates(ns: TexNode[] | undefined): boolean {
    for (const n of ns || []) {
        for (const k in n) if (k.endsWith('_rate')) return true;
        if (nodesHaveRates(n.children) || nodesHaveRates(n.pre) || nodesHaveRates(n.post)
            || nodesHaveRates(n.replace) || (n.leader && nodesHaveRates([n.leader]))) return true;
    }
    return false;
}
export function paragraphFloorWidth(n: TexNode, sourceWidthSp: number): number {
    let minimum = 0;
    for (const field of ['width', 'kern', 'surround'] as const) {
        const rate = n[`${field}_rate` as const];
        if (n[`${field}_floor` as const] && rate! > 0) minimum = Math.max(minimum, sourceWidthSp - (n[field] || 0) / rate!);
    }
    if (n.glue_set_floor && n.glue_set_rate! > 0)
        minimum = Math.max(minimum, sourceWidthSp - (n.glue_set || 0) / n.glue_set_rate!);
    for (const key of AFFINE_CHILD_LISTS)
        for (const c of n[key] || []) minimum = Math.max(minimum, paragraphFloorWidth(c, sourceWidthSp));
    if (n.leader) minimum = Math.max(minimum, paragraphFloorWidth(n.leader, sourceWidthSp));
    return Math.min(minimum, sourceWidthSp);
}
export function paragraphAtWidth(para: Paragraph, widthSp: number, sourceWidthSp: number): TexNode[] {
    if (!(sourceWidthSp > 0)) return para.nodes;
    let memo = paraEval.get(para);
    if (!memo) { memo = { rated: nodesHaveRates(para.nodes) }; paraEval.set(para, memo); }
    if (!memo.rated) return para.nodes;
    // (a box only to hold them: it has no dimensions of its own)
    const box = { type: 'hlist', children: para.nodes } as BoxNode;
    if (memo.floorSp === undefined) memo.floorSp = paragraphFloorWidth(box, sourceWidthSp);
    const deltaSp = Math.max(widthSp, memo.floorSp) - sourceWidthSp;
    if (memo.deltaSp !== deltaSp) { memo.deltaSp = deltaSp; memo.nodes = affineDisplayNode(box, deltaSp).children || para.nodes; }
    return memo.nodes!;
}

// The space of a line's \vadjust material (px): TeX takes it out of the line
// it is in, wherever the line breaks fall, and sets it above the line (pre)
// or below it, besides the interline glue, which it leaves to the depths.
export function lineAdjust(nodes: TexNode[]): LineAdjust {
    let above = 0, below = 0;
    for (const n of nodes) {
        if (n.type !== 'adjust') continue;
        if (n.subtype === 1) above += (n.height || 0) * SP_TO_PX;
        else below += (n.height || 0) * SP_TO_PX;
    }
    return { above, below };
}

// Where a paragraph's line is set at the reader's width: its indent and the
// measure it is broken to (sp). A list item's indent is a fixed measure
// (\leftmargin), so it stays put and the text column narrows around it – the
// item's label hangs a fixed distance to the left of it, and at x0=0 would
// sit at negative x and be clipped away. A paragraph's measure can be
// narrower than the column on the right too: a quote environment sets \hsize
// = \textwidth - 2\leftmargin, and a wrapped figure takes the right or left
// of the lines beside it. That margin is what remains of the source width,
// as fixed a measure as the left one, so it narrows the column the same way.
// (At the source width, keeping only the left indent set a 295pt quote at
// 320pt: a line TeX had to shrink came out at its natural width, 22pt wider
// than in the PDF.) This is the one rule for widths other than TeX's: each
// line keeps its distances from both edges of the column, so a wrapped
// figure keeps its size and the number of lines beside it.
export function lineBandAtWidth(band: LineBand, widthSp: number, sourceWidthSp: number): { indentSp: number; rightSp: number; availSp: number } {
    const indentSp = band.indent || 0;
    const rightSp = (sourceWidthSp > 0 && band.width! > 0) ? Math.max(0, sourceWidthSp - indentSp - band.width!) : 0;
    return { indentSp, rightSp, availSp: widthSp - indentSp - rightSp };
}

export function layoutTextSegment(fontInfo: FontTable, seg: TextSegment, widthPt: number, p: Params, cache: LayoutCache): SegmentGeometry {
    const widthSp  = Math.round(widthPt * 65536);
    const columnPx = widthPt * ZOOM;
    const lines: Line[] = [], lrp: LinePlacement[] = [], meta: LineMeta[] = [], adjust: LineAdjust[] = [];
    let adjusted = false;
    const itemStarts: number[] = [];            // the first line of each item (paragraph)
    // Right edge of the widest line's ink, tracked alongside the loop below.
    // columnPx-only would be wrong for a figure segment (see isFigureParagraph):
    // its one line is an unbreakable, unshrinkable box that is exactly as wide
    // as the source picture, so an oversized one is genuinely wider than the
    // column rather than merely mis-measured. Harmless for ordinary text, whose
    // segment W is never read (only isFigure's mount logic consults it).
    let maxRightPx = columnPx;

    for (const { index, para, prevDepth } of seg.items) {
        itemStarts.push(lines.length);
        // A paragraph holding a box set to the measure (a tabular*, a figure
        // scaled to \linewidth) carries rates: its nodes follow this width.
        // A paragraph TeX justified, set as the block asks (data-align): centred
        // or flush right as LaTeX's \centering and \raggedleft set it, with a
        // rigid \parfillskip (blockRigidParFill).
        const atWidth = paragraphAtWidth(para, widthSp, cache.sourceWidthSp!);
        const nodes = blockRigidParFill(para, p.align) ? rigidParFill(atWidth) : atWidth;
        let bcs = nodes === para.nodes ? cache.bcs!.get(index) : null;
        if (!bcs) {
            bcs = buildBreakCandidates(nodes, fontInfo, para);
            if (nodes === para.nodes) cache.bcs!.set(index, bcs);
        }

        // TeX interline parameters for this paragraph, for the LaTeX rule
        const lineMeta = paragraphLeading(para);
        // and for its first line the \prevdepth TeX set the glue above from
        let thisMeta: LineMeta = prevDepth != null
            ? { ...lineMeta, prevDepth: prevDepth <= IGNORE_DEPTH_SP ? -Infinity : prevDepth * SP_TO_PX }
            : lineMeta;

        // Each line's band at this width (lineBandAtWidth): one for every
        // line, or one per line of a shaped paragraph, the last for every
        // line after.
        const bands = (para.shape && para.shape.length > 1 ? para.shape : [para])
            .map(b => lineBandAtWidth(b, widthSp, cache.sourceWidthSp!));
        // A figure paragraph (a picture, a table, a framed box – no running
        // text) is broken against the column like any other, as TeX breaks it:
        // a box wider than the column cannot fit, so TeX's final pass sets it
        // on an overfull line of its own, after an empty first line (a list
        // item's label, centre's), with \lineskip between the two. The line
        // is then wider than the column, and the segment scrolls whole.
        const measure = bands.map(b => Math.max(1, b.availSp));

        // Pluggable breaker. A page may install an alternative paragraph
        // breaker as window.reflowtexBreak(nodes, availSp, params, helpers)
        // – e.g. a TeX engine's own line-breaking code compiled to WebAssembly.
        // It returns the same line objects kpBreak does ([{nodes, ratio,
        // fitness, leftProtrusion}]; kpBreak's also carry rightProtrusion,
        // where a TeX engine returns the right margin kern as a node), or
        // null to decline (module still
        // loading, unsupported paragraph), in which case the built-in
        // Knuth–Plass runs. Everything below is agnostic to which breaker ran.
        // A line flagged `exact: true` carries a TeX-exact glue ratio whose
        // stretch pool holds no glyph expandability, so the viewer's own
        // expansion is not applied on top of it; a line carrying `expand` (a
        // fraction: 0.012 = glyphs 1.2 % wider) was expanded by the breaker
        // itself, exactly that much. The helpers also hand over what TeX had
        // for microtypography – each font's protrusion/expansion codes and
        // the paragraph's \adjustspacing/\protrudechars – so an engine can
        // apply them as TeX did.
        // TeX's breaking parameters, the paragraph's own where it had them
        // (\sloppy: every bibliography)
        // Alignment is per paragraph: TeX's \centering/\raggedright/\raggedleft
        // set the paragraph's \leftskip/\rightskip, which the serializer
        // records, and every line is set between them (paragraphParams). A
        // paragraph with none (the common case) is set as the block's
        // alignment asks (p.align, from --latex-align).
        const pp = paragraphParams(p, skipsAtWidth(para, widthSp - (cache.sourceWidthSp || widthSp)));
        // (a shaped paragraph is the built-in breaker's: the hook takes one measure)
        const ext = typeof window !== 'undefined' && typeof window.reflowtexBreak === 'function' && bands.length === 1
            ? window.reflowtexBreak(nodes, measure[0], pp, {
                  gW, gH, gD, align: alignOf(pp),
                  bskip: para.baselineskip || 0,
                  lskip: para.lineskip || 0,
                  font: fid => fontInfo[String(fid)] || null,
                  adjustSpacing: para.adjust_spacing || 0,
                  protrudeChars: para.protrude_chars || 0,
              })
            : null;
        const broken = ext || kpBreak(bcs, nodes, bands.length === 1 ? measure[0] : measure, pp);
        const L = pp.leftSkip, R = pp.rightSkip;
        for (let k = 0; k < broken.length; k++) {
            const ln = broken[k], band = bands[Math.min(k, bands.length - 1)];
            const availSp = measure[Math.min(k, measure.length - 1)];
            const indentPx = band.indentSp * SP_TO_PX;
            ln.nodes = mergeWidgetRuns(ln.nodes);
            const ratio = ln.ratio;
            const er    = ln.expand !== undefined ? ln.expand
                        : (p.useExpansion && !ln.exact) ? ratio * p.maxExpand : 0;
            const protX = -(p.useProtrusion ? ln.leftProtrusion * SP_TO_PX : 0);
            // The line's width as it is drawn: its glyphs widened or narrowed
            // by the line's expansion. A centred line its fonts shrank by a
            // whole step overshoots, and TeX gives the surplus to the fills on
            // both sides: it is still a line that fits, centred.
            const natSp = sumWidthSp(ln.nodes) + (er ? Math.round(er * sumExpandableSp(fontInfo, ln.nodes)) : 0);
            const natPx = natSp * SP_TO_PX;
            // TeX sets the line between the margin skips, \leftskip and
            // \rightskip, packed to the measure, with its margin kerns in it:
            // what protrudes is not part of the width the line must fit in.
            // (A breaker that returns the right margin kern as a node has it
            // in natSp already; the built-in one reports it as
            // rightProtrusion.) The slack goes to the glue of the highest
            // order that stretches – the line's own and the skips' – so a
            // fill in the line shares it with skips of its order (LaTeX's \and,
            // plus .17fil, between centred author blocks), and gets all of it
            // over skips of a lower order (\hfill in a ragged line); a line with
            // no infinite glue is set by the breaker's ratio, which counts the
            // skips' finite stretch and shrink. Where the line starts is the
            // \leftskip's share; its first character then hangs out of that
            // place by its protrusion. A line too wide to shrink to the
            // measure starts at the margin, as TeX sets it.
            const leftKernSp  = p.useProtrusion ? (ln.leftProtrusion || 0) : 0;
            const rightKernSp = p.useProtrusion ? (ln.rightProtrusion || 0) : 0;
            const slackSp = availSp - (natSp - leftKernSp - rightKernSp);
            const sums = stretchByOrder(ln.nodes).map((t, o) => t + stretchAt(L, o) + stretchAt(R, o));
            let order = sums.length - 1;
            while (order > 0 && !sums[order]) order--;
            let x0 = protX, fillRatio = 0, fillOrder = 0;
            if (slackSp > 0 && order > 0) {
                const total = sums[order];
                if (total > 0) { fillRatio = slackSp / total; fillOrder = order; x0 += fillRatio * stretchAt(L, order) * SP_TO_PX; }
            } else if (ratio > 0) x0 += ratio * stretchAt(L, 0) * SP_TO_PX;
            else if (ratio < 0) x0 += ratio * (L?.shrink || 0) * SP_TO_PX;
            maxRightPx = Math.max(maxRightPx, x0 + indentPx + natPx);
            lines.push(ln);
            lrp.push({ ratio, er, x0: x0 + indentPx, fillRatio, fillOrder });
            meta.push(thisMeta);
            thisMeta = lineMeta;
            const adj = lineAdjust(ln.nodes);
            adjust.push(adj);
            if (adj.above || adj.below) adjusted = true;
        }
    }
    return { lines, lrp, meta, itemStarts, W: Math.ceil(maxRightPx),
             adjust: adjusted ? adjust : undefined,
             preDisplaySizeSp: preDisplaySizeSp(fontInfo, lines, lrp) };
}
