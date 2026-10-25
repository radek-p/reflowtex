// SPDX-License-Identifier: AGPL-3.0-or-later
// What a glyph says as text (src/shared/glyph-text.ts), wherever the page
// turns glyphs into text: copying, and the text a mark is found by.
import { test, expect } from './fixtures.ts';
import type { Locator } from '@playwright/test';

/** The block's text, copied as a reader copies it: all of it selected, and
 *  what the copy put in the event's clipboardData (read on window, after the
 *  viewer's listener on document). */
const copyAll = (block: Locator) => block.evaluate(el => {
  const sel = getSelection()!, r = document.createRange();
  r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
  let text = '';
  const read = (e: ClipboardEvent) => { text = e.clipboardData!.getData('text/plain'); };
  window.addEventListener('copy', read);
  document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
  window.removeEventListener('copy', read);
  return text;
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
