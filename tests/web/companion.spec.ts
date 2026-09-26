// SPDX-License-Identifier: AGPL-3.0-or-later
// The companion plugin: an InlineButton with a typeset label opening a
// Popover (the pattern of \mypopover).
import { test, expect } from './fixtures.ts';

test('button fits its label on the baseline', async ({ openPage }) => {
  const page = await openPage('companion');
  await page.waitForSelector('.rtx-button svg text tspan', { state: 'attached' });
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.rtx-button')!, lab = reflowtex.host.instances('popover')[0].part('popover-label');
    const base = (t: any) => { const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
                               return p.matrixTransform(t.getScreenCTM()).y as number; };
    const own = base(b.querySelector('svg text tspan'));
    const text = [...b.closest('.latex-block')!.querySelectorAll('svg text tspan')].filter(t => !b.contains(t)).map(base);
    return { width: b.getBoundingClientRect().width, label: lab.naturalWidth() as number, off: Math.min(...text.map(y => Math.abs(y - own))) };
  });
  expect(r.label < r.width && r.width < r.label + 40).toBe(true);
  expect(r.off, `the label is ${r.off.toFixed(2)} px off the line's baseline`).toBeLessThan(0.5);
});

test('popover opens and closes', async ({ openPage }) => {
  const page = await openPage('companion');
  const button = page.locator('.rtx-button');
  await button.click();
  await page.waitForSelector('.rtx-popover svg text tspan', { state: 'attached' });
  expect(await button.getAttribute('aria-expanded')).toBe('true');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rtx-popover', { state: 'detached' });      // Preact re-renders on its own time
  await button.click();
  await page.waitForSelector('.rtx-popover', { state: 'attached' });
  const box = await page.locator('.rtx-popover').boundingBox();
  expect(box && box.width > 100 && box.height > 20, `the reopened popover has no size: ${JSON.stringify(box)}`).toBe(true);
  await page.mouse.click(5, 5);
  await page.waitForSelector('.rtx-popover', { state: 'detached' });
});
