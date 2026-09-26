// SPDX-License-Identifier: AGPL-3.0-or-later
// The accordion drawn by the companion (src/companion/src/kinds/
// accordion.tsx): animated switching, reduced motion, the keyboard, styling
// from LaTeX, print, nesting, and a component that throws.
import { test, expect, type WebPage } from './fixtures.ts';

const ACC = '.latex-stream[data-kind="accordion"]';

const state = (page: WebPage, n = 0) => page.evaluate(n => {
  const a = document.querySelectorAll<HTMLElement>('.rtx-accordion')[n];
  return { pane: a.dataset.pane, states: [...a.children].map(p => (p as HTMLElement).dataset.state),
           animating: 'animating' in a.dataset, height: a.getBoundingClientRect().height };
}, n);

/** Click the n-th visible control sending `action` (a prefix). */
const press = (page: WebPage, action: string, n = 0) =>
  page.locator(`.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action^="${action}"]`).nth(n).click({ force: true });

test('drawn by the companion', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  const s = await state(page);
  expect(s.pane).toBe('collapsed');
  expect(s.states).toEqual(['open', 'closed']);
  expect(await page.locator(`${ACC} > .rtx-accordion`).count(), "every accordion (one nested) is the companion's").toBe(4);
  expect(await page.locator('.latex-stream[data-kind="pane"]').count(), 'no pane drawn the old way').toBe(0);
});

test('a switch animates, then settles', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  const start = (await state(page)).height;
  await press(page, 'pane:next');
  await page.waitForTimeout(90);
  const mid = await state(page);
  expect(mid.animating).toBe(true);
  expect(mid.states).toEqual(['leaving', 'open']);
  await page.waitForTimeout(600);
  const end = await state(page);
  expect([end.animating, end.pane]).toEqual([false, 'expanded']);
  expect(end.states).toEqual(['closed', 'open']);
  expect(start < mid.height && mid.height < end.height, 'the height eases from one pane to the other').toBe(true);
  await press(page, 'pane:prev');
  await page.waitForTimeout(600);
  expect((await state(page)).pane).toBe('collapsed');
});

test('reduced motion cuts', async ({ openPage }) => {
  const page = await openPage('accordion-v2', { reducedMotion: 'reduce' });
  await press(page, 'pane:next');
  await page.waitForTimeout(30);
  const s = await state(page);
  expect(s.animating).toBe(false);
  expect(s.states).toEqual(['closed', 'open']);
});

test('motion: none from CSS', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  await page.addStyleTag({ content: '.rtx-accordion { --rtx-accordion-motion: none; }' });
  await press(page, 'pane:next');
  await page.waitForTimeout(30);
  expect((await state(page)).animating).toBe(false);
});

test('what follows moves with it', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  const after = () => page.evaluate(() => {
    const b = document.querySelector('.latex-block[data-nodelist-b64]')!;
    const ts = [...b.querySelectorAll(':scope > div > div > svg text tspan')];
    const t: any = ts[ts.length - 1], p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
    return p.matrixTransform(t.getScreenCTM()).y as number;
  });
  const y0 = await after();
  await press(page, 'pane:next');
  await page.waitForTimeout(700);
  expect(await after(), 'the text after the accordion moved down as the taller pane opened').toBeGreaterThan(y0 + 10);
});

test('the keyboard moves focus to the new pane', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  await page.locator('.rtx-pane[data-state="open"] .latex-action[tabindex]').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const a = document.activeElement as HTMLElement;
    return { inOpen: !!a.closest('.rtx-pane[data-state="open"]'), action: a.dataset.linkAction || '' }; });
  expect(r.inOpen).toBe(true);
  expect(r.action.startsWith('pane:')).toBe(true);
});

test('styled from LaTeX', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  const r = await page.evaluate(() => {
    const h = document.querySelectorAll<HTMLElement>('.latex-stream[data-kind="accordion"]')[1];
    const cs = getComputedStyle(h);
    return { variant: h.dataset.variant, motion: h.dataset.motion, cls: h.classList.contains('faq'),
             accent: cs.getPropertyValue('--rtx-accent').trim(), pad: parseFloat(cs.paddingTop),
             border: parseFloat(cs.borderTopWidth), pane: (h.querySelector('.rtx-accordion') as HTMLElement).dataset.pane };
  });
  expect([r.variant, r.motion, r.cls]).toEqual(['card', 'fade', true]);
  expect(r.accent).toBe('#c2410c');
  expect(r.pad > 0 && r.border > 0).toBe(true);
  expect(r.pane, 'initial= by name').toBe('two');
});

test('actions by name and number', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  const acc = page.locator('.rtx-accordion').nth(1);
  await acc.locator('.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action="pane:next"]').click({ force: true });
  await page.waitForTimeout(600);
  expect((await state(page, 1)).pane).toBe('three');
  await acc.locator('.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action="pane:first"]').first().click({ force: true });
  await page.waitForTimeout(600);
  expect((await state(page, 1)).pane).toBe('one');
});

test('nested accordions act alone', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  const inner = page.locator('.rtx-accordion').nth(2).locator('.rtx-accordion');
  await inner.locator('.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action="pane:next"]').click({ force: true });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const o = document.querySelectorAll<HTMLElement>('.rtx-accordion')[2];
    return { outer: o.dataset.pane, inner: (o.querySelector('.rtx-accordion') as HTMLElement).dataset.pane }; });
  expect(r).toEqual({ outer: 'outer-a', inner: 'inner-b' });
});

test('the state survives relayout', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  await press(page, 'pane:next');
  await page.waitForTimeout(600);
  await page.locator('.latex-block[data-nodelist-b64]').first().evaluate((b: HTMLElement) => { b.style.width = '320px'; });
  await page.waitForTimeout(400);
  expect((await state(page)).pane).toBe('expanded');
});

test('print shows the print pane', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => [...document.querySelectorAll('.rtx-accordion')[1].children].map(p => ({
    shown: getComputedStyle(p).display !== 'none', glyphs: p.querySelectorAll('tspan').length })));
  expect(r.map(x => x.shown), 'print= defaults to the last pane').toEqual([false, false, true]);
  expect(r[2].glyphs, 'painted for print').toBeGreaterThan(0);
});

test('a component that throws draws the body', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  await page.evaluate(`(async () => {
    const { define } = await import('reflowtex/companion');
    define('accordion', () => { throw new Error('boom'); });
  })()`);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const h = document.querySelector('.latex-stream[data-kind="accordion"]')!;
    return { ours: h.querySelectorAll('.rtx-accordion').length, glyphs: h.querySelectorAll('tspan').length }; });
  expect(r.ours).toBe(0);
  expect(r.glyphs).toBeGreaterThan(0);
  expect(page.errors.some(e => e.includes('failed, drawn plainly'))).toBe(true);
  page.errors.length = 0;
});
