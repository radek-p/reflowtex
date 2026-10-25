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

// Live text inside boxes: a \webtext in an \hbox, in maths' \text, in an
// equation's tag (placed by the display model) and in a one-line caption
// (LaTeX's \@makecaption: a box set to the measure, centred by its fills).
// The text the page gives is drawn there, the box around it grows with it
// (or, set to a width, takes it into its glue), so nothing it holds or
// follows it is drawn over, and the line still fits the measure.
type Drawn = { slot: number; text: string; x: number; adv: number; y: number; seg: number };
type BoxGeometry = { k: number; column: number; slotted: Drawn[]; others: Drawn[]; box: { x: number; adv: number } | null; dom: string };
async function inBox(page: WebPage, name: string): Promise<BoxGeometry> {
  return page.evaluate((name: string): BoxGeometry => {
    const el = [...document.querySelectorAll('.latex-block[data-nodelist-b64]')]
      .find(b => b.querySelector(`[data-slot="${name}"]`)) as HTMLElement;
    const st = reflowtex.inspect.state(el);
    // (every slot of the name: maths' \text sets its argument once per style)
    const ids = new Set(st.doc.slots.flatMap((s: any, i: number) => s.name === name ? [i + 1] : []));
    const holds = (n: any): boolean => ids.has(n.slot) || (n.children || []).some(holds);
    const glyphs: Drawn[] = [];
    let box: { x: number; adv: number } | null = null;
    st.cache.layout.laid.forEach((_: any, i: number) => reflowtex.inspect.replay(el, i, {
      node(n: any, x: number, y: number, adv: number) {
        if (n.type === 'glyph') glyphs.push({ slot: n.slot || 0, text: n.text ?? String.fromCodePoint(n.char), x, adv, y, seg: i });
        // the innermost box holding the slot (boxes are reported after what they hold)
        else if (n.type === 'hlist' && !box && (n.children || []).some(holds)) box = { x, adv };
      },
    }));
    const slotted = glyphs.filter(g => ids.has(g.slot));
    const at = slotted[0];
    return { k: reflowtex.inspect.spToPx, column: st.cache.layoutCtx.columnPx, slotted, box,
             others: glyphs.filter(g => !ids.has(g.slot) && at && g.seg === at.seg && Math.abs(g.y - at.y) < 0.01),
             dom: [...el.querySelectorAll(`[data-slot="${name}"]`)].map(t => t.textContent).join('') };
  }, name);
}

for (const [name, text] of [['inbox', 'one, two and three'], ['inmath', 'one, two and three'],
                            ['intag', '1.2.3 revised'], ['incap', 'considerably longer']]) {
  test(`live text in a box: ${name}`, async ({ openPage }) => {
    const page = await openPage('live-boxes');
    const before = await inBox(page, name);
    expect(before.box, 'no box holds the slot').not.toBeNull();
    await page.evaluate(([n, t]) => reflowtex.host.setText(n, t), [name, text]);
    await idle(page);
    const after = await inBox(page, name);
    const words = text.replaceAll(' ', '');
    expect(after.dom, 'not drawn').toBe(words);
    expect(after.slotted.map(g => g.text).join(''), 'not laid out').toBe(words);
    // the box widened by what the text did (to within a pixel: the browser's
    // words against TeX's glyphs), and holds every word
    const width = (d: Drawn[]) => d[d.length - 1].x + d[d.length - 1].adv - d[0].x;
    const grew = width(after.slotted) - width(before.slotted);
    expect(grew, 'the text is no wider').toBeGreaterThan(10);
    expect(Math.abs(after.box!.adv - before.box!.adv - grew), 'the box did not grow with it').toBeLessThan(1);
    for (const g of after.slotted) {
      expect(g.x, `${g.text}: left of its box`).toBeGreaterThanOrEqual(after.box!.x - 0.5);
      expect(g.x + g.adv, `${g.text}: past its box`).toBeLessThanOrEqual(after.box!.x + after.box!.adv + 0.5);
      // nothing else on its line drawn over it
      for (const o of after.others)
        expect(o.x + o.adv <= g.x + 0.3 || o.x >= g.x + g.adv - 0.3, `${o.text} over ${g.text}`).toBe(true);
    }
    // and the line fits the measure
    for (const g of [...after.slotted, ...after.others]) {
      expect(g.x, `${g.text}: past the left edge`).toBeGreaterThanOrEqual(-0.5);
      expect(g.x + g.adv, `${g.text}: past the measure`).toBeLessThanOrEqual(after.column + 0.5);
    }
    // back to TeX's own
    await page.evaluate(n => reflowtex.host.setText(n, null), name);
    await idle(page);
    const again = await inBox(page, name);
    expect(again.dom).toBe(before.dom);
    expect(Math.abs(again.box!.adv - before.box!.adv), 'not back to its width').toBeLessThan(0.01);
  });
}

test('a box grown by live text: its paragraph broken again at a narrow width', async ({ openPage }) => {
  const page = await openPage('live-boxes');
  await page.evaluate(() => reflowtex.host.setText('inbox', 'one, two and three'));
  const block = page.locator('.latex-block[data-nodelist-b64]:has([data-slot="inbox"])');
  await block.evaluate((b: HTMLElement) => { b.style.width = '240px'; });
  await idle(page);
  const g = await inBox(page, 'inbox');
  expect(g.dom).toBe('one,twoandthree');
  for (const o of g.others) for (const s of g.slotted)
    expect(o.x + o.adv <= s.x + 0.3 || o.x >= s.x + s.adv - 0.3, `${o.text} over ${s.text}`).toBe(true);
  const all = await page.evaluate(() => {
    const el = document.querySelector('.latex-block[data-nodelist-b64]:has([data-slot="inbox"])') as HTMLElement;
    const st = reflowtex.inspect.state(el), out: number[] = [];
    st.cache.layout.laid.forEach((_: any, i: number) => reflowtex.inspect.replay(el, i, {
      node(n: any, x: number, _y: number, adv: number) { if (n.type === 'glyph') out.push(x + adv); } }));
    return { right: Math.max(...out), column: st.cache.layoutCtx.columnPx };
  });
  expect(all.right, 'a line past the measure').toBeLessThanOrEqual(all.column + 0.5);
});
