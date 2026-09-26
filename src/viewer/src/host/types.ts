// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's host API: what pages and packages (the companion) may use.
// window.reflowtex.host implements `Host`. Everything here is the public
// contract; nothing else in the viewer is. The companion imports these
// types (type-only), so a change here is a change to the package's API.
//
// The model. A block (one [data-nodelist-b64] element) holds *instances*:
// everything the author made with the companion package, and the constructs
// the pipeline itself produces (footnotes, \marginpar). An instance has a
// kind, the author's parameters, a placement (where it stands relative to
// the text) and *parts*: its typeset content, which the viewer lays out
// into any element the page gives it, at any width, as often as it likes.
// Instances nest as their TeX did.

/** Where an instance stands relative to the text. */
export type Placement =
    /** In the flow, between paragraphs (webstream and what is built on it). */
    | 'block'
    /** A box in a line of text, measured by the page (\webwidget). */
    | 'inline'
    /** A run of text in a line the page may replace (\webtext). */
    | 'text'
    /** Out of the flow; shown wherever the page likes (\webaside, footnote,
     *  \marginpar). May have a mark in the text: `anchor()`. */
    | 'detached';

/** How an instance is to look, from parameters that are not the author's
 *  own data: `class=…` and `--name=…`. */
export interface Presentation {
    readonly classes: readonly string[];
    /** CSS custom properties, name (with its leading --) → value. */
    readonly properties: Readonly<Record<string, string>>;
}

export interface Instance {
    /** Stable for the life of the page: the same across relayouts, font
     *  loads and re-renders. Unique on the page. */
    readonly id: string;
    readonly kind: string;
    /** The author's parameters (key=value), as strings. Keys the viewer
     *  interprets itself (class, --…, aside) are not here. */
    readonly attrs: Readonly<Record<string, string>>;
    readonly presentation: Presentation;
    readonly placement: Placement;
    /** The instance's content by role. A stream's own content is `body`; its
     *  text carried verbatim (Lean code) is the data part `text`. */
    readonly parts: ReadonlyMap<string, Part>;
    part(role: string): Part | undefined;
    readonly parent: Instance | null;
    /** The vertical space TeX put before the instance in its parent's text
     *  (the author's skips, \topsep, …), in CSS px; 0 when none, and for any
     *  instance not in a flow. For a component that hides a part and wants
     *  the space that preceded it after what stays. */
    readonly spaceBefore: number;
    /** Nested instances, in document order. */
    readonly children: readonly Instance[];
    readonly block: Block;
    /** Where the instance stood in the text, when that is a point in a line
     *  that is drawn: a zero-size rect on the baseline, in window
     *  coordinates (an inline instance: its first piece's box). Else null
     *  (not drawn yet, not in a line, no mark). */
    anchor(): DOMRect | null;
    /** Handle the reader's actions of one verb (\webaction{verb:arg}{…})
     *  pressed in this instance's text or in any instance inside it. The
     *  innermost instance with a handler for the verb gets it first; a
     *  handler returning false passes it on outward. Returns what removes
     *  the handler. */
    onAction(verb: string, fn: (action: Action) => boolean | void): () => void;
    /** A text instance (\webtext): show `text` instead of the default, set
     *  the way a browser sets text, the paragraph broken again around it;
     *  null brings the default back. Wins over Host.setText for its name. */
    setText(text: string | null): void;
}

/** A colour map: per theme, the colours TeX produced (#rrggbb) → what that
 *  theme shows (any CSS colour); and tints, colours TeX baked by mixing a
 *  base into white → [base, percent], mixed again against the page. */
export interface ColorMap {
    colors?: Record<string, Record<string, string>>;
    tints?: Record<string, [string, number]>;
}

export interface MarkHandle {
    readonly id: string;
    /** Its glyphs' elements, in drawing order. */
    elements(): Element[];
    /** One rect per line it is drawn on, in window coordinates. */
    rects(): DOMRect[];
}

/** A stretch of a block's text, by the positions of its glyphs: every
 *  glyph of the block (footnotes and boxes included) numbered from 0 in
 *  reading order, the same on every load of the same document. */
