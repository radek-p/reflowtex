// SPDX-License-Identifier: AGPL-3.0-or-later
// The accessible layer (src/pipeline/a11y.ts, vanilla's --a11y): what a
// screen reader is given – the text in reading order with MathML for every
// formula – and that the drawing is hidden from it, not from the eye.
import { test, expect } from './fixtures.ts';

test('every formula reaches assistive technology as MathML; the drawing does not', async ({ openPage }) => {
  const page = await openPage('mathml');
  const tree = await page.locator('body').ariaSnapshot();
  const maths = tree.split('\n').filter(l => /^\s*- math\b/.test(l));
  // first block: three inline formulas, the integral, the alignment (one
  // table for its rows); second block: two inline formulas
  expect(maths.length).toBe(7);
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
  // the layer takes no room (its pieces hang over the block, invisible)
  for (const layer of await page.locator('.latex-a11y').all()) expect((await layer.boundingBox())!.height).toBeLessThanOrEqual(1);
  const opacities = await page.locator('.latex-a11y > *').evaluateAll(ps => ps.map(p => getComputedStyle(p).opacity));
  expect(new Set(opacities)).toEqual(new Set(['0']));
  // the drawing is there, and drawn
  expect(await page.locator('.latex-block svg').count()).toBeGreaterThan(0);
});

// Where each piece of the layer is: over what it stands for. A screen reader
// scrolls to the element it reads (and VoiceOver draws its cursor around it),
// so a layer placed anywhere else sends the reader to the wrong place.
async function layerBoxes(page: import('@playwright/test').Page) {
  return page.evaluate(() => [...document.querySelectorAll('.latex-block[data-nodelist-b64]')].map(block => {
    const b = block.getBoundingClientRect();
    const layer = block.nextElementSibling!;
    return {
      block: { top: b.top + scrollY, bottom: b.bottom + scrollY },
      pieces: [...layer.children].map(p => {
        const r = p.getBoundingClientRect();
        return { top: r.top + scrollY, bottom: r.bottom + scrollY, height: r.height, text: (p.textContent ?? '').slice(0, 30) };
      }),
    };
  }));
}

function expectPlaced(blocks: Awaited<ReturnType<typeof layerBoxes>>) {
  for (const { block, pieces } of blocks) {
    let lastTop = -Infinity;
    for (const p of pieces) {
      expect(p.height, `"${p.text}" has a height`).toBeGreaterThan(5);
      expect(p.top, `"${p.text}" starts inside its block`).toBeGreaterThanOrEqual(block.top - 2);
      expect(p.bottom, `"${p.text}" ends inside its block`).toBeLessThanOrEqual(block.bottom + 2);
      expect(p.top, `"${p.text}" follows the piece before it`).toBeGreaterThanOrEqual(lastTop);
      lastTop = p.top;
    }
  }
}

test('each paragraph and display of the layer lies over its own lines', async ({ openPage }) => {
  const page = await openPage('mathml', { height: 600 });
  const blocks = await layerBoxes(page);
  expectPlaced(blocks);
  // the three paragraphs of one segment are placed apart, not all at its top
  const [p1, p2, p3] = blocks[1].pieces;
  expect(p2.top).toBeGreaterThan(p1.bottom - 2);
  expect(p3.top).toBeGreaterThan(p2.bottom - 2);
  // and the layer is still not seen, nor in the way of the pointer
  const style = await page.locator('.latex-a11y > *').first().evaluate(e => {
    const s = getComputedStyle(e);
    return { opacity: s.opacity, pointer: s.pointerEvents };
  });
  expect(style).toEqual({ opacity: '0', pointer: 'none' });
});

test('the layer follows a reflow', async ({ openPage }) => {
  const page = await openPage('mathml', { width: 1200, height: 600 });
  await page.setViewportSize({ width: 420, height: 600 });
  await page.waitForTimeout(600);                                 // the resize settles
  expectPlaced(await layerBoxes(page));
});
