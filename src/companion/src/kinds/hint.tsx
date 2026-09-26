// SPDX-License-Identifier: AGPL-3.0-or-later
// A hint (reflowtex.sty's webhint): blurred until the reader presses it
// (click, Enter or Space), blurred again by the next press. A press on a
// link inside, or one that ends a text selection, leaves it as it is. The
// reader's choice outlives redraws. The look is companion.css: the blur and
// its label ease out and in; [data-revealed] marks it revealed.
import { useLayoutEffect } from 'preact/hooks';
import { useInstanceState } from '../context.ts';
import type { BlockProps } from '../define.tsx';
import { Typeset } from '../typeset.tsx';

export function Hint({ host }: BlockProps) {
    const revealed = useInstanceState('revealed', false);
    const on = revealed.value;

    // The element is the viewer's (it stands in the flow); its role, focus and
    // state are set on it, as it is what the reader presses.
    useLayoutEffect(() => {
        const el = host.el;
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        const toggle = () => { revealed.value = !revealed.value; };
        const click = (e: MouseEvent) => {
            if ((e.target as Element).closest?.('[data-link]')) return;
            if (revealed.value && String(getSelection()).trim()) return;
            toggle();
        };
        const key = (e: KeyboardEvent) => {
            if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault(); toggle();
        };
        el.addEventListener('click', click);
        el.addEventListener('keydown', key);
        return () => {
            el.removeEventListener('click', click);
            el.removeEventListener('keydown', key);
            for (const a of ['role', 'tabindex', 'aria-pressed', 'aria-label', 'data-revealed']) el.removeAttribute(a);
        };
    }, [host]);

    useLayoutEffect(() => {
        const el = host.el;
        el.toggleAttribute('data-revealed', on);
        el.setAttribute('aria-pressed', String(on));
        el.setAttribute('aria-label', on ? 'Hint, shown: press to hide' : 'Hint, hidden: press to reveal');
    }, [on]);

    return <Typeset />;
}
