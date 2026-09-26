// SPDX-License-Identifier: AGPL-3.0-or-later
// Actions (\webaction{verb:arg}{text}): what the reader presses in the text,
// routed to the instances that handle it (Instance.onAction, types.ts).
//
// A control stands in some instance's text: the nearest element marked
// data-instance around it – a surface's box (its part's instance), a
// stream's box – or none, in the block's own text. A press goes to that
// instance and then outward
// through its parents – the tree the TeX made, not the DOM, so a control
// in a part drawn in a popover or the margin still reaches its owner – to
// the first handler for the verb that does not return false. Either way
// the glyph then sends `reflowtex:action` (bubbling) for page scripts:
// detail { action, verb, arg, source, instance, handled }.
import type { Action, Instance } from './types.ts';
import { host } from './host.ts';

type Handler = (a: Action) => boolean | void;
const handlers = new WeakMap<Instance, Map<string, Set<Handler>>>();

export function onAction(instance: Instance, verb: string, fn: Handler): () => void {
    let byVerb = handlers.get(instance);
    if (!byVerb) handlers.set(instance, byVerb = new Map());
    let set = byVerb.get(verb);
    if (!set) byVerb.set(verb, set = new Set());
    set.add(fn);
    return () => { set!.delete(fn); };
}


export function parseAction(text: string): { verb: string; arg: string } {
    const i = text.indexOf(':');
    return { verb: i < 0 ? text : text.slice(0, i), arg: i < 0 ? '' : text.slice(i + 1) };
}

/** The reader pressed `source`, a control sending `text`. */
export function dispatchAction(source: Element, text: string): void {
    const { verb, arg } = parseAction(text);
    const marked = source.closest('[data-instance]') as HTMLElement | null;
    const origin = (marked && host.find(marked.dataset.instance || '')) || null;
    const action: Action = { verb, arg, action: text, instance: origin, source };
    let handled = false;
    for (let i: Instance | null = origin; i && !handled; i = i.parent) {
        for (const fn of handlers.get(i)?.get(verb) || []) {
            let r: boolean | void;
            try { r = fn(action); } catch (e) { console.error(`[latex-viewer] action "${text}":`, e); r = undefined; }
            if (r !== false) { handled = true; break; }
        }
    }
    source.dispatchEvent(new CustomEvent('reflowtex:action', {
        bubbles: true, detail: { ...action, handled } }));
}
