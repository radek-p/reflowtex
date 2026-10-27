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

// (For the paragraph breaker a page may plug in: the viewer's own node and
// line shapes.)
import type { Doc, TexNode, ViewerFont } from '../engine/model.ts';
import type { Line } from '../engine/layout/types.ts';
import type { Params } from '../runtime/params.ts';
import type { Inspect } from './inspect.ts';
import type { AlertLevel, LogLevel, LogRecord } from '../../../shared/log.ts';
import type { ColorMap } from '../runtime/builtin-colour-maps.ts';
import type { ThemeState } from '../runtime/theme.ts';

export type { AlertLevel, LogLevel, LogRecord };

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
     *  null brings the default back. Wins over Host.setText for its name.
     *  In this view of its block only, unless `mirror` (TextOptions). */
    setText(text: string | null, options?: TextOptions): void;
}

export interface TextOptions {
    /** The same text in this instance of every view of the block
     *  (Block.views), those mounted later too; a text a view is given of its
     *  own afterwards wins there. */
    mirror?: boolean;
}

/** A colour map: per theme, the colours TeX produced (#rrggbb) → what that
 *  theme shows (any CSS colour), and how links look; and tints, colours TeX
 *  baked by mixing a base into white → [base, percent], mixed again against
 *  the page. */
export type { ColorMap, LinkLook } from '../runtime/builtin-colour-maps.ts';
export type { ThemeState } from '../runtime/theme.ts';

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
    /** Block.key: of the view the range is in (each view of a block has a
     *  key of its own; the positions are the same in all of them). */
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
    /** Show the mark in every view of each range's block (Block.views),
     *  those mounted later too, not only in the view the range names.
     *  Default false: a mark is its view's own. */
    mirror?: boolean;
}

/** A mark made while the page is open (host.addMark): a reader's
 *  highlight, say. Drawn as the document's own: a band behind each line
 *  (rect.latex-mark, the classes in data-mark, the id in data-rtx-id),
 *  kept through every reflow; its glyphs carry the id in data-rtx-marks. */
export interface LiveMark extends MarkHandle {
    readonly classes: string;
    /** Where it is, as it was resolved: save these to make it again. */
    readonly ranges: readonly TextRange[];
    /** Made with `mirror`: shown in every view of its blocks. */
    readonly mirror: boolean;
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
    /** A sliced layout (BlockMountOptions.layout) has left work for idle
     *  time: segments to lay out, or near the window to paint. Sent once per
     *  run, however many times the layout starts again (a width changing
     *  under way). */
    layoutstart: () => void;
    /** A slice of that work is done; `left`: the segments still to come. */
    layoutslice: (detail: { left: number }) => void;
    /** Nothing is left: the block is laid out as a synchronous layout would
     *  have left it. Once per layoutstart. */
    layoutcomplete: () => void;
}

