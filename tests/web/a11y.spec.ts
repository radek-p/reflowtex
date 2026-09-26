// SPDX-License-Identifier: AGPL-3.0-or-later
// The accessible layer (src/pipeline/a11y.ts, vanilla's --a11y): what a
// screen reader is given – the text in reading order with MathML for every
// formula – and that the drawing is hidden from it, not from the eye.
import { test, expect } from './fixtures.ts';

test('every formula reaches assistive technology as MathML; the drawing does not', async ({ openPage }) => {
  const page = await openPage('mathml');
  const tree = await page.locator('body').ariaSnapshot();
  const maths = tree.split('\n').filter(l => /^\s*- math\b/.test(l));
  // three inline formulas, the integral, the alignment (one table for its rows)
  expect(maths.length).toBe(5);
  expect(tree).toContain('Inline');
  expect(tree).toContain('The end.');
  expect(tree).not.toMatch(/- img\b/);            // the drawn block, glyph by glyph, is hidden

  const blocks = page.locator('.latex-block[data-nodelist-b64]');   // the page's, not the viewer's popovers
  for (const b of await blocks.all()) expect(await b.getAttribute('aria-hidden')).toBe('true');
  expect(await page.locator('.latex-block[data-nodelist-b64] + .latex-a11y').count()).toBe(await blocks.count());

  const align = page.locator('.latex-a11y math[display="block"]').nth(1);
  expect(await align.locator('mtable').first().locator(':scope > mtr').count()).toBe(2);
  expect(await align.locator('mtable mtable').count()).toBe(2);   // cases, pmatrix
});

test('the layer is not seen: the page looks as it did', async ({ openPage }) => {
  const page = await openPage('mathml');
  const box = await page.locator('.latex-a11y').first().boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);
  expect(box!.height).toBeLessThanOrEqual(1);
  // the drawing is there, and drawn
  expect(await page.locator('.latex-block svg').count()).toBeGreaterThan(0);
});
