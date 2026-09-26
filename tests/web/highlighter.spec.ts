// SPDX-License-Identifier: AGPL-3.0-or-later
// Live marks (host.addMark, host.rangesOf, host.liveMarks) and the
// companion's highlighter built on them (<div data-rtx="highlighter">): the
// reader selects text, picks a colour, and the text has a band behind each
// of its lines, as the author's \webclass does.
import { test, expect, type WebPage } from './fixtures.ts';

/** Select from the first glyph of mark `key` to its last (or, with `into`,
 *  to the n-th glyph of the second block), as a reader would. */
async function selectKey(page: WebPage, opts: { into?: number; glyphs?: [number, number] } = {}) {
  await page.evaluate(({ into, glyphs }) => {
    const els = reflowtex.host.mark('key').elements();
    let a = els[0], b = els[els.length - 1];
    if (glyphs) { a = els[glyphs[0]]; b = els[glyphs[1]]; }
    if (into !== undefined) b = document.querySelectorAll('.latex-block')[1].querySelectorAll('tspan')[into];
    const r = document.createRange();
    r.setStart(a.firstChild!, 0);
    r.setEnd(b.firstChild!, b.textContent!.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  }, opts);
  await expect(page.locator('.rtx-highlighter')).toBeVisible();
}

const bands = (page: WebPage, colour = 'yellow') => page.evaluate(c =>
  [...document.querySelectorAll<SVGRectElement>(`rect.latex-mark[data-mark~="rtx-highlight-${c}"]`)]
    .filter(r => r.width.baseVal.value > 0)
    .map(r => ({ fill: getComputedStyle(r).fill, y: Math.round(r.getBoundingClientRect().top) })), colour);

test('a selection highlighted: a band on every line, styled, kept through a reflow', async ({ openPage }) => {
  const page = await openPage('highlighter');
  await selectKey(page);
  await page.getByRole('button', { name: 'Highlight: yellow' }).click();
  await expect(page.locator('.rtx-highlighter')).toHaveCount(0);
  const r = await page.evaluate(() => {
    const [m] = reflowtex.host.liveMarks();
    const key = reflowtex.host.mark('key').elements();
    return { n: reflowtex.host.liveMarks().length, text: m.ranges[0].text, classes: m.classes,
             same: m.elements().length === key.length, lines: m.rects().length,
             selection: String(getSelection()) };
  });
  expect(r.n).toBe(1);
  expect(r.text, 'the glyphs, without spaces').toBe('Everynumberaboveoneisaproductofprimes,inonlyoneway');
  expect(r.classes).toBe('rtx-highlight rtx-highlight-yellow');
  expect(r.same, 'the same glyphs as the \\webid it was selected over').toBe(true);
  expect(r.selection, 'the selection is let go').toBe('');
  const wide = await bands(page);
  expect(wide.length).toBe(r.lines);
  expect(wide[0].fill, 'coloured by companion.css').not.toMatch(/none|rgba\(0, 0, 0, 0\)/);

  // A narrower column breaks the text into more lines: a band for each.
  await page.evaluate(() => { (document.querySelector('.latex-block') as HTMLElement).style.width = '260px'; });
  await page.waitForTimeout(400);
  const narrow = await bands(page);
  const lines = await page.evaluate(() => reflowtex.host.liveMarks()[0].rects().length);
  expect(lines).toBeGreaterThan(r.lines);
  expect(narrow.length).toBe(lines);
});

// A position is the glyph's place in the block's text: a selection that
// ends where the next glyph's text starts does not take that glyph.
test('rangesOf counts a glyph only when some of its text is selected', async ({ openPage }) => {
  const page = await openPage('highlighter');
  const r = await page.evaluate(() => {
    const els = reflowtex.host.mark('key').elements();
    const range = document.createRange();
    range.setStart(els[0].firstChild!, 1);        // after "E": not E
    range.setEnd(els[5].firstChild!, 0);          // before the "n" of "number": not it
    return reflowtex.host.rangesOf(range);
  });
  expect(r.length).toBe(1);
  // Five positions: TeX may hyphenate "Ev-ery", and the hyphen it would
  // draw at a line's end has a place of its own, but no text.
  expect(r[0].text).toBe('very');
  expect(r[0].to - r[0].from).toBe(4);
});

test('one highlight across two blocks', async ({ openPage }) => {
  const page = await openPage('highlighter');
  await selectKey(page, { into: 5 });
  await page.getByRole('button', { name: 'Highlight: green' }).click();
  const r = await page.evaluate(() => reflowtex.host.liveMarks().map((m: any) => m.ranges.map((x: any) => x.block)));
  expect(r.length).toBe(1);
  expect(r[0].length, 'a range in each block').toBe(2);
  expect(r[0][0]).not.toBe(r[0][1]);
});

test('highlights are remembered, and come back on the next visit', async ({ openPage }) => {
  const page = await openPage('highlighter');
  await selectKey(page);
  await page.getByRole('button', { name: 'Highlight: pink' }).click();
  const before = await page.evaluate(() => reflowtex.host.liveMarks()[0].ranges);
  await page.reload();
  await page.waitForFunction(() => (window as any).reflowtex?.host?.liveMarks().length === 1);
  const after = await page.evaluate(() => reflowtex.host.liveMarks().map((m: any) => ({ ranges: m.ranges, classes: m.classes })));
  expect(after).toEqual([{ ranges: before, classes: 'rtx-highlight rtx-highlight-pink' }]);
  expect((await bands(page, 'pink')).length).toBeGreaterThan(0);
});

// Positions are saved with the text they spelled: if the document changed
// and the text moved, it is found again, nearest its old place.
test('a saved range whose text moved is found by its text', async ({ openPage }) => {
  const page = await openPage('highlighter');
  const r = await page.evaluate(() => {
    const [real] = reflowtex.host.rangesOf((() => {
      const els = reflowtex.host.mark('key').elements(), range = document.createRange();
      range.setStart(els[0].firstChild!, 0); range.setEnd(els[4].firstChild!, 1); return range;
    })());
    const moved = reflowtex.host.addMark([{ ...real, from: real.from + 7, to: real.to + 7 }]);
    const gone = reflowtex.host.addMark([{ ...real, text: 'nowhereinthistext' }]);
    return { real, found: moved && moved.ranges[0], gone };
  });
  expect(r.found).toEqual(r.real);
  expect(r.gone, 'text not in the block: no mark').toBeNull();
});

test('the eraser takes out the selected part, and leaves the rest', async ({ openPage }) => {
  const page = await openPage('highlighter');
  await selectKey(page);
  await page.getByRole('button', { name: 'Highlight: yellow' }).click();
  await selectKey(page, { glyphs: [5, 10] });        // "number"
  await page.getByRole('button', { name: 'Remove highlight' }).click();
  const r = await page.evaluate(() => reflowtex.host.liveMarks().map((m: any) => m.ranges.map((x: any) => x.text)));
  expect(r).toEqual([['Every', 'aboveoneisaproductofprimes,inonlyoneway']]);
});

test('pressing highlighted text: recolour or remove it', async ({ openPage }) => {
  const page = await openPage('highlighter');
  await selectKey(page);
  await page.getByRole('button', { name: 'Highlight: yellow' }).click();
  const at = await page.evaluate(() => {
    const r = reflowtex.host.liveMarks()[0].rects()[0];
    return { x: r.left + 4, y: r.top + r.height / 2 };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('button', { name: 'Highlight: yellow' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Highlight: green' }).click();
  expect(await page.evaluate(() => reflowtex.host.liveMarks()[0].classes)).toBe('rtx-highlight rtx-highlight-green');
  await page.mouse.click(at.x, at.y);
  await page.getByRole('button', { name: 'Remove highlight' }).click();
  expect(await page.evaluate(() => reflowtex.host.liveMarks().length)).toBe(0);
  expect((await bands(page, 'green')).length).toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll('[data-rtx-marks]').length), 'the glyphs let go of it').toBe(0);
});

test('a selection made by dragging the mouse', async ({ openPage }) => {
  const page = await openPage('highlighter');
  const [a, b] = await page.evaluate(() => {
    const r0 = reflowtex.host.mark('key').rects()[0];
    return [{ x: r0.left + 1, y: r0.top + r0.height / 2 }, { x: r0.left + r0.width * 0.6, y: r0.top + r0.height / 2 }];
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.rtx-highlighter')).toBeVisible();
  await page.getByRole('button', { name: 'Highlight: blue' }).click();
  const text = await page.evaluate(() => reflowtex.host.liveMarks()[0]?.ranges[0].text);
  expect(text.startsWith('Every')).toBe(true);
});
