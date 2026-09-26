// SPDX-License-Identifier: AGPL-3.0-or-later
// Live text (\webtext) and widgets (\webwidget).
import { test, expect, type WebPage } from './fixtures.ts';

const SLOT = '[data-slot="apples"]';
const words = async (page: WebPage) => (await page.locator(SLOT).allTextContents()).join('').replaceAll(' ', '');

test('setText, and back', async ({ openPage }) => {
  const page = await openPage('live');
  expect(await words(page)).toBe('noapplesatall');
  await page.evaluate(() => reflowtex.host.setText('apples', 'a great many apples indeed'));
  await page.waitForTimeout(300);
  expect(await words(page)).toBe('agreatmanyapplesindeed');
  await page.evaluate(() => reflowtex.host.setText('apples', null));
  await page.waitForTimeout(300);
  expect(await words(page)).toBe('noapplesatall');
});

test("an instance's text wins over its name's", async ({ openPage }) => {
  const page = await openPage('live');
  await page.evaluate(() => reflowtex.host.setText('apples', 'many'));
  await page.evaluate(() => reflowtex.host.instances({ kind: 'text', name: 'apples' })[0].setText('seven apples'));
  await page.waitForTimeout(300);
  expect(await words(page)).toBe('sevenapples');
  await page.evaluate(() => reflowtex.host.instances({ kind: 'text', name: 'apples' })[0].setText(null));
  await page.waitForTimeout(300);
  expect(await words(page)).toBe('many');
});

test('widget drawn and split', async ({ openPage }) => {
  const page = await openPage('live');
  expect(await page.locator('foreignObject.latex-widget .badge').count(), 'not drawn').toBeGreaterThanOrEqual(1);
  await page.locator('.latex-block[data-nodelist-b64]').nth(1).evaluate((b: HTMLElement) => { b.style.width = '170px'; });
  await page.waitForTimeout(400);
  expect(await page.locator('.badge.cut-right').count(), 'not split in a narrow column').toBeGreaterThanOrEqual(1);
  expect(await page.locator('.badge.cut-left').count()).toBeGreaterThanOrEqual(1);
});

test('invalidate measures again, and the old pieces are ended', async ({ openPage }) => {
  // Pieces replaced by a new measurement were never told: their drawing leaked.
  const page = await openPage('live');
  const before = await page.evaluate(() => [window.__measured, window.__pieces]);
  await page.evaluate(() => window.__badge.set('short'));
  await page.waitForTimeout(400);
  expect((await page.locator('.badge').allTextContents()).join('')).toBe('short');
  const [measured, pieces] = await page.evaluate(() => [window.__measured, window.__pieces]);
  expect(measured).toBeGreaterThan(before[0]);
  expect(pieces, 'the replaced pieces were not ended').toBe(1);
});
