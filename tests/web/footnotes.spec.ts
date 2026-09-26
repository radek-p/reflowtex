// SPDX-License-Identifier: AGPL-3.0-or-later
// Footnotes: the mark opens the note in a popover.
import { test, expect, type WebPage } from './fixtures.ts';

const POP = '#latex-footnote-pop';
const isOpen = (page: WebPage) => page.locator(POP).evaluate(p => p.classList.contains('latex-footnote-open'));

test('hover opens and leaving closes', async ({ openPage }) => {
  const page = await openPage('notes');
  await page.locator('[data-footnote]').first().hover();
  await page.waitForTimeout(200);
  expect(await isOpen(page)).toBe(true);
  expect(await page.locator(`${POP} svg text tspan`).count(), 'the popover shows no typeset text').toBeGreaterThan(0);
  const box = (await page.locator(POP).boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x >= 0 && box.x + box.width <= vw, 'the popover leaves the window').toBe(true);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  expect(await isOpen(page)).toBe(false);
});

test('click pins and Escape closes', async ({ openPage }) => {
  const page = await openPage('notes');
  await page.locator('[data-footnote]').first().click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  expect(await isOpen(page), 'a clicked note stays open').toBe(true);
  await page.keyboard.press('Escape');
  expect(await isOpen(page)).toBe(false);
});

test('keyboard', async ({ openPage }) => {
  const page = await openPage('notes');
  const mark = page.locator('[data-footnote]').first();
  expect(await mark.getAttribute('role')).toBe('button');
  expect(await mark.getAttribute('tabindex')).toBe('0');
  await mark.focus();
  await page.keyboard.press('Enter');
  expect(await isOpen(page)).toBe(true);
});
