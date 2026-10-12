// SPDX-License-Identifier: AGPL-3.0-or-later

import { placeMarginNotes } from '../defaults/margin-notes.ts';
import { blockData } from './blocks.ts';
import { placeAccessibleLayer } from './a11y.ts';
import { cancelLater, later } from './pending.ts';
import type { MarginLayer } from '../defaults/margin-notes.ts';
import type { Doc, FontTable, GlyphMetrics, Picture } from '../engine/model.ts';
import type { LayoutCache } from '../engine/layout/types.ts';
import type { Params } from './params.ts';

/** What every view of a block shares (runtime/init.ts): the compiled bytes,
 *  the fonts, the glyph metrics and pictures, the accessible layer as
 *  shipped, and its views in the order mounted. */
export interface BlockSource {
    b64: string;
    glyph_metrics: GlyphMetrics[];
    pictures: Picture[];
    fontInfo: FontTable;
    layer: HTMLElement | null;
    views: BlockData[];
    /** The last view number given (v1, v2, …). */
    seq: number;
}

/** A block's, or a view's, data (runtime/init.ts, initBlock). */
export interface BlockData {
    /** Its own working copy of the document (live text changes it). */
    doc: Doc;
    fontInfo: FontTable;
    /** The width (pt) and alignment it was last laid out at. */
    lastWidth: number;
    lastAlign: string;
    params: Params;
    cache: LayoutCache;
    painted: boolean;
    seq: number;
    el: HTMLElement;
    /** Where its live texts are looked up first (host.mount's scope). */
    scope: string | null;
    source: BlockSource;
    /** Its name among its block's views. */
    view: string;
    /** Mounted as a view of another (host.mount(el, { of })). */
    mountedOf?: boolean;
    /** It set aria-hidden on its element itself. */
    hidAria?: boolean;
    /** data-latex-width="natural": the width it measured (pt). */
    naturalPt?: number;
    /** Its margin notes' layer (defaults/margin-notes.ts). */
    margin?: MarginLayer | null;
}

// Per-block data the host modules look up. Asides themselves (\webaside:
// streams typeset out of the flow) are detached instances of the host API
// (host/instances.ts): a page finds them with host.instances({ placement:
// 'detached', … }), mounts their parts where it likes and places them by
// instance.anchor().
export const docData = new WeakMap<Doc, BlockData>();          // a block's decoded document → its data
export const allData: BlockData[] = [];                     // every block's data, in page order

// After every layout, and whenever lines are drawn as they near the window,
// a block places its margin notes and its accessible layer again and sends reflowtex:layout
// (bubbling; block.on('layout') in the host API), for a page that places
// things by anchors.
// While a resize is under way (a quick reflow, every frame of a drag or of
// a column that animates its width), the accessible layer is placed a few
// times a second, not on every frame: placing it rebuilds and measures the
// text of every paragraph near the window, which on a phone cost frames. A
// placement is always due after the last reflow, so the layer ends where the
// lines are. reflowtex:layout says whether the reflow was a quick one (detail
// quick); each placement of the layer sends reflowtex:layer (runtime/a11y.ts).
const LAYER_MS = 200;
const layerTimers = new Map<HTMLElement, number>();                 // a block → its placement to come
export function announceLayout(el: HTMLElement, quick = false): void {
    const data = blockData.get(el);
    placeMarginNotes(data);
    if (quick) {
        if (!layerTimers.has(el)) layerTimers.set(el, later('accessible layer', () => {
            layerTimers.delete(el);
            placeAccessibleLayer(blockData.get(el));
        }, LAYER_MS));
    } else {
        cancelLater(layerTimers.get(el));
        layerTimers.delete(el);
        placeAccessibleLayer(data);
    }
    el.dispatchEvent(new CustomEvent('reflowtex:layout', { bubbles: true, detail: { block: el, quick } }));
}
