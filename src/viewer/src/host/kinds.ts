// SPDX-License-Identifier: AGPL-3.0-or-later
// The one registry of kinds the page draws (host.define, types.ts KindDef),
// for every placement. Each placement's module (block-hosts.ts, inline.ts,
// the margin notes) subscribes, to draw its instances of a kind again when
// the kind is defined, redefined or undefined.
import type { KindDef } from './types.ts';

const kinds = new Map<string, KindDef>();
const listeners = new Set<(kind: string) => void>();

export const kindDef = (kind: string): KindDef | undefined => kinds.get(kind);

export function onKindChange(fn: (kind: string) => void): void { listeners.add(fn); }

function changed(kind: string) {
    for (const fn of listeners) {
        try { fn(kind); } catch (e) { console.error(`[latex-viewer] redrawing kind "${kind}":`, e); }
    }
}

export function defineKind(kind: string, def: KindDef): () => void {
    if (!def || typeof def.render !== 'function')
        throw new TypeError(`host.define("${kind}"): render(instance, host) is required`);
    kinds.set(kind, def);
    changed(kind);
    return () => {
        if (kinds.get(kind) !== def) return;
        kinds.delete(kind);
        changed(kind);
    };
}
