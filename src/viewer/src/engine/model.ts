// SPDX-License-Identifier: AGPL-3.0-or-later
// The decoded document – src/schema/latex.proto as runtime/decode.ts gives
// it: protobuf.js objects with an unset scalar absent (proto2 presence),
// repeated fields as arrays, enums as their lowercase names – and what the
// viewer adds to it: the nodes it makes itself (a word of live text, a
// widget's pieces) and the fields it hangs on the decoded ones. Types only:
// nothing here is emitted into the bundle.

import type { InlineEnv, Instance, KindDef } from '../host/types.ts';
import type { FontKind } from '../../../shared/font-face.ts';
import type { Warning } from '../../../shared/log.ts';

// ── Nodes ──────────────────────────────────────────────────────────────────

/** A field that varies with the measure: its value at the document's width,
 *  its change per scaled point of measure (`*_rate`), and whether it stays
 *  non-negative (`*_floor`). See ContentItem's display_model in latex.proto. */
export type AffineField =
    | 'width' | 'height' | 'depth' | 'stretch' | 'shrink' | 'kern' | 'shift'
    | 'glue_set' | 'surround' | 'm_a' | 'm_b' | 'm_c' | 'm_d';
/** The lists a node holds other nodes in. */
export type ChildList = 'children' | 'pre' | 'post' | 'replace';

type Rates = { [F in AffineField as `${F}_rate`]?: number };
type Floors = { [F in 'width' | 'kern' | 'surround' | 'glue_set' as `${F}_floor`]?: boolean };

/** Every field a node may carry, all of them optional: read through the
 *  TexNode union, a field is there only on the types that have it. The
 *  member types below make required what a node of their type always has. */
export interface NodeFields extends Rates, Floors {
    type: TexNode['type'];
    char?: number;
    font?: number;
    width?: number;
    height?: number;
    depth?: number;
    stretch?: number;
    shrink?: number;
    /** 0 when absent (the encoder omits a 0), as are the next five. */
    stretch_order?: number;
    shrink_order?: number;
    subtype?: number;
    shift?: number;
    glue_sign?: number;
    glue_order?: number;
    glue_set?: number;
    kern?: number;
    penalty?: number;
    surround?: number;
    children?: TexNode[];
    pre?: TexNode[];
    post?: TexNode[];
    replace?: TexNode[];
    /** Leader glue: the box TeX tiles across the glue's set width. */
    leader?: TexNode;
    /** A CSS hex colour; absent: the text colour. */
    color?: string;
    /** 1-based indices into the document's tables. */
    picture?: number;
    metrics?: number;
    link?: number;
    anchor?: number;
    stream?: number;
    slot?: number;
    aside?: number;
    mark?: number;
    cite?: number;
    citetarget?: number;
    m_a?: number;
    m_b?: number;
    m_c?: number;
    m_d?: number;
    /** A formula as MathML, on the math node that opens it. */
    mathml?: string;
    /** A box's text, read instead of its glyphs' (a virtual font's é, drawn
     *  as an accent and an e). */
    actual_text?: string;

    // What the viewer adds.
    /** A picture's payload, hung on its node once per block (runtime/init). */
    pic?: Picture;
    /** A node evaluated at a measure: the compiled node it came from
     *  (non-enumerable; layout/display). */
    affineSource?: TexNode;
    /** A word of live text (host/slots): its text, instead of a character. */
    text?: string;
    /** Leader glue: the copies of its box drawn last (engine/render). */
    _leaderCopies?: TexNode[];
    // A widget's pieces (WidgetNode, WidgetDiscNode), read through the union.
    part?: WidgetPart;
    inline?: WidgetInline;
    fontPx?: number;
    version?: number;
    run?: WidgetRun;
    role?: 'capL' | 'capR' | 'seg' | 'gap' | 'cutL' | 'cutR';
    seg?: number;
    options?: { penalty: number; pre: TexNode[]; post: TexNode[] }[];
}

