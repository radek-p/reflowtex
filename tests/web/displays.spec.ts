// SPDX-License-Identifier: AGPL-3.0-or-later
// Wide displays and the host API: the fade where a display's scroll box cuts
// it off, switched per block, per view and for the host
// (setDisplayFade), and scrolling one so that a point of it is in view
// (revealInDisplay), for example to keep a caret visible.
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

/** The page's first two blocks at 400 px, as window.__A and window.__B. */
async function narrow(page: WebPage) {
  await page.evaluate(() => {
    const els = document.querySelectorAll<HTMLElement>('.latex-block[data-nodelist-b64]');
    for (const el of els) el.style.width = '400px';
    window.__A = reflowtex.host.block(els[0]);
    window.__B = reflowtex.host.block(els[1]);
    // Whether an element's display box is masked (the fade), and its state.
    window.__masked = (wrap: Element) => {
      const cs = getComputedStyle(wrap) as CSSStyleDeclaration & { webkitMaskImage?: string };
      return [cs.maskImage, cs.webkitMaskImage].some(v => !!v && v !== 'none');
    };
    window.__wrap = (b: any) => b.el.querySelector('.latex-display');
  });
  await idle(page);
}
/** For each of the named blocks: has a scroll box, is masked, the API's word. */
const fades = (page: WebPage, ...which: string[]) => page.evaluate(ws => ws.map(w => {
  const b = window[w], wrap = window.__wrap(b);
  return { wrap: !!wrap, masked: !!wrap && window.__masked(wrap), api: b.displayFade() };
}), which);

test('a wide display fades by default', async ({ openPage }) => {
  const page = await openPage('displays');
  await narrow(page);
  expect(await page.evaluate(() => reflowtex.host.displayFade())).toBe(true);
  expect(await fades(page, '__A', '__B')).toEqual([{ wrap: true, masked: true, api: true },
                                                    { wrap: true, masked: true, api: true }]);
  const cue = await page.evaluate(() => window.__wrap(window.__A).className);
  expect(cue).toContain('latex-overflow-right');
});

test('the fade turned off for one block; the host default for those without their own', async ({ openPage }) => {
  const page = await openPage('displays');
  await narrow(page);
  await page.evaluate(() => window.__B.setDisplayFade(false));
  await idle(page);
  expect(await fades(page, '__A', '__B')).toEqual([{ wrap: true, masked: true, api: true },
                                                    { wrap: true, masked: false, api: false }]);
  // The host's default reaches A, which has no setting of its own.
  await page.evaluate(() => reflowtex.host.setDisplayFade(false));
  await idle(page);
  expect((await fades(page, '__A', '__B')).map(f => f.masked)).toEqual([false, false]);
  await page.evaluate(() => { reflowtex.host.setDisplayFade(true); window.__B.setDisplayFade(false); });
  await idle(page);
  expect((await fades(page, '__A', '__B')).map(f => f.masked)).toEqual([true, false]);
  // B's own setting stays until it follows the host again.
  await page.evaluate(() => window.__B.setDisplayFade(null));
  await idle(page);
  expect((await fades(page, '__A', '__B')).map(f => f.masked)).toEqual([true, true]);
  // Off, the whole box still scrolls.
  await page.evaluate(() => window.__B.setDisplayFade(false));
  const scrolls = await page.evaluate(() => { const w = window.__wrap(window.__B); return w.scrollWidth > w.clientWidth; });
  expect(scrolls).toBe(true);
});

