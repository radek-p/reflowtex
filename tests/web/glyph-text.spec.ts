// SPDX-License-Identifier: AGPL-3.0-or-later
// What a glyph says as text (src/shared/glyph-text.ts), wherever the page
// turns glyphs into text: copying, and the text a mark is found by.
import { test, expect } from './fixtures.ts';
import type { Locator } from '@playwright/test';

/** The block's text, copied as a reader copies it: all of it selected, and
 *  what the copy put in the event's clipboardData (read on window, after the
 *  viewer's listener on document) – or, where the viewer leaves the copy to
 *  the browser, the selection's text, which is what the browser copies (a
 *  copy event made by a script does not run the browser's own). */
const copyAll = (block: Locator) => block.evaluate(el => {
  const sel = getSelection()!, r = document.createRange();
  r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
  let text = '';
  const read = (e: ClipboardEvent) => { text = e.clipboardData!.getData('text/plain'); };
  window.addEventListener('copy', read);
  document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
  window.removeEventListener('copy', read);
  return text || sel.toString();
});

// A ligature was copied as its one character (U+FB03 for "ffi"), a classic
// font's as a private-use code, and so was a sign with no character of its
// own; a mark could not be found by a ligature's letters.
test("copying gives each glyph's text: a ligature's letters, nothing for a private-use code", async ({ openPage }) => {
  const page = await openPage('glyph-text');
  const block = page.locator('.latex-block[data-nodelist-b64]').first();
  expect(await block.locator('tspan[data-text]').count(), 'drawn by codes that are not their text').toBeGreaterThan(0);
  const copied = (await copyAll(block)).replace(/\s+/g, ' ');
  expect(copied).toContain('The official finding of the office was effective');
  expect(copied).toContain('A classic font’s official finding was as effective.');
  expect(copied).toContain('search for, , which says nothing');
  expect(copied).not.toMatch(/[-ﬀ-ﬆ]|[\u{F0000}-\u{10FFFF}]/u);
  // the glyphs' text as the page's API gives it, and a mark found by it
  const r = await block.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const [all] = reflowtex.host.rangesOf(range);
    const m = reflowtex.host.addMark([{ block: all.block, from: -1, to: -1, text: 'officialfinding' }]);
    return { text: all.text as string, found: m && m.ranges.map((x: { text: string }) => x.text) };
  });
  expect(r.text).toContain('Theofficialfindingoftheofficewaseffective');
  expect(r.found).toEqual(['officialfinding']);
});

// A font no producer can give a face (here one defined in Lua, with metrics
// and nothing to draw): the page was refused at build time, and the boxes
// the viewer drew for such a font had no text – not selected, copied, found
// or linked. Then each glyph was outlined in red; now it takes the space TeX
// gave it and draws nothing (the build's warning says why, in the log).
test('a font with no face: its glyphs take their space unseen, their text selected, copied and found', async ({ openPage }) => {
  const page = await openPage('glyph-text');
  const block = page.locator('.latex-block[data-nodelist-b64]').nth(1);
  // nothing painted in the block but its text: no outline, no fill
  const painted = await block.locator('svg *:not(text):not(tspan)').evaluateAll(es => es.filter(e => {
    const s = getComputedStyle(e), seen = (p: string) => p !== 'none' && p !== 'rgba(0, 0, 0, 0)' && p !== 'transparent';
    return e instanceof SVGGeometryElement && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 &&
      ((seen(s.stroke) && parseFloat(s.strokeWidth) > 0) || (seen(s.fill) && Number(s.fillOpacity) > 0));
  }).map(e => e.outerHTML.slice(0, 120)));
  expect(painted).toEqual([]);
  // "Boxed words, findable": 19 glyphs, each its character, transparent,
  // TeX's width (400000 sp, 2 px per pt) apart
  const carriers = await block.locator('tspan').evaluateAll(ts => ts.filter(t => t.getAttribute('font-family') === 'serif')
    .map(t => [t.textContent!, getComputedStyle(t).fill, Number(t.getAttribute('x'))] as const));
  expect(carriers.map(c => c[0]).join('')).toBe('Boxedwords,findable');
  for (const [, fill] of carriers) expect(fill).toBe('rgba(0, 0, 0, 0)');
  expect(carriers[1][2] - carriers[0][2]).toBeCloseTo(400000 / 65536 * 2, 2);
  expect((await copyAll(block)).replace(/\s+/g, ' ')).toContain('Before the font, Boxed words, findable and after it again');
  const r = await block.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const [all] = reflowtex.host.rangesOf(range);
    const m = reflowtex.host.addMark([{ block: all.block, from: -1, to: -1, text: 'Boxedwords,findable' }]);
    getSelection()!.removeAllRanges();
    // the browser's own find
    const found = (window as unknown as { find(s: string): boolean }).find('findable');
    const at = getSelection()!.anchorNode;
    return { mark: m && m.ranges.map((x: { text: string }) => x.text), found, inBlock: !!at && el.contains(at) };
  });
  expect(r.mark).toEqual(['Boxedwords,findable']);
  expect(r.found && r.inBlock, 'the browser finds the text in the block').toBe(true);
});
