// SPDX-License-Identifier: AGPL-3.0-or-later
// Problems found and fixed before, so that they stay fixed. Each test names
// the commit that fixed it (see README.md, "Regressions"). A known failure is
// marked test.fail(): the day it passes, the suite says so, to have the mark
// taken off.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { test, expect, type WebPage } from './fixtures.ts';
import { BUILD } from './web.ts';

const block = (page: WebPage, i = 0) => page.locator('.latex-block[data-nodelist-b64]').nth(i);

// ── Host pages ──────────────────────────────────────────────────────────────

// A host's svg{max-width:100%} once scaled a paragraph's picture down for a
// frame on every resize (e9db719).
test('host CSS does not scale the text', async ({ openPage }) => {
  const page = await openPage('hostile');
  const b = block(page);
  const before = await b.evaluate(b => b.querySelector('svg')!.getBoundingClientRect().width);
  const same = await b.evaluate((b: HTMLElement) => {               // the same frame, before a re-break
    b.style.width = (b.getBoundingClientRect().width - 150) + 'px';
    return b.querySelector('svg')!.getBoundingClientRect().width;
  });
  expect(Math.abs(same - before), 'the host CSS scaled the text before it was broken again').toBeLessThan(1);
});

// A host's margin on .latex-block pushed a button's typeset label below the
// button (cec397b).
test('host CSS keeps a label in its button', async ({ openPage }) => {
  const page = await openPage('hostile');
  await page.waitForSelector('.rtx-button svg text tspan', { state: 'attached' });
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const btn = document.querySelector('.rtx-button')!, b = btn.getBoundingClientRect();
    const base = (t: any) => { const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
                               return p.matrixTransform(t.getScreenCTM()).y as number; };
    const own = [...btn.querySelectorAll('svg text tspan')];
    const text = [...btn.closest('.latex-block')!.querySelectorAll('svg text tspan')].filter(t => !btn.contains(t));
    const y = base(own[0]), line = Math.min(...text.map(t => Math.abs(base(t) - y)));
    const x = own.map(t => t.getBoundingClientRect());
    return { off: line, inside: y > b.top && y < b.bottom && Math.min(...x.map(r => r.left)) >= b.left && Math.max(...x.map(r => r.right)) <= b.right };
  });
  expect(r.inside, 'the label is outside its button').toBe(true);
  expect(r.off, `the label is ${r.off.toFixed(2)} px off the line's baseline`).toBeLessThan(1);
});

// Resizing a block with rotated text made every later paint throw `el is
// null` (e9db719); openPage fails on any error.
test('resizing rotated text raises nothing', async ({ openPage }) => {
  const page = await openPage('hostile');
  for (const w of [400, 900, 360, 900, 400]) {
    await block(page).evaluate((b: HTMLElement, w) => { b.style.width = `${w}px`; }, w);
    await page.waitForTimeout(120);
  }
});

// ── Links ───────────────────────────────────────────────────────────────────

// The space between two words of a link was on no link: no hover, no click
// (e9db719).
test('the gap in a link is hoverable', async ({ openPage }) => {
  const page = await openPage('hostile', { width: 420 });
  // Glyph positions from their own coordinates: WebKit gives a tspan's box as
  // its whole line's.
  const [x, y] = await page.evaluate(() => {
    const at = (t: any) => { const p = t.ownerSVGElement.createSVGPoint(); p.x = parseFloat(t.getAttribute('x'));
                             p.y = parseFloat(t.getAttribute('y')); return p.matrixTransform(t.getScreenCTM()) as DOMPoint; };
    const g = [...document.querySelectorAll('tspan[data-link-href^="https://en.wikipedia"]')].map(at);
    const line = g.filter(p => Math.abs(p.y - g[0].y) < 1).sort((p, q) => p.x - q.x);
    let i = 1; for (let j = 2; j < line.length; j++) if (line[j].x - line[j - 1].x > line[i].x - line[i - 1].x) i = j;
    return [line[i].x - 2, line[i].y - 4];                   // just before the word after the widest gap
  });
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.tagName, [x, y]), 'the point is on a glyph').not.toBe('tspan');
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
  expect(await page.locator('.latex-link-hover').count(), 'pointing between two words of a link hovers nothing').toBeGreaterThan(0);
});

