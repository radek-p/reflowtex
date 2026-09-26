// SPDX-License-Identifier: AGPL-3.0-or-later
// Every page, at a desktop and a phone width: it loads without an error
// (openPage fails the test on any), every block is drawn, and nothing makes
// the page scroll sideways.
import { test, expect } from './fixtures.ts';
import { LINES, names } from './web.ts';

for (const name of names())
  for (const width of [1200, 360])
    test(`${name} loads at ${width} px`, async ({ openPage }) => {
      const page = await openPage(name, { width });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(wide, `the page scrolls sideways by ${wide} px at ${width} px`).toBeLessThanOrEqual(1);
    });

// A block made narrower is broken into more lines, none wider than it.
test('reflows when narrower', async ({ openPage }) => {
  const page = await openPage('notes');
  const block = page.locator('.latex-block[data-nodelist-b64]').first();
  const wide = await block.evaluate(LINES);
  await block.evaluate((b: HTMLElement) => { b.style.width = '240px'; });
  await page.waitForTimeout(400);
  const narrow = await block.evaluate(LINES);
  expect(narrow.length).toBeGreaterThan(wide.length);
  const over = await block.evaluate(b => {
    const r = b.getBoundingClientRect().right;
    return Math.max(0, ...[...b.querySelectorAll('svg text tspan')].map(t => t.getBoundingClientRect().right - r));
  });
  expect(over, `a glyph reaches ${over.toFixed(1)} px past the block`).toBeLessThanOrEqual(2);
});
