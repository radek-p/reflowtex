// SPDX-License-Identifier: AGPL-3.0-or-later
// Live text (\webtext) and widgets (\webwidget).
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

const SLOT = '[data-slot="apples"]';
const words = async (page: WebPage) => (await page.locator(SLOT).allTextContents()).join('').replaceAll(' ', '');

test('setText, and back', async ({ openPage }) => {
  const page = await openPage('live');
  expect(await words(page)).toBe('noapplesatall');
  await page.evaluate(() => reflowtex.host.setText('apples', 'a great many apples indeed'));
  await idle(page);
  expect(await words(page)).toBe('agreatmanyapplesindeed');
  await page.evaluate(() => reflowtex.host.setText('apples', null));
  await idle(page);
  expect(await words(page)).toBe('noapplesatall');
});

test("an instance's text wins over its name's", async ({ openPage }) => {
  const page = await openPage('live');
  await page.evaluate(() => reflowtex.host.setText('apples', 'many'));
  await page.evaluate(() => reflowtex.host.instances({ kind: 'text', name: 'apples' })[0].setText('seven apples'));
  await idle(page);
  expect(await words(page)).toBe('sevenapples');
  await page.evaluate(() => reflowtex.host.instances({ kind: 'text', name: 'apples' })[0].setText(null));
  await idle(page);
  expect(await words(page)).toBe('many');
});

test('widget drawn and split', async ({ openPage }) => {
  const page = await openPage('live');
  expect(await page.locator('foreignObject.latex-widget .badge').count(), 'not drawn').toBeGreaterThanOrEqual(1);
  await page.locator('.latex-block[data-nodelist-b64]').nth(1).evaluate((b: HTMLElement) => { b.style.width = '170px'; });
  await idle(page);
  expect(await page.locator('.badge.cut-right').count(), 'not split in a narrow column').toBeGreaterThanOrEqual(1);
  expect(await page.locator('.badge.cut-left').count()).toBeGreaterThanOrEqual(1);
});

test('invalidate measures again, and the old pieces are ended', async ({ openPage }) => {
  // Pieces replaced by a new measurement were never told: their drawing leaked.
  const page = await openPage('live');
  const before = await page.evaluate(() => [window.__measured, window.__pieces]);
  await page.evaluate(() => window.__badge.set('short'));
  await idle(page);
  expect((await page.locator('.badge').allTextContents()).join('')).toBe('short');
  const [measured, pieces] = await page.evaluate(() => [window.__measured, window.__pieces]);
  expect(measured).toBeGreaterThan(before[0]);
  expect(pieces, 'the replaced pieces were not ended').toBe(1);
});

// A no-break space in a given text is TeX's ~: the words either side stay on
// one line, with the font's interword glue between them – not the browser's
// advance for U+00A0, measured as part of one word (about 10 px against
// TeX's 6.7 at 20 px: every tie made its line some 3 px too wide).
const TIES = 'Bounds\u00A01 to\u00A04';
const BOUNDS = '.latex-block[data-nodelist-b64]:has([data-slot="bounds"])';

/** The slot's words where they are drawn: text, x (svg units), and, from the
 *  layout, the line each is on; with the slot's interword space and spToPx. */
type Bounds = { k: number; space: number;
  nodes: { type: string; text?: string; width: number; penalty?: number; line?: number }[];
  drawn: { text: string; x: number }[] };
async function bounds(page: WebPage): Promise<Bounds> {
  return page.evaluate((sel: string): Bounds => {
    const el = document.querySelector(sel) as HTMLElement, st = reflowtex.inspect.state(el);
    const id = st.doc.slots.findIndex((s: any) => s.name === 'bounds') + 1, slot = st.doc.slots[id - 1];
    const line = new Map<any, number>();
    st.cache.layout.laid.forEach((L: any, a: number) => (L.lines || []).forEach((ln: any, b: number) =>
      ln.nodes.forEach((n: any) => line.set(n, a * 1000 + b))));
    const nodes = st.doc.paragraphs.flatMap((p: any) => p.nodes).filter((n: any) => n.slot === id);
    return {
      k: reflowtex.inspect.spToPx as number, space: slot.space as number,
      nodes: nodes.map((n: any) => ({ type: n.type, text: n.text, width: n.width, penalty: n.penalty, line: line.get(n) })),
      drawn: [...el.querySelectorAll('[data-slot="bounds"]')].map(t => ({ text: t.textContent!, x: Number(t.getAttribute('x')) })),
    };
  }, BOUNDS);
}