test('toggling the fade keeps the scroll position and lays nothing out again', async ({ openPage }) => {
  const page = await openPage('displays');
  await narrow(page);
  await page.evaluate(() => {
    const w = window.__wrap(window.__A);
    w.scrollLeft = 120;
    window.__layouts = 0;
    window.__A.on('layout', () => window.__layouts++);
  });
  await idle(page);
  await page.evaluate(() => { window.__laid0 = reflowtex.inspect.state(window.__A.el).cache.layout.laid; });
  // What a relayout or a repaint would change: the layout itself, the paint
  // and layout counts, every <svg>'s box, every glyph's place.
  const snapshot = () => page.evaluate(() => {
    const A = window.__A, st = reflowtex.inspect.state(A.el), w = window.__wrap(A);
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 100) / 100); };
    return {
      sameLayout: st.cache.layout.laid === window.__laid0, paints: reflowtex.inspect.paints, layouts: window.__layouts,
      scrollLeft: w.scrollLeft, masked: window.__masked(w),
      svgs: [...A.el.querySelectorAll('svg')].map(box),
      glyphs: [...A.el.querySelectorAll('svg tspan')].map(t => `${t.getAttribute('x')},${t.getAttribute('y')}`).join(' '),
    };
  });
  const before = await snapshot();
  expect(before.scrollLeft).toBeGreaterThan(100);
  expect(before).toMatchObject({ sameLayout: true, masked: true, layouts: 0 });
  await page.evaluate(() => window.__A.setDisplayFade(false));
  await idle(page);
  expect(await snapshot()).toEqual({ ...before, masked: false });
  await page.evaluate(() => window.__A.setDisplayFade(true));
  await idle(page);
  expect(await snapshot()).toEqual(before);
});

/** Where display 0's point `x` (its own px) is on screen, and the box's edges
 *  and the column's (the block's), on screen too. */
const where = (page: WebPage, which: string, x: number) => page.evaluate(([w, x]) => {
  const b = window[w], wrap = window.__wrap(b), svg = wrap.querySelector('svg') as SVGSVGElement;
  const p = new DOMPoint(x, 0).matrixTransform(svg.getScreenCTM()!).x;
  const r = wrap.getBoundingClientRect(), col = b.el.getBoundingClientRect();
  return { p, box: [r.left + wrap.clientLeft, r.left + wrap.clientLeft + wrap.clientWidth], col: [col.left, col.right],
           scrollLeft: wrap.scrollLeft, width: svg.width.baseVal.value };
}, [which, x] as const);

test('revealInDisplay brings a far-right point into view, and back', async ({ openPage }) => {
  const page = await openPage('displays');
  await narrow(page);
  const { width } = await where(page, '__A', 0);
  const far = width - 2;
  const before = await where(page, '__A', far);
  expect(before.p).toBeGreaterThan(before.box[1]);              // out of sight
  // Fading: into the column, not the faded peek.
  expect(await page.evaluate(x => window.__A.revealInDisplay(0, x), far)).toBe(true);
  await idle(page);
  let at = await where(page, '__A', far);
  expect(at.scrollLeft).toBeGreaterThan(0);
  expect(at.p).toBeGreaterThanOrEqual(at.col[0] - 1);
  expect(at.p).toBeLessThanOrEqual(at.col[1] + 1);
  // Back to the start.
  await page.evaluate(() => window.__A.revealInDisplay(0, 0));
  await idle(page);
  at = await where(page, '__A', 0);
  expect(at.scrollLeft).toBe(0);
  // Not fading: anywhere in the whole box, less the margin asked for.
  await page.evaluate(x => { window.__A.setDisplayFade(false); window.__A.revealInDisplay(0, x, { margin: 10 }); }, far);
  await idle(page);
  at = await where(page, '__A', far);
  expect(at.p).toBeLessThanOrEqual(at.box[1] - 10 + 1);
  expect(at.p).toBeGreaterThan(at.col[1]);                    // in the margin, where it would have faded
  // A glyph given as itself: the display's last one, whole.
  await page.evaluate(() => window.__A.revealInDisplay(0, 0));
  const glyph = await page.evaluate(() => {
    const wrap = window.__wrap(window.__A), ts = [...wrap.querySelectorAll('tspan')] as SVGTextContentElement[];
    const last = ts.reduce((m, t) => parseFloat(t.getAttribute('x')!) > parseFloat(m.getAttribute('x')!) ? t : m);
    const ok = window.__A.revealInDisplay(last);
    const x = parseFloat(last.getAttribute('x')!), ctm = last.getScreenCTM()!;
    const a = new DOMPoint(x, 0).matrixTransform(ctm).x, b = new DOMPoint(x + last.getComputedTextLength(), 0).matrixTransform(ctm).x;
    const r = wrap.getBoundingClientRect();
    return { ok, a, b, box: [r.left + wrap.clientLeft, r.left + wrap.clientLeft + wrap.clientWidth] };
  });
  expect(glyph.ok).toBe(true);
  expect(glyph.a).toBeGreaterThanOrEqual(glyph.box[0] - 1);
  expect(glyph.b).toBeLessThanOrEqual(glyph.box[1] + 1);
  // No such display; and a point of a display that is not this block's.
  expect(await page.evaluate(() => [window.__A.revealInDisplay(5, 0),
    window.__A.revealInDisplay(window.__wrap(window.__B).querySelector('tspan'))])).toEqual([false, false]);
});

