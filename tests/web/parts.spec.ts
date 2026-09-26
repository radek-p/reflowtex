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
