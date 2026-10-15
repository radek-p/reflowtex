// SPDX-License-Identifier: AGPL-3.0-or-later
// An SVG element's screen matrix with CSS `zoom` included, in every browser.
//
// A page may scale blocks with the CSS `zoom` property (a reader's text size).
// Chromium (128 and later) and Firefox include an ancestor's zoom in
// getScreenCTM(); WebKit leaves it out: its matrix is the page's divided by the
// zoom (scale 1, offsets divided), while getBoundingClientRect() and pointer
// events are in page pixels. Anything mapped through the raw matrix (a link's
// hit area, a footnote's anchor, a display's scroll) is then off by the zoom.
//
//   screenCTM(el)        el.getScreenCTM(), scaled by el's effective zoom where the browser leaves it out
//   effectiveZoom(el)    the product of the zoom of el and its ancestors
//   zoomInScreenCTM()    whether this browser's getScreenCTM() includes CSS zoom (measured once)

let withZoom: boolean | null = null;

/** Tests: measure again on the next call. */
export function resetZoomProbe(): void { withZoom = null; }

/** Measured once: the scale of an SVG's matrix inside a `zoom: 2` box. */
export function zoomInScreenCTM(): boolean {
    if (withZoom !== null) return withZoom;
    if (typeof document === 'undefined') return true;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:-10000px;top:0;zoom:2;visibility:hidden;pointer-events:none';
    box.innerHTML = '<svg width="10" height="10"><rect width="1" height="1"/></svg>';
    (document.body || document.documentElement).appendChild(box);
    const svg = box.firstElementChild as SVGSVGElement | null;
    const m = svg && svg.getScreenCTM ? svg.getScreenCTM() : null;
    box.remove();
    // no matrix (nothing laid out yet): assume the standard behaviour
    withZoom = !m || Math.abs(m.a - 1) > 0.01;
    return withZoom;
}

export function effectiveZoom(el: Element): number {
    let z = 1;
    for (let e: Element | null = el; e; e = e.parentElement) {
        const v = parseFloat(getComputedStyle(e).zoom);
        if (v > 0 && v !== 1) z *= v;
    }
    return z;
}

export function screenCTM(el: Element | null | undefined): DOMMatrix | null {
    const g = el as SVGGraphicsElement | null | undefined;
    const m = g && g.getScreenCTM ? g.getScreenCTM() : null;
    if (!m || !g || zoomInScreenCTM()) return m;
    const z = effectiveZoom(g);
    return z === 1 ? m : new DOMMatrix([m.a * z, m.b * z, m.c * z, m.d * z, m.e * z, m.f * z]);
}
