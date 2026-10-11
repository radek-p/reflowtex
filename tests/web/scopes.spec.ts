// SPDX-License-Identifier: AGPL-3.0-or-later
// Scopes of live text: a page showing several documents at once, whose slot
// names (labels, counters) may be the same, gives each document's blocks
// their own texts (host.mount(el, { scope }), host.setText(name, text,
// { scope })), the page-wide texts being the fallback.
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

const SLOT = '[data-slot="fruit"]';

/** Mount a fresh copy of the page's first block (another document, as far
 *  as the viewer knows) as window[name], in `scope` (undefined: none given). */
async function mountCopy(page: WebPage, name: string, scope?: string | null) {
  await page.evaluate(async ([name, scope, given]) => {
    const src = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
    el.style.width = '400px';
    el.dataset.nodelistB64 = src.dataset.nodelistB64!;
    window[name] = await reflowtex.host.mount(el, given ? { scope } : {});
  }, [name, scope ?? null, scope !== undefined] as const);
  await idle(page);
}
const words = (page: WebPage, which: string) =>
  page.evaluate(([w, s]) => [...window[w].el.querySelectorAll(s)].map((e: Element) => e.textContent).join('').replaceAll(' ', ''),
    [which, SLOT] as const);
const setText = (page: WebPage, text: string | null, scope?: string) =>
  page.evaluate(([t, s]) => reflowtex.host.setText('fruit', t, s === null ? undefined : { scope: s }), [text, scope ?? null] as const);

test('two scopes with the same slot name show their own texts; an unscoped block the page-wide one', async ({ openPage }) => {
  const page = await openPage('views');
  await mountCopy(page, '__A', 'doc-a');
  await mountCopy(page, '__B', 'doc-b');
  await mountCopy(page, '__U');
  expect(await page.evaluate(() => [window.__A.scope, window.__B.scope, window.__U.scope])).toEqual(['doc-a', 'doc-b', null]);
  await setText(page, 'two pears', 'doc-a');
  await setText(page, 'one plum', 'doc-b');
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__B'), await words(page, '__U')])
    .toEqual(['twopears', 'oneplum', 'nofruitatall']);
  // The page-wide text: the unscoped block, and a scope with no text of its own.
  await setText(page, 'a fig');
  await setText(page, null, 'doc-b');
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__B'), await words(page, '__U')])
    .toEqual(['twopears', 'afig', 'afig']);
  expect(await page.evaluate(() => [reflowtex.host.text('fruit', { scope: 'doc-a' }), reflowtex.host.text('fruit', { scope: 'doc-b' }),
                                    reflowtex.host.text('fruit'), reflowtex.host.text('apples', { scope: 'doc-a' })]))
    .toEqual(['two pears', 'a fig', 'a fig', null]);
  // Clearing a scope: its blocks fall back; the page-wide texts stay.
  await page.evaluate(() => reflowtex.host.clearTexts({ scope: 'doc-a' }));
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__U')]).toEqual(['afig', 'afig']);
  await page.evaluate(() => reflowtex.host.clearTexts());
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__B'), await words(page, '__U')])
    .toEqual(['nofruitatall', 'nofruitatall', 'nofruitatall']);
  // An instance's own text still wins over its scope's.
  await setText(page, 'two pears', 'doc-a');
  await page.evaluate(() => window.__A.instances({ kind: 'text', name: 'fruit' })[0].setText('a quince'));
  await idle(page);
  expect(await words(page, '__A')).toBe('aquince');
});

