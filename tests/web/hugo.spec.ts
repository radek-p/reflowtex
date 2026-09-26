// SPDX-License-Identifier: AGPL-3.0-or-later
// The Hugo integration, on a small site served under a subpath (/hugo/): what
// a Hugo site's readers get.
import { test, expect, type WebPage } from './fixtures.ts';

const PAGES = ['hugo/alpha/', 'hugo/beta/'];
const text = async (page: WebPage) => (await page.locator('.latex-block svg text tspan').allTextContents()).join('');

// Scripts and fonts are found under the site's subpath (8de3e92): openPage
// fails on any 404.
test('pages load under a subpath', async ({ openPage }) => {
  for (const url of PAGES) await openPage(url);
});

// \ref and \eqref print numbers, not ?? (b7d65b3).
test('references resolve', async ({ openPage }) => {
  const page = await openPage('hugo/alpha/');
  expect(await text(page)).not.toContain('??');
  expect(await page.evaluate(() => document.getElementById('eq:one') !== null)).toBe(true);
});

// A label on another page resolves through the link map, to that page.
test('a reference to another page', async ({ openPage }) => {
  const page = await openPage('hugo/beta/');
  await page.locator('rect.latex-link-hit').first().click({ force: true });
  await page.waitForURL(/\/hugo\/alpha\/(index\.html)?#eq:one$/);
});

// An example's text size stays when its theme is changed or its text clicked:
// the stored size once shared the buttons' attribute, so every click shrank
// the text (1d3a850). The options are the companion's (<PreviewOptions>),
// which the site turns on (params.reflowtexCompanion).
test('example controls', async ({ openPage }) => {
  const page = await openPage('hugo/alpha/');
  const fig = page.locator('figure.latex-example');
  const level = () => fig.evaluate(f => ((f.querySelector('[data-latex-zoom-level]') ?? f) as HTMLElement).dataset.latexZoomLevel);
  const start = await level();
  await fig.locator('[data-rtx="preview-options"] [data-z="out"]').click();
  await page.waitForTimeout(100);
  const smaller = await level();
  expect(smaller, 'the smaller-text button did nothing').not.toBe(start);
  await fig.locator('[data-rtx="preview-options"] [data-t="dark"]').click();
  await fig.locator('.latex-example-preview').click({ position: { x: 20, y: 60 } });
  await page.waitForTimeout(300);
  expect(await level(), 'the text size changed on a click elsewhere').toBe(smaller);
  expect(await fig.locator('[data-latex-theme="dark"]').count(), 'the theme did not change').toBeGreaterThan(0);
});

// The example's handle narrows the result, which breaks into more lines; the
// page never scrolls sideways (1adde61).
test('example handle', async ({ openPage }) => {
  const page = await openPage('hugo/alpha/');
  const fig = page.locator('figure.latex-example');
  const blk = fig.locator('.latex-example-preview .latex-block');
  const h0 = await blk.evaluate(b => b.getBoundingClientRect().height);
  await fig.locator('.latex-example-handle').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  expect(await blk.evaluate(b => b.getBoundingClientRect().height)).toBeGreaterThan(h0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

// Until the reader picks one, an example's options mark the page's theme;
// a pick themes that example alone.
test("example options start from the page's theme, and theme one example", async ({ openPage }) => {
  const page = await openPage('hugo/alpha/');
  const opts = page.locator('figure.latex-example [data-rtx="preview-options"]');
  await opts.locator('[data-t]').first().waitFor();
  expect(await opts.locator('[aria-checked="true"]').getAttribute('data-t')).toBe('light');
  await opts.locator('[data-t="dark"]').click();
  expect(await page.evaluate(() => [document.documentElement.getAttribute('data-theme'),
    document.querySelector('.latex-example-preview')!.getAttribute('data-latex-theme')])).toEqual([null, 'dark']);
});
