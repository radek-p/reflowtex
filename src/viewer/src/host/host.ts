// SPDX-License-Identifier: AGPL-3.0-or-later
// window.reflowtex.host: the host API (types.ts) over the viewer's blocks.
// Installed when the viewer script runs; `reflowtex:host` on document says
// so, for a module that loaded first. Blocks join as the viewer initialises
// them (registerBlock, from initBlock), each with its instances built on
// first use.

import { api } from '../runtime/page.js';
import { normalise, walk, matches, type AnchorSource, type Doc, type DocStream, type InstanceImpl } from './instances.ts';
import { TypesetPartImpl, type BlockData } from './surface.ts';
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
                src => this.anchor(src));
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

const blocks: BlockImpl[] = [];
const byEl = new WeakMap<Element, BlockImpl>();
const blockListeners = new Set<(b: Block) => void>();

export const host: Host = {
    version: 1,
    blocks: () => blocks.slice(),
    block: el => byEl.get(el),
    instances: query => blocks.flatMap(b => b.instances(query)),
    find: id => {
        const b = blocks.find(b => id.startsWith(b.key + '/'));
        return b && b.find(id);
    },
    onBlock(fn) {
        blockListeners.add(fn);
        for (const b of blocks) fn(b);
        return () => { blockListeners.delete(fn); };
    },
};

/** From initBlock, once the block is laid out (so it has its key). */
export function registerBlock(data: ViewerBlockData) {
    if (byEl.has(data.el)) return;
    const b = new BlockImpl(data);
    blocks.push(b);
    byEl.set(data.el, b);
    for (const fn of [...blockListeners]) {
        try { fn(b); } catch (e) { console.error('[latex-viewer] onBlock listener:', e); }
    }
}

(api as Record<string, unknown>).host = host;
document.dispatchEvent(new CustomEvent('reflowtex:host', { detail: { host } }));

export type { Doc };
