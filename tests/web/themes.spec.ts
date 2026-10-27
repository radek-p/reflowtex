// SPDX-License-Identifier: AGPL-3.0-or-later
// Themes: `default` draws TeX's colours exactly; every other theme is its
// colour map's, links included; the system mode shows one theme while the
// system is light and another while it is dark (src/viewer/README.md, Theming).
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

const fill = (page: WebPage) => page.locator('.latex-block svg text tspan').first().evaluate(t => getComputedStyle(t).fill);

test('dark changes the ink', async ({ openPage }) => {
  const light = await fill(await openPage('notes'));
  const dark = await fill(await openPage('notes', { theme: 'dark' }));
  expect(light).not.toBe(dark);
});

// pages/themes: black text, a \ref (linkcolor=red) and a \url (urlcolor=magenta)
const colours = (page: WebPage) => page.evaluate(() => {
  const f = (sel: string) => { const e = document.querySelector(sel); return e && getComputedStyle(e).fill; };
  return { text: f('.latex-block tspan:not(.latex-link)'), ref: f('.latex-block tspan.latex-link[data-link-label]'),
           url: f('.latex-block tspan.latex-link[data-link-href^="https:"]'),
           theme: document.documentElement.getAttribute('data-theme'), classes: document.documentElement.className.trim() };
});
/** Point at the reference; the underline drawn under it, if any (its stroke). */
async function hoverRef(page: WebPage): Promise<string | null> {
  await page.locator('rect.latex-link-hit[data-link-label]').first().hover({ force: true });
  await idle(page);
  return page.evaluate(() => { const u = document.querySelector('.latex-link-underline'); return u && getComputedStyle(u).stroke; });
}
const setTheme = async (page: WebPage, t: string) => { await page.evaluate(t => window.reflowtex!.setTheme!(t), t); await idle(page); };

test('default: TeX black is #000000 and links have the colours TeX gave them, with no underline', async ({ openPage }) => {
  const page = await openPage('themes', { colorScheme: 'light' });
  expect(await colours(page)).toEqual({ text: 'rgb(0, 0, 0)', ref: 'rgb(255, 0, 0)', url: 'rgb(255, 0, 255)', theme: 'default', classes: '' });
  expect(await hoverRef(page), 'no underline in the default theme').toBeNull();
});

test('dark: its colour map, links included', async ({ openPage }) => {
  const page = await openPage('themes', { colorScheme: 'light' });
  await setTheme(page, 'dark');
  expect(await colours(page)).toEqual({ text: 'rgb(231, 229, 228)', ref: 'rgb(157, 155, 255)', url: 'rgb(157, 155, 255)', theme: 'dark', classes: 'dark' });
  expect(await hoverRef(page), "the map's hover colour, underlined").toBe('rgb(195, 194, 255)');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('tspan.latex-link[data-link-label]')!).fill)).toBe('rgb(195, 194, 255)');
  // and back to TeX's
  await setTheme(page, 'default');
  expect((await colours(page)).ref).toBe('rgb(255, 0, 0)');
});

test("a page's map gives a theme its link look", async ({ openPage }) => {
  const page = await openPage('themes', { colorScheme: 'light' });
  await page.evaluate(() => window.reflowtex!.host!.setColorMaps({ reflowtex: { links: { light: { color: '#00aa00', hover: '#005500', underline: 'hover' } } } }));
  await setTheme(page, 'light');
  const c = await colours(page);
  expect([c.text, c.ref, c.url]).toEqual(['rgb(51, 51, 51)', 'rgb(0, 170, 0)', 'rgb(0, 170, 0)']);
  expect(await hoverRef(page)).toBe('rgb(0, 85, 0)');
});

test('the system mode: one theme while the system is light, another while it is dark; remembered', async ({ openPage }) => {
  const page = await openPage('themes', { colorScheme: 'dark' });
  expect(await page.evaluate(() => window.reflowtex!.theme!())).toEqual({ choice: 'system', theme: 'dark', light: 'default', dark: 'dark' });
  expect((await colours(page)).classes).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await idle(page);
  expect(await colours(page)).toMatchObject({ text: 'rgb(0, 0, 0)', ref: 'rgb(255, 0, 0)', theme: 'default', classes: '' });
  await page.evaluate(() => window.reflowtex!.setSystemThemes!({ light: 'sepia' }));
  await idle(page);
  expect(await colours(page)).toMatchObject({ text: 'rgb(69, 58, 38)', theme: 'sepia', classes: 'sepia' });
  expect(await page.evaluate(() => [localStorage.getItem('reflowtex-theme'), localStorage.getItem('reflowtex-theme-light')]))
    .toEqual([null, 'sepia']);
  await page.reload();
  await idle(page);
  expect((await colours(page)).theme, 'the slot is remembered').toBe('sepia');
  await page.emulateMedia({ colorScheme: 'dark' });
  await idle(page);
  expect((await colours(page)).theme).toBe('dark');
});

// On a page that does not ask for the reader's settings (no
// data-latex-theme-choice: the Hugo site's), the viewer neither reads nor
// writes them: setTheme only applies, a host keeps its own. rememberTheme()
// asks for them.
const watchThemeKeys = `(() => { const seen = window.__themeKeys = [];
  for (const m of ['getItem', 'setItem', 'removeItem']) { const f = Storage.prototype[m];
    Storage.prototype[m] = function (k, ...a) { if (String(k).startsWith('reflowtex-theme')) seen.push(m + ' ' + k); return f.call(this, k, ...a); }; } })();`;
const themeKeys = (page: WebPage) => page.evaluate(() => (window as unknown as { __themeKeys: string[] }).__themeKeys);

test('without the opt-in, the theme settings are neither read nor written', async ({ openPage }) => {
  const page = await openPage('hugo/alpha/', { init: watchThemeKeys, colorScheme: 'light' });
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-latex-theme-choice'))).toBe(false);
  await setTheme(page, 'dark');
  await page.evaluate(() => window.reflowtex!.setSystemThemes!({ light: 'sepia' }));
  await setTheme(page, 'system');
  expect(await page.evaluate(() => [document.documentElement.className.trim(), document.documentElement.dataset.theme]),
    'applied all the same').toEqual(['sepia', 'sepia']);
  expect(await themeKeys(page), 'storage untouched').toEqual([]);
  // asked for: read, then written
  await page.evaluate(() => window.reflowtex!.rememberTheme!());
  await setTheme(page, 'contrast');
  expect(await themeKeys(page)).toEqual(expect.arrayContaining(['getItem reflowtex-theme', 'setItem reflowtex-theme']));
});
