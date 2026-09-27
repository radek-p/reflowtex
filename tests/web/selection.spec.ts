// SPDX-License-Identifier: AGPL-3.0-or-later
// The selection drawn as bands (the viewer's host/selection.ts), a flag:
// data-latex-selection="bands" on <html> or a block, and the reader's
// switch in the companion's reading options. Off, the browser draws it.
import { test, expect, type WebPage } from './fixtures.ts';
import { READY, SETTLED } from './web.ts';

/** Select glyphs a..b of the first block (all of mark `key` by default).
 *  The viewer draws its bands on selectionchange, which the browser queues
 *  as a task of its own: under the whole suite WebKit could deliver it after
 *  two frames, and a test found no bands yet (3 in 105 runs in the CI
 *  container). So: the event first, then two frames for the drawing. */
async function select(page: WebPage, glyphs?: [number, number], block = 0) {
  await page.evaluate(([glyphs, block]) => new Promise<void>(done => {
    const els = glyphs || block ? [...document.querySelectorAll('.latex-block')[block as number].querySelectorAll('tspan')]
                                : reflowtex.host.mark('key').elements();
    const [a, b] = glyphs ? [els[glyphs[0]], els[glyphs[1]]] : [els[0], els[els.length - 1]];
    const r = document.createRange();
    r.setStart(a.firstChild!, 0);
    r.setEnd(b.firstChild!, b.textContent!.length);
    // (the event for the new selection: clearing it first may be one of its own)
    const timer = setTimeout(finish, 2000);          // (no event: the selection did not change)
    function finish() { clearTimeout(timer); document.removeEventListener('selectionchange', seen); done(); }
    function seen() { const s = getSelection()!; if (s.rangeCount && !s.isCollapsed) finish(); }
    document.addEventListener('selectionchange', seen);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  }), [glyphs || null, block] as const);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const bands = (page: WebPage, block = 0) => page.evaluate(b =>
  [...document.querySelectorAll('.latex-block')[b].querySelectorAll<SVGRectElement>('rect.latex-selection')]
    .map(r => ({ h: +r.getAttribute('height')!, w: +r.getAttribute('width')!, fill: getComputedStyle(r).fill })), block);

test('off by default: the browser draws the selection', async ({ openPage }) => {
  const page = await openPage('selection');
  await select(page);
  expect(await bands(page)).toEqual([]);
});

test('bands: one even rect per line, and none once the selection goes', async ({ openPage }) => {
  const page = await openPage('selection');
  await page.evaluate(() => document.documentElement.setAttribute('data-latex-selection', 'bands'));
  await select(page);
  const lines = await page.evaluate(() => reflowtex.host.mark('key').rects().length);
  const b = await bands(page);
  expect(b.length, 'a band per line').toBe(lines);
  expect(lines).toBeGreaterThan(1);
  expect(new Set(b.map(x => x.h.toFixed(2))).size, 'all of one height').toBe(1);
  expect(b[0].fill, 'coloured').not.toMatch(/none|rgba\(0, 0, 0, 0\)/);
  // The browser's highlight is hidden in the text. (A default highlight
  // is reported as transparent too: give the page one of its own.)
  await page.addStyleTag({ content: '::selection { background: rgb(1, 2, 3); }' });
  const bg = await page.evaluate(() => getComputedStyle(reflowtex.host.mark('key').elements()[0], '::selection').backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await bands(page)).toEqual([]);
});

test('bands follow the text into new lines', async ({ openPage }) => {
  const page = await openPage('selection');
  await page.evaluate(() => document.documentElement.setAttribute('data-latex-selection', 'bands'));
  await select(page);
  const wide = (await bands(page)).length;
  const before = await page.evaluate(() => reflowtex.inspect.paints);
  await page.evaluate(() => { (document.querySelector('.latex-block') as HTMLElement).style.width = '260px'; });
  // The reflow's paint, then still frames (a frame can be held back for seconds)
  await page.waitForFunction(n => reflowtex.inspect.paints > n, before);
  await page.waitForFunction(SETTLED, undefined, { polling: 50 });
  const lines = await page.evaluate(() => reflowtex.host.mark('key').rects().length);
  expect(lines).toBeGreaterThan(wide);
  expect((await bands(page)).length).toBe(lines);
});

test('a block may keep the browser\'s selection', async ({ openPage }) => {
  const page = await openPage('selection');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-latex-selection', 'bands');
    document.querySelectorAll('.latex-block')[1].setAttribute('data-latex-selection', 'native');
  });
  await page.addStyleTag({ content: '::selection { background: rgb(1, 2, 3); }' });
  await select(page, [2, 30], 1);
  expect(await bands(page, 1)).toEqual([]);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelectorAll('.latex-block')[1].querySelector('tspan')!, '::selection').backgroundColor);
  expect(bg, 'its highlight is not hidden').toBe('rgb(1, 2, 3)');
  await select(page, [2, 30], 0);
  expect((await bands(page, 0)).length).toBeGreaterThan(0);
});