// A block whose display comes after a stream (a segment with no <svg> of its
// own): a glyph of the display, given as itself, is found past the stream.
test('revealInDisplay finds a display after a stream', async ({ openPage }) => {
  const page = await openPage('displays-streams');
  await narrow(page);
  const r = await page.evaluate(() => {
    const wrap = window.__wrap(window.__A);
    try { return { ok: window.__A.revealInDisplay(wrap.querySelector('tspan')), wrap: !!wrap }; }
    catch (e) { return { error: String(e) }; }
  });
  expect(r).toEqual({ ok: true, wrap: true });
});

test('a view turns the fade off for itself only, and reveals on its own', async ({ openPage }) => {
  const page = await openPage('displays');
  await narrow(page);
  await page.evaluate(async () => {
    const el = document.createElement('div');
    el.className = 'latex-block';
    el.style.width = '300px';
    document.body.append(el);
    window.__V = await reflowtex.host.mount(el, { of: window.__A, view: 'edit', displayFade: false });
  });
  await idle(page);
  expect(await fades(page, '__A', '__V')).toEqual([{ wrap: true, masked: true, api: true },
                                                    { wrap: true, masked: false, api: false }]);
  // The host's default does not reach the view's own setting; the block follows it.
  await page.evaluate(() => reflowtex.host.setDisplayFade(false));
  await idle(page);
  expect((await fades(page, '__A', '__V')).map(f => f.masked)).toEqual([false, false]);
  await page.evaluate(() => reflowtex.host.setDisplayFade(true));
  await idle(page);
  expect((await fades(page, '__A', '__V')).map(f => f.masked)).toEqual([true, false]);
  // Turned on in the block, the view stays off; and the other way round.
  await page.evaluate(() => { window.__A.setDisplayFade(false); window.__V.setDisplayFade(true); });
  await idle(page);
  expect((await fades(page, '__A', '__V')).map(f => f.masked)).toEqual([false, true]);
  // Revealing in the view scrolls the view alone.
  await page.evaluate(() => window.__V.revealInDisplay(0, 1e6));
  await idle(page);
  const s = await page.evaluate(() => [window.__wrap(window.__A).scrollLeft, window.__wrap(window.__V).scrollLeft]);
  expect(s[0]).toBe(0);
  expect(s[1]).toBeGreaterThan(0);
  // Unmounted, the view's element keeps nothing of it.
  const cls = await page.evaluate(() => { const el = window.__V.el; window.__V.setDisplayFade(false); window.__V.unmount(); return el.className; });
  expect(cls).toBe('latex-block');
});

/** At the page's own width (no style on the blocks): each block's display
 *  panned to its end, with the edges that matter, on screen. */