export interface GlyphNode extends NodeFields {
    type: 'glyph';
    font: number;
}
export interface GlueNode extends NodeFields {
    type: 'glue';
    width: number;
    stretch: number;
    shrink: number;
}
export interface KernNode extends NodeFields {
    type: 'kern';
    kern: number;
}
export interface RuleNode extends NodeFields {
    type: 'rule';
    width: number;
    height: number;
    depth: number;
}
export interface BoxNode extends NodeFields {
    type: 'hlist' | 'vlist';
    width: number;
    height: number;
    depth: number;
    children: TexNode[];
}
export interface DiscNode extends NodeFields {
    type: 'disc';
    pre: TexNode[];
    post: TexNode[];
    replace: TexNode[];
}
export interface PenaltyNode extends NodeFields {
    type: 'penalty';
    penalty: number;
}
export interface MathNode extends NodeFields {
    type: 'math';
    surround: number;
}
export interface PictureNode extends NodeFields {
    type: 'picture';
    width: number;
    height: number;
    depth: number;
}
/** \rotatebox and friends: the matrix [m_a m_b m_c m_d] applied to its
 *  children, about the current point. */
export interface TransformNode extends NodeFields {
    type: 'transform';
    children: TexNode[];
}
/** A node kind a serializer's raw output may still hold (a test harness
 *  feeding output.json to the layout); the encoder never writes one. */
export interface LocalParNode extends NodeFields {
    type: 'local_par';
}

// The viewer's own kinds: a widget (\webwidget, host/widgets) drawn by the
// page, as a box in the line.

/** Which part of a widget a node draws (types.ts, Piece). */
export type WidgetPart =
    | 'whole'
    | { split: number; piece: 'first' | 'second' }
    | { from: number; to: number; left: 'cap' | 'cut'; right: 'cap' | 'cut' };
/** The widget instance a node draws, its kind, and what it is drawn with. */
export interface WidgetInline { instance: Instance; def: KindDef; env: InlineEnv }
/** A segments widget's run: what its pieces share. */
export interface WidgetRun {
    slot: number;
    inline: WidgetInline;
    fontPx: number;
    color: string | undefined;
    version: number;
    /** A line's pieces merged into one part, by shape (mergeWidgetRuns). */
    merged: Map<string, WidgetNode>;
    height: number;
    depth: number;
}
export interface WidgetNode extends NodeFields {
    type: 'widget';
    width: number;
    height: number;
    depth: number;
    // A part to draw (part, inline, fontPx, version), or one piece of a
    // segments widget before its line is merged (run, role, seg).
}
/** A widget that may be split: a discretionary with a pre/post pair per way
 *  to split it, over the one unbroken widget. */
export interface WidgetDiscNode extends NodeFields {
    type: 'wdisc';
    slot: number;
    replace: TexNode[];
    options: { penalty: number; pre: TexNode[]; post: TexNode[] }[];
}

export type TexNode =
    | GlyphNode | GlueNode | KernNode | RuleNode | BoxNode | DiscNode | PenaltyNode
    | MathNode | PictureNode | TransformNode | LocalParNode | WidgetNode | WidgetDiscNode;
export type NodeType = TexNode['type'];

// ── The document ───────────────────────────────────────────────────────────

/** A drawing's markup, and its viewBox's size (bp), as the pipeline writes it. */
export interface Picture { svg: string; vb_w: number; vb_h: number }
export interface GlyphMetrics { width: number; height: number; depth: number }

/** One character's protrusion and expansion codes (thousandths). */
export interface CharCodes { char?: number; lp?: number; rp?: number; ef?: number }

/** A font as the document records it (FontInfo in latex.proto). Its face is
 *  kind, filename and reason (src/shared/font-face.ts, faceFromWire). */
export interface DocFont {
    id?: number;
    name?: string;
    size_sp: number;
    kind?: FontKind;
    filename?: string;
    reason?: string;
    quad?: number;
    expand_stretch?: number;
    expand_shrink?: number;
    expand_step?: number;
    codes?: CharCodes[];
}

export interface Paragraph {
    nodes: TexNode[];
    indent?: number;
    baselineskip?: number;
    lineskip?: number;
    lineskiplimit?: number;
    align?: string;
    adjust_spacing?: number;
    protrude_chars?: number;
    width?: number;
    pretolerance?: number;
    tolerance?: number;
    emergency_stretch?: number;
    line_penalty?: number;
    adj_demerits?: number;
    double_hyphen_demerits?: number;
    final_hyphen_demerits?: number;
}