export interface Block {
    readonly el: HTMLElement;
    /** Unique on the page, stable for its life. Instance ids start with it. */
    readonly key: string;
    /** Its name among the views of its block (host.mount(el, { of, view })):
     *  as given, else v1, v2, … in the order mounted. */
    readonly view: string;
    /** The scope it resolves its texts in (BlockMountOptions.scope); null:
     *  the page-wide texts only. */
    readonly scope: string | null;
    /** Every view of the same compiled block now on the page, this one
     *  included, in the order mounted; a block shown nowhere else has one. */
    views(): Block[];
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
    /** The same as destroy: this view goes; the block's other views stay. */
    unmount(): void;
    /** Resolves once the block's sliced layout has nothing left
     *  (layoutcomplete), at once when it has nothing under way. */
    layoutDone(): Promise<void>;
    /** Lay out and paint, now, everything a sliced layout has left. */
    flushLayout(): void;
    /** Whether its wide displays (those that scroll sideways in a
     *  .latex-display box) fade where they are cut off: its own setting,
     *  else the host's (Host.displayFade). */
    displayFade(): boolean;
    /** Turn the fade off (false) or on (true) for this block, this view
     *  only; null follows the host again. Off, a wide display shows all
     *  its box holds, still scrolling sideways, with no mask over it. Only
     *  a class changes (latex-no-fade on el): nothing is laid out again,
     *  and every scroll position is kept. */
    setDisplayFade(on: boolean | null): void;
    /** How its wide displays are boxed: its own setting, else the host's
     *  (Host.displayFit). */
    displayFit(): 'natural' | 'column';
    /** 'column': a wide display scrolls in a box the column's width (with
     *  the page's peek into the margins, and the fade). 'natural': its box
     *  widens to the display's natural width, into the room beside the
     *  column – centred on the column as far as the room on each side
     *  allows, up to the padding box of the element the block sits in and
     *  never past the window – and scrolls only when it is wider than that,
     *  with no fade. This block, this view only; null follows the host
     *  again. Only classes and styles change (latex-fit-natural on el, the
     *  room as custom properties): no line is broken or laid out again, and
     *  every glyph of a display stays where it was on screen as far as its
     *  box lets it (scrollLeft follows). */
    setDisplayFit(fit: 'natural' | 'column' | null): void;
    /** Scroll a wide display sideways so that a point of it is in view, for
     *  example to keep a caret visible. `display` is its index among
     *  the block's displays (the top-level ones, in document order, whether
     *  or not they overflow now) or an element drawn in it (a glyph). `x`
     *  is in the display's own px, from its left edge (its <svg>'s user
     *  units); without it, the element given is brought into view whole.
     *  "In view" is within the column while the display fades (the faded
     *  peek is not counted), the whole box when it does not, less
     *  `margin` px on each side (default 0). Moves only as far as needed;
     *  a display that fits is all in view already. False when there is no
     *  such display. */
    revealInDisplay(display: number | Element, x?: number, options?: { margin?: number }): boolean;
    /** The block's decoded document (latex.proto's Document), read-only: its
     *  fonts, glyph metrics, paragraphs. This view's own working copy: the
     *  nodes Segment.walk gives are its objects (by identity), except those
     *  a live text (\webtext) set. */
    readonly document: Readonly<Doc>;
    /** The measure (pt) and alignment it was last laid out at, and the
     *  width TeX set it at (\hsize, pt; 0 if unknown); null before its first
     *  layout. */
    layout(): { widthPt: number; align: string; sourceWidthPt: number } | null;
    /** Lay it out again now, after a change the viewer cannot see (a custom
     *  property it reads, say). */
    relayout(): void;
    /** Its segments in drawing order: runs of paragraphs, displays, and
     *  streams (boxes laid out of the flow, with segments of their own). */
    segments(): readonly Segment[];
}