// ── Fonts ───────────────────────────────────────────────────────────────────

// A font that failed to download left text silently missing; now a bar says
// so (970f543).
test('a font failure is shown and dismissed', async ({ openPage }) => {
  test.fail(true, 'Dismiss sets hidden on the bar, but its CSS display:flex overrides [hidden] ' +
    '(fix: .latex-font-warning[hidden] { display: none }); left to the viewer refactor');
  const page = await openPage('notes', { route: ['**/*.otf', r => r.fulfill({ status: 404 })] });
  page.errors.length = 0;                               // the 404s are the point here
  const bar = page.locator('.latex-font-warning');
  await bar.waitFor({ state: 'visible' });
  expect(await bar.innerText()).toMatch(/lmroman|cm/);
  await bar.locator('[data-act="close"]').click();
  expect(await bar.isVisible()).toBe(false);
});

// Fonts resolve against the viewer script's own URL, so a page works from
// disk and under any path (8de3e92, d001f88). (A page of the companion
// package's kinds does not: browsers load no ES module from file://, so
// those need a server.)
test('works from a file', async ({ openPage }) => {
  const page = await openPage(pathToFileURL(join(BUILD, 'pictures', 'index.html')).href);
  expect(await page.evaluate(() => [...document.fonts].filter(f => f.status === 'error').map(f => f.family))).toEqual([]);
});

// ── Pictures ────────────────────────────────────────────────────────────────

// Two blocks' pictures shared ids: one drew the other's glyphs and clip paths
// (04e81e7).
test('picture ids do not collide', async ({ openPage }) => {
  const page = await openPage('pictures');
  const r = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('.latex-block [id]')].map(e => e.id);
    const bad: string[] = [];
    for (const b of document.querySelectorAll('.latex-block[data-nodelist-b64]'))
      for (const e of b.querySelectorAll('*')) for (const a of e.attributes) {
        const m = a.value.match(/url\(#([^)]+)\)/) || (/href$/.test(a.name) && a.value.match(/^#(.+)/));
        if (m && !b.querySelector('#' + CSS.escape(m[1]))) bad.push(a.value);
      }
    return { dup: ids.length - new Set(ids).size, bad };
  });
  expect(r.dup, 'ids repeat across blocks').toBe(0);
  expect(r.bad, `references outside their block: ${r.bad.slice(0, 3)}`).toEqual([]);
});

// ── Themes ──────────────────────────────────────────────────────────────────

// The browser resolves every colour through a canvas: rgba() in 0–255,
// whatever the CSS wrote (color(srgb …), color-mix(…), variables).
const contrast = (page: WebPage) => page.evaluate(() => {
  const cv = document.createElement('canvas').getContext('2d')!;
  const rgba = (c: string) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data]; };
  const over = (top: number[], under: number[]) => top.slice(0, 3).map((v, i) => v * top[3] / 255 + under[i] * (1 - top[3] / 255));
  const lum = (c: number[]) => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
                                 return .2126 * r + .7152 * g + .0722 * b; };
  const pop = document.querySelector('#latex-footnote-pop')!;
  const page = rgba(getComputedStyle(document.documentElement).backgroundColor);
  const bg = over(rgba(getComputedStyle(pop).backgroundColor), page);
  const fg = rgba(getComputedStyle(pop.querySelector('svg text tspan')!).fill);
  const a = lum(bg), b = lum(fg.slice(0, 3));
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
});