const atEnd = (page: WebPage) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.latex-display')].map(w => {
  w.scrollLeft = w.scrollWidth;
  const svg = w.querySelector(':scope > svg') as SVGSVGElement, col = w.parentElement!.getBoundingClientRect();
  // the rightmost glyph's end, from its own coordinates
  let ink = -Infinity;
  for (const t of svg.querySelectorAll<SVGTextContentElement>('tspan')) {
    const x = parseFloat(t.getAttribute('x')!) + t.getComputedTextLength();
    ink = Math.max(ink, new DOMPoint(x, 0).matrixTransform(t.getScreenCTM()!).x);
  }
  return { col: col.right, svg: svg.getBoundingClientRect().right, ink, pan: w.scrollLeft,
           overflow: svg.width.baseVal.value - col.width, cue: w.classList.contains('latex-overflow-right') };
}));

for (const width of [360, 390]) {
  test(`at ${width} px a display panned to its end is flush with the column's right edge`, async ({ openPage }) => {
    const page = await openPage('displays', { width });
    for (const fade of [true, false]) {
      await page.evaluate(f => reflowtex.host.setDisplayFade(f), fade);
      await idle(page);
      const ends = await atEnd(page);
      await idle(page);
      expect(ends.length).toBe(3);                // every block's
      for (const e of ends) {
        // It pans exactly as far as it overflows the column (the trailing
        // peek is as wide as the leading one), so its box ends on the
        // column's edge, and so does its last glyph, near enough.
        expect(e.pan).toBeGreaterThan(0);
        expect(Math.abs(e.pan - e.overflow)).toBeLessThanOrEqual(1);
        expect(Math.abs(e.svg - e.col)).toBeLessThanOrEqual(0.5);
        expect(e.ink).toBeLessThanOrEqual(e.col + 0.5);
        expect(e.ink).toBeGreaterThan(e.col - 4);
      }
      // nothing left to fade on the right
      expect((await page.evaluate(() => [...document.querySelectorAll('.latex-display')]
        .map(w => w.classList.contains('latex-overflow-right'))))).toEqual([false, false, false]);
    }
  });
}

// ── The fit: a display's box the column's width, or its own ──────────────

/** The page at 1200 px with its blocks 400 px wide and centred in the
 *  page's column (736 px, so 188 px of room each side, the content's
 *  padding included): A and B too wide even for that, C (window.__C) not. */
async function centred(page: WebPage) {
  await narrow(page);
  await page.evaluate(() => {
    const els = document.querySelectorAll<HTMLElement>('.latex-block[data-nodelist-b64]');
    for (const el of els) el.style.marginInline = 'auto';
    window.__C = reflowtex.host.block(els[2]);
  });
  await idle(page);
}
/** A block's display box, its <svg>, its rightmost glyph's end, the column
 *  (the block) and the host (its parent's padding box), on screen. */
const fit = (page: WebPage, which: string) => page.evaluate(w => {
  const b = window[w], wrap = window.__wrap(b), svg = wrap.querySelector(':scope > svg') as SVGSVGElement;
  const rect = (e: Element) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; };
  let ink = -Infinity;
  for (const t of svg.querySelectorAll<SVGTextContentElement>('tspan')) {
    const x = parseFloat(t.getAttribute('x')!) + t.getComputedTextLength();
    ink = Math.max(ink, new DOMPoint(x, 0).matrixTransform(t.getScreenCTM()!).x);
  }
  const p = b.el.parentElement!, pr = p.getBoundingClientRect();
  return { api: b.displayFit(), box: rect(wrap), svg: rect(svg), ink, col: rect(b.el),
           host: [pr.left + p.clientLeft, pr.left + p.clientLeft + p.clientWidth],
           scrolls: wrap.scrollWidth > wrap.clientWidth + 1, scrollLeft: wrap.scrollLeft,
           masked: window.__masked(wrap), top: wrap.getBoundingClientRect().top, height: wrap.offsetHeight };
}, which);

