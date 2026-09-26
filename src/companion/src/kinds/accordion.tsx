// SPDX-License-Identifier: AGPL-3.0-or-later
// The accordion (reflowtex.sty's webaccordion, webpane): one pane shown at a
// time, switched by \webpanelink / \webnextpane / \webprevpane in the panes'
// text – actions "pane:next", "pane:prev", "pane:first", "pane:last",
// "pane:NAME", "pane:NUMBER".
//
// Switching animates: the accordion's height eases from the old pane's to
// the new one's, while the old pane fades out where it was and the new one
// fades (and, by default, slides) in. What follows the accordion on the page
// moves with its height. Tuned from CSS or from the author's parameters:
//
//   --rtx-accordion-motion    slide (default) · fade · none   or motion=…
//   --rtx-accordion-duration  default --rtx-duration (280ms)
//   --rtx-accordion-easing    default --rtx-easing
//
// and the reader's prefers-reduced-motion makes it a plain cut. The look is
// companion.css: variant=card | outline, --rtx-accordion-* and the global
// --rtx-* tokens; the state is on the elements for CSS of one's own:
//   .rtx-accordion[data-pane=NAME]     the pane showing
//   .rtx-pane[data-state=open|closed|leaving][data-name=NAME]
//
// Every pane stays laid out (a closed one takes no height but keeps the
// accordion's width, and is painted as it nears the screen), so a pane
// opens at once, drawn, at the right width.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAction, useInstanceState } from '../context.ts';
import type { BlockProps } from '../define.tsx';
import type { Instance } from '../host.ts';
import { readMotion } from '../motion.ts';
import { Typeset } from '../typeset.tsx';

/** A pane by what an action or a parameter names: first, last, next, prev,
 *  a name, or a number from 1. -1: none. */
export function findPane(panes: readonly Instance[], target: string, current: number): number {
    const t = target.trim();
    if (t === 'first') return 0;
    if (t === 'last') return panes.length - 1;
    if (t === 'next') return Math.min(current + 1, panes.length - 1);
    if (t === 'prev') return Math.max(current - 1, 0);
    const byName = panes.findIndex(p => p.attrs.name === t);
    if (byName >= 0) return byName;
    const n = parseInt(t, 10);
    return n >= 1 && n <= panes.length ? n - 1 : -1;
}

interface Pending { from: number; height: number; focus: boolean }

export function Accordion({ instance, attrs }: BlockProps) {
    const panes = instance.children.filter(c => c.kind === 'pane' && c.placement === 'block');
    const active = useInstanceState('pane', () => Math.max(0, findPane(panes, attrs.initial || '1', 0)));
    const [leaving, setLeaving] = useState<number | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const paneEls = useRef<(HTMLDivElement | null)[]>([]);
    const pending = useRef<Pending | null>(null);
    const running = useRef<Animation[]>([]);
    const cur = Math.min(active.value, Math.max(0, panes.length - 1));
    const printAt = findPane(panes, attrs.print || 'last', cur);

    useAction('pane', ({ arg, source }) => {
        const i = findPane(panes, arg, active.value);
        if (i < 0) return false;                    // not one of ours: an outer accordion's
        if (i === active.value || !root.current) return;
        // Keyboard focus was on the control just pressed, which is about to
        // be hidden: it goes to the new pane's first control (a mouse click
        // focuses the glyph too, but then there is no focus ring to move).
        const a = document.activeElement as HTMLElement | null, s = source as HTMLElement | null;
        const focus = !!(a && s && a.dataset?.link && a.dataset.link === s.dataset?.link && a.matches(':focus-visible'));
        for (const an of running.current) an.cancel();
        running.current = [];
        pending.current = { from: active.value, height: root.current.offsetHeight, focus };
        setLeaving(active.value);
        active.value = i;
    });

    useLayoutEffect(() => {
        const p = pending.current, el = root.current;
        pending.current = null;
        if (!p || !el) return;
        const incoming = paneEls.current[cur], outgoing = paneEls.current[p.from];
        if (p.focus) incoming?.querySelector<HTMLElement>('.latex-action[tabindex]')?.focus({ preventScroll: true });
        const m = readMotion(el, 'accordion', 'slide', attrs.motion);
        const to = el.offsetHeight;
        if (!m.duration) { delete el.dataset.animating; setLeaving(null); return; }
        el.dataset.animating = '';
        const timing = { duration: m.duration, easing: m.easing };
        const dy = m.style === 'slide' ? (cur > p.from ? 1 : -1) * 10 : 0;
        const anims = [el.animate([{ height: `${p.height}px` }, { height: `${to}px` }], timing)];
        if (incoming) anims.push(incoming.animate(
            [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], timing));
        if (outgoing) anims.push(outgoing.animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-dy}px)` }],
            { ...timing, duration: m.duration * 0.6, fill: 'forwards' }));
        running.current = anims;
        anims[0].finished.then(() => {
            if (running.current !== anims) return;
            running.current = [];
            for (const an of anims) an.cancel();       // drop the outgoing pane's held end state
            delete el.dataset.animating;
            setLeaving(null);
        }, () => {});                                  // cancelled by the next switch
    }, [cur]);

    if (!panes.length) return <Typeset />;
    const name = (i: number) => panes[i]?.attrs.name || String(i + 1);
    return (
        <div ref={root} class="rtx-accordion" data-pane={name(cur)}>
            {panes.map((p, i) => {
                const state = i === cur ? 'open' : i === leaving ? 'leaving' : 'closed';
                return (
                    <div key={p.id} ref={e => { paneEls.current[i] = e; }}
                         class={['rtx-pane', ...p.presentation.classes].join(' ')}
                         style={p.presentation.properties as Record<string, string>}
                         data-state={state} data-name={p.attrs.name || undefined}
                         data-print={i === printAt ? '' : undefined}
                         inert={state !== 'open'} aria-hidden={state !== 'open' ? 'true' : undefined}>
                        <Typeset of={p} edge={i === cur ? 'both' : undefined} />
                    </div>
                );
            })}
        </div>
    );
}
