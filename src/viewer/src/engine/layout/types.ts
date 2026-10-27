// SPDX-License-Identifier: AGPL-3.0-or-later
// What a layout is made of: the segments a block's content is split into
// (text.ts, segmentsOf), the lines each is laid out into, the per-segment
// elements, and the cache a layout keeps between reflows (document.ts).
// Types only.

import type { BreakCandidates } from '../breaker.ts';
import type { GapKinds } from './display.ts';
import type {
    ContentItem, FontTable, GlyphMetrics, Link, Mark, Paragraph, Stream, TexNode,
} from '../model.ts';
import type { Params } from '../../runtime/params.ts';

// ── Segments ───────────────────────────────────────────────────────────────

/** A paragraph of a text segment, by its 1-based index in the document. */
/** A paragraph of a text segment; prevDepth is its item's prev_depth (sp). */
export interface TextItem { index: number; para: Paragraph; vspace?: ContentItem | null; prevDepth?: number }
/** A row of a display segment, and the space above it (px). */
export interface DisplayRow { item: ContentItem; gap: number; vspace?: ContentItem | null }

interface SegmentCommon {
    /** The space above it (px), from the vspace item before it. */
    gapBefore: number;
    /** That item, for tools that show what the space is made of. */
    vspace: ContentItem | null;
    /** The labels it owns (1-based indices into Document.anchors). */
    anchors?: number[];
}
export interface TextSegment extends SegmentCommon {
    kind: 'text';
    items: TextItem[];
    /** One unbreakable box, no running text: it scrolls when too wide. */
    isFigure?: boolean;
}
export interface DisplaySegment extends SegmentCommon {
    kind: 'display';
    isAlign: boolean;
    rows: DisplayRow[];
}
export interface StreamSegment extends SegmentCommon {
    kind: 'stream';
    stream: Stream;
    /** Its 1-based index in Document.streams. */
    index: number;
}
export type Segment = TextSegment | DisplaySegment | StreamSegment;
/** A content stream's segments, and the space after the last (px). */
export type Segments = Segment[] & { trailingGap?: number };

// ── Lines ──────────────────────────────────────────────────────────────────

/** A line as a breaker returns it (the built-in one, or a page's
 *  window.reflowtexBreak): its nodes, its glue ratio, and what protrudes
 *  (sp). A display is one line holding its box. */
export interface Line {
    nodes: TexNode[];
    ratio: number;
    fitness: number;
    leftProtrusion: number;
    rightProtrusion?: number;
    /** The breaker's own expansion (a fraction: 0.012 = 1.2 % wider). */
    expand?: number;
    /** A TeX-exact ratio, whose stretch holds no glyph expandability: the
     *  viewer's expansion is not applied on top. */
    exact?: boolean;
}
/** How a line is set: its glue ratio, expansion, left edge (px) and the
 *  ratio of its infinite fill, if it has one with room to spare. */
export interface LinePlacement { ratio: number; er: number; x0: number; fillRatio?: number; fillOrder?: number }
/** TeX's interline parameters, in px; on a paragraph's first line, the depth
 *  TeX set the glue above it from where that is not the line above's
 *  (prevDepth; -Infinity: no glue, TeX's \prevdepth of -1000pt). */
export interface LineMeta { bskip: number; lskip: number; lskiplimit: number; prevDepth?: number }
/** The space a line's \vadjust material takes (px): above the line (\vadjust
 *  pre) and below it. */
export interface LineAdjust { above: number; below: number }
/** A glyph's or box's extent on a line (px), for collision leading. */
export interface InkItem { x1: number; x2: number; h: number; d: number }
/** TeX's \predisplaysize from a line (sp) and the quad of its font. */
export interface PreDisplaySize { w: number; quad: number }

/** What laying out a text or display segment gives (text.ts, display.ts),
 *  before the lines are stacked (document.ts). */
export interface SegmentGeometry {
    lines: Line[];
    lrp: LinePlacement[];
    meta?: (LineMeta | null)[];
    gaps?: number[];
    /** Each line's \vadjust space, where any line of a text segment has one. */
    adjust?: LineAdjust[];
    itemStarts?: number[];
    W: number;
    /** A display's: the width its boxes need (layoutDisplaySegment), which
     *  decides whether it overflows; W, its surface, covers its ink too. */
    fitW?: number;
    preDisplaySizeSp?: PreDisplaySize | null;
    displayLeftSp?: number;
    atSourceWidth?: boolean;
    affine?: DisplayAffine;
}
/** How a display's width model was applied, for api.inspect: the measure
 *  TeX compiled at, the one asked for, the narrowest its gaps allow, and the
 *  one evaluated at (sp); each row's gap kinds and item as evaluated. */
export interface DisplayAffine {
    sourceWidthSp: number; targetSp: number; minWidthSp: number; evaluatedSp: number; floorSp: number;
    kinds: GapKinds[]; items: ContentItem[];
}

/** What laying out one segment gives: its lines and its geometry (px). A
 *  segment whose layout is deferred has no lines yet, only the geometry
 *  its neighbours need (document.ts, the layout cache). */
