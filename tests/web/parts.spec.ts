// SPDX-License-Identifier: AGPL-3.0-or-later
// What an author declares in reflowtex.sty and a page finds through the host
// API: widget parameters, parts (\webpart), marks (\webid, \webclass), and
// kinds declared with \NewWebEnvironment and \NewWebAside.
import { test, expect } from './fixtures.ts';

test('a widget with parameters owns its parts', async ({ openPage }) => {
  const page = await openPage('parts');
  const r = await page.evaluate(() => {
    const w = reflowtex.host.instances('popover')[0];
    return { placement: w.placement, attrs: { ...w.attrs }, parts: [...w.parts.keys()].sort(),
             label: w.part('label').naturalWidth() > 0, detached: reflowtex.host.instances({ placement: 'detached' }).map((i: any) => i.kind) };
  });
  expect(r.placement).toBe('inline');
  expect(r.attrs, 'the parameters, and no package keys').toEqual({ tone: 'warm' });
  expect(r.parts).toEqual(['label', 'note']);
  expect(r.label).toBe(true);
  expect(r.detached, 'parts are not instances of their own').not.toContain('label');
});

test('a block owns the part written inside it', async ({ openPage }) => {
  const page = await openPage('parts');
  const r = await page.evaluate(() => {
    const box = reflowtex.host.instances('box')[0];
    const s = box.part('summary');
    return { parts: [...box.parts.keys()].sort(), type: s.type, variant: box.attrs.variant };
  });
  expect(r).toEqual({ parts: ['body', 'summary'], type: 'typeset', variant: 'card' });
});

test('marks: classes and ids on the glyphs, found by id', async ({ openPage }) => {
  const page = await openPage('parts');
  const r = await page.evaluate(() => {
    const key = reflowtex.host.mark('key'), inner = reflowtex.host.mark('inner');
    const hot = [...document.querySelectorAll('.latex-block svg .hot')];
    return { key: key.elements().length, keyLines: key.rects().length, keyText: key.elements().map((e: Element) => e.textContent).join(''),
             inner: inner.elements().every((e: Element) => e.classList.contains('hot')),
             hot: hot.length, none: reflowtex.host.mark('nothing').elements().length };
  });
  expect(r.key).toBeGreaterThan(10);
  expect(r.keyLines).toBeGreaterThanOrEqual(1);
  expect(r.keyText.replaceAll(' ', '')).toContain('keysentence');
  expect(r.inner, 'an inner mark keeps the outer classes').toBe(true);
  expect(r.hot).toBeGreaterThan(r.key / 2);
  expect(r.none).toBe(0);
});

test('a mark is styled by CSS, however the lines break', async ({ openPage }) => {
  const page = await openPage('parts');
  await page.addStyleTag({ content: '.latex-block svg .hot { fill: rgb(200, 0, 0) !important; }' });
  await page.locator('.latex-block[data-nodelist-b64]').first().evaluate((b: HTMLElement) => { b.style.width = '220px'; });
  await page.waitForTimeout(400);
  const fills = await page.evaluate(() => [...new Set([...document.querySelectorAll('.latex-block svg .hot')].map(e => getComputedStyle(e).fill))]);
  expect(fills).toEqual(['rgb(200, 0, 0)']);
});

// A mark's band: one rect per line behind its glyphs, across the spaces
// between its words, invisible until a page styles it – an effect other
// than a fill, so a mark need not look like a link.
test('a mark has a band behind it on every line', async ({ openPage }) => {
  const page = await openPage('parts');
  await page.locator('.latex-block[data-nodelist-b64]').first().evaluate((b: HTMLElement) => { b.style.width = '220px'; });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const bands = [...document.querySelectorAll<SVGRectElement>('rect.latex-mark[data-rtx-id="key"]')];
    return { n: bands.length, lines: reflowtex.host.mark('key').rects().length, fill: getComputedStyle(bands[0]).fill,
             hot: document.querySelectorAll('rect.latex-mark[data-mark~="hot"]').length,
             glyphsOnly: reflowtex.host.mark('key').elements().every((e: Element) => e.tagName === 'tspan') };
  });
  expect(before.n, 'one band per line').toBe(before.lines);
  expect(before.n).toBeGreaterThan(1);
  expect(before.fill, 'invisible unless styled').toBe('rgba(0, 0, 0, 0)');
  expect(before.hot, 'the classes in data-mark').toBeGreaterThan(0);
  expect(before.glyphsOnly, 'mark(id).elements() is the glyphs, not the bands').toBe(true);
  await page.addStyleTag({ content: '.latex-block rect.latex-mark[data-rtx-id="key"] { fill: rgb(255, 230, 150); }' });
  const r = await page.evaluate(() => {
    // In the SVG's units, from the glyphs' own x and y (a tspan's client
    // rect is its whole line in WebKit): the band's line is the glyphs
    // whose baseline lies inside it.
    const band = document.querySelector<SVGRectElement>('rect.latex-mark[data-rtx-id="key"]')!;
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(k => parseFloat(band.getAttribute(k)!));
    const xs = reflowtex.host.mark('key').elements().filter((e: Element) => e.closest('svg') === band.ownerSVGElement)
      .map((e: Element) => [parseFloat(e.getAttribute('x')!), parseFloat(e.getAttribute('y')!)]).filter(([, gy]: number[]) => gy > y && gy < y + h).map(([gx]: number[]) => gx);
    return { fill: getComputedStyle(band).fill, under: band.ownerSVGElement!.firstElementChild!.contains(band),
             spans: xs.length > 1 && Math.abs(x - Math.min(...xs)) < 0.01 && x + w > Math.max(...xs) };
  });
  expect(r.fill, 'styled by the page').toBe('rgb(255, 230, 150)');
  expect(r.spans, 'from the first glyph on the line to the last').toBe(true);
  expect(r.under, 'drawn first, under the text').toBe(true);
});

test('NewWebEnvironment and NewWebAside make instances', async ({ openPage }) => {
  const page = await openPage('parts');
  const r = await page.evaluate(() => {
    const w = reflowtex.host.instances('warning')[0], n = reflowtex.host.instances('sidenote')[0];
    return { w: [w.placement, w.attrs.variant], accent: w.presentation.properties['--rtx-accent'],
             n: [n.placement, n.attrs.place, n.attrs.n] };
  });
  expect(r.w).toEqual(['block', 'accent']);
  expect(r.accent, 'a #hex colour taken as written').toBe('#c2410c');
  expect(r.n).toEqual(['detached', 'margin', '1']);
});