export interface TextRange {
    /** Block.key. */
    readonly block: string;
    /** The first glyph and the last (inclusive). */
    readonly from: number;
    readonly to: number;
    /** What the glyphs spell, without spaces (a space is glue, not a
     *  glyph). Kept with a saved range: if the document has changed, the
     *  range is found again by it. */
    readonly text: string;
}

export interface LiveMarkOptions {
    /** Default: a new one (rtx-live-N). An id in use replaces that mark. */
    id?: string;
    /** Space-separated, as \webclass's: in the bands' data-mark. */
    classes?: string;
}

/** A mark made while the page is open (host.addMark): a reader's
 *  highlight, say. Drawn as the document's own: a band behind each line
 *  (rect.latex-mark, the classes in data-mark, the id in data-rtx-id),
 *  kept through every reflow; its glyphs carry the id in data-rtx-marks. */
export interface LiveMark extends MarkHandle {
    readonly classes: string;
    /** Where it is, as it was resolved: save these to make it again. */
    readonly ranges: readonly TextRange[];
    /** False once removed (or replaced by a mark of the same id). */
    readonly live: boolean;
    setClasses(classes: string): void;
    remove(): void;
}

/** A \webaction the reader pressed: \webaction{pane:next}{…} is verb
 *  "pane", arg "next". */
export interface Action {
    readonly verb: string;
    readonly arg: string;
    /** As written. */
    readonly action: string;
    /** The instance whose text holds the control (null: the block's own). */
    readonly instance: Instance | null;
    /** The glyph pressed (its element). */
    readonly source: Element;
}

export type Part = TypesetPart | DataPart;

/** Content TeX typeset, which the viewer lays out anew at any width. */
export interface TypesetPart {
    readonly type: 'typeset';
    readonly role: string;
    readonly instance: Instance;
    /** Its width with every paragraph on one line, in CSS px, as TeX would
     *  set an \hbox. Computed once, on first use. */
    naturalWidth(): number;
    /** The vertical space TeX put before it in its owner's text, px (a part
     *  that stood in the flow – a Lean proof after its statement); 0 for
     *  one typeset out of the flow (\webpart). */
    readonly spaceBefore: number;
    /** Lay it out in `el` (replacing el's children) and keep it laid out
     *  until disposed. May be mounted any number of times at once. */
    mount(el: HTMLElement, options?: MountOptions): Surface;
}

/** Text the author wrote that TeX did not typeset (verbatim code). */
export interface DataPart {
    readonly type: 'data';
    readonly role: string;
    readonly instance: Instance;
    readonly data: string;
}

export interface MountOptions {
    /** The measure, in CSS px:
     *  - a number: that width;
     *  - 'natural': the part's natural width (one line per paragraph);
     *  - 'container' (the default): el's content width, followed as it
     *    changes (a ResizeObserver on el). */
    width?: number | 'natural' | 'container';
}

export interface SurfaceMetrics {
    /** Laid-out size, in CSS px. */
    width: number;
    height: number;
    /** The first line's baseline, px down from the surface's top edge
     *  (0 when the part starts with no line of text). */
    firstBaseline: number;
    /** How far the last line reaches below its baseline, px. */
    lastDepth: number;
}

/** A part laid out in an element. The viewer writes only inside that
 *  element, never around it. Painting follows the element's visibility:
 *  hide it (display: none, say) and it is painted once shown again. */
export interface Surface {
    readonly el: HTMLElement;
    readonly part: TypesetPart;
    metrics(): SurfaceMetrics;
    /** Change the measure (see MountOptions.width). */
    setWidth(width: MountOptions['width']): void;
    /** Called after every layout of this surface (a width change, a font
     *  load). Returns an unsubscribe function. */
    onChange(fn: (metrics: SurfaceMetrics) => void): () => void;
    /** Stop laying it out and empty the element. Idempotent. */
    dispose(): void;
}

/** A query: a kind, or an object that `kind`, `placement` and any
 *  parameters must all match. No query matches everything. */
export type InstanceQuery =
    | string
    | ({ kind?: string; placement?: Placement } & Record<string, string | undefined>);

export interface BlockEvents {
    /** After every layout of the block, and whenever more of its lines are
     *  drawn as they near the window: anchors may have moved. */
    layout: () => void;
}

