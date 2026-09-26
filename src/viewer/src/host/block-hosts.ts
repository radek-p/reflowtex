// SPDX-License-Identifier: AGPL-3.0-or-later
// Block kinds (types.ts: BlockKind, BlockHost): a `block` instance of a
// kind the page defined is drawn by the page. The viewer places its element
// in the flow – the stream's box, `.latex-stream[data-kind]`, which it
// already makes – and hands it over once; what goes inside is the page's,
// typically the instance's parts mounted as surfaces. The viewer lays out
// nothing there itself.
//
// The flow still spaces the host as TeX would. The space above and below a
// stream box is its spacer's height, computed from the author's explicit
// gap and, towards text, TeX's interline glue from the neighbouring line to
// the host's first line (and from its last line down). Those lines are the
// host's *edges*: by default the body's surface inside it, or whatever the
// renderer names (setEdges). A framed edge (setFrame) takes no glue across
// it. The box's own height is never set by the layout – the content makes
// it – so a renderer may grow or shrink it at will (a pane opening); only
// when the edges' lines change does the layout owning the host run again,
// once, in the next frame.
//
// A host lives as long as the layout around it: relayouts reuse it, and so
// does a rebuild after fonts load (document.js keeps the box, by stream
// index, in cache.hosts). Defining or undefining a kind rebuilds the blocks
// that have instances of it, so they are drawn the new way.

import { ZOOM } from '../engine/core.js';
import { blockData, rerenderBlock } from '../runtime/blocks.js';
import { blockOf } from './host.ts';
import { surfaceHooks, surfacesOf, type Cache, type Edges, type SurfaceImpl } from './surface.ts';
import type { BlockHost, BlockKind, Instance, Surface } from './types.ts';

interface HostRecord {
    box: HTMLElement;
    index: number;               // the stream's, the key in owner.hosts
    instance: Instance;
    kind: string;
    def: BlockKind;
    owner: Cache;
    host: BlockHost;
    undo: (() => void) | null;
    frame: { top: boolean; bottom: boolean };
    edges: { top?: SurfaceImpl | null; bottom?: SurfaceImpl | null } | null;   // null: the default
    laid: Edges | null;          // the edges the last layout used
    failed: boolean;
}

const kinds = new Map<string, BlockKind>();
const records = new Set<HostRecord>();
const byBox = new WeakMap<HTMLElement, HostRecord>();

export function blockKind(kind: string) { return kinds.get(kind); }

// ── Relayout, coalesced per owning layout ────────────────────────────────
const pending = new Set<() => void>();
let frame = 0;
function relayoutSoon(owner: Cache) {
    if (!owner.relayout) return;
    pending.add(owner.relayout);
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const fns = [...pending];
        pending.clear();
        for (const fn of fns) fn();
    });
}

// The edges a record stands for now: the renderer's, else the body's surface.
function currentEdges(rec: HostRecord): { top: SurfaceImpl | null; bottom: SurfaceImpl | null } {
    if (rec.edges) return { top: rec.edges.top ?? null, bottom: rec.edges.bottom ?? null };
    const body = rec.instance.part('body');
    let found: SurfaceImpl | null = null;
    for (const s of surfacesOf(rec.instance.block.el)) {
        if (s.part === body && !s.isDisposed && rec.box.contains(s.el)) { found = s; break; }
    }
    return { top: found, bottom: found };
}
function edgeValues(rec: HostRecord): Edges {
    const { top, bottom } = currentEdges(rec);
    const t = top && !top.isDisposed ? top.edges() : null;
    const b = bottom && !bottom.isDisposed ? bottom.edges() : null;
    return { firstAscent: t ? t.firstAscent : 0, firstMeta: t ? t.firstMeta : null, textFirst: !!(t && t.textFirst),
             lastDepth: b ? b.lastDepth : 0, textLast: !!(b && b.textLast) };
}
const sameEdges = (a: Edges | null, b: Edges) => !!a && a.firstAscent === b.firstAscent && a.lastDepth === b.lastDepth
    && a.firstMeta === b.firstMeta && a.textFirst === b.textFirst && a.textLast === b.textLast;

// A surface changed or went: the host it stands for an edge of lays out again
// if what the flow reads from it changed.
surfaceHooks.changed = (s: SurfaceImpl) => {
    for (let el: HTMLElement | null = s.el; el; el = el.parentElement) {
        const rec = byBox.get(el);
        if (!rec) continue;
        if (rec.laid && !sameEdges(rec.laid, edgeValues(rec))) relayoutSoon(rec.owner);
        return;
    }
};
surfaceHooks.disposeHosts = (cache: Cache) => {
    for (const rec of [...records]) if (rec.owner.hosts === cache.hosts) dispose(rec);
};

