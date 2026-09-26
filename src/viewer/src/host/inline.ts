// SPDX-License-Identifier: AGPL-3.0-or-later
// Inline instances (\webwidget) drawn by a kind the page defined
// (types.ts: KindDef.measure, PieceHost). The line breaking stays in
// widgets.js; this is where it meets the page: which kind, its environment,
// and each piece's drawing and its end.
//
// A piece is drawn once, when its element is made (paint.js). Elements are
// kept for reuse while their nodes are (a line that breaks elsewhere and
// back gets the same one); a piece goes for good when its node does – the
// widget measured again (invalidate, a new definition), or the drawing
// rebuilt after fonts load – and then what its render returned is called.
import { scheduleSlots } from './slots.js';
import { measureHTML } from './widgets.js';
import { blockOf } from './host.ts';
import { kindDef, onKindChange } from './kinds.ts';
import type { InlineEnv, Instance, KindDef, PieceHost } from './types.ts';

const versions = new Map<string, number>();      // instance id → bumped by invalidate

export const inlineVersion = (instance: Instance) => versions.get(instance.id) || 0;

/** The instance and definition of slot `index` in a block, if a kind the
 *  page defined draws it. */
export function inlineOf(blockEl: HTMLElement | undefined, index: number): { instance: Instance; def: KindDef } | null {
    const block = blockEl && blockOf(blockEl);
    const instance = block && block.find(`${block.key}/w${index}`);
    const def = instance && kindDef(instance.kind);
    return instance && def && typeof def.measure === 'function' ? { instance, def } : null;
}

export function inlineEnv(instance: Instance, fontSize: number, color: string | null): InlineEnv {
    return {
        fontSize, color,
        measure(content) {
            if (typeof content !== 'function') return measureHTML(content, fontSize);
            const el = document.createElement('span');
            content(el);
            return measureHTML(el, fontSize);
        },
        invalidate() {
            versions.set(instance.id, inlineVersion(instance) + 1);
            scheduleSlots();
        },
    };
}

// What each drawn piece's render returned, by its element; and the pieces
// of each layout (cache), to end them all when its drawing is rebuilt.
const undo = new WeakMap<Element, () => void>();
const byCache = new WeakMap<object, Set<Element>>();

/** From paint.js: draw one piece in `box`, the element made for node `n`. */
export function renderPiece(n: any, el: Element, box: HTMLElement, cache: object): void {
    const { instance, def, env } = n.inline as { instance: Instance; def: KindDef; env: InlineEnv };
    const host: PieceHost = { type: 'piece', el: box, instance, piece: n.part, env };
    try {
        const u = def.render(instance, host);
        if (typeof u === 'function') {
            undo.set(el, u);
            let set = byCache.get(cache);
            if (!set) byCache.set(cache, set = new Set());
            set.add(el);
        }
    } catch (e) {
        console.error(`[latex-viewer] kind "${instance.kind}": drawing a piece failed:`, e);
    }
}

/** A piece's node is gone for good: end its drawing. */
export function disposePiece(el: Element | undefined) {
    const u = el && undo.get(el);
    if (!u) return;
    undo.delete(el!);
    try { u(); } catch (e) { console.error('[latex-viewer] ending a piece failed:', e); }
}

/** A layout's drawing is rebuilt: end every piece in it, nested layouts too. */
export function disposePieces(cache: any) {
    if (!cache) return;
    for (const el of byCache.get(cache) || []) disposePiece(el);
    byCache.delete(cache);
    for (const s of (cache.dom && cache.dom.segs) || []) if (s.sub) disposePieces(s.sub);
}

// A kind defined, redefined or undefined: its widgets are measured again (the
// old pieces then go, the new ones are drawn by the new definition).
onKindChange(kind => {
    let any = false;
    for (const el of document.querySelectorAll('[data-nodelist-b64]')) {
        const block = blockOf(el);
        for (const i of block ? block.instances({ kind, placement: 'inline' }) : []) {
            versions.set(i.id, inlineVersion(i) + 1);
            any = true;
        }
    }
    if (any) scheduleSlots();
});