type DisplayRates = { [F in 'display_width' | 'display_indent' | 'display_shift' as `${F}_rate`]?: number };

export interface ContentItem extends DisplayRates {
    kind: 'paragraph' | 'display' | 'vspace' | 'anchorpoint' | 'stream';
    para?: number;
    box?: TexNode;
    amount?: number;
    glue?: TexNode[];
    display_width?: number;
    display_indent?: number;
    display_shift?: number;
    display_shift_floor?: boolean;
    display_pre_size?: number;
    display_above?: number;
    display_above_short?: number;
    display_below?: number;
    display_below_short?: number;
    display_used_above?: number;
    display_used_below?: number;
    display_after_line?: boolean;
    display_quad?: number;
    display_interline_above?: number;
    display_interline_below?: number;
    prev_depth?: number;
    display_baselineskip?: number;
    display_lineskip?: number;
    display_lineskiplimit?: number;
    display_after_min?: number;
    display_wide?: ContentItem;
    display_wide_from?: number;
    display_wide_width?: number;
    anchor?: number;
    stream?: number;
    mathml?: string;
}

export interface StreamAttr { key?: string; value?: string }
export interface Stream {
    kind?: string;
    content: ContentItem[];
    attrs: StreamAttr[];
    text?: string;
}
export interface Slot {
    name?: string;
    space?: number;
    stretch?: number;
    shrink?: number;
    kind?: string;
    attrs: StreamAttr[];
}
export interface Mark { id?: string; classes?: string }
export interface Link { label?: string; url?: string; action?: string }
export interface OutlineEntry {
    kind?: string;
    env?: string;
    level?: number;
    number?: string;
    title?: string;
    anchor?: number;
}

/** A paragraph holding a \webtext slot: its list as compiled, and what the
 *  viewer made of it (host/slots). */
export interface SlotParagraph {
    index: number;
    para: Paragraph;
    orig: TexNode[];
    made: TexNode[];
    /** What was substituted, as a key: unchanged, nothing is laid out again. */
    key?: string;
    /** The nodes replaced by the last change, whose drawings go. */
    stale?: TexNode[] | null;
}
/** A display whose box holds a \webtext slot: its box as compiled, and what
 *  the viewer made of it (host/slots). `item` is the display, or its wider
 *  form (display_wide), of `owner`, the item in the content stream. */
export interface SlotDisplay {
    owner: ContentItem;
    item: ContentItem;
    orig: TexNode;
    made: TexNode[];
    key?: string;
    stale?: TexNode[] | null;
}

export interface Doc {
    fonts: DocFont[];
    paragraphs: Paragraph[];
    content: ContentItem[];
    pictures: Picture[];
    glyph_metrics: GlyphMetrics[];
    source_width?: number;
    display_model?: boolean;
    anchors: string[];
    links: Link[];
    streams: Stream[];
    outline: OutlineEntry[];
    slots: Slot[];
    marks: Mark[];
    /** What the build found about the block (src/shared/log.ts); a map
     *  with no entries decodes as absent. */
    warnings?: (Omit<Warning, 'details'> & { details?: Warning['details'] })[];
    /** The viewer's (host/slots). */
    slotParas?: SlotParagraph[];
    slotDisplays?: SlotDisplay[];
}

// ── Fonts, as the viewer holds them ────────────────────────────────────────

/** \expandglyphsinfont's three arguments (thousandths). */
export interface Expansion { stretch: number; shrink: number; step: number }

/** How the viewer draws a font's glyphs: as text, in the CSS family its face
 *  is registered under, or – a font with no face – as boxes of the size TeX
 *  gave each glyph (`reason`: why it has none). */
export type ViewerFace =
    | { kind: 'text'; family: string }
    | { kind: 'boxes'; reason: string };

/** A block's font, by its id in the document (runtime/fonts.registerFonts). */
export interface ViewerFont {
    face: ViewerFace;
    size_px: number;
    quad: number;
    expand: Expansion | null;
    codes: Map<number | undefined, CharCodes>;
}
/** A block's fonts, by their id as a string. */
export type FontTable = Record<string, ViewerFont>;
