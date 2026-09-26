// SPDX-License-Identifier: AGPL-3.0-or-later
// <Typeset>: an instance's typeset part, laid out by the viewer where the
// component puts it.
import type { JSX } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { InstanceContext } from './context.ts';
import type { Instance, MountOptions, Part, Surface, SurfaceMetrics } from './host.ts';

export interface TypesetProps {
    /** A role of the instance ('body', the default), or a part itself. */
    part?: string | Part;
    /** Whose part: the instance being drawn, unless given (a child). */
    of?: Instance;
    /** 'container' (the default: this element's width, followed), 'natural'
     *  (every paragraph on one line) or px. */
    width?: MountOptions['width'];
    /** This part's first and last lines stand for the block's edges in the
     *  text, for the spacing TeX puts around it (see BlockHost.setEdges).
     *  The block's own body is its edge without asking. */
    edge?: 'both' | 'top' | 'bottom';
    /** Told the size and first baseline after every layout. */
    onMetrics?: (metrics: SurfaceMetrics, surface: Surface) => void;
    class?: string;
    style?: JSX.CSSProperties | string;
}

export function Typeset({ part = 'body', of, width = 'container', edge, onMetrics, class: cls, style }: TypesetProps) {
    const scope = useContext(InstanceContext);
    const instance = of ?? scope?.instance;
    const p = typeof part === 'string' ? instance?.part(part) : part;
    const ref = useRef<HTMLDivElement>(null);
    const surface = useRef<Surface | null>(null);
    const told = useRef(onMetrics);
    told.current = onMetrics;

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !p || p.type !== 'typeset') return;
        const s = surface.current = p.mount(el, { width });
        const off = s.onChange(m => told.current?.(m, s));
        told.current?.(s.metrics(), s);
        return () => { off(); s.dispose(); surface.current = null; };
    }, [p, width]);

    useLayoutEffect(() => {
        const s = surface.current, host = scope?.host;
        if (!s || !host || host.type === 'piece' || !edge) return;
        host.setEdges(edge === 'top' ? { top: s } : edge === 'bottom' ? { bottom: s } : { top: s, bottom: s });
    }, [edge, p, width]);

    // The surface fills this element; Preact leaves what it did not make alone.
    return <div ref={ref} class={cls ? `rtx-typeset ${cls}` : 'rtx-typeset'} style={style} />;
}
