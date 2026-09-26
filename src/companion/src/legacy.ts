// SPDX-License-Identifier: AGPL-3.0-or-later
// The first version's API, over the viewer's previous registries
// (reflowtex.widgets, reflowtex.marginNotes, aside handles): kept, unchanged
// in behaviour, until inline kinds and placements move to the host API (plan
// stages 3 and 5). New code should not start here.
//
//   widget(name, { size(ctx), render })  a \webwidget drawn by a component
//   <Aside aside width onDrawn>           an aside handle, typeset
//   <InlineButton ctx onPress pressed>    a pill in a line of text
//   <Popover anchor onClose>              a panel below an element
//   marginNote(kind, Component)           a kind of margin note
import { h, render, type ComponentChildren, type ComponentType } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';

type Rtx = Record<string, any>;
const rtx = (): Rtx => (window.reflowtex = window.reflowtex || {}) as Rtx;

export function widget(name: string, { size, render: View, splits }:
        { size: (ctx: any) => object; render: ComponentType<any>; splits?: (ctx: any) => unknown }) {
    const r = rtx();
    r.widgets = r.widgets || {};
    r.widgets[name] = {
        measure: (ctx: any) => ({ ...size(ctx), ...(splits ? { splits: splits(ctx) } : {}) }),
        render: (el: Element, part: unknown, ctx: any) => render(h(View, { ctx, part }), el),
    };
    if (r.refreshWidgets) r.refreshWidgets();
}

export function Aside({ aside, width = 'natural', onDrawn }:
        { aside: any; width?: number | 'natural' | 'fill'; onDrawn?: (drawn: any, el: HTMLElement) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!aside || !el) return;
        let w: number | undefined = width === 'natural' ? undefined : width as number;
        if (width === 'fill') {
            const box = el.parentElement!, cs = getComputedStyle(box);
            w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        }
        const drawn = aside.render(el, w);
        if (onDrawn) onDrawn(drawn, el);
    }, [aside, width]);
    return h('div', { class: 'rtx-aside', ref });
}

export const PILL = { up: 0.9, down: 0.45, side: 0.55 };
export function InlineButton({ ctx, onPress, pressed, label, class: cls = '', metrics = PILL, children }:
        { ctx: any; onPress?: (e: MouseEvent) => void; pressed?: boolean; label?: string; class?: string;
          metrics?: typeof PILL; children?: ComponentChildren }) {
    const em = ctx.fontSize, inside = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        // Measured: the label's baseline against where it should be
        // (metrics.up em below the button's top), moved by the difference.
        // A widget is drawn before the viewer puts it in the page: measure
        // once it is there.
        const fit = () => {
            const el = inside.current, box = el && el.querySelector<HTMLElement>('.latex-aside[data-baseline]');
            if (!el || !box || !el.isConnected) return false;
            const button = el.parentElement!, k = button.getBoundingClientRect().height / button.offsetHeight || 1;
            const want = button.getBoundingClientRect().top + metrics.up * em * k;
            const have = box.getBoundingClientRect().top + parseFloat(box.dataset.baseline || '0') * k;
            el.style.top = (parseFloat(el.style.top) || 0) + (want - have) / k + 'px';
            return true;
        };
        if (!fit()) { const f = requestAnimationFrame(() => fit()); return () => cancelAnimationFrame(f); }
    });
    return h('button', { type: 'button', class: 'rtx-button ' + cls, onClick: onPress, 'aria-label': label,
                         'aria-expanded': pressed === undefined ? undefined : String(!!pressed) },
             h('span', { class: 'rtx-button-content', ref: inside, style: { left: metrics.side * em + 'px' } }, children));
}
InlineButton.size = (ctx: any, contentWidth: number, metrics = PILL) => {
    const em = ctx.fontSize;
    return { width: contentWidth + 2 * metrics.side * em, height: metrics.up * em, depth: metrics.down * em };
};

export function Popover({ anchor, onClose, children, className = '' }:
        { anchor: HTMLElement; onClose: () => void; children?: ComponentChildren; className?: string }) {
    const host = useMemo(() => document.createElement('div'), []);
    useLayoutEffect(() => {
        document.body.appendChild(host);
        return () => { render(null, host); host.remove(); };
    }, [host]);
    useLayoutEffect(() => {
        render(h('div', { class: 'rtx-popover ' + className, role: 'dialog' }, children), host);
        const panel = host.firstChild as HTMLElement, r = anchor.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
        panel.style.top = r.bottom + 6 + 'px';
    });
    // Before the first paint, so a key pressed as soon as it shows counts.
    useLayoutEffect(() => {
        const away = (e: Event) => { if (!host.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus && anchor.focus(); } };
        document.addEventListener('pointerdown', away);
        document.addEventListener('keydown', key);
        window.addEventListener('scroll', onClose, { passive: true });
        return () => {
            document.removeEventListener('pointerdown', away);
            document.removeEventListener('keydown', key);
            window.removeEventListener('scroll', onClose);
        };
    }, [anchor, onClose]);
    return null;
}

export function marginNote(kind: string, View: ComponentType<{ aside: any; width: number }>) {
    const r = rtx();
    r.marginNotes = r.marginNotes || {};
    r.marginNotes[kind] = (el: Element, aside: any, width: number) => render(h(View, { aside, width }), el);
}