export interface Block {
    readonly el: HTMLElement;
    /** Unique on the page, stable for its life. Instance ids start with it. */
    readonly key: string;
    /** Top-level instances, in document order. */
    readonly roots: readonly Instance[];
    /** Every instance of the block, depth first, matching the query. */
    instances(query?: InstanceQuery): Instance[];
    find(id: string): Instance | undefined;
    on<E extends keyof BlockEvents>(event: E, fn: BlockEvents[E]): () => void;
    /** Take the block off the page's books: everything drawn for its
     *  instances is undone, its observers stop, and its element is emptied.
     *  The element may then be removed, or mounted again. */
    destroy(): void;
}

/** Where the viewer shows a detached instance, for its kind to draw in:
 *  - 'margin': a note beside its line (place=margin, \marginpar); el is the
 *    note, as wide as the margin; the first line of the edge surface
 *    (setEdges; by default a body surface inside) is set on the line of its
 *    mark.
 *  - 'popover': the panel opened from a glyph that refers to it (a
 *    footnote's marker); el is the panel's content, drawn anew each time it
 *    opens and undone when it closes. */
export interface NoteHost {
    readonly type: 'margin' | 'popover';
    readonly el: HTMLElement;
    readonly instance: Instance;
    setEdges(edges: { top?: Surface | null; bottom?: Surface | null }): void;
}

/** How a kind is drawn: the page's code, not the viewer's. One definition
 *  serves every placement of the kind.
 *
 *  - block instances: render(instance, BlockHost) in the element the viewer
 *    places in the flow. Undefined kinds are drawn by default: the stream's
 *    own element (.latex-stream[data-kind], with its data-* parameters,
 *    classes and custom properties) holding the body at its width.
 *  - detached instances the viewer shows – in the margin (place=margin), or
 *    in the popover a glyph opens (a footnote): render(instance, NoteHost).
 *    Default: the body, at the margin's or the popover's width.
 *  - inline instances (\webwidget): measure(instance, env) sizes it and
 *    says where it may break; render(instance, PieceHost) draws each piece
 *    (the whole widget, or its part on one line). Undefined: nothing drawn.
 *
 *  render is called once per host: not again on relayout, resize or font
 *  load. It returns what undoes it, if anything, which is called when the
 *  host goes for good (a piece no line uses any more, the kind redefined).
 *  If it throws, the instance is drawn by default. State belongs to the
 *  instance (instance.id), never to a host: an inline widget has as many
 *  hosts as lines it is broken across. */
export interface KindDef {
    render(instance: Instance, host: AnyHost): void | (() => void);
    measure?(instance: Instance, env: InlineEnv): InlineMetrics;
}

export type AnyHost = BlockHost | NoteHost | PieceHost;

/** An inline instance's surroundings, for measuring and drawing. */
export interface InlineEnv {
    /** The text's font size and colour where the widget stands. */
    readonly fontSize: number;
    readonly color: string | null;
    /** The width, height and depth (px, against the baseline) of some HTML
     *  set at that size: a string, a node, or a function that fills an
     *  element (a component rendered into it). */
    measure(content: string | Node | ((el: HTMLElement) => void)): { width: number; height: number; depth: number };
    /** The content changed: measure again, break the paragraph again. */
    invalidate(): void;
}

export interface Box { width: number; height: number; depth: number }
/** An inline instance's size, px: whole (unbreakable); with splits, each a
 *  way to break it once between two lines (penalty default 100, overhang:
 *  how far a piece reaches past the margin); or as segments with a break
 *  point (gap) between each two and its ends measured closed ('cap') and
 *  cut ('cut'), breakable at any number of its points. */
export type InlineMetrics =
    | (Box & { splits?: { first: Box & { overhang?: number }; second: Box & { overhang?: number }; penalty?: number }[] })
    | { segments: Box[]; gaps?: { width?: number; penalty?: number }[];
        ends?: { left?: { cap?: number; cut?: number; overhang?: number }; right?: { cap?: number; cut?: number; overhang?: number } } };

/** Which part of an inline instance a piece shows. */
export type Piece =
    | 'whole'
    | { split: number; piece: 'first' | 'second' }
    | { from: number; to: number; left: 'cap' | 'cut'; right: 'cap' | 'cut' };

/** One piece of an inline instance, in the line: el is sized to it, its
 *  content on the text's baseline. */
