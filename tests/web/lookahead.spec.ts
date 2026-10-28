// SPDX-License-Identifier: AGPL-3.0-or-later
// Lookahead in scroll boxes (runtime/visibility.ts): a segment is painted once
// it is near the screen – within a height of the window, or, in a scroll box
// of the page's, within a height of what the box shows – so that scrolling
// shows text, not a blank that fills in. A box clips what it holds, which an
// observer of the window alone cannot see past; these put a block in a box
// (in a box in a box; in a box that became one after the block was painted),
// scroll the box as a reader would, and look at what is painted.
import { test, expect, type WebPage } from './fixtures.ts';

interface Seg { svg: SVGSVGElement | null; painted?: boolean; dirty?: boolean }
interface Counts { shown: number; shownBlank: number; below: number; belowBlank: number; far: number; farPainted: number }

/** Mounts a copy of the page's block into the element `#host` that the page
 *  builds from `html`, scrolls that box to the middle of the block, as a
 *  reader would, and counts, once the viewer is idle, the segments shown in
 *  the box, those within one box height below its fold, and those three to
 *  six heights below it – each with how many of them are not painted. `later`: a style `#host` is given
 *  after the mount, before scrolling. */
async function scrolled(page: WebPage, html: string, later?: string): Promise<Counts> {
  return page.evaluate(async ({ html, later }) => {
    const src = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.prepend(wrap);
    window.scrollTo(0, 0);
    const host = wrap.querySelector('#host') as HTMLElement;
    const el = document.createElement('div');
    el.className = 'latex-block';
    el.style.width = '640px';
    el.dataset.nodelistB64 = src.dataset.nodelistB64!;
    host.append(el);
    await reflowtex.host.mount(el);
    await reflowtex.inspect.idle();
    if (later) host.style.cssText = later;
    const box = host;
    box.scrollTop = Math.round(box.scrollHeight * 0.5);
    await reflowtex.inspect.idle();
    const segs = (reflowtex.inspect.state(el).cache.dom.segs as Seg[]).filter(s => s.svg);
    const c = box.getBoundingClientRect(), top = c.top + box.clientTop, h = box.clientHeight, fold = top + h;
    const blank = (s: Seg) => !s.painted || !!s.dirty;
    const within = (a: number, b: number) => segs.filter(s => { const r = s.svg!.getBoundingClientRect(); return r.bottom > a && r.top < b; });
    const shown = within(top, fold), below = within(fold, fold + h), far = within(fold + 3 * h, fold + 6 * h);
    return { shown: shown.length, shownBlank: shown.filter(blank).length,
             below: below.length, belowBlank: below.filter(blank).length,
             far: far.length, farPainted: far.filter(s => !blank(s)).length };
  }, { html, later });
}

test('in a scroll box, what is within its height below its fold is painted before it scrolls in', async ({ openPage }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  const r = await scrolled(page, '<div id="host" style="height:360px;overflow:auto"></div>');
  expect(r.shown).toBeGreaterThan(0);
  expect(r.below).toBeGreaterThan(1);
  expect(r, JSON.stringify(r)).toMatchObject({ shownBlank: 0, belowBlank: 0 });
  // and what is far below is still left for later
  expect(r.far).toBeGreaterThan(1);
  expect(r.farPainted).toBe(0);
});

test('a scroll box below the fold of another: what it shows is painted before the outer box scrolls to it', async ({ openPage }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  // The outer box shows 0–400 px of what it holds; the inner box stands at
  // 600–900 px in it: out of sight, within the outer box's height of it.
  const r = await scrolled(page,
    '<div style="height:400px;overflow:auto"><div style="height:600px"></div>' +
    '<div id="host" style="height:300px;overflow:auto"></div><div style="height:2000px"></div></div>');
  expect(r.shown).toBeGreaterThan(0);
  expect(r, JSON.stringify(r)).toMatchObject({ shownBlank: 0 });
  expect(r.far).toBeGreaterThan(1);
  expect(r.farPainted).toBe(0);
});

test('an element that becomes a scroll box after its block was painted gives the same lookahead', async ({ openPage }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  // Mounted into a plain element (no box: the page scrolls); then the element
  // is made a box, with no change to the block's width (so no new layout).
  const r = await scrolled(page, '<div id="host"></div>', 'height:360px;overflow:auto');
  expect(r.shown).toBeGreaterThan(0);
  expect(r.below).toBeGreaterThan(1);
  expect(r, JSON.stringify(r)).toMatchObject({ shownBlank: 0, belowBlank: 0 });
  expect(r.far).toBeGreaterThan(1);
  expect(r.farPainted).toBe(0);
});