test('a block mounted later into a scope is first drawn with its scope\'s text', async ({ openPage }) => {
  const page = await openPage('views');
  await setText(page, 'eleven cherries', 'late');
  await setText(page, 'page-wide melons');
  // Every frame from before the mount until the block is drawn: what its slot shows.
  const frames = await page.evaluate(async () => {
    const src = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
    el.dataset.nodelistB64 = src.dataset.nodelistB64!;
    const seen: string[] = [];
    let drawn = false;
    const watch = () => {
      const t = [...el.querySelectorAll('[data-slot="fruit"]')].map(e => e.textContent).join('').replaceAll(' ', '');
      if (t) { seen.push(t); drawn = true; }
      if (!drawn || seen.length < 3) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    // (no await between: the first frame after the mount is the first drawn)
    const mounted = reflowtex.host.mount(el, { scope: 'late' });
    const t0 = [...el.querySelectorAll('[data-slot="fruit"]')].map(e => e.textContent).join('');
    await mounted;
    const t1 = [...el.querySelectorAll('[data-slot="fruit"]')].map(e => e.textContent).join('').replaceAll(' ', '');
    await reflowtex.inspect.idle();
    while (seen.length < 3) await new Promise(r => requestAnimationFrame(r));
    return { t0, t1, seen };
  });
  expect(frames.t0).toBe('');
  expect(frames.t1).toBe('elevencherries');
  expect(frames.seen).toEqual(['elevencherries', 'elevencherries', 'elevencherries']);
  // Without a scope, the same text set first is the page-wide one.
  await mountCopy(page, '__U');
  expect(await words(page, '__U')).toBe('page-widemelons');
});

test('changing one scope\'s text lays out only that scope\'s blocks', async ({ openPage }) => {
  const page = await openPage('views');
  await mountCopy(page, '__A', 'doc-a');
  await mountCopy(page, '__B', 'doc-b');
  await setText(page, 'two pears', 'doc-b');
  await idle(page);
  // (a block whose texts change gets new node lists and a new layout)
  await page.evaluate(() => {
    const st = (b: any) => reflowtex.inspect.state(b.el);
    window.__before = [window.__A, window.__B].map(b => ({ nodes: st(b).doc.paragraphs.map((p: any) => p.nodes), layout: st(b).cache.layout }));
  });
  await setText(page, 'a great many apples, more than anyone could carry', 'doc-a');
  await idle(page);
  const same = await page.evaluate(() => [window.__A, window.__B].map((b, k) => {
    const s = reflowtex.inspect.state(b.el), was = window.__before[k];
    return { nodes: s.doc.paragraphs.every((p: any, i: number) => p.nodes === was.nodes[i]), layout: s.cache.layout === was.layout };
  }));
  expect(same).toEqual([{ nodes: false, layout: false }, { nodes: true, layout: true }]);
  expect(await words(page, '__B')).toBe('twopears');
});

test('a view mounted of a scoped block inherits its scope, unless given its own', async ({ openPage }) => {
  const page = await openPage('views');
  await mountCopy(page, '__A', 'doc-a');
  await setText(page, 'two pears', 'doc-a');
  await setText(page, 'one plum', 'doc-b');
  await page.evaluate(async () => {
    const mk = () => document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
    window.__V = await reflowtex.host.mount(mk(), { of: window.__A });
    window.__W = await reflowtex.host.mount(mk(), { of: window.__A, scope: 'doc-b' });
    window.__X = await reflowtex.host.mount(mk(), { of: window.__A, scope: null });
  });
  await idle(page);
  expect(await page.evaluate(() => [window.__V.scope, window.__W.scope, window.__X.scope])).toEqual(['doc-a', 'doc-b', null]);
  expect([await words(page, '__V'), await words(page, '__W'), await words(page, '__X')])
    .toEqual(['twopears', 'oneplum', 'nofruitatall']);
  await setText(page, 'three figs', 'doc-a');
  await idle(page);
  expect([await words(page, '__A'), await words(page, '__V'), await words(page, '__W')]).toEqual(['threefigs', 'threefigs', 'oneplum']);
});

test('a block already on the page is moved into a scope by mounting it with one', async ({ openPage }) => {
  const page = await openPage('views');
  await setText(page, 'two pears', 'moved');
  await page.evaluate(async () => {
    const el = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
    window.__P = await reflowtex.host.mount(el, { scope: 'moved' });
  });
  await idle(page);
  expect([await page.evaluate(() => window.__P.scope), await words(page, '__P')]).toEqual(['moved', 'twopears']);
  await page.evaluate(() => reflowtex.host.mount(window.__P.el, { scope: null }));
  await idle(page);
  expect([await page.evaluate(() => window.__P.scope), await words(page, '__P')]).toEqual([null, 'nofruitatall']);
  expect(await page.evaluate(() => reflowtex.inspect.scopes())).toEqual({});
});

test('unmounting takes a block out of its scope; mounted again without one, it shows the page-wide text', async ({ openPage }) => {
  const page = await openPage('views');
  await mountCopy(page, '__A', 'doc-a');
  await mountCopy(page, '__B', 'doc-a');
  await page.evaluate(async () => { window.__V = await reflowtex.host.mount(
    document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' })), { of: window.__A }); });
  await setText(page, 'two pears', 'doc-a');
  await setText(page, 'a fig');
  await idle(page);
  expect(await page.evaluate(() => reflowtex.inspect.scopes())).toEqual({ 'doc-a': 3 });
  await page.evaluate(() => { window.__V.unmount(); window.__A.unmount(); });
  expect(await page.evaluate(() => reflowtex.inspect.scopes())).toEqual({ 'doc-a': 1 });
  // A text set for the scope reaches what is left, and nothing of the gone ones.
  await setText(page, 'three figs', 'doc-a');
  await idle(page);
  expect(await words(page, '__B')).toBe('threefigs');
  expect(await page.evaluate(() => window.__A.el.childElementCount + window.__V.el.childElementCount)).toBe(0);
  await page.evaluate(() => window.__B.unmount());
  expect(await page.evaluate(() => reflowtex.inspect.scopes())).toEqual({});
  // The scope's texts are the host's: kept until cleared, for a block mounted into it again.
  expect(await page.evaluate(() => reflowtex.host.text('fruit', { scope: 'doc-a' }))).toBe('three figs');
  await page.evaluate(async () => { window.__A = await reflowtex.host.mount(window.__A.el); });
  await idle(page);
  expect([await page.evaluate(() => window.__A.scope), await words(page, '__A')]).toEqual([null, 'afig']);
});

test('a scope is a string', async ({ openPage }) => {
  const page = await openPage('views');
  const err = await page.evaluate(() => { try { reflowtex.host.setText('fruit', 'x', { scope: 7 as any }); return ''; } catch (e) { return String(e); } });
  expect(err).toContain('scope');
});

test('data-latex-scope on the element gives the scope when the host gives none', async ({ openPage }) => {
  const page = await openPage('views');
  await setText(page, 'two pears', 'attr');
  await page.evaluate(async () => {
    const src = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
    el.dataset.nodelistB64 = src.dataset.nodelistB64!;
    el.dataset.latexScope = 'attr';
    window.__A = await reflowtex.host.mount(el);
  });
  await idle(page);
  expect([await page.evaluate(() => window.__A.scope), await words(page, '__A')]).toEqual(['attr', 'twopears']);
});
