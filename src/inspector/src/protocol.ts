// SPDX-License-Identifier: AGPL-3.0-or-later
// What the page agent (agent/) answers the panel (panel/), through
// window.__rtxInspector: plain JSON, apart from the elements fromElement and
// elementOf take and give. Types only.

/** A row of the tree. `kind` is what it is to the agent; `type` how a panel
 *  shows it (a node's type, or 'block', 'text', 'display', 'stream', 'line',
 *  'vspace'). */
export interface Row {
    id: number;
    kind: string;
    hasChildren: boolean;
    label: string;
    note: string;
    type?: string;
    /** Drawn on the current layout (false: a node a reflow left undrawn). */
    drawn?: boolean;
    /** A plain hyphenation point (a discretionary with nothing unbroken). */
    point?: boolean;
    /** The fields the width model evaluates at the reader's measure. */
    affine?: string[];
}
/** A field and its value, as shown. */
export type DetailRow = [string, string];
export interface Details {
    summary: Row;
    rows: DetailRow[];
    /** A glyph: its font's resource key and its character. */
    glyph: { key: string; cp: number; font: string } | null;
}
/** What the accessible layer holds for a row. */
export interface Accessible {
    layer: boolean;
    pieces: { kind: 'paragraph' | 'display'; lined: boolean; parts: AccessiblePart[] }[];
}
export type AccessiblePart = { type: 'text'; text: string } | { type: 'math'; mathml: string; alttext: string };

/** A thing picked from the page, or found from an element: its id, and the
 *  rows down to it. */
export interface Hit { id: number; path: number[] }
export interface Status {
    api: true;
    version: number;
    blocks: number;
    paints: number;
    picking: boolean;
    /** The last pick; seq counts picks. */
    picked: (Hit & { seq: number }) | null;
}
/** The page-wide guides, and whether the selection is drawn. */
export interface Options { baselines: boolean; badness: boolean; springs: boolean; a11y: boolean; selection: boolean }

// ── Resources ───────────────────────────────────────────────────────────────
/** A resource in a list: its key (see resources.ts), category, label and a note. */
export interface ResourceRow {
    key: string;
    cat: string;
    label: string;
    note: string;
    /** A font: how the pipeline served it. */
    origin?: FontOrigin;
    /** A font: the CSS family its glyphs are drawn in; null for one drawn as boxes. */
    family?: string | null;
    uses?: number;
}
export type FontOrigin = 'converted' | 'patched' | 'original' | null;
export interface Resources {
    fonts: ResourceRow[];
    modifiedFonts: ResourceRow[];
    pictures: ResourceRow[];
    streams: ResourceRow[];
    links: ResourceRow[];
    citations: ResourceRow[];
    anchors: ResourceRow[];
    slots: ResourceRow[];
    instances: ResourceRow[];
    marks: ResourceRow[];
    kinds: ResourceRow[];
}
/** A resource in full. */
export interface Resource {
    key: string;
    cat: string;
    rows: DetailRow[];
    title?: string;
    /** Its text (a stream's, or an instance's data part); code when textIsCode. */
    text?: string;
    textIsCode?: boolean;
    /** A picture's drawing. */
    svg?: { markup: string; vb_w: number; vb_h: number };
    /** A stream: shown in the popover, or standing in a flow. */
    footnote?: boolean;
    flow?: boolean;
    /** The row of its popover's surface, once laid out. */
    side?: number;
}
/** A font's glyph table (fontGlyphs). */
export interface FontGlyphs {
    key: string;
    file: string | null;
    family: string | null;
    sizes: number[];
    names: string[];
    status: string | null;
    url: string | null;
    cells: GlyphCell[];
    micro: { quad: number; expand: string | null; codes: number };
    error?: string;
    origin: FontOrigin;
    puaUsed: number;
    upem?: number;
    numGlyphs?: number;
    puaInFile?: number;
}
/** One glyph of a font: its index and name in the file, the characters that
 *  map to it, its advance, and how the documents use it. */
export interface GlyphCell {
    gid: number | null;
    name: string | null;
    cps: number[];
    adv: number | null;
    uses: number;
    /** Per size used: [size, width, height, depth] (sp). */
    tex: [number, number, number, number][] | null;
    codes: { lp: number; rp: number; ef: number } | null;
    /** Used, but not in the file's cmap. */
    missing?: boolean;
}
/** The page's colour maps (colourMaps). */
export interface ColourMaps {
    theme: string;
    maps: {
        name: string;
        themes: string[];
        used: number;
        usedBy: string;
        colors: { src: string; by: Record<string, string | null>; now: string | null }[];
        tints: { hex: string; base: string; pct: number; now: string | null }[];
    }[];
    edited: boolean;
}

/** window.__rtxInspector. The calls a panel makes return these; an id is a
 *  row's. */
export interface AgentApi {
    /** The agent's version (a panel needs this one or a newer). */
    agent: number;
    setOptions(o: Partial<Options>): void;
    redraw(): void;
    xml(id: number): string;
    text(id: number): string;
    status(): Status;
    blocks(): Row[];
    children(id: number): Row[];
    details(id: number): Details | null;
    /** An id, a list of ids, or null. */
    hover(id: number | number[] | null): void;
    select(id: number | null, options?: { scroll?: boolean }): void;
    clear(): void;
    pick(): boolean;
    cancelPick(): void;
    fromElement(el: Element | null): Hit | null;
    elementOf(id: number): Element | null | undefined;
    blockPath(el: Element): number[] | null;
    resources(): Resources;
    resource(key: string): Resource | null;
    uses(key: string, limit?: number): number[];
    fontGlyphs(fontKey: string): Promise<FontGlyphs | null>;
    pathTo(id: number): number[] | null;
    mark(ids: number[] | null): void;
    accessible(id: number): Accessible;
    openPopover(key: string): 'ok' | 'wait' | 'none';
    colourMaps(): ColourMaps;
    setPageTheme(t: string): string;
    setMapColour(name: string, theme: string, src: string, value: string | null): string;
    /** pct: a number, or a field's text (taken as a number; 0 if none). */
    setMapTint(name: string, hex: string, base: string | null, pct?: number | string): string;
    importColourMaps(json: unknown): string;
    exportColourMaps(): string;
    resetColourMaps(): string;
}

/** What the panel's module gives the loader (panel/app.ts, mount): the
 *  calls window.reflowtex.inspector makes once it is loaded. */
export interface InspectorPanel {
    open(block?: Element | null, options?: { dock?: string; scroll?: boolean }): Promise<void>;
    close(): void;
    toggle(): unknown;
    setDock(mode: string): void;
    dock(container: Element, block?: Element | null): Promise<void>;
    inspect(win: Window): Promise<void>;
    isOpen(): boolean;
}

/** window.reflowtex.inspector (inspector.ts; src/inspector/README.md):
 *  the panel's calls, loading it on first use. */
export interface InspectorApi {
    open(block?: Element | null, options?: { dock?: string; scroll?: boolean }): Promise<unknown>;
    toggle(): Promise<unknown>;
    dock(container: Element, block?: Element | null): Promise<unknown>;
    inspect(win: Window): Promise<unknown>;
    isOpen(): Promise<boolean>;
    close(): Promise<void>;
    setDock(mode: string): Promise<void>;
    /** The shortcut's label, for a tooltip. */
    shortcut: string;
}

declare global {
    interface Window {
        __rtxInspector?: AgentApi;
        /** Installs the agent: 'ok', or 'no-api' without an inspectable viewer. */
        __rtxInspectorInstall?: () => 'ok' | 'no-api';
    }
}