test('fitted naturally, a wide display is shown whole, centred on the column and inside the host', async ({ openPage }) => {
  const page = await openPage('displays');
  await centred(page);
  expect(await page.evaluate(() => reflowtex.host.displayFit())).toBe('column');
  const before = await fit(page, '__C');
  expect(before).toMatchObject({ api: 'column', scrolls: true, masked: true });
  await page.evaluate(() => window.__C.setDisplayFit('natural'));
  await idle(page);
  const f = await fit(page, '__C');
  expect(f).toMatchObject({ api: 'natural', scrolls: false, masked: false });
  // The box is the display's own width, past the column on both sides ...
  expect(Math.abs((f.box[1] - f.box[0]) - (f.svg[1] - f.svg[0]))).toBeLessThanOrEqual(1);
  expect(f.box[0]).toBeLessThan(f.col[0] - 10);
  expect(f.box[1]).toBeGreaterThan(f.col[1] + 10);
  expect(Math.abs((f.svg[0] + f.svg[1]) / 2 - (f.col[0] + f.col[1]) / 2)).toBeLessThanOrEqual(1);
  // ... and its last glyph in the host.
  expect(f.ink).toBeLessThanOrEqual(f.host[1]);
  expect(f.svg[0]).toBeGreaterThanOrEqual(f.host[0] - 0.5);
  // Its vertical place is the same.
  expect([f.top, f.height]).toEqual([before.top, before.height]);
  // Wider than the host (A), the box is the host's width and scrolls, with
  // no fade; at its end, the display ends at the host's right edge.
  await page.evaluate(() => window.__A.setDisplayFit('natural'));
  await idle(page);
  let a = await fit(page, '__A');
  expect(a).toMatchObject({ scrolls: true, masked: false });
  expect(Math.abs(a.box[0] - a.host[0])).toBeLessThanOrEqual(0.5);
  expect(Math.abs(a.box[1] - a.host[1])).toBeLessThanOrEqual(0.5);
  await page.evaluate(() => { const w = window.__wrap(window.__A); w.scrollLeft = w.scrollWidth; });
  await idle(page);
  a = await fit(page, '__A');
  expect(Math.abs(a.svg[1] - a.host[1])).toBeLessThanOrEqual(0.5);
  expect(a.ink).toBeLessThanOrEqual(a.host[1] + 0.5);
  // A block too close to one side takes the room from the other: C at the
  // page column's left edge (20 px of room, the content's padding). Moved
  // without a resize, the host sets the fit again to have it measured.
  await page.evaluate(() => { window.__C.el.style.marginInline = '0'; window.__C.setDisplayFit('natural'); });
  await idle(page);
  const left = await fit(page, '__C');
  expect(left.scrolls).toBe(false);
  expect(Math.abs(left.box[0] - left.host[0])).toBeLessThanOrEqual(1);
  expect(left.ink).toBeLessThanOrEqual(left.host[1]);
  // The element it sits in resized, the room follows: 420 px wide, C
  // centred again, so 30 px of room on each side, too little now: it
  // scrolls, its box the host's width.
  await page.evaluate(() => {
    window.__C.el.style.marginInline = 'auto';
    const p = window.__C.el.parentElement!;
    p.style.width = '420px';
    p.style.maxWidth = 'none';
  });
  await idle(page);
  const smaller = await fit(page, '__C');
  expect(smaller.col[1] - smaller.col[0]).toBe(400);
  expect(smaller.scrolls).toBe(true);
  expect(Math.abs(smaller.box[0] - smaller.host[0])).toBeLessThanOrEqual(1);
  expect(Math.abs(smaller.box[1] - smaller.host[1])).toBeLessThanOrEqual(1);
  // A value that is no fit is refused.
  expect(await page.evaluate(() => { try { window.__C.setDisplayFit('wide'); return 'set'; } catch (e) { return (e as Error).name; } })).toBe('TypeError');
});