/** One segment of a block's drawing (Block.segments). */
export interface Segment {
    readonly kind: 'text' | 'display' | 'stream';
    /** The <svg> it is drawn in (null for a stream, whose segments have
     *  their own); its lines are drawn as they near the window, so it may be
     *  empty yet. Its CTM maps the units walk() gives to the screen. */
    readonly svg: SVGSVGElement | null;
    /** Whether its lines are drawn now. */
    readonly painted: boolean;
    /** A stream's own segments; [] for the others. */
    segments(): readonly Segment[];
    /** Walk its lines and nodes as they are drawn now, in its svg's user
     *  units, touching no DOM: line(j, nodes, x0, baselineY) for each line,
     *  node(n, x, baselineY, advance) for each node of it in drawing order
     *  (glyphs, and the maths on and off nodes among others). False when it
     *  has no lines yet (a stream; a layout put off until it nears the
     *  window). */
    walk(sink: { line?(j: number, nodes: readonly TexNode[], x0: number, baselineY: number): void;
                 node?(n: TexNode, x: number, baselineY: number, advance: number): void }): boolean;
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
     *  defaults again). With `scope`, in the blocks of that scope only
     *  (BlockMountOptions.scope), where it wins over the page-wide text; a
     *  scope's text may be set before its blocks are mounted, and they are
     *  then first drawn with it. Kept until cleared, whether or not a block
     *  of the scope is on the page. */
    setText(name: string, text: string | null, options?: ScopeOptions): void;
    /** The text a block of `scope` shows for `name` (no scope: an
     *  unscoped block): the scope's, else the page-wide one; null when it
     *  shows TeX's default. Instance.setText's own texts aside. */
    text(name: string, options?: ScopeOptions): string | null;
    /** Forget every text set with setText in `scope` (no scope: every
     *  page-wide one); the blocks concerned show what is left. */
    clearTexts(options?: ScopeOptions): void;
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
    /** Resolves once the viewer has nothing still to come on the page: no
     *  layout, paint, set-up, face or animation it waits for (over three
     *  frames). For a test, or a host that acts after a change has settled. */
    idle(): Promise<void>;
    /** CSS px per TeX scaled point: the unit of a block drawing's svg (what
     *  Segment.walk gives) per the unit of its document's sizes. */
    readonly spToPx: number;
    /** Called for every block, now for those already initialised and later
     *  for each new one. Returns an unsubscribe function. */
    onBlock(fn: (block: Block) => void): () => void;
    /** Render a block element added after the page loaded (a framework's,
     *  say): one carrying data-nodelist-b64, as the integrations write it.
     *  Resolves when it is laid out: its faces loaded (or failed), and its
     *  segments within a window's height of the viewport painted, when the
     *  element is rendered (visibility: hidden counts; display: none does
     *  not, and those are painted once it is shown). So a host may mount a
     *  new result into a hidden element and swap it in at once, with no
     *  frame drawn without its text. A block already rendered resolves at
     *  once. With `of`, `el` (an empty element) becomes another view of that
     *  block instead: see BlockMountOptions. */
    mount(el: HTMLElement, options?: BlockMountOptions): Promise<Block>;
    /** Every view of a block (a Block, its element, or any view's key), in
     *  the order mounted; [] when it is not on the page. */
    views(of: Block | Element | string): Block[];
    /** Whether wide displays fade where they are cut off, in every block
     *  that has no setting of its own (Block.setDisplayFade). On by
     *  default. */
    displayFade(): boolean;
    /** Set that default; the blocks that follow it change at once, with no
     *  layout. */
    setDisplayFade(on: boolean): void;
    /** How wide displays are boxed in every block that has no setting of
     *  its own (Block.setDisplayFit). 'column' unless set. */
    displayFit(): 'natural' | 'column';
    /** Set that default; the blocks that follow it change at once, with no
     *  layout. */
    setDisplayFit(fit: 'natural' | 'column'): void;
    /** How blocks are laid out when nothing says otherwise
     *  (BlockMountOptions.layout, data-latex-layout): 'sliced' unless set. */
    layout(): 'sliced' | 'sync';
    /** Set that default; 'sync' finishes at once what slices had left. */
    setLayout(mode: 'sliced' | 'sync'): void;
    /** The faces the blocks draw in (one per font file, by its original
     *  name). Without provide(), a face comes from the served file beside
     *  the viewer (fonts/, data-fonts-base, #latex-font-map). */
    readonly fonts: Fonts;
    /** The page's log: the warnings the blocks' data carry from the build,
     *  and the viewer's own records (the viewer's README, The log). */
    readonly log: HostLog;
}