// The footnote popover took the OS's colours, not the page's: black on black
// (92d4a2d).
for (const [os, theme] of [['dark', 'light'], ['light', 'dark']] as const)
  test(`popover readable: OS ${os}, page ${theme}`, async ({ openPage }) => {
    const page = await openPage('notes', { colorScheme: os });
    await page.evaluate(t => window.__setTheme(t), theme);
    await page.locator('[data-footnote]').first().hover();
    await page.waitForTimeout(200);
    expect(await contrast(page)).toBeGreaterThan(4.5);
  });

// ── Line breaking in the browser ────────────────────────────────────────────

// Lines ran past the column's right edge at narrow widths (ff96946).
for (const name of ['notes', 'live'])
  test(`nothing past the edge: ${name}`, async ({ openPage }) => {
    const page = await openPage(name);
    let worst = 0;
    for (let w = 170; w < 520; w += 35) {
      await page.evaluate(w => { for (const b of document.querySelectorAll<HTMLElement>('.latex-block[data-nodelist-b64]')) b.style.width = `${w}px`; }, w);
      await page.waitForTimeout(300);             // a resize lays out the rest once it settles (150 ms)
      worst = Math.max(worst, await page.evaluate(() => new Promise<number>(r => requestAnimationFrame(() => requestAnimationFrame(() => {
        let m = 0;
        for (const b of document.querySelectorAll('.latex-block[data-nodelist-b64]')) {
          const right = b.getBoundingClientRect().right;
          for (const t of b.querySelectorAll('svg text tspan, foreignObject'))
            if (!t.closest('.latex-display'))      // a wide display scrolls in its own box, by design
              m = Math.max(m, t.getBoundingClientRect().right - right);
        }
        r(m);
      })))));
    }
    expect(worst, `something reaches ${worst.toFixed(1)} px past its column`).toBeLessThanOrEqual(5);
  });

// ── The companion package's parts ───────────────────────────────────────────

const firstBaseline = (page: WebPage, selector: string) => page.evaluate(s => {
  const t = document.querySelector(s + ' svg text tspan') as SVGGraphicsElement;
  const p = t.ownerSVGElement!.createSVGPoint(); p.y = parseFloat(t.getAttribute('y')!);
  return p.matrixTransform(t.getScreenCTM()!).y;
}, selector);

// The expanded pane's first line sat 5.8 px below the collapsed one's (b7d65b3).
test('accordion panes share a baseline', async ({ openPage }) => {
  const page = await openPage('accordion');
  const pane = '.rtx-pane[data-state="open"]';
  const before = await firstBaseline(page, pane);
  await page.locator('rect.latex-link-hit[data-link-action^="pane:next"]').first().click({ force: true });
  await page.waitForTimeout(300);
  expect(Math.abs(await firstBaseline(page, pane) - before)).toBeLessThan(0.5);
});

// In print a hint is not blurred and has no label, and action links are
// hidden (b7d65b3, 77a7f87). The label's print rule lost to a more specific
// one until the hint moved to the companion.
test('print shows hints and hides actions', async ({ openPage }) => {
  let page = await openPage('notes');
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);                         // the blur eases out
  const s = await page.locator('.latex-stream[data-kind="hint"]').evaluate(h => ({
    blur: getComputedStyle(h.firstElementChild!).filter, label: getComputedStyle(h, '::after').content }));
  expect(s.blur, JSON.stringify(s)).not.toContain('blur');
  expect(s.label, JSON.stringify(s)).not.toContain('reveal');
  page = await openPage('accordion');
  await page.emulateMedia({ media: 'print' });
  // Hidden on paper: not displayed, not visible, or (the viewer's print rule
  // for controls) drawn in a transparent fill.
  expect(await page.evaluate(() => [...document.querySelectorAll('[data-link-action]')].filter(e => {
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.fill !== 'rgba(0, 0, 0, 0)'; }).length)).toBe(0);
});

