// SPDX-License-Identifier: AGPL-3.0-or-later
// Motion settings, from CSS: a component `name` reads --rtx-NAME-duration,
// --rtx-NAME-easing and --rtx-NAME-motion on its element, falling back to
// the global --rtx-duration and --rtx-easing (companion.css sets both on
// :root). An author's parameter motion=… wins over the CSS. The reader's
// prefers-reduced-motion turns every movement into a plain cut.

export interface Motion {
    /** ms; 0 for none. */
    duration: number;
    easing: string;
    /** The component's own names for what moves ('slide', 'fade', 'none'). */
    style: string;
}

const DEFAULT = { duration: 280, easing: 'cubic-bezier(.22, .8, .26, 1)' };

function time(v: string): number | null {
    const m = /^(-?[\d.]+)(ms|s)$/.exec(v.trim());
    return m ? parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
}

export function readMotion(el: Element, name: string, fallbackStyle: string, attr?: string): Motion {
    const cs = getComputedStyle(el), get = (p: string) => cs.getPropertyValue(p).trim();
    const style = (attr || get(`--rtx-${name}-motion`) || fallbackStyle).toLowerCase();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = time(get(`--rtx-${name}-duration`)) ?? time(get('--rtx-duration')) ?? DEFAULT.duration;
    return {
        duration: reduce || style === 'none' ? 0 : Math.max(0, duration),
        easing: get(`--rtx-${name}-easing`) || get('--rtx-easing') || DEFAULT.easing,
        style,
    };
}
