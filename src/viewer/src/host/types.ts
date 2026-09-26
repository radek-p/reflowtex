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
     *  coordinates. Else null (not drawn yet, not in a line, no mark). */
    anchor(): DOMRect | null;
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
}

/** How a kind of `block` instance is drawn: the page's code, not the
 *  viewer's. Kinds without one are drawn by default: the stream's own
 *  element (`.latex-stream[data-kind]`, with its data-* parameters, classes
 *  and custom properties) holding the body laid out at its width. */
export interface BlockKind {
    /** Draw `instance` in `host.el`, an element the viewer placed in the flow
     *  and sized across; its height is whatever the content makes it. Called
     *  once per host, which lives as long as the text around it: not again
     *  on relayout, resize or font load. Returns what undoes it, if anything
     *  (called when the kind is redefined, or the layout holding the host
     *  goes away). If it throws, the instance is drawn by default. */
    render(instance: Instance, host: BlockHost): void | (() => void);
}

/** Where a block instance stands in the flow, and what the flow needs to
 *  know about it to space it as TeX would. */
export interface BlockHost {
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
    /** Draw every `block` instance of a kind with `def`, from now on and,
     *  by drawing them again, those already drawn. Returns what undefines
     *  it (the kind is then drawn by default again). */
    define(kind: string, def: BlockKind): () => void;
    /** Blocks initialised so far, in page order. */
    blocks(): Block[];
    block(el: Element): Block | undefined;
    /** Every block's instances matching the query. */
    instances(query?: InstanceQuery): Instance[];
    find(id: string): Instance | undefined;
    /** Called for every block, now for those already initialised and later
     *  for each new one. Returns an unsubscribe function. */
    onBlock(fn: (block: Block) => void): () => void;
}

declare global {
    interface Window {
        reflowtex?: { host?: Host } & Record<string, unknown>;
    }
    interface DocumentEventMap {
        /** Sent once, on document, when window.reflowtex.host exists. */
        'reflowtex:host': CustomEvent<{ host: Host }>;
    }
}
