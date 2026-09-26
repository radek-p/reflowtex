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

// ── Building blocks ───────────────────────────────────────────────────────
// For components that show and hide typeset parts. A part's text is laid
// out by the viewer at its container's width, one frame after that width
// changes – so a height is measured only once that has happened.

const frames = (n: number) => new Promise<void>(r => {
    const step = () => (--n <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
});

/** Ease `el`'s height from `from` (px, measured before a change) to what it
 *  is after the change. The height is held at `from` for two frames, while
 *  the typeset parts inside settle at their new widths, then animated;
 *  what overflows is clipped below (data-animating) until the end. */
export async function animateHeight(el: HTMLElement, from: number, m: Motion): Promise<void> {
    if (!m.duration) return;
    el.style.height = `${from}px`;
    el.dataset.animating = '';
    await frames(2);
    el.style.height = '';
    const to = el.offsetHeight;
    if (Math.abs(to - from) >= 1) {
        const a = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: m.duration, easing: m.easing });
        try { await a.finished; } catch { /* cancelled */ }
    }
    delete el.dataset.animating;
}

/** Fade (and, for style slide, lift) an element in. */
export function fadeIn(el: Element, m: Motion, dy = 8): Animation | null {
    if (!m.duration) return null;
    const t = m.style === 'slide' ? `translateY(${dy}px)` : 'none';
    return el.animate([{ opacity: 0, transform: t }, { opacity: 1, transform: 'none' }],
                      { duration: m.duration, easing: m.easing });
}

/** Fade an element out; resolves when it has (at once without motion). */
export async function fadeOut(el: Element, m: Motion, dy = 8): Promise<void> {
    if (!m.duration) return;
    const t = m.style === 'slide' ? `translateY(${-dy}px)` : 'none';
    const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: t }],
                         { duration: m.duration * 0.45, easing: m.easing, fill: 'forwards' });
    try { await a.finished; } catch { /* cancelled */ }
    a.cancel();
}
