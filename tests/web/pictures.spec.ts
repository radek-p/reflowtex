// SPDX-License-Identifier: AGPL-3.0-or-later
// Included bitmaps (pages/pictures/c-bitmaps.tex): a PNG and a JPEG are each
// an <image> of their own bytes, drawn at the size TeX gave them – not the
// whole block – and laid out again with the text.
import { test, expect } from './fixtures.ts';
import { idle } from './web.ts';

const PX_PER_PT = 96 / 72.27;

test('a PNG and a JPEG are drawn at their TeX size', async ({ openPage }) => {
  const page = await openPage('pictures');
  const block = page.locator('.latex-block[data-nodelist-b64]').filter({ has: page.locator('.latex-picture image') });
  await expect(block).toHaveCount(1);
  const measure = () => block.evaluate(b => {
    return { block: b.getBoundingClientRect().width, images: [...b.querySelectorAll('.latex-picture image')].map(i => {
      const r = i.getBoundingClientRect();
      return { type: /^data:(image\/\w+);base64,/.exec(i.getAttribute('href') ?? '')?.[1], w: r.width, h: r.height, left: r.left, top: r.top };
    }) };
  });
  const m = await measure();
  expect(m.images.map(i => i.type)).toEqual(['image/png', 'image/jpeg']);
  const [png, jpeg] = m.images;
  // 3 cm wide, 6 × 4; 1 cm tall, square – at the block's scale, which the
  // PNG's width gives; the JPEG's height must agree with it
  const scale = png.w / (3 / 2.54 * 72.27 * PX_PER_PT);
  expect(scale).toBeGreaterThan(0.5);
  expect(png.h / png.w).toBeCloseTo(4 / 6, 2);
  expect(jpeg.w / jpeg.h).toBeCloseTo(1, 2);
  expect(jpeg.h / (1 / 2.54 * 72.27 * PX_PER_PT * scale)).toBeCloseTo(1, 2);
  expect(png.w, 'the PNG fills its box, not the block').toBeLessThan(m.block / 2);

  // a narrower block breaks the line again: the images keep their size
  await block.evaluate((b: HTMLElement) => { b.style.width = '200px'; });
  await idle(page);
  const n = await measure();
  n.images.forEach((img, k) => {
    expect(img.w).toBeCloseTo(m.images[k].w, 1);
    expect(img.h).toBeCloseTo(m.images[k].h, 1);
  });
});

// Pictures drawn as their PDF paints them (pages/pictures/d-backgrounds.tex):
// an included figure's opaque white page (white-page.pdf, as Figma exports
// one) and a TikZ picture's white rectangle as large as itself are white,
// which a theme shows as the page's colour; a coloured square keeps its
// colour, as the colour map gives it.
test('a white page in a picture is the page\'s colour in every theme; colours are mapped', async ({ openPage }) => {
  const fills = async (theme?: string) => {
    const page = await openPage('pictures', theme ? { theme } : {});
    return page.evaluate(() => {
      const pics = [...document.querySelectorAll('.latex-picture')].filter(g => g.querySelector('[fill*="--latex-color-ffffff"]'));
      const fill = (e: Element | null) => (e ? getComputedStyle(e).fill : null);
      return {
        pageBg: getComputedStyle(document.documentElement).backgroundColor,
        whites: pics.map(g => fill(g.querySelector('[fill*="--latex-color-ffffff"]'))),
        red: fill(document.querySelector('.latex-picture [fill*="--latex-color-ff0000"]')),
        blue: fill(document.querySelector('.latex-picture [fill*="--latex-color-000099"]')),
      };
    });
  };
  const light = await fills(), dark = await fills('dark');
  expect(light.whites, 'the included figure\'s page and the TikZ rectangle').toHaveLength(2);
  // the page's colour in each theme (the page's own: near white, near black)
  expect(light.whites).toEqual([light.pageBg, light.pageBg]);
  expect(dark.whites).toEqual([dark.pageBg, dark.pageBg]);
  expect(dark.pageBg).not.toBe(light.pageBg);
  expect([light.red, dark.red]).toEqual(['rgb(255, 0, 0)', 'rgb(255, 0, 0)']);
  expect([light.blue, dark.blue]).toEqual(['rgb(0, 0, 153)', 'rgb(153, 204, 255)']);
});