/** host.log. */
export interface HostLog {
    /** Every record so far, oldest first; with `after`, those after that
     *  record's seq. */
    records(after?: number): LogRecord[];
    /** Be given every record from now on, alerted or not; returns the call
     *  that stops it. */
    subscribe(fn: (record: LogRecord) => void): () => void;
    /** Add a record of the page's own (source 'page'), as the viewer's are:
     *  alerted and shown as configured. `details`: its particulars, as
     *  strings (an `error` is kept as its message, and given to the
     *  console as it is); `block`: the key of the block it is about. */
    report(level: LogLevel, code: string, message: string, details?: Record<string, unknown>,
           options?: { block?: string | null; source?: 'page' | 'companion' }): LogRecord;
    /** The alerted level: records at it or above are written to the
     *  browser's console and sent as `reflowtex:log` on document. From
     *  #latex-log-config's `alert`, else 'error'. */
    alertLevel(): AlertLevel;
    /** Set it for this page; null: back to the page's configuration. */
    setAlertLevel(level: AlertLevel | null): void;
    /** What is shown to readers in the notice bar: codes, and level names
     *  (that level and above). From #latex-log-config's `show`, else
     *  ['font-load-failed']. */
    shown(): string[];
    /** Set it for this page; null: back to the page's configuration. */
    setShown(selection: readonly string[] | null): void;
}

/** host.fonts. */
export interface Fonts {
    /** Give a font's file by its original name (cmr10.otf; for a converted
     *  Type 1 face, the hashed name its blocks give): bytes, or a URL. Before
     *  any block uses it, its face is made from this instead of the served
     *  file. After, the face is replaced only once the new file has loaded
     *  (no blank or stand-in frame; a file that fails leaves the old face, with
     *  a warning), and every block is drawn again. Resolves then: true once
     *  the file is in effect (at once for a font no block uses yet), false
     *  when it could not be loaded or a newer one was given meanwhile. */
    provide(file: string, source: ArrayBuffer | Uint8Array | string): Promise<boolean>;
    /** Whether the font's face has loaded. */
    loaded(file: string): boolean;
    /** Settles once every face asked for so far (and every replacement on
     *  its way) has loaded or failed. */
    ready(): Promise<void>;
}

export interface ScopeOptions {
    /** A name a host gives the blocks of one document (BlockMountOptions.scope);
     *  null or absent: the page-wide texts. */
    scope?: string | null;
}

export interface BlockMountOptions {
    /** Where its \webtext slots find their texts first (Host.setText with
     *  this scope), then the page-wide ones: for a page showing several
     *  documents whose names (labels, counters) may clash. Applied before
     *  its first layout, so a text already set is drawn at once. Without
     *  it: the element's data-latex-scope, else, for a view (`of`), its
     *  block's scope, else none – as before scopes. A block already on the
     *  page moves into the scope given, null taking it out of one. */
    scope?: string | null;
    /** 'sliced': a re-break (the first layout, a new width, new live text)
     *  lays out at once only the segments on the screen, and the rest in
     *  slices of idle time, nearest first (BlockEvents layoutstart,
     *  layoutslice, layoutcomplete; Block.layoutDone). 'sync': all of it at
     *  once, as a page that prints or measures the whole block needs.
     *  Without it: data-latex-layout, else the host's (Host.layout). */
    layout?: 'sliced' | 'sync';
    /** The block to show again (a Block, its element, or its key). The new
     *  view is laid out at its own width and re-broken on its own, with its
     *  own instances, live marks and accessible layer; it shares the block's
     *  compiled data, fonts and glyph metrics. host.setText reaches every
     *  view; Instance.setText and host.addMark the one view unless mirrored.
     *  Its anchors' ids end in `--<its key>` (the block's own view has the
     *  plain ones), and a reference in it goes to its own anchor.
     *  Unmounting it (Block.unmount) leaves the other views as they are. */
    of?: Block | Element | string;
    /** Its name among the block's views (Block.view); unique among them. */
    view?: string;
    /** Its own display fade (Block.setDisplayFade), set before it is first
     *  drawn; without it, it follows the host's. */
    displayFade?: boolean;
    /** Its own display fit (Block.setDisplayFit), set before it is first
     *  drawn; without it, it follows the host's. */
    displayFit?: 'natural' | 'column';
}

/** One entry of a block's outline (the viewer's README, Outline): sent as
 *  `reflowtex:outline` (bubbling, detail { block, entries }) on the block
 *  once it is laid out, and kept on it as `el.reflowtexOutline`. `id` is
 *  its anchor element's id. */
