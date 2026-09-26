// SPDX-License-Identifier: AGPL-3.0-or-later
// window.reflowtex.host: the host API (types.ts) over the viewer's blocks.
// Installed when the viewer script runs; `reflowtex:host` on document says
// so, for a module that loaded first. Blocks join as the viewer initialises
// them (registerBlock, from initBlock), each with its instances built on
// first use.

import { api } from '../runtime/page.js';
import { SP_TO_PX } from '../engine/core.js';
import { normalise, walk, matches, type AnchorSource, type Doc, type DocStream, type InstanceImpl } from './instances.ts';
import { TypesetPartImpl, type BlockData } from './surface.ts';
import './block-hosts.ts';
import { defineKind } from './kinds.ts';
import { setSlotText } from './slots.js';
import { markHandle } from './marks.ts';
import { destroyBlock, mountBlock } from '../runtime/init.js';
import { blockData } from '../runtime/blocks.js';
import type { Block, BlockEvents, Host, Instance, InstanceQuery } from './types.ts';

interface ViewerBlockData extends BlockData { cache: { blockKey?: string } }

// A point in an SVG element's own coordinates, in the window's: through its
// transform, as WebKit gives an empty or text element's box wrongly.
function screenPoint(el: Element | null, x: number, y: number): DOMRect | null {
    const ctm = el && (el as SVGGraphicsElement).getScreenCTM && (el as SVGGraphicsElement).getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(x, y).matrixTransform(ctm);
    return new DOMRect(p.x, p.y, 0, 0);
}
const num = (el: Element, a: string) => parseFloat(el.getAttribute(a) || '0') || 0;

class BlockImpl implements Block {
    private _roots: InstanceImpl[] | null = null;
    private byId: Map<string, Instance> | null = null;
    constructor(readonly data: ViewerBlockData) {}
    get el() { return this.data.el; }
    get key() { return this.data.cache.blockKey || ''; }
    get roots(): readonly Instance[] {
        if (!this._roots) {
            this._roots = normalise(this.data.doc, this, this.key,
                { typeset: (inst, role, stream: DocStream) => new TypesetPartImpl(role, inst, this.data, stream) },
                src => this.anchor(src), SP_TO_PX);
        }
        return this._roots;
    }
    instances(query?: InstanceQuery): Instance[] {
        return [...walk(this.roots)].filter(i => matches(i, query));
    }
    find(id: string) {
        if (!this.byId) this.byId = new Map([...walk(this.roots)].map(i => [i.id, i]));
        return this.byId.get(id);
    }
    destroy() { destroyBlock(this.el); }
    on<E extends keyof BlockEvents>(event: E, fn: BlockEvents[E]): () => void {
        // 'layout' is the block's reflowtex:layout DOM event (announceLayout).
        const h = (e: Event) => { if ((e as CustomEvent).detail?.block === this.el) fn(); };
        this.el.addEventListener('reflowtex:' + event, h);
        return () => this.el.removeEventListener('reflowtex:' + event, h);
    }
    private anchor(src: AnchorSource): DOMRect | null {
        const el = this.el;
        if (src.type === 'aside') {
            const m = el.querySelector(`.latex-aside-mark[data-aside="${src.stream}"]`);
            return m && screenPoint(m, num(m, 'x'), num(m, 'y'));
        }
        if (src.type === 'glyph') {
            const g = el.querySelector(`[data-footnote="${src.stream}"]`);
            return g && screenPoint(g, num(g, 'x'), num(g, 'y'));
        }
        if (src.type === 'widget') {
            const w = el.querySelector(`.latex-widget[data-widget="${CSS.escape(`${this.key}:${src.slot}`)}"]`);
            return w ? w.getBoundingClientRect() : null;
        }
        return null;
    }
}

/** A block element's key (the prefix of its instances' ids). */
export const blockKeyOf = (el: Element | undefined): string => (el && blockOf(el)?.key) || '';

const blocks: BlockImpl[] = [];                 // announced (registerBlock), in page order
const byEl = new WeakMap<Element, BlockImpl>();   // every block made, announced or not

/** The Block of a block element the viewer has data for – before it is
 *  announced too, as its first layout needs it (block-hosts.ts). */
export function blockOf(el: Element): BlockImpl | undefined {
    let b = byEl.get(el);
    if (!b) {
        const data = blockData.get(el);
        if (!data) return undefined;
        byEl.set(el, b = new BlockImpl(data));
    }
    return b;
}
const blockListeners = new Set<(b: Block) => void>();

export const host: Host = {
    version: 1,
    define: defineKind,
    setText: (name, text) => setSlotText(name, text),
    mark: id => markHandle(id),
    blocks: () => blocks.slice(),
    block: el => blocks.includes(byEl.get(el) as BlockImpl) ? byEl.get(el) : undefined,
    instances: query => blocks.flatMap(b => b.instances(query)),
    find: id => {
        const b = blocks.find(b => id.startsWith(b.key + '/'));
        return b && b.find(id);
    },
    async mount(el) {
        await mountBlock(el);
        const b = blockOf(el);
        if (!b) throw new Error('host.mount: not a block (no data-nodelist-b64, or it failed to render)');
        return b;
    },
    onBlock(fn) {
        blockListeners.add(fn);
        for (const b of blocks) fn(b);
        return () => { blockListeners.delete(fn); };
    },
};

/** From initBlock, once the block is laid out (so it has its key). */
/** From destroyBlock: the block is gone from the page's books. */
export function unregisterBlock(el: Element) {
    const b = byEl.get(el);
    if (!b) return;
    const i = blocks.indexOf(b);
    if (i >= 0) blocks.splice(i, 1);
    byEl.delete(el);
}

export function registerBlock(data: ViewerBlockData) {
    const b = blockOf(data.el);
    if (!b || blocks.includes(b)) return;
    blocks.push(b);
    for (const fn of [...blockListeners]) {
        try { fn(b); } catch (e) { console.error('[latex-viewer] onBlock listener:', e); }
    }
}

/** From the entry module, once every module has been evaluated: a page's
 *  listener may call host.define at once, which needs block-hosts.ts ready
 *  (it and this module import each other). */
export function installHost() {
    (api as Record<string, unknown>).host = host;
    document.dispatchEvent(new CustomEvent('reflowtex:host', { detail: { host } }));
}

export type { Doc };
