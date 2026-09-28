// SPDX-License-Identifier: AGPL-3.0-or-later
// Views: one block shown in several elements at once (host.mount(el, { of })),
// each laid out at its own width, with its own drawing, instances, marks and
// accessible layer, sharing the block's compiled data.
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

/** The page's block A at `a` px, and a view B of it at `b` px, below it
 *  (window.__A, window.__B); window.__lines(el) gives an element's lines as
 *  text, from its layout. */
async function twoViews(page: WebPage, a = 600, b = 300) {
  await page.evaluate(async ([a, b]) => {
    window.__lines = (el: HTMLElement) => {
      const text = (ns: any[]): string => ns.map(n => n.type === 'glyph' ? (n.text ?? String.fromCodePoint(n.char || 63))
        : n.type === 'glue' ? ' ' : text(n.children || [])).join('');
      return reflowtex.inspect.state(el).cache.layout.laid
        .flatMap((L: any) => (L.lines || []).map((ln: any) => text(ln.nodes).replace(/\s+/g, ' ').trim()));
    };
    const A = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
    A.style.width = a + 'px';
    const el = document.createElement('div');
    el.className = 'latex-block';
    el.style.width = b + 'px';
    document.body.append(el);
    window.__A = reflowtex.host.block(A);
    window.__B = await reflowtex.host.mount(el, { of: A, view: 'right' });
  }, [a, b]);
  await idle(page);
}
const setWidth = (page: WebPage, which: string, px: number) =>
  page.evaluate(([w, px]) => { window[w].el.style.width = px + 'px'; }, [which, px] as const);
const lines = (page: WebPage, which: string) => page.evaluate(w => window.__lines(window[w].el) as string[], which);

test('two views break at their own widths, each as the block alone would', async ({ openPage }) => {
  const page = await openPage('views');
  await twoViews(page);
  const shared = await page.evaluate(() => {
    const h = reflowtex.host, A = window.__A, B = window.__B, sa = reflowtex.inspect.state(A.el), sb = reflowtex.inspect.state(B.el);
    return { views: h.views(A).map((v: any) => v.view), viaKey: h.views(B.key).length, own: B.views().includes(B),
             keys: A.key !== B.key, docs: sa.doc !== sb.doc, metrics: sa.doc.glyph_metrics === sb.doc.glyph_metrics,
             fonts: sa.fontInfo === sb.fontInfo, drawn: B.el.querySelectorAll('svg text tspan').length > 0,
             attr: B.el.dataset.latexView, blocks: h.blocks().length };
  });
  expect(shared).toEqual({ views: ['v1', 'right'], viaKey: 2, own: true, keys: true, docs: true, metrics: true,
                           fonts: true, drawn: true, attr: 'right', blocks: 2 });
  const wideA = await lines(page, '__A'), narrowB = await lines(page, '__B');
  expect(narrowB.length).toBeGreaterThan(wideA.length);
  // Each as the block alone at that width: A narrowed to B's, B widened to A's.
  await setWidth(page, '__A', 300);
  await setWidth(page, '__B', 600);
  await idle(page);
  expect(await lines(page, '__A')).toEqual(narrowB);
  expect(await lines(page, '__B')).toEqual(wideA);
});

test('resizing one view lays out only that one', async ({ openPage }) => {
  const page = await openPage('views');
  await twoViews(page);
  await page.evaluate(() => {
    window.__layouts = { A: 0, B: 0 };
    window.__A.on('layout', () => window.__layouts.A++);
    window.__B.on('layout', () => window.__layouts.B++);
    window.__laidB = reflowtex.inspect.state(window.__B.el).cache.layout;
    window.__widthB = reflowtex.inspect.state(window.__B.el).lastWidth;
  });
  await setWidth(page, '__A', 400);
  await idle(page);
  const r = await page.evaluate(() => ({ ...window.__layouts, sameB: reflowtex.inspect.state(window.__B.el).cache.layout === window.__laidB,
                                         widthB: reflowtex.inspect.state(window.__B.el).lastWidth === window.__widthB }));
  expect(r.A).toBeGreaterThan(0);
  expect(r).toMatchObject({ B: 0, sameB: true, widthB: true });
});

const SLOT = '[data-slot="fruit"]';
const words = (page: WebPage, which: string) =>
  page.evaluate(([w, s]) => [...window[w].el.querySelectorAll(s)].map((e: Element) => e.textContent).join('').replaceAll(' ', ''), [which, SLOT] as const);