test('fitting a display naturally moves no other line, and lays nothing out again', async ({ openPage }) => {
  const page = await openPage('displays');
  await centred(page);
  await page.evaluate(() => {
    window.__layouts = 0;
    window.__C.on('layout', () => window.__layouts++);
    window.__laid0 = reflowtex.inspect.state(window.__C.el).cache.layout.laid;
  });
  // Every <svg> but the display's, every glyph's place in its own, the
  // page's height, the layout itself and the paint count.
  const snapshot = () => page.evaluate(() => {
    const C = window.__C, st = reflowtex.inspect.state(C.el);
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 100) / 100); };
    return {
      sameLayout: st.cache.layout.laid === window.__laid0, paints: reflowtex.inspect.paints, layouts: window.__layouts,
      lines: [...document.querySelectorAll('.latex-block svg')].filter(s => !s.closest('.latex-display')).map(box),
      glyphs: [...C.el.querySelectorAll('svg tspan')].map(t => `${t.getAttribute('x')},${t.getAttribute('y')}`).join(' '),
      height: document.documentElement.scrollHeight, blockHeight: C.el.offsetHeight,
    };
  });
  const before = await snapshot();
  expect(before).toMatchObject({ sameLayout: true, layouts: 0 });
  expect(before.lines.length).toBeGreaterThan(3);
  await page.evaluate(() => window.__C.setDisplayFit('natural'));
  await idle(page);
  expect(await snapshot()).toEqual(before);
  // and the host's default, every block at once
  await page.evaluate(() => reflowtex.host.setDisplayFit('natural'));
  await idle(page);
  expect(await snapshot()).toEqual(before);
  await page.evaluate(() => { reflowtex.host.setDisplayFit('column'); window.__C.setDisplayFit(null); });
  await idle(page);
  expect(await snapshot()).toEqual(before);
});

test('back in the column, the box, the peek and the fade return; glyphs stay where they were', async ({ openPage }) => {
  const page = await openPage('displays');
  await centred(page);
  const column = await fit(page, '__C');
  await page.evaluate(() => window.__C.setDisplayFit('natural'));
  await idle(page);
  const natural = await fit(page, '__C');
  await page.evaluate(() => window.__C.setDisplayFit('column'));
  await idle(page);
  const back = await fit(page, '__C');
  expect(back).toMatchObject({ api: 'column', masked: true, box: column.box });
  // The display stayed where it was on screen: scrolled by the room it had
  // taken on the left, its first glyphs under the fade.
  expect(Math.abs(back.svg[0] - natural.svg[0])).toBeLessThanOrEqual(1);
  expect(back.scrollLeft).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__wrap(window.__C).className)).toContain('latex-overflow-left');
  // A scrolled display too wide for the host too keeps its glyphs where
  // they are, both ways.
  await page.evaluate(() => { window.__wrap(window.__A).scrollLeft = 300; });
  await idle(page);
  const a0 = await fit(page, '__A');
  await page.evaluate(() => window.__A.setDisplayFit('natural'));
  await idle(page);
  const a1 = await fit(page, '__A');
  await page.evaluate(() => window.__A.setDisplayFit(null));
  await idle(page);
  const a2 = await fit(page, '__A');
  expect(Math.abs(a1.svg[0] - a0.svg[0])).toBeLessThanOrEqual(1);
  expect(a2).toMatchObject({ api: 'column', masked: true, box: a0.box, scrollLeft: a0.scrollLeft });
  // The fade switch has no say while fitted naturally, and has again after.
  await page.evaluate(() => { window.__C.setDisplayFade(true); window.__C.setDisplayFit('natural'); });
  await idle(page);
  expect((await fit(page, '__C')).masked).toBe(false);
  await page.evaluate(() => window.__C.setDisplayFit('column'));
  await idle(page);
  expect((await fit(page, '__C')).masked).toBe(true);
});