export interface SegmentLayout {
    seg: Segment;
    lines: Line[];
    lrp?: LinePlacement[];
    meta?: (LineMeta | null)[];
    /** An alignment's own space between its rows (px). */
    gaps?: number[];
    /** Each line's \vadjust space (px), when there is any. */
    adjust?: LineAdjust[];
    /** The first line of each paragraph. */
    itemStarts?: number[];
    profiles?: InkItem[][];
    baselineYs?: number[];
    W: number;
    /** A display's: see SegmentGeometry. */
    fitW?: number;
    H: number;
    firstAscent: number;
    lastDepth: number;
    firstMeta: LineMeta | null;
    gapBefore: number;
    preDisplaySizeSp?: PreDisplaySize | null;
    displayLeftSp?: number;
    atSourceWidth?: boolean;
    affine?: DisplayAffine;
    deferred?: boolean;
    /** Deferred by a quick reflow: its box keeps the old surface. */
    held?: boolean;
    /** Left by a sliced layout for idle time (runtime/slices.ts). */
    pending?: boolean;
    /** Its geometry is estimateGeometry's, not one it was laid out to. */
    estimate?: boolean;
    /** Where a sliced layout reckons its top stands in the window (px). */
    estTop?: number;
    /** A stream box framed at its top or bottom (CSS padding or border). */
    frameTop?: boolean;
    frameBottom?: boolean;
    /** What is left of the grid rounding after its box (document.ts). */
    gridCarry?: number;
    /** A display's choice of skips: the full pair, the short, or as TeX had it. */
    displayFull?: boolean | null;
    alts?: null;
}

// ── The elements, and the cache ────────────────────────────────────────────

/** One line's elements: its rules and pictures, and its <text>. */
export interface LinePair { g: SVGGElement; text: SVGTextElement; attached: boolean }

/** Geometry a segment had at one width (the height cache). */
export interface Observation {
    w: number; H: number; W: number; fitW?: number; firstAscent: number; lastDepth: number; firstMeta: LineMeta | null;
    preDisplaySizeSp?: PreDisplaySize | null; displayLeftSp?: number; atSourceWidth?: boolean;
}
/** A segment's layouts by width, for one set of parameters. */
export interface HeightCache { key: string; exact: Map<number, SegmentLayout>; obs: Observation[] }

/** A segment's elements: a spacer (the space above), its box, and in it the
 *  <svg> (or its scroll box), or a stream's nested layout. */
export interface DomSegment {
    svg: SVGSVGElement | null;
    box: HTMLElement;
    gap: HTMLElement;
    wrap: HTMLElement | null;
    pairs: LinePair[];
    /** A stream's nested layout. */
    sub?: LayoutCache | null;
    /** What is mounted in the box. */
    mount?: Element | null;
    hc?: HeightCache | null;
    painted?: boolean;
    dirty?: boolean;
    intersecting?: boolean;
    observed?: boolean;
    /** The elements its last paint drew. */
    live?: Set<Element>;
    hits?: SVGGElement;
    bands?: SVGGElement;
    selBands?: SVGGElement;
}
export interface LayoutDom {
    root: HTMLElement;
    segs: DomSegment[];
    /** Every element drawn, by the node it draws (kept when undrawn). */
    byNode: Map<TexNode, SVGElement>;
    live: Set<Element>;
    /** The anchor element of each label. */
    anchors: Map<string, HTMLElement>;
    /** The spacer after the last segment. */
    trail?: HTMLElement;
}
export interface PaintStats { created: number; moved: number; repositioned: number; removed: number }
export interface LayoutStats { computed: number; reused: number; deferred: number; materialized: number; pending: number }
/** What a deferred segment needs to be laid out later. */
export interface LayoutContext {
    layoutOne(seg: Segment, i: number): SegmentLayout;
    segs: Segments;
    widthPt: number;
    p: Params;
    columnPx: number;
    paramsKey: string;
}

/** A layout's cache: what a block's layout (or a surface's, or a stream's
 *  nested one) keeps between reflows. Made with a few fields; the first
 *  layoutDocument fills in the rest. `blockEl`, `relayout`, `hosts` and
 *  `anchorSuffix` travel down into nested caches. */
export interface LayoutCache {
    /** Break candidates by paragraph index (shared with nested caches). */
    bcs: Map<number, BreakCandidates> | null;
    dom: LayoutDom | null;
    layout: { laid: SegmentLayout[] } | null;
    stats: PaintStats | null;
    blockEl?: HTMLElement;
    blockKey?: string;
    /** Lay the layout owning this cache out again. */
    relayout?: () => void;
    /** The hosts of the block instances a page draws, by stream index
     *  (host/block-hosts.ts). */
    hosts?: Map<number, unknown>;
    /** A view's suffix for its anchors' ids. */
    anchorSuffix?: string;
    metrics?: GlyphMetrics[];
    sourceWidthSp?: number;
    fontInfo?: FontTable;
    links?: Link[];
    marks?: Mark[];
    slotNames?: (string | undefined)[];
    anchors?: string[];
    streams?: Stream[];
    layoutCtx?: LayoutContext;
    layoutStats?: LayoutStats;
    /** A stream laid out before its box could be measured. */
    streamsUnmeasured?: boolean;
    /** The layout under way is sliced (runtime/slices.ts). */
    sliced?: boolean;
    /** The last layout through layoutBlock was. */
    lastSliced?: boolean;
    /** The geometry the segments had, for a sliced re-render to keep. */
    geomHint?: SegmentLayout[] | null;
}