// Beside marks, not through them: a live mark keeps its own band, and the
// selection's is a layer of its own, over it.
test('the selection and marks are drawn side by side', async ({ openPage }) => {
  const page = await openPage('selection');
  await page.evaluate(() => document.documentElement.setAttribute('data-latex-selection', 'bands'));
  await select(page);
  const r = await page.evaluate(() => {
    const m = reflowtex.host.addMark(reflowtex.host.rangesOf(getSelection()!.getRangeAt(0)), { classes: 'hl' });
    const svg = document.querySelector('.latex-block svg')!;
    const kids = [...svg.children];
    const band = svg.querySelector('rect.latex-mark[data-mark~="hl"]')!, sel = svg.querySelector('rect.latex-selection')!;
    return { marks: reflowtex.host.liveMarks().length, live: m.live,
             order: kids.indexOf(band.parentElement!) < kids.indexOf(sel.parentElement!),
             underText: kids.indexOf(sel.parentElement!) < kids.findIndex(k => k.tagName === 'text') };
  });
  expect(r.marks, 'the selection is not a mark').toBe(1);
  expect(r.order, 'the selection over the marks').toBe(true);
  expect(r.underText, 'and under the text').toBe(true);
});

test('the reader\'s switch, remembered', async ({ openPage }) => {
  const page = await openPage('selection');
  await page.getByRole('radio', { name: 'Even' }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-latex-selection'))).toBe('bands');
  await page.reload();
  // As openPage waits: every block drawn, its fonts loaded (without it, a
  // slow load under the whole suite had nothing drawn to select yet).
  await page.waitForFunction(READY, undefined, { timeout: 20000 });
  // …and the viewer's repaint for its web fonts, after fonts.ready: it
  // replaces the glyphs, and a selection made before it went with them
  // (WebKit, 3 in 40 runs in the CI container: no bands, no selection left).
  await page.waitForFunction(SETTLED, undefined, { polling: 50, timeout: 20000 });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-latex-selection') === 'bands');
  await expect(page.getByRole('radio', { name: 'Even' })).toHaveAttribute('aria-checked', 'true');
  await select(page);
  expect((await bands(page)).length).toBeGreaterThan(0);
  await page.getByRole('radio', { name: 'Browser' }).click();
  await select(page);
  expect(await bands(page), 'back to the browser\'s').toEqual([]);
});

// A selection's ends may fall between glyphs: "word[ word]" starts at the
// end of the d. Its band then starts at the d's right edge, over the space;
// a selection of the space alone has a band too. (Spaces are glue, not
// glyphs, so the band used to start at the next word, and a space alone
// had none.)
test('a selection over a space: its band reaches the glyphs\' edges', async ({ openPage }) => {
  const page = await openPage('selection');
  await page.evaluate(() => document.documentElement.setAttribute('data-latex-selection', 'bands'));
  const r = await page.evaluate(async () => {
    const els = reflowtex.host.mark('key').elements();
    const text = els.map((e: Element) => e.textContent).join('');
    const d = text.indexOf('Every') + 4, w = d + 1;             // "Every| number": y, then n
    const x = (i: number) => +els[i].getAttribute('x')!;
    const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // (as the select above: the selection's event, then the frames the bands are drawn in)
    const select = (a: Node, ao: number, b: Node, bo: number) => new Promise<void>(done => {
      const t = setTimeout(finish, 2000);
      function finish() { clearTimeout(t); document.removeEventListener('selectionchange', seen); done(); }
      function seen() { const s = getSelection()!; if (s.rangeCount && !s.isCollapsed) finish(); }
      document.addEventListener('selectionchange', seen);
      const range = document.createRange(); range.setStart(a, ao); range.setEnd(b, bo);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    });
    const band = () => { const b = document.querySelector('.latex-block rect.latex-selection');
      return b ? [+b.getAttribute('x')!, +b.getAttribute('x')! + +b.getAttribute('width')!] : null; };
    // From the end of "Every" to the end of "number".
    await select(els[d].firstChild!, 1, els[w + 5].firstChild!, 1); await frames();
    const withWord = band();
    // The space alone: from the end of "Every" to the start of "number".
    await select(els[d].firstChild!, 1, els[w].firstChild!, 0); await frames();
    const space = band();
    // As Chromium puts it: in the word space's own element, before its
    // text (the start) and after it (the end).
    const sp = [...els[d].parentElement!.children].find(e => e.textContent === ' ' && +e.getAttribute('x')! > x(d))!;
    await select(sp.firstChild!, 0, els[w + 5].firstChild!, 1); await frames();
    const fromSpace = band();
    await select(els[d - 4].firstChild!, 0, sp.firstChild!, 1); await frames();
    const toSpaceEnd = band();
    return { withWord, space, fromSpace, toSpaceEnd, dx: x(d), wx: x(w) };
  });
  expect(r.withWord![0], 'starts after the y, before the n').toBeGreaterThan(r.dx);
  expect(r.withWord![0]).toBeLessThan(r.wx - 1);
  expect(r.space, 'a space alone has a band').not.toBeNull();
  expect(r.space![0]).toBeCloseTo(r.withWord![0], 3);
  expect(r.space![1], 'up to the n').toBeCloseTo(r.wx, 3);
  expect(r.fromSpace, 'from the space\'s own element').toEqual(r.withWord);
  expect(r.toSpaceEnd![1], 'to the end of the space: the n').toBeCloseTo(r.wx, 3);
});