test('a view fits its displays on its own; the host default reaches only those without a setting', async ({ openPage }) => {
  const page = await openPage('displays');
  await centred(page);
  await page.evaluate(async () => {
    const el = document.createElement('div');
    el.className = 'latex-block';
    el.style.cssText = 'width: 400px; margin-inline: auto';
    document.querySelector('.latex-block[data-nodelist-b64]')!.parentElement!.append(el);
    window.__V = await reflowtex.host.mount(el, { of: window.__C, view: 'side', displayFit: 'natural' });
  });
  await idle(page);
  const state = async () => [await fit(page, '__C'), await fit(page, '__V')].map(f => [f.api, f.scrolls, f.masked]);
  expect(await state()).toEqual([['column', true, true], ['natural', false, false]]);
  await page.evaluate(() => reflowtex.host.setDisplayFit('natural'));
  await idle(page);
  expect(await state()).toEqual([['natural', false, false], ['natural', false, false]]);
  await page.evaluate(() => { reflowtex.host.setDisplayFit('column'); window.__V.setDisplayFit('column'); window.__C.setDisplayFit('natural'); });
  await idle(page);
  expect(await state()).toEqual([['natural', false, false], ['column', true, true]]);
  // Unmounted, the view's element keeps nothing of it.
  const left = await page.evaluate(() => { const el = window.__V.el; window.__V.setDisplayFit('natural'); window.__V.unmount();
    return [el.className, el.style.getPropertyValue('--latex-display-room-left')]; });
  expect(left).toEqual(['latex-block', '']);
});

// ── Ink that hangs past a display's boxes (page displays-hang) ──────────────
// microtype patches the equation number (\tagform@) so that TeX hangs its ")"
// past the measure by the parenthesis' \rpcode: a negative kern after it in
// the number's box. The row is not overfull, and TeX lets the glyph hang. So
// does the viewer: such a display is mounted bare, as one that fits, and its
// ")" bleeds past the column; only a display whose boxes run past the column
// gets a scroll box (layoutDisplaySegment's fitW, sizeSegment). It had one,
// with the right fade dimming the ")", as its ink did run past the column.

/** Block `i` of the page at `w` px. */
async function blockAt(page: WebPage, i: number, w: number) {
  await page.locator('.latex-block[data-nodelist-b64]').nth(i)
    .evaluate((b: HTMLElement, w: number) => { b.style.maxWidth = 'none'; b.style.width = `${w}px`; }, w);
  await idle(page);
}

/** Block `i`'s (first) display: its layout's widths, and how it is mounted. */
const mounted = (page: WebPage, i: number) => page.evaluate((i: number) => {
  const el = document.querySelectorAll<HTMLElement>('.latex-block[data-nodelist-b64]')[i];
  const cache = reflowtex.inspect.state(el).cache;
  const s = cache.layout.laid.findIndex((L: any) => L && L.seg.kind === 'display');
  const L = cache.layout.laid[s], seg = cache.dom.segs[s], svg = seg.svg as SVGSVGElement;
  const wrap = el.querySelector<HTMLElement>('.latex-display');
  return {
    deferred: !!L.deferred, W: L.W as number, fitW: L.fitW as number | undefined, column: cache.layoutCtx.columnPx as number,
    wrap: !!wrap, cue: !!el.querySelector('.latex-overflow-right, .latex-overflow-left'),
    wrapScrolls: !!wrap && wrap.scrollWidth > wrap.clientWidth,
    bare: svg.parentElement === seg.box, overflowX: getComputedStyle(seg.box).overflowX,
    surface: svg.width.baseVal.value, scroll: [el.scrollWidth, el.clientWidth],
  };
}, i);

/** Where block `i`'s equation number's ")" ends past the column, as drawn
 *  (pt, from the replayed pen positions; px on the screen), and the hang TeX
 *  gave it: minus the kern after it in the number's box (pt). */
