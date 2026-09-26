// SPDX-License-Identifier: AGPL-3.0-or-later
// The instance a component draws, and the hooks that read it.
import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals';
import type { BlockHost, Instance } from './host.ts';

export interface InstanceScope {
    instance: Instance;
    /** Present when the instance is a block drawn in the flow (defineBlock). */
    host?: BlockHost;
}
export const InstanceContext = createContext<InstanceScope | null>(null);

function scope(hook: string): InstanceScope {
    const s = useContext(InstanceContext);
    if (!s) throw new Error(`${hook}: only inside a component drawn by defineBlock`);
    return s;
}

/** The instance being drawn. */
export const useInstance = (): Instance => scope('useInstance').instance;

/** The author's parameters: \begin{…}[key=value]. */
export const useAttrs = (): Readonly<Record<string, string>> => scope('useAttrs').instance.attrs;

/** Where a block instance stands in the flow (its element: host.el). */
export function useBlockHost(): BlockHost {
    const s = scope('useBlockHost');
    if (!s.host) throw new Error('useBlockHost: the instance is not a block in the flow');
    return s.host;
}

// State outlives the component: the viewer may draw an instance again (a
// kind defined again, the same part shown in two places), and the reader's
// choice – the pane they opened – should still stand. Keyed by instance id.
const states = new Map<string, Signal<unknown>>();

/** A signal belonging to the instance, under `key`: the same one wherever
 *  and however often the instance is drawn. Read `.value` to re-render on
 *  change. */
export function useInstanceState<T>(key: string, initial: T | (() => T)): Signal<T> {
    const id = `${useInstance().id}|${key}`;
    let s = states.get(id) as Signal<T> | undefined;
    if (!s) {
        s = signal(typeof initial === 'function' ? (initial as () => T)() : initial);
        states.set(id, s as Signal<unknown>);
    }
    return s;
}

/** What an action carries: \webaction{verb:argument}{text} – the verb and
 *  the rest, and the glyph the reader pressed. */
export interface Action { verb: string; arg: string; source: Element | null }

/** Handle the reader's actions of one verb from inside the instance's
 *  element (\webaction links in its typeset parts). Return false to leave
 *  one to an enclosing instance; anything else stops it here. */
export function useAction(verb: string, handler: (action: Action) => boolean | void): void {
    const { host } = scope('useAction');
    const h = useRef(handler);
    h.current = handler;
    useLayoutEffect(() => {
        const el = host?.el;
        if (!el) return;
        const on = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            const text = String(d.action || ''), i = text.indexOf(':');
            const action = { verb: i < 0 ? text : text.slice(0, i), arg: i < 0 ? '' : text.slice(i + 1), source: d.source || null };
            if (action.verb !== verb) return;
            if (h.current(action) !== false) e.stopPropagation();
        };
        el.addEventListener('reflowtex:action', on);
        return () => el.removeEventListener('reflowtex:action', on);
    }, [host, verb]);
}
