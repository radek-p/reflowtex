// SPDX-License-Identifier: AGPL-3.0-or-later
// Components declared in HTML: <div data-rtx="NAME" data-KEY="value"></div>
// is drawn by the component registered under NAME, with each data-KEY as a
// prop (camelCase; "true" and "false" as booleans, numbers as numbers).
// The companion draws every such element when it loads, and any added later
// with mountAll(). A page registers its own: registerElement(name, Component).
import { h, render, type ComponentType } from 'preact';

const elements = new Map<string, ComponentType<any>>();
const mounted = new WeakSet<Element>();

export function registerElement(name: string, View: ComponentType<any>): void {
    elements.set(name, View);
    mountAll();
}

function props(el: HTMLElement): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el.dataset)) {
        if (k === 'rtx' || v === undefined) continue;
        out[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && isFinite(Number(v)) ? Number(v) : v;
    }
    return out;
}

/** Draw every [data-rtx] element under `root` not drawn yet. */
export function mountAll(root: ParentNode = document): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-rtx]')) {
        const View = elements.get(el.dataset.rtx || '');
        if (!View || mounted.has(el)) continue;
        mounted.add(el);
        render(h(View, props(el)), el);
    }
}
