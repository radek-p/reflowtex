// SPDX-License-Identifier: AGPL-3.0-or-later
// The website's table of contents (website/layouts/partials/docs-toc.html)
// where its column is not shown: a rail at the window's right edge, a line
// per heading, which opens into the list when pointed at or focused. The
// fixture page has no docs layout, so no column: the rail at every width
// above a phone's.
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

const rail = (page: WebPage) => page.evaluate(() => {
  const toc = document.querySelector('.docs-toc')!, nav = toc.querySelector('nav')!;
  const links = [...toc.querySelectorAll('a')].filter(a => a.getClientRects().length);
  return { rail: toc.classList.contains('rail'), shown: getComputedStyle(toc).display !== 'none',
           label: nav.getAttribute('aria-label'), width: nav.getBoundingClientRect().width,
           lines: links.map(a => parseFloat(getComputedStyle(a).backgroundSize)),
           titles: links.map(a => a.textContent!.replace(/\s+/g, ' ')), tallest: Math.max(...links.map(a => a.getBoundingClientRect().height)),
           current: toc.querySelector('a[aria-current]')?.textContent!.replace(/\s+/g, ' ') ?? null };
});
const top = (page: WebPage, title: string) => page.evaluate(t => {
  const a = [...document.querySelectorAll('.docs-toc a')].find(a => a.textContent!.replace(/\s+/g, ' ') === t)!;
  return document.getElementById(a.getAttribute('href')!.slice(1))!.getBoundingClientRect().top;
}, title);

test('a line per heading, shorter for deeper ones; the one being read is marked', async ({ openPage }) => {
  const page = await openPage('toc-rail');
  const r = await rail(page);
  expect(r).toMatchObject({ rail: true, shown: true, label: 'Contents of the document' });
  expect(r.titles).toEqual(['1 Introduction', '2 Background', '2.1 Earlier work', '2.2 Notation', '2.2.1 Conventions',
    '3 Results', '3.1 The main theorem', '3.2 Its proof', '4 Conclusion']);
  const [sec, sub, subsub] = [r.lines[0], r.lines[2], r.lines[4]];
  expect(sec).toBeGreaterThan(sub);
  expect(sub).toBeGreaterThan(subsub);
  expect(r.width, 'slim').toBeLessThan(50);
  expect(r.tallest, 'lines, not titles').toBeLessThan(10);
  await page.evaluate(() => window.scrollTo(0, 0));
  await idle(page);
  expect((await rail(page)).current).toBe('1 Introduction');
  // scrolled to the results
  const y = await top(page, '3.1 The main theorem');
  await page.evaluate(y => window.scrollBy(0, y), y);
  await expect.poll(async () => (await rail(page)).current).toBe('3.1 The main theorem');
});

test('pointed at, it opens into the list; a click goes there and closes it', async ({ openPage }) => {
  const page = await openPage('toc-rail');
  await page.locator('.docs-toc nav').hover();
  const open = await rail(page);
  expect(open.width).toBeGreaterThan(200);
  expect(open.tallest, 'titles').toBeGreaterThan(14);
  await page.locator('.docs-toc a', { hasText: 'Results' }).click();
  await expect.poll(() => top(page, '3 Results')).toBeLessThan(60);
  expect(await page.evaluate(() => location.hash)).toMatch(/^#./);
  await page.mouse.move(100, 100);
  await expect.poll(async () => (await rail(page)).width, 'closed again').toBeLessThan(50);
  expect((await rail(page)).current).toBe('3 Results');
});

test('focused from the keyboard, it opens; Enter goes there', async ({ openPage }) => {
  const page = await openPage('toc-rail');
  await page.locator('.docs-toc a').first().focus();
  expect((await rail(page)).width).toBeGreaterThan(200);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect.poll(() => top(page, '2 Background')).toBeLessThan(60);
  expect((await rail(page)).width, 'still open while focused').toBeGreaterThan(200);
});

test('no rail on a phone', async ({ openPage }) => {
  const page = await openPage('toc-rail', { width: 390, height: 800 });
  expect(await rail(page)).toMatchObject({ rail: false, shown: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll').toBe(true);
});