const paren = (page: WebPage, i: number) => page.evaluate((i: number) => {
  const el = document.querySelectorAll<HTMLElement>('.latex-block[data-nodelist-b64]')[i];
  const ins = reflowtex.inspect, st = ins.state(el), cache = st.cache, pt = ins.spToPx * 65536;
  const s = cache.layout.laid.findIndex((L: any) => L && L.seg.kind === 'display');
  const L = cache.layout.laid[s], svg = cache.dom.segs[s].svg as SVGSVGElement;
  let glyph: any = null, hang = 0;
  const find = (n: any, inNumber: boolean) => {          // the number: a box of subtype 7
    const c = n.children || [];
    const k = inNumber ? c.findLastIndex((x: any) => x.type === 'glyph' && x.char === 41) : -1;
    if (k >= 0) { glyph = c[k]; hang = c[k + 1]?.type === 'kern' ? -(c[k + 1].kern || 0) / 65536 : 0; }
    for (const x of c) find(x, inNumber || (x.type === 'hlist' && x.subtype === 7));
  };
  find(L.lines[0].nodes[0], false);
  let end = NaN;
  ins.replay(el, s, { node(n: any, x: number, _y: number, adv: number) { if (n === glyph) end = x + adv; } });
  const toScreen = (x: number) => new DOMPoint(x, 0).matrixTransform(svg.getScreenCTM()!).x;
  return { hang, past: end / pt - st.lastWidth, pastPx: toScreen(end) - svg.getBoundingClientRect().right };
}, i);

test('an equation number\'s ")" hangs past the column, and the display is mounted bare', async ({ openPage }) => {
  const page = await openPage('displays-hang');
  for (const w of [360, 480, 600, 720]) {
    await blockAt(page, 0, w);
    const m = await mounted(page, 0), p = await paren(page, 0);
    const at = `at ${w} px`;
    // the fixture shows the case: its ink runs past the column by more than
    // the tolerance for rounding, though its boxes fit
    expect(m.W, `${at}: the ")" no longer hangs out past the tolerance`).toBeGreaterThan(m.column + 2);
    expect(m.fitW, at).toBe(Math.ceil(m.column));
    expect(m, at).toMatchObject({ deferred: false, wrap: false, cue: false, bare: true, overflowX: 'visible', surface: m.column });
    expect(m.scroll[0], `${at}: the block scrolls sideways`).toBe(m.scroll[1]);
    // the ")" ends where TeX hangs it, and is drawn there
    expect(p.hang, at).toBeGreaterThan(0.5);
    expect(Math.abs(p.past - p.hang), `${at}: ")" ends ${p.past.toFixed(2)} pt past the column, TeX ${p.hang.toFixed(2)}`).toBeLessThanOrEqual(0.05);
    expect(Math.abs(p.pastPx - 2 * p.hang), `${at}: on the screen ${p.pastPx.toFixed(2)} px`).toBeLessThanOrEqual(0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('a display whose boxes run past the column still gets its scroll box', async ({ openPage }) => {
  const page = await openPage('displays-hang');
  await blockAt(page, 1, 400);
  const m = await mounted(page, 1);
  expect(m.fitW!).toBeGreaterThan(m.column + 2);
  expect(m).toMatchObject({ wrap: true, cue: true, wrapScrolls: true, bare: false, surface: m.W });
  await blockAt(page, 1, 720);
  expect(await mounted(page, 1)).toMatchObject({ wrap: false, cue: false, bare: true });
});

test('a display out of view, sized from the width cache, is mounted bare too', async ({ openPage }) => {
  // Out of view, a display whose geometry at a width is cached is not laid
  // out again (layoutDocument's deferred segments): it is sized from what the
  // cache kept, fitW with the rest. Laid out at wider and wider widths, each
  // past every one before (so none is answered from the cache), the first
  // one's full layout is gone (EXACT_LAYOUTS_KEPT) and only its geometry is
  // left when the width comes back to it.
  const page = await openPage('displays-hang', { height: 400 });
  for (const w of [640, 800, 900, 1000, 640]) await blockAt(page, 2, w);
  const m = await mounted(page, 2);
  expect(m.deferred, 'the display was laid out: it is not out of view').toBe(true);
  expect(m.W).toBeGreaterThan(m.column + 2);
  expect(m).toMatchObject({ wrap: false, cue: false, bare: true, surface: m.column });
});