export interface PieceHost {
    readonly type: 'piece';
    readonly el: HTMLElement;
    readonly instance: Instance;
    readonly piece: Piece;
    readonly env: InlineEnv;
}

/** Where a block instance stands in the flow, and what the flow needs to
 *  know about it to space it as TeX would. */
export interface BlockHost {
    readonly type: 'block';
    readonly el: HTMLElement;
    readonly instance: Instance;
    /** A framed edge (a border, padding: the instance draws a box) stops
     *  TeX's interline glue from reaching across it; the author's explicit
     *  space around the environment stays. Default: unframed. */
    setFrame(frame: { top?: boolean; bottom?: boolean }): void;
    /** The surfaces whose first and last lines stand for the instance's
     *  edges in the text: the glue above is computed from `top`'s first
     *  line, below from `bottom`'s last. null: that edge is not a line of
     *  text. Default (never called): a surface of the `body` part mounted
     *  inside el, for both. */
    setEdges(edges: { top?: Surface | null; bottom?: Surface | null }): void;
    /** The space the flow puts above and below el as last laid out, in CSS
     *  px: TeX's gaps and interline glue. Read after a layout (block
     *  'layout' event); 0 where there is no neighbour. */
    spacing(): { before: number; after: number };
}

export interface Host {
    /** Bumped on incompatible changes. */
    readonly version: 1;
    /** Draw every instance of a kind with `def`, from now on and, by
     *  drawing them again, those already drawn. Returns what undefines it
     *  (the kind is then drawn by default again). */
    define(kind: string, def: KindDef): () => void;
    /** The kinds the page defines now, by name. */
    kinds(): string[];
    /** The colour maps in force (the page's #latex-color-maps island, or
     *  what setColorMaps last gave): name → map, as the island's JSON. */
    colorMaps(): Record<string, ColorMap>;
    /** Replace them: every block with data-color-map follows at once (the
     *  colours are CSS custom properties; nothing is laid out again). */
    setColorMaps(maps: Record<string, ColorMap>): void;
    /** Show `text` in every \webtext{name}{…}, in every block (null: the
     *  defaults again). */
    setText(name: string, text: string | null): void;
    /** The text marked \webid{id}{…}, in every block and wherever its parts
     *  are shown. Its glyph elements carry data-rtx-id (and \webclass's
     *  classes, which CSS reaches directly); only lines already drawn have
     *  elements (the viewer draws lines as they near the window). */
    mark(id: string): MarkHandle;
    /** The text a DOM range covers (the reader's selection:
     *  getSelection().getRangeAt(0)), one range per block it reaches; []
     *  when it holds no glyph. A glyph counts when any of its text is in. */
    rangesOf(range: Range): TextRange[];
    /** Mark text from now on (see LiveMark). A range whose `text` no longer
     *  reads the same at its positions is looked for by its text, nearest
     *  its old place, and left out if not found; null when nothing is left.
     *  Every change to live marks sends `reflowtex:marks` on document. */
    addMark(ranges: readonly TextRange[], options?: LiveMarkOptions): LiveMark | null;
    /** The live marks: all of them, those on a glyph element, or those
     *  sharing a glyph with any of the ranges. In the order made. */
    liveMarks(at?: Element | readonly TextRange[]): LiveMark[];
    /** Blocks initialised so far, in page order. */
    blocks(): Block[];
    block(el: Element): Block | undefined;
    /** Every block's instances matching the query. */
    instances(query?: InstanceQuery): Instance[];
    find(id: string): Instance | undefined;
    /** Called for every block, now for those already initialised and later
     *  for each new one. Returns an unsubscribe function. */
    onBlock(fn: (block: Block) => void): () => void;
    /** Render a block element added after the page loaded (a framework's,
     *  say): one carrying data-nodelist-b64, as the integrations write it.
     *  Resolves when it is laid out; a block already rendered resolves at
     *  once. */
    mount(el: HTMLElement): Promise<Block>;
}

declare global {
    interface Window {
        reflowtex?: { host?: Host } & Record<string, unknown>;
    }
    interface DocumentEventMap {
        /** Sent once, on document, when window.reflowtex.host exists. */
        'reflowtex:host': CustomEvent<{ host: Host }>;
        /** Sent on document after live marks change (host.addMark). */
        'reflowtex:marks': CustomEvent<{ marks: LiveMark[] }>;
    }
}
