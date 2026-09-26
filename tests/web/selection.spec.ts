// SPDX-License-Identifier: AGPL-3.0-or-later
// The selection drawn as bands (the viewer's host/selection.ts), a flag:
// data-latex-selection="bands" on <html> or a block, and the reader's
// switch in the companion's reading options. Off, the browser draws it.
import { test, expect, type WebPage } from './fixtures.ts';

/** Select glyphs a..b of the first block (all of mark `key` by default). */
async function select(page: WebPage, glyphs?: [number, number], block = 0) {
  await page.evaluate(([glyphs, block]) => {
    const els = glyphs || block ? [...document.querySelectorAll('.latex-block')[block as number].querySelectorAll('tspan')]
                                : reflowtex.host.mark('key').elements();
    const [a, b] = glyphs ? [els[glyphs[0]], els[glyphs[1]]] : [els[0], els[els.length - 1]];
    const r = document.createRange();
    r.setStart(a.firstChild!, 0);
    r.setEnd(b.firstChild!, b.textContent!.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  }, [glyphs || null, block] as const);
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
  await page.evaluate(() => { (document.querySelector('.latex-block') as HTMLElement).style.width = '260px'; });
  await page.waitForTimeout(400);
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
  await page.waitForFunction(() => document.documentElement.getAttribute('data-latex-selection') === 'bands');
  await expect(page.getByRole('radio', { name: 'Even' })).toHaveAttribute('aria-checked', 'true');
  await select(page);
  expect((await bands(page)).length).toBeGreaterThan(0);
  await page.getByRole('radio', { name: 'Browser' }).click();
  await select(page);
  expect(await bands(page), 'back to the browser\'s').toEqual([]);
});
