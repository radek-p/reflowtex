// SPDX-License-Identifier: AGPL-3.0-or-later
// Asides (\webaside, \marginpar): the API, and side notes.
import { test, expect, type WebPage } from './fixtures.ts';

test('query, width, render, anchor', async ({ openPage }) => {
  const page = await openPage('asides');
  const r = await page.evaluate(() => {
    const all = reflowtex.asides(), plain = reflowtex.asides({ kind: 'plain', for: 'y' });
    const el = document.createElement('div'); document.body.append(el);
    const drawn = plain[0].render(el);
    const a = plain[0].anchor();
    return { kinds: all.map((a: any) => a.kind).sort(), plain: plain.length, width: plain[0].width() as number,
             drawn, drawnWidth: el.firstElementChild!.getBoundingClientRect().width,
             anchor: a && [a.x, a.y], block: plain[0].block === document.querySelectorAll('.latex-block[data-nodelist-b64]')[1] };
  });
  expect(r.kinds).toEqual(['custom', 'marginpar', 'marginpar', 'plain']);
  expect(r.plain === 1 && r.block).toBe(true);
  expect(r.width > 50 && r.width < 600, 'natural width of one line').toBe(true);
  expect(Math.abs(r.drawn.width - r.width) < 0.5 && r.drawn.baseline > 0).toBe(true);
  expect(r.anchor, 'an aside written in text has a mark').not.toBeNull();
});

test('anchor on its line', async ({ openPage }) => {
  const page = await openPage('asides');
  const r = await page.evaluate(() => {
    const a = reflowtex.asides({ kind: 'plain' })[0], at = a.anchor();
    const lines = [...a.block.querySelectorAll('svg text tspan')].map((t: any) => {
      const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
      return p.matrixTransform(t.getScreenCTM()).y; });
    return Math.min(...lines.map(y => Math.abs(y - at.y)));
  });
  expect(r, `the mark is ${r.toFixed(2)} px from the nearest baseline`).toBeLessThan(0.5);
});

test('layout event', async ({ openPage }) => {
  const page = await openPage('asides');
  await page.evaluate(() => { window.__n = 0; document.addEventListener('reflowtex:layout', () => window.__n++); });
  await page.locator('.latex-block[data-nodelist-b64]').first().evaluate((b: HTMLElement) => { b.style.width = '300px'; });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__n)).toBeGreaterThanOrEqual(1);
});

const notes = (page: WebPage) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.latex-margin-note:not([hidden])')].map(n => {
  const r = n.getBoundingClientRect(), t = n.querySelector('svg text tspan') as SVGGraphicsElement;
  const p = t.ownerSVGElement!.createSVGPoint(); p.y = parseFloat(t.getAttribute('y')!);
  return { kind: n.dataset.kind!, left: r.left, top: r.top, bottom: r.bottom, base: p.matrixTransform(t.getScreenCTM()!).y,
           right: n.closest('.latex-block')!.getBoundingClientRect().right }; }));

test('side notes in the margin', async ({ openPage }) => {
  const page = await openPage('asides', { width: 1400 });
  const ns = await notes(page);
  expect(ns.map(n => n.kind).sort()).toEqual(['custom', 'marginpar', 'marginpar']);
  for (const n of ns) expect(n.left, 'a note over the text').toBeGreaterThanOrEqual(n.right);
  const anchors: number[] = await page.evaluate(() => reflowtex.asides({ place: 'margin' }).map((a: any) => a.anchor().y));
  const ordered = [...ns].sort((a, b) => a.top - b.top);
  expect(Math.abs(ordered[0].base - Math.min(...anchors)), 'the first note is not on its line').toBeLessThan(0.5);
  for (let i = 1; i < ordered.length; i++) expect(ordered[i].top, 'notes overlap').toBeGreaterThanOrEqual(ordered[i - 1].bottom);
});

test('no margin: marks open the note', async ({ openPage }) => {
  const page = await openPage('asides', { width: 1400 });
  await page.evaluate(() => {
    for (const b of document.querySelectorAll<HTMLElement>('.latex-block')) b.style.setProperty('--latex-margin-width', '0');
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(300);
  expect(await page.locator('.latex-margin-note:not([hidden])').count()).toBe(0);
  const marks = page.locator('.latex-margin-mark:not([hidden])');
  expect(await marks.count()).toBe(3);
  await marks.first().click();
  expect(await page.locator('#latex-footnote-pop.latex-footnote-open svg text tspan').count()).toBeGreaterThan(0);
});
