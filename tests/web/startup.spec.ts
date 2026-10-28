// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's start: a script that runs after DOMContentLoaded (added by a
// loader once the page has loaded) sets the page up at once; colour maps a
// page sets before the first block are kept over the page's island.
import { test, expect } from './fixtures.ts';
import { idle } from './web.ts';

type W = Window & typeof globalThis & { reflowtex: any };

test('added after the page loaded, the viewer sets the page up at once', async ({ openPage }) => {
  // the page's viewer script taken out and added again from the load event, when readyState is 'complete'
  const page = await openPage('live', { route: ['**/live/index.html', async route => {
    const res = await route.fetch();
    let html = await res.text();
    html = html.replace(/<script([^>]*)\bsrc="([^"]*latex-viewer\.js[^"]*)"([^>]*)><\/script>/, (_all, _a, src) =>
      `<script>addEventListener('load', () => { window.__state = document.readyState; const s = document.createElement('script'); s.src = ${JSON.stringify(src)}; document.body.append(s); });</script>`);
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html' } });
  }] });
  const r = await page.evaluate(async () => {
    await (window as W).reflowtex.host.idle();
    return { state: (window as unknown as { __state: string }).__state, blocks: (window as W).reflowtex.host.blocks().length,
      drawn: document.querySelectorAll('.latex-block[data-nodelist-b64] svg tspan').length };
  });
  expect(r.state).toBe('complete');
  expect(r.blocks).toBeGreaterThan(0);
  expect(r.drawn).toBeGreaterThan(0);
});

test('colour maps set before the first block are kept over the island\'s', async ({ openPage }) => {
  const page = await openPage('colours', { init: `
    document.addEventListener('reflowtex:host', e => {
      e.detail.host.setColorMaps({ mine: { colors: { dark: { '#ff0000': '#ffaaaa' } } } });
    });` });
  await idle(page);
  const maps = await page.evaluate(() => Object.keys((window as W).reflowtex.host.colorMaps()).sort());
  // the host's and the island's, beside the built-in one the viewer always has
  expect(maps).toEqual(['mine', 'reflowtex', 'test']);
});