// A split widget showed pieces of two different splits, and hovering one
// piece marked only that one (6433a47).
test('a split widget is whole and hovers as one', async ({ openPage }) => {
  const page = await openPage('live');
  await block(page, 1).evaluate((b: HTMLElement) => { b.style.width = '120px'; });
  await page.waitForTimeout(400);
  const parts = page.locator('foreignObject.latex-widget');
  expect(await parts.count()).toBeGreaterThanOrEqual(3);
  expect((await page.locator('.badge').allInnerTexts()).map(t => t.trim()).join(' ')).toBe('checked by Lean on 25 September 2026');
  await parts.nth(1).hover();
  await page.waitForTimeout(100);
  const marked = await page.evaluate(() => [...document.querySelectorAll('foreignObject.latex-widget')]
    .filter(f => f.closest('.latex-widget-hover') || f.classList.contains('latex-widget-hover') || f.querySelector('.latex-widget-hover')).length);
  expect(marked, 'hovering one piece did not mark them all').toBe(await parts.count());
});

// ctx.measure counted the line box around a widget, which drew it 5 px above
// the baseline (6433a47).
test('a widget sits on the baseline', async ({ openPage }) => {
  const page = await openPage('live');
  const off = await page.evaluate(() => {
    const span = document.querySelector('.badge')!, probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0'; span.appendChild(probe);
    const y = probe.getBoundingClientRect().bottom; probe.remove();
    const blk = span.closest('.latex-block')!;
    const base = [...blk.querySelectorAll('svg text tspan')].map((t: any) => { const p = t.ownerSVGElement.createSVGPoint();
      p.y = parseFloat(t.getAttribute('y')); return p.matrixTransform(t.getScreenCTM()).y as number; });
    return Math.min(...base.map(b => Math.abs(b - y)));
  });
  expect(off, `the widget's text is ${off.toFixed(2)} px off the line's baseline`).toBeLessThan(1);
});

// Margin notes were lost when the block was drawn again once its fonts had
// loaded, and could run past the block's bottom (d99df5f).
test('margin notes when fonts come late', async ({ openPage }) => {
  const slow = async (route: import('@playwright/test').Route) => { await new Promise(r => setTimeout(r, 600)); await route.continue(); };
  const page = await openPage('asides', { width: 1400, route: ['**/*.otf', slow] });
  const r = await page.evaluate(() => {
    const ns = [...document.querySelectorAll('.latex-margin-note:not([hidden])')];
    return { n: ns.length, over: Math.max(...ns.map(n => n.getBoundingClientRect().bottom - n.closest('.latex-block')!.getBoundingClientRect().bottom)) };
  });
  expect(r.n).toBe(3);
  expect(r.over, `a note hangs ${r.over.toFixed(1)} px below its block`).toBeLessThanOrEqual(1);
});

// ── Scrolling and resizing ──────────────────────────────────────────────────

// After a resize the reader saw different content: the viewer's rewrites
// defeated the browser's scroll anchoring (fde0a25); and the page scrolled
// sideways during the drag (a25c334).
test('a resize keeps the reader in place', async ({ openPage }) => {
  const page = await openPage('long', { width: 1100, height: 800 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__first = [...document.querySelectorAll('.latex-block svg')].find(s => s.getBoundingClientRect().bottom > 40); });
  const top0: number = await page.evaluate(() => window.__first.getBoundingClientRect().top);
  for (let w = 1100; w > 700; w -= 40) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `sideways scroll at ${w} px`).toBeLessThanOrEqual(1);
  }
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ connected: window.__first.isConnected as boolean, top: window.__first.getBoundingClientRect().top as number }));
  expect(r.connected, 'the segment on screen was replaced').toBe(true);
  expect(Math.abs(r.top - top0) < 5 || (r.top >= 0 && r.top < 800), `the reader lost their place: ${top0.toFixed(0)} → ${r.top.toFixed(0)} px`).toBe(true);
});
