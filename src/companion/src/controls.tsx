// SPDX-License-Identifier: AGPL-3.0-or-later
// Building blocks for kinds of one's own.
//
//   <InlineButton env onPress pressed label>…</InlineButton>
//       a pill in a line of text, for an inline widget, around anything (a
//       <Typeset width="natural" /> label, say); InlineButton.size(env,
//       contentWidth) is its size for the widget's measure.
//   <Popover anchor onClose>…</Popover>
//       a panel below an element, closed by Escape, a click outside, or
//       scrolling; what is inside keeps the instance it was drawn for.
import { render, type ComponentChildren } from 'preact';
import { useContext, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { InstanceContext } from './context.ts';
import type { Box, InlineEnv } from './host.ts';

/** The pill's box around its content: `up` em above the text's baseline,
 *  `down` below, the content `side` em from either end. */
export const PILL = { up: 0.9, down: 0.45, side: 0.55 };

export function InlineButton({ env, onPress, pressed, label, class: cls = '', metrics = PILL, children }: {
    env: InlineEnv; onPress?: (e: MouseEvent) => void; pressed?: boolean; label?: string; class?: string;
    metrics?: typeof PILL; children?: ComponentChildren;
}) {
    const em = env.fontSize, inside = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        // Measured, not worked out: where a typeset label's first baseline is
        // against where it should be (metrics.up em below the button's top),
        // the content moved by the difference. A piece is drawn before the
        // viewer puts it in the page: measure once it is there.
        const fit = () => {
            const el = inside.current, box = el && el.querySelector<HTMLElement>('.latex-part[data-baseline]');
            if (!el || !box || !el.isConnected) return false;
            const button = el.parentElement!, k = button.getBoundingClientRect().height / button.offsetHeight || 1;
            const want = button.getBoundingClientRect().top + metrics.up * em * k;
            const have = box.getBoundingClientRect().top + parseFloat(box.dataset.baseline || '0') * k;
            el.style.top = (parseFloat(el.style.top) || 0) + (want - have) / k + 'px';
            return true;
        };
        if (!fit()) { const f = requestAnimationFrame(() => fit()); return () => cancelAnimationFrame(f); }
    });
    return (
        <button type="button" class={'rtx-button ' + cls} onClick={onPress} aria-label={label}
                aria-expanded={pressed === undefined ? undefined : pressed}>
            <span class="rtx-button-content" ref={inside} style={{ left: metrics.side * em + 'px' }}>{children}</span>
        </button>);
}
InlineButton.size = (env: InlineEnv, contentWidth: number, metrics = PILL): Box => {
    const em = env.fontSize;
    return { width: contentWidth + 2 * metrics.side * em, height: metrics.up * em, depth: metrics.down * em };
};

export function Popover({ anchor, onClose, children, class: cls = '' }: {
    anchor: HTMLElement; onClose: () => void; children?: ComponentChildren; class?: string;
}) {
    const scope = useContext(InstanceContext);
    const host = useMemo(() => document.createElement('div'), []);
    useLayoutEffect(() => {
        document.body.appendChild(host);
        return () => { render(null, host); host.remove(); };
    }, [host]);
    useLayoutEffect(() => {
        render(<InstanceContext.Provider value={scope}>
                   <div class={'rtx-popover ' + cls} role="dialog">{children}</div>
               </InstanceContext.Provider>, host);
        const panel = host.firstChild as HTMLElement, r = anchor.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
        panel.style.top = r.bottom + 6 + 'px';
    });
    // Before the first paint, so a key pressed as soon as it shows counts.
    useLayoutEffect(() => {
        const away = (e: Event) => { if (!host.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus?.(); } };
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