test('setText by name reaches every view; an instance\'s own text its view, unless mirrored', async ({ openPage }) => {
  const page = await openPage('views');
  await twoViews(page);
  await page.evaluate(() => reflowtex.host.setText('fruit', 'three ripe pears'));
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__B')]).toEqual(['threeripepears', 'threeripepears']);
  await page.evaluate(() => window.__B.instances({ kind: 'text', name: 'fruit' })[0].setText('one plum'));
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__B')]).toEqual(['threeripepears', 'oneplum']);
  await page.evaluate(() => window.__A.instances({ kind: 'text', name: 'fruit' })[0].setText('a fig', { mirror: true }));
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__B')]).toEqual(['afig', 'afig']);
  // A view mounted later has the mirrored text too.
  await page.evaluate(async () => {
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
    window.__C = await reflowtex.host.mount(el, { of: window.__A });
  });
  await idle(page);
  expect(await words(page, '__C')).toBe('afig');
  await page.evaluate(() => window.__A.instances({ kind: 'text', name: 'fruit' })[0].setText(null, { mirror: true }));
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__B'), await words(page, '__C')])
    .toEqual(['threeripepears', 'threeripepears', 'threeripepears']);
});

const bandsIn = (page: WebPage, which: string, id: string) =>
  page.evaluate(([w, id]) => [...window[w].el.querySelectorAll(`rect.latex-mark[data-rtx-id="${id}"]`)]
    .filter((r: any) => r.width.baseVal.value > 0).length, [which, id] as const);

test('a live mark is its view\'s own, unless mirrored', async ({ openPage }) => {
  const page = await openPage('views');
  await twoViews(page);
  await page.evaluate(() => {
    const range = (b: any) => ({ block: b.key, from: 10, to: 120, text: '' });
    window.__own = reflowtex.host.addMark([range(window.__A)], { id: 'own' });
    window.__both = reflowtex.host.addMark([range(window.__B)], { id: 'both', mirror: true });
  });
  await idle(page);
  expect(await bandsIn(page, '__A', 'own')).toBeGreaterThan(1);           // across a line break
  expect(await bandsIn(page, '__B', 'own')).toBe(0);
  expect(await bandsIn(page, '__A', 'both')).toBeGreaterThan(1);
  expect(await bandsIn(page, '__B', 'both')).toBeGreaterThan(1);
  const found = await page.evaluate(() => ({
    inB: reflowtex.host.liveMarks([{ block: window.__B.key, from: 50, to: 60, text: '' }]).map((m: any) => m.id),
    inA: reflowtex.host.liveMarks([{ block: window.__A.key, from: 50, to: 60, text: '' }]).map((m: any) => m.id),
    mirror: [window.__own.mirror, window.__both.mirror],
  }));
  expect(found).toEqual({ inB: ['both'], inA: ['own', 'both'], mirror: [false, true] });
  // Through a reflow of one view, and in a view mounted later; removed, from all.
  await setWidth(page, '__B', 250);
  await page.evaluate(async () => {
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
    window.__C = await reflowtex.host.mount(el, { of: window.__B.key });
  });
  await idle(page);
  expect(await bandsIn(page, '__B', 'both')).toBeGreaterThan(1);
  expect(await bandsIn(page, '__C', 'both')).toBeGreaterThan(1);
  expect(await bandsIn(page, '__C', 'own')).toBe(0);
  await page.evaluate(() => window.__both.remove());
  await idle(page);
  expect([await bandsIn(page, '__A', 'both'), await bandsIn(page, '__B', 'both'), await bandsIn(page, '__C', 'both')]).toEqual([0, 0, 0]);
  expect(await bandsIn(page, '__A', 'own')).toBeGreaterThan(1);
});

test('unmounting one view leaves the others working', async ({ openPage }) => {
  const page = await openPage('views');
  await twoViews(page);
  const gone = await page.evaluate(() => {
    const B = window.__B, el = B.el;
    B.unmount();
    return { children: el.childElementCount, views: reflowtex.host.views(window.__A).length, block: reflowtex.host.block(el) === undefined,
             attr: el.hasAttribute('data-latex-view'), layers: document.querySelectorAll('.latex-a11y').length };
  });
  expect(gone).toEqual({ children: 0, views: 1, block: true, attr: false, layers: 1 });
  const before = (await lines(page, '__A')).length;
  await setWidth(page, '__A', 300);
  await idle(page);
  expect((await lines(page, '__A')).length).toBeGreaterThan(before);
  // The block's own view unmounted: a view of it still reflows.
  await twoViews(page, 300, 300);
  await page.evaluate(() => window.__A.unmount());
  const narrow = (await lines(page, '__B')).length;
  await setWidth(page, '__B', 600);
  await idle(page);
  expect((await lines(page, '__B')).length).toBeLessThan(narrow);
  expect(await page.evaluate(() => reflowtex.host.views(window.__B).map((v: any) => v.view))).toEqual(['right']);
});

