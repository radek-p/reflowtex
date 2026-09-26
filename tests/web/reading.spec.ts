// SPDX-License-Identifier: AGPL-3.0-or-later
// Reading options (the companion's reading.tsx): the corner button and its
// panel, a card of them set into the page, and the page following the
// reader's choices.
import { test, expect, type WebPage } from './fixtures.ts';

const htmlState = (page: WebPage) => page.evaluate(() => { const h = document.documentElement;
  return { theme: h.getAttribute('data-theme'), classes: [...h.classList], width: h.getAttribute('data-width'),
           zoom: h.style.getPropertyValue('--rtx-zoom'), saved: localStorage.getItem('reflowtex-theme') }; });

test('the button opens the panel; Escape closes it', async ({ openPage }) => {
  const page = await openPage('reading');
  const button = page.locator('.rtx-reading-button');
  expect(await page.locator('.rtx-reading-panel').count()).toBe(0);
  await button.click();
  await page.waitForSelector('.rtx-reading-panel');
  expect(await button.getAttribute('aria-expanded')).toBe('true');
  expect(await page.evaluate(() => document.activeElement!.closest('.rtx-reading-panel') !== null), 'focus not moved in').toBe(true);
  expect(await page.locator('.rtx-reading-panel [data-w]').count(), 'data-width="true" offers the width').toBe(4);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rtx-reading-panel', { state: 'detached' });
  expect(await page.evaluate(() => document.activeElement!.classList.contains('rtx-reading-button'))).toBe(true);
});

test('theme, width and size are followed and kept', async ({ openPage }) => {
  const page = await openPage('reading');
  await page.locator('.rtx-reading-button').click();
  const panel = page.locator('.rtx-reading-panel');
  await panel.locator('[data-t="sepia"]').click();
  await panel.locator('[data-w="wide"]').click();
  await panel.locator('[data-z="in"]').click();
  let s = await htmlState(page);
  expect([s.theme, s.saved]).toEqual(['sepia', 'sepia']);
  expect(s.classes).toContain('sepia');
  expect(s.width).toBe('wide');
  expect(Math.abs(parseFloat(s.zoom) - 1.1)).toBeLessThan(1e-6);
  expect(await panel.locator('[data-t="sepia"]').getAttribute('aria-checked')).toBe('true');
  expect(await panel.locator('[data-z="reset"]').innerText()).toBe('110%');
  // The card set into the page shows the same state.
  const card = page.locator('#inline-options');
  expect(await card.locator('[data-z="reset"]').innerText()).toBe('110%');
  expect(await card.locator('[data-t="sepia"]').getAttribute('aria-checked')).toBe('true');
  expect(await card.locator('[data-w]').count(), 'no width unless asked').toBe(0);
  await card.locator('[data-t="dark"]').click();
  s = await htmlState(page);
  expect(s.theme).toBe('dark');
  expect(s.classes).toContain('dark');
  expect(s.classes).not.toContain('sepia');
  await page.reload();
  await page.waitForSelector('.rtx-reading-button');
  expect((await htmlState(page)).theme, 'the choice is remembered').toBe('dark');
});

test('a click outside closes', async ({ openPage }) => {
  const page = await openPage('reading');
  await page.locator('.rtx-reading-button').click();
  await page.waitForSelector('.rtx-reading-panel');
  await page.mouse.click(5, 5);
  await page.waitForSelector('.rtx-reading-panel', { state: 'detached' });
});

// A theme set from elsewhere (the inspector's Colours view) by the same
// convention, data-theme on <html>, is the one the options show.
test('the options follow a theme set from outside', async ({ openPage }) => {
  const page = await openPage('reading');
  await page.evaluate(() => { const h = document.documentElement; h.classList.add('dark'); h.setAttribute('data-theme', 'dark'); });
  await page.locator('.rtx-reading-button').click();
  await expect(page.locator('.rtx-reading-panel [data-t="dark"]')).toHaveAttribute('aria-checked', 'true');
});
