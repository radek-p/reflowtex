// SPDX-License-Identifier: AGPL-3.0-or-later
// Cross-references: a \eqref goes to its equation.
import { test, expect } from './fixtures.ts';

test('eqref jumps', async ({ openPage }) => {
  const page = await openPage('notes', { height: 300 });
  const link = page.locator('[data-link-href="#eq:basel"], [data-link="eq:basel"]').last();
  expect(await link.count() > 0 || await page.locator('[data-link]').count() > 0).toBe(true);
  expect(await page.evaluate(() => document.getElementById('eq:basel') !== null), 'no anchor for the label').toBe(true);
  await page.locator('[data-link]').last().click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => location.hash)).toBe('#eq:basel');
});
