// SPDX-License-Identifier: AGPL-3.0-or-later
// A hint: blurred, with a label over it, until pressed.
import { test, expect, type WebPage } from './fixtures.ts';

const HINT = '.latex-stream[data-kind="hint"]';

async function state(page: WebPage) {
  await page.waitForSelector(`${HINT}[role="button"]`, { state: 'attached' });   // the kind has taken it over
  return page.locator(HINT).evaluate(h => ({
    blur: getComputedStyle(h.firstElementChild!).filter,
    label: getComputedStyle(h, '::after').content,
    revealed: h.classList.contains('latex-revealed'), pressed: h.getAttribute('aria-pressed') }));
}

test('hidden, then revealed', async ({ openPage }) => {
  const page = await openPage('notes');
  let s = await state(page);
  expect(s.blur).toContain('blur');
  expect(s.label).toBe('"Click to reveal"');
  expect(s.revealed).toBe(false);
  await page.locator(HINT).click();
  await page.waitForTimeout(300);                     // the blur eases out
  s = await state(page);
  expect(s.revealed && s.pressed === 'true').toBe(true);
  expect(s.blur).not.toContain('blur');
  expect(s.label).toBe('none');
  await page.locator(HINT).click();
  expect((await state(page)).revealed).toBe(false);
});

test('keyboard and label', async ({ openPage }) => {
  const page = await openPage('notes');
  await page.locator(HINT).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await state(page)).revealed).toBe(true);
  expect(await page.evaluate(() => document.activeElement === document.querySelector('.latex-stream[data-kind="hint"]')),
    'the hint lost the keyboard focus').toBe(true);
  await page.evaluate(() => document.documentElement.style.setProperty('--latex-hint-label', '"Show"'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await state(page)).label).toBe('"Show"');
});
