// SPDX-License-Identifier: AGPL-3.0-or-later
// Wide displays and the host API: the fade where a display's scroll box cuts
// it off, switched per block, per view and for the host
// (setDisplayFade), and scrolling one so that a point of it is in view
// (revealInDisplay), for example to keep a caret visible.
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

/** The page's two blocks at 400 px, as window.__A and window.__B. */
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