function dispose(rec: HostRecord) {
    records.delete(rec);
    rec.owner.hosts?.delete(rec.index);
    if (rec.undo) {
        try { rec.undo(); } catch (e) { console.error(`[latex-viewer] kind "${rec.kind}": undoing render failed:`, e); }
    }
    rec.undo = null;
}

function makeRecord(box: HTMLElement, index: number, instance: Instance, def: BlockKind, owner: Cache): HostRecord {
    const rec = { box, index, instance, kind: instance.kind, def, owner, undo: null, laid: null, failed: false,
                  frame: { top: false, bottom: false }, edges: null } as unknown as HostRecord;
    rec.host = {
        el: box, instance,
        setFrame(f) {
            const next = { top: !!f.top, bottom: !!f.bottom };
            if (next.top === rec.frame.top && next.bottom === rec.frame.bottom) return;
            rec.frame = next;
            if (rec.laid) relayoutSoon(owner);
        },
        spacing() {
            // The spacers the layout put before this box and before the next
            // segment (layoutDocument: each segment is a spacer, then its box).
            const segs: any[] = (owner.dom && owner.dom.segs) || [];
            const i = segs.findIndex(sg => sg.box === box);
            const px = (el: HTMLElement | undefined) => (el && parseFloat(el.style.height)) || 0;
            return { before: i >= 0 ? px(segs[i].gap) : 0, after: i >= 0 && i + 1 < segs.length ? px(segs[i + 1].gap) : 0 };
        },
        setEdges(e: { top?: Surface | null; bottom?: Surface | null }) {
            rec.edges = { ...(rec.edges || {}), ...e } as HostRecord['edges'];
            if (rec.laid && !sameEdges(rec.laid, edgeValues(rec))) relayoutSoon(owner);
        },
    };
    return rec;
}

/** For document.js: a host box to keep when the DOM is rebuilt. */
export function keptHostBox(cache: Cache, index: number): HTMLElement | null {
    const rec = cache.hosts && (cache.hosts.get(index) as HostRecord | undefined);
    return rec && !rec.failed ? rec.box : null;
}

/** For layoutStreamSegment: lay out a stream segment whose kind the page
 *  defined, or return null to have it laid out by default. */
export function layoutHostedSegment(s: any, seg: any, widthPt: number, cache: Cache): object | null {
    const def = kinds.get(seg.stream.kind || '');
    if (!def || !cache.blockEl) return null;
    const hosts = cache.hosts || (cache.hosts = new Map());
    let rec = hosts.get(seg.index) as HostRecord | undefined;
    if (rec && rec.failed) return null;
    if (!rec) {
        const block = blockOf(cache.blockEl);
        const instance = block && block.find(`${block.key}/s${seg.index}`);
        if (!instance) return null;
        rec = makeRecord(s.box, seg.index, instance, def, cache);
        hosts.set(seg.index, rec);
        records.add(rec);
        byBox.set(s.box, rec);
        try {
            const undo = def.render(instance, rec.host);
            rec.undo = typeof undo === 'function' ? undo : null;
        } catch (e) {
            console.error(`[latex-viewer] kind "${rec.kind}": render failed, drawn by default:`, e);
            rec.failed = true;
            records.delete(rec);
            s.box.replaceChildren();
            return null;
        }
    }
    const E = rec.laid = edgeValues(rec);
    // As the default path does: the edges' own ink, for CSS sizing a frame.
    const fa = E.textFirst ? `${E.firstAscent}px` : 'var(--latex-cap-height, 0px)';
    const ld = E.textLast ? `${E.lastDepth}px` : '0px';
    if (s.box.style.getPropertyValue('--latex-first-ascent') !== fa) s.box.style.setProperty('--latex-first-ascent', fa);
    if (s.box.style.getPropertyValue('--latex-last-depth') !== ld) s.box.style.setProperty('--latex-last-depth', ld);
    return { seg, lines: [], H: s.box.offsetHeight, W: widthPt * ZOOM,
             firstAscent: E.firstAscent, lastDepth: E.lastDepth, firstMeta: E.firstMeta,
             alts: null, frameTop: rec.frame.top, frameBottom: rec.frame.bottom,
             gapBefore: seg.gapBefore || 0 };
}

// Rebuild every block with instances of `kind`, so they are drawn anew.
function redraw(kind: string) {
    for (const rec of [...records]) if (rec.kind === kind) dispose(rec);
    for (const el of document.querySelectorAll<HTMLElement>('[data-nodelist-b64]')) {
        const block = blockOf(el);
        if (block && blockData.get(el) && block.instances({ kind, placement: 'block' }).length) rerenderBlock(el);
    }
}

export function defineBlockKind(kind: string, def: BlockKind): () => void {
    if (!def || typeof def.render !== 'function') throw new TypeError(`host.define("${kind}"): render(instance, host) is required`);
    kinds.set(kind, def);
    redraw(kind);
    return () => {
        if (kinds.get(kind) !== def) return;
        kinds.delete(kind);
        redraw(kind);
    };
}