test('a no-break space is a tie of the interword glue', async ({ openPage }) => {
  const page = await openPage('live');
  await page.evaluate(t => reflowtex.host.setText('bounds', t), TIES);
  await idle(page);
  const { k, space, nodes, drawn } = await bounds(page);
  expect(drawn.map(d => d.text)).toEqual(['Bounds', '1', 'to', '4']);
  // each tie: a penalty 10000, then the slot's interword glue
  const kinds = nodes.map(n => n.type === 'glyph' ? n.text : n.type === 'penalty' ? `p${n.penalty}` : n.type);
  expect(kinds).toEqual(['Bounds', 'p10000', 'glue', '1', 'glue', 'to', 'p10000', 'glue', '4']);
  expect(nodes.filter(n => n.type === 'glue').every(n => n.width === space)).toBe(true);
  // and drawn so: the gap after a tied word is the interword space
  const at = (t: string) => drawn.find(d => d.text === t)!;
  const w = (t: string) => nodes.find(n => n.text === t)!.width * k;
  expect(Math.abs(at('1').x - at('Bounds').x - w('Bounds') - space * k)).toBeLessThan(0.05);
  expect(Math.abs(at('4').x - at('to').x - w('to') - space * k)).toBeLessThan(0.05);
});

test('a text with ties is as wide as TeX set it', async ({ openPage }) => {
  // The paragraph is one line, its last: every glue at its natural width.
  // Its width: from the left of B to the right of 4. (The 4 is the same
  // glyph in both, given its browser width; each word as the browser
  // measures it against TeX's glyphs and kerns: well within a pixel. The
  // browser's no-break space put the line some 6 px out.)
  const page = await openPage('live');
  const tex = await bounds(page);
  expect(tex.drawn.map(d => d.text).join('')).toBe('Bounds1to4');
  await page.evaluate(t => reflowtex.host.setText('bounds', t), TIES);
  await idle(page);
  const web = await bounds(page);
  const right = (b: Bounds, last: number) => b.drawn[b.drawn.length - 1].x + last * b.k - b.drawn[0].x;
  const words = web.nodes.filter(n => n.type === 'glyph'), four = words.find(n => n.text === '4');
  const natural = right(web, words[words.length - 1].width);
  expect(Math.abs(natural - right(tex, four ? four.width : NaN)), 'not TeX\'s width').toBeLessThan(1);
});

test('no break at a no-break space, at any width; the spaces still break', async ({ openPage }) => {
  const page = await openPage('live');
  await page.evaluate(t => reflowtex.host.setText('bounds', t), TIES);
  await idle(page);
  // too narrow by the last word: the only legal break left is the space;
  // then far too narrow for any word
  const { drawn } = await bounds(page), x = (t: string) => drawn.find(d => d.text === t)!.x;
  for (const px of [Math.floor(x('4') - x('Bounds')), 40]) {
    await page.locator(BOUNDS).evaluate((b: HTMLElement, px: number) => { b.style.width = px + 'px'; }, px);
    await idle(page);
    const { nodes } = await bounds(page);
    const line = (t: string) => nodes.find(n => n.text === t)!.line;
    expect(line('Bounds'), `${px} px`).toBeDefined();
    expect(line('1'), `${px} px: broken at a tie`).toBe(line('Bounds'));
    expect(line('4'), `${px} px: broken at a tie`).toBe(line('to'));
    expect(line('to'), `${px} px: not broken at the space`).not.toBe(line('1'));
  }
});
