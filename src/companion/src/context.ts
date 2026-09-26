// SPDX-License-Identifier: AGPL-3.0-or-later
// The instance a component draws, and the hooks that read it.
import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals';
import type { Action, AnyHost, BlockHost, Instance, NoteHost, PieceHost } from './host.ts';

export interface InstanceScope {
    instance: Instance;
    /** Where it is drawn: a block in the flow, a margin note or a popover
     *  (define), or one piece of an inline widget (defineInline). */
    host?: AnyHost;
}
export const InstanceContext = createContext<InstanceScope | null>(null);

function scope(hook: string): InstanceScope {
    const s = useContext(InstanceContext);
    if (!s) throw new Error(`${hook}: only inside a component drawn by define or defineInline`);
    return s;
}

/** The instance being drawn. */
export const useInstance = (): Instance => scope('useInstance').instance;

/** The author's parameters: \begin{…}[key=value]. */
export const useAttrs = (): Readonly<Record<string, string>> => scope('useAttrs').instance.attrs;

/** Where the instance is drawn: host.type is 'block', 'margin', 'popover'
 *  or 'piece'; host.el its element. */
export function useHost(): AnyHost {
    const h = scope('useHost').host;
    if (!h) throw new Error('useHost: the instance is not being drawn');
    return h;
}

/** Where a block instance stands in the flow (host.el, setFrame, setEdges,
 *  spacing). */
export function useBlockHost(): BlockHost {
    const h = scope('useBlockHost').host;
    if (!h || h.type !== 'block') throw new Error('useBlockHost: not a block in the flow');
    return h;
}

/** Where a detached instance is shown: the margin or a popover. */
export function useNoteHost(): NoteHost {
    const h = scope('useNoteHost').host;
    if (!h || (h.type !== 'margin' && h.type !== 'popover')) throw new Error('useNoteHost: not a margin note or a popover');
    return h;
}

/** The piece of an inline widget being drawn: which part (host.piece), its
 *  element, and the text's environment (host.env). */
export function usePiece(): PieceHost {
    const h = scope('usePiece').host;
    if (!h || h.type !== 'piece') throw new Error('usePiece: not a piece of an inline widget');
    return h;
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

export type { Action };

/** Handle the reader's actions of one verb (\webaction{verb:arg}{…}) pressed
 *  in this instance's text, or in any instance inside it, wherever its parts
 *  are shown. Return false to leave one to an enclosing instance. */
export function useAction(verb: string, handler: (action: Action) => boolean | void): void {
    const { instance } = scope('useAction');
    const h = useRef(handler);
    h.current = handler;
    useLayoutEffect(() => instance.onAction(verb, a => h.current(a)), [instance, verb]);
}