test('each view has its own accessible layer, over its own lines', async ({ openPage }) => {
  const page = await openPage('views');
  await twoViews(page);
  const r = await page.evaluate(() => {
    const A = window.__A.el as HTMLElement, B = window.__B.el as HTMLElement;
    const la = A.previousElementSibling as HTMLElement, lb = B.previousElementSibling as HTMLElement;
    const inside = (layer: HTMLElement, el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return [...layer.children].every(p => { const r = p.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1; });
    };
    const text = (l: HTMLElement) => l.textContent!.replace(/\s+/g, '');
    return { a: la.classList.contains('latex-a11y'), b: lb.classList.contains('latex-a11y'), two: la !== lb,
             same: text(la) === text(lb), hidden: B.getAttribute('aria-hidden'),
             insideA: inside(la, A), insideB: inside(lb, B), wider: la.children[0].getBoundingClientRect().width > lb.children[0].getBoundingClientRect().width };
  });
  expect(r).toEqual({ a: true, b: true, two: true, same: true, hidden: 'true', insideA: true, insideB: true, wider: true });
});

test('a reference in a view goes to its own anchor', async ({ openPage }) => {
  const page = await openPage('views');
  await page.evaluate(() => {
    const pad = () => Object.assign(document.createElement('div'), { style: 'height: 1500px' });
    document.body.append(pad());
  });
  await twoViews(page);
  await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { style: 'height: 3000px' })));
  const ids = await page.evaluate(() => ({
    plain: document.querySelectorAll('[id="sec:views"]').length,
    own: document.querySelectorAll(`[id="sec:views--${window.__B.key}"]`).length,
    inB: window.__B.el.contains(document.getElementById(`sec:views--${window.__B.key}`)),
    outline: !!window.__A.el.reflowtexOutline[0].id && window.__B.el.reflowtexOutline[0].id === `${window.__A.el.reflowtexOutline[0].id}--${window.__B.key}`
      && window.__B.el.contains(document.getElementById(window.__B.el.reflowtexOutline[0].id)),
  }));
  expect(ids).toEqual({ plain: 1, own: 1, inB: true, outline: true });
  await page.evaluate(() => window.__B.el.scrollIntoView({ block: 'end' }));
  await idle(page);           // (drawn as it comes near)
  await page.evaluate(() => (window.__B.el.querySelector('[data-link-label="sec:views"]') as HTMLElement)
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect.poll(() => page.evaluate(() =>
    Math.round(document.getElementById(`sec:views--${window.__B.key}`)!.getBoundingClientRect().top))).toBeLessThan(5);
});

test('mounting and unmounting a view a hundred times leaves nothing behind', async ({ openPage, browserName }) => {
  const page = await openPage('views');
  await twoViews(page);
  await page.evaluate(async () => {
    reflowtex.host.addMark([{ block: window.__A.key, from: 10, to: 60, text: '' }], { id: 'kept', mirror: true });
    const h = reflowtex.host, I = reflowtex.inspect;
    window.__count = () => ({ blocks: h.blocks().length, inspect: I.blocks().length, views: h.views(window.__A).length,
                              layers: document.querySelectorAll('.latex-a11y').length, marks: h.liveMarks().length });
    window.__before = window.__count();
    window.__refs = [];
    for (let i = 0; i < 100; i++) {
      const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
      el.style.width = (200 + i) + 'px';
      const v = await h.mount(el, { of: window.__A });
      const s = I.state(el);
      window.__refs.push(new WeakRef(s), new WeakRef(s.doc), new WeakRef(s.cache.dom.root), new WeakRef(v));
      v.instances({ kind: 'text' })[0].setText('now ' + i);
      await I.idle();
      v.unmount();
      el.remove();
    }
  });
  await idle(page);
  const counts = await page.evaluate(() => ({ before: window.__before, after: window.__count() }));
  expect(counts.after).toEqual(counts.before);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const alive = await page.evaluate(() => window.__refs.filter((r: WeakRef<object>) => r.deref()).length);
    expect(alive, 'what an unmounted view held is collected').toBe(0);
  }
  // The block itself still works.
  expect(await page.evaluate(() => reflowtex.host.views(window.__B).length)).toBe(2);
});
