// SPDX-License-Identifier: AGPL-3.0-or-later
// Live text (\webtext) and widgets (\webwidget).
import { test, expect, type WebPage } from './fixtures.ts';

const SLOT = '[data-slot="apples"]';
const words = async (page: WebPage) => (await page.locator(SLOT).allTextContents()).join('').replaceAll(' ', '');

test('setText, and back', async ({ openPage }) => {
  const page = await openPage('live');
  expect(await words(page)).toBe('noapplesatall');
  await page.evaluate(() => reflowtex.setText('apples', 'a great many apples indeed'));
  await page.waitForTimeout(300);
  expect(await words(page)).toBe('agreatmanyapplesindeed');
  await page.evaluate(() => reflowtex.setText('apples', null));
  await page.waitForTimeout(300);
  expect(await words(page)).toBe('noapplesatall');
});

test('widget drawn and split', async ({ openPage }) => {
  const page = await openPage('live');
  expect(await page.locator('foreignObject.latex-widget .badge').count(), 'not drawn').toBeGreaterThanOrEqual(1);
  await page.locator('.latex-block[data-nodelist-b64]').nth(1).evaluate((b: HTMLElement) => { b.style.width = '170px'; });
  await page.waitForTimeout(400);
  expect(await page.locator('.badge.cut-right').count(), 'not split in a narrow column').toBeGreaterThanOrEqual(1);
  expect(await page.locator('.badge.cut-left').count()).toBeGreaterThanOrEqual(1);
});

test('invalidate measures again', async ({ openPage }) => {
  const page = await openPage('live');
  const before = await page.evaluate(() => reflowtex.widgets.badge && document.querySelector('.badge')!.textContent);
  await page.evaluate(() => {
    const w = reflowtex.widgets.badge;
    const orig = w.measure; w.measure = (ctx: any) => { ctx.state.label = 'short'; window.__ctx = ctx; return orig(ctx); };
    if (reflowtex.refreshWidgets) reflowtex.refreshWidgets();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__ctx && window.__ctx.invalidate());
  await page.waitForTimeout(400);
  expect((await page.locator('.badge').allTextContents()).join('')).not.toBe(before);
});
