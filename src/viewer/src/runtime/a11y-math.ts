// SPDX-License-Identifier: AGPL-3.0-or-later
// The layer's formulas put in place. A page ships each formula's MathML in a
// <noscript data-mathml> (src/pipeline/a11y.ts, shippedMath), as text while
// scripts run, and a script right after the layer inserts them (INSERT_MATH).
// Where that script did not run – a page that forbids inline scripts, HTML a
// host inserted by script – the viewer does it here, the same way: each
// formula parsed off the page and inserted whole, in one step, so no
// browser ever lays out a formula missing a part (an <mfrac> with one child).

/** Every shipped formula under `root` put in place, as LaTeX wrote it. */
export function insertShippedMath(root: ParentNode): void {
    for (const n of root.querySelectorAll('noscript[data-mathml]')) {
        const t = document.createElement('template');
        // (a <noscript> parsed with scripts off – by a DOMParser, say – holds
        // the MathML as elements, not as text)
        t.innerHTML = n.firstElementChild ? n.innerHTML : n.textContent || '';
        n.replaceWith(t.content);
    }
}
