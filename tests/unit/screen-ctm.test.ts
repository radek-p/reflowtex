// SPDX-License-Identifier: AGPL-3.0-or-later
// src/viewer/src/runtime/screen-ctm.ts: an SVG element's screen matrix with
// CSS zoom included, whether or not the browser's getScreenCTM() includes it.
// The browser is stood in for: its probe answer (the matrix of an SVG in a
// `zoom: 2` box) and the element's own matrix and ancestors' zoom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenCTM, effectiveZoom, resetZoomProbe } from '../../src/viewer/src/runtime/screen-ctm.ts';

class Matrix { a: number; b: number; c: number; d: number; e: number; f: number;
    constructor([a, b, c, d, e, f]: number[]) { this.a = a!; this.b = b!; this.c = c!; this.d = d!; this.e = e!; this.f = f!; } }

/** a page whose getScreenCTM() has (std) or lacks (legacy) CSS zoom; el sits in a zoom: 1.5 block */
function page(includesZoom: boolean) {
    const g = globalThis as Record<string, unknown>;
    g.DOMMatrix = Matrix;
    const probeSvg = { getScreenCTM: () => new Matrix(includesZoom ? [2, 0, 0, 2, 0, 0] : [1, 0, 0, 1, 0, 0]) };
    const body = { appendChild: () => {} };
    g.document = { body, documentElement: body, createElement: () => ({ style: {}, set innerHTML(_: string) {}, firstElementChild: probeSvg, remove: () => {} }) };
    const block = { zoom: '1.5', parentElement: null };
    const el = { zoom: '1', parentElement: block,
        // the page's matrix is scale 1.5 at (300, 150); a legacy browser divides it all by the zoom
        getScreenCTM: () => new Matrix(includesZoom ? [1.5, 0, 0, 1.5, 300, 150] : [1, 0, 0, 1, 200, 100]) };
    g.getComputedStyle = (e: { zoom: string }) => ({ zoom: e.zoom });
    resetZoomProbe();
    return el as unknown as Element;
}

test('a browser that includes zoom: the matrix as it gives it', () => {
    const m = screenCTM(page(true))!;
    assert.deepEqual([m.a, m.d, m.e, m.f], [1.5, 1.5, 300, 150]);
});

test('a browser that leaves zoom out (WebKit): the matrix scaled by the effective zoom, as the standard one', () => {
    const el = page(false);
    assert.equal(effectiveZoom(el), 1.5);
    const m = screenCTM(el)!;
    assert.deepEqual([m.a, m.d, m.e, m.f], [1.5, 1.5, 300, 150]);
});

test('no element or no matrix: null', () => {
    page(false);
    assert.equal(screenCTM(null), null);
});