export interface OutlineItem {
    kind: string;
    env: string;
    level: number;
    number: string;
    title: string;
    id: string | null;
}

/** window.reflowtexBreak: another paragraph breaker, which a page may
 *  define (the viewer's README, Plugging in another paragraph breaker). It
 *  is given a paragraph's nodes, the measure (sp), the block's parameters
 *  and helpers, and returns its lines, or null to leave the paragraph to
 *  the built-in breaker. */
export type ParagraphBreaker = (nodes: TexNode[], availSp: number, params: Params, helpers: BreakerHelpers) => Line[] | null;
export interface BreakerHelpers {
    gW(n: TexNode): number;
    gH(n: TexNode): number;
    gD(n: TexNode): number;
    align: string;
    /** The paragraph's \baselineskip and \lineskip (sp). */
    bskip: number;
    lskip: number;
    /** A font's record: its quad, expansion limits and character codes. */
    font(id: number): ViewerFont | null;
    adjustSpacing: number;
    protrudeChars: number;
}

/** window.reflowtex: the host API, and a few page-wide switches (the
 *  viewer's README). A page may create it first, with the switches set. */
export interface ReflowTeX {
    host?: Host;
    /** Timing lines in the console, read on each line (or ?reflowtex-debug). */
    debug?: boolean;
    /** false: the notice that fonts failed to download is not shown (as
     *  leaving font-load-failed out of HostLog.shown). */
    fontWarning?: boolean;
    /** How the accessible layer gives formulas: as MathML, or as their
     *  words. The reader's choice, remembered; reflowtex:accessible-math on
     *  document when it changes. */
    accessibleMath?(): 'mathml' | 'spoken';
    setAccessibleMath?(mode: 'mathml' | 'spoken'): void;
    /** Screen reader mode: the drawing hidden, the accessible layer shown;
     *  remembered. */
    screenReaderMode?(): boolean;
    setScreenReaderMode?(on: boolean): void;
    /** The accessible layer shown over the drawing (a debugging aid);
     *  remembered. */
    accessibleDebug?(): boolean;
    setAccessibleDebug?(on: boolean): void;
    /** The reader's colour theme (the README's Theming): the choice (a
     *  theme, or 'system'), the theme shown, and the system mode's two
     *  themes. reflowtex:theme on document when it changes. */
    theme?(): ThemeState;
    /** The themes on offer: default, then the colour maps'. */
    themes?(): string[];
    /** Choose a theme, or 'system'; remembered. */
    setTheme?(choice: string): void;
    /** The themes the system mode shows while the system is light, and
     *  while it is dark; remembered. */
    setSystemThemes?(slots: { light?: string; dark?: string }): void;
    /** For tools: the viewer's own state (the README's Inspecting). Not
     *  part of this contract: its shape may change between versions (its
     *  `version` says which). */
    inspect?: Inspect;
    /** The inspector (src/inspector), once its script has run: its own
     *  API (src/inspector/README.md). */
    inspector?: unknown;
}

declare global {
    interface Window {
        reflowtex?: ReflowTeX;
        reflowtexBreak?: ParagraphBreaker;
    }
    interface DocumentEventMap {
        /** Sent once, on document, when window.reflowtex.host exists. */
        'reflowtex:host': CustomEvent<{ host: Host }>;
        /** Sent on document for each record at the alerted level or above (HostLog). */
        'reflowtex:log': CustomEvent<{ record: LogRecord }>;
        /** Sent on document after live marks change (host.addMark). */
        'reflowtex:marks': CustomEvent<{ marks: LiveMark[] }>;
        /** Sent on document when the reader's theme changes (ReflowTeX.theme). */
        'reflowtex:theme': CustomEvent<ThemeState>;
    }
    interface HTMLElement {
        /** A block's outline, once it is laid out (OutlineItem). */
        reflowtexOutline?: OutlineItem[];
    }
}
