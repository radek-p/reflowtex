// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's faces (src/viewer/src/runtime/fonts.ts): made by script, one
// per font file, never an @font-face rule; host.fonts.provide gives a font's
// file before its first block or replaces its face once the new file has
// loaded, so no frame is without it; a file that fails leaves the old face;
// live text asks document.fonts nothing.
import { test, expect } from './fixtures.ts';
import { idle } from './web.ts';

const FILE = 'lmroman10-regular.otf', FAMILY = 'lmroman10_regular';
type W = Window & typeof globalThis & { reflowtex: any; __given?: unknown; __checks?: number };

test('a face per font, made by script; none from a style rule', async ({ openPage }) => {
  const page = await openPage('live');
  const r = await page.evaluate(({ FILE, FAMILY }) => {
    const w = window as W;
    const rules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
      .filter(r => r instanceof CSSFontFaceRule).length;
    const faces = [...document.fonts].filter(f => f.family.replace(/["']/g, '') === FAMILY);
    return { rules, faces: faces.map(f => f.status), loaded: w.reflowtex.host.fonts.loaded(FILE),
      source: w.reflowtex.inspect.faces().find((f: { family: string }) => f.family === FAMILY)?.url ?? null };
  }, { FILE, FAMILY });
  expect(r.rules).toBe(0);
  expect(r.faces).toEqual(['loaded']);
  expect(r.loaded).toBe(true);
  expect(r.source).toMatch(/\/fonts\/lmroman10-regular\.otf$/);
});

test('given before its first block, a font\'s face comes from what the page gave', async ({ openPage }) => {
  const page = await openPage('live', { init: `
    document.addEventListener('reflowtex:host', e => {
      window.__given = e.detail.host.fonts.provide('${FILE}', 'fonts/${FILE}?given');
    });` });
  const url = await page.evaluate(FAMILY => (window as W).reflowtex.inspect.faces().find((f: { family: string }) => f.family === FAMILY)?.url, FAMILY);
  expect(url).toMatch(/\/fonts\/lmroman10-regular\.otf\?given$/);
});

test('given again, the face is replaced once the new file has loaded: no frame without it', async ({ openPage }) => {
  const page = await openPage('live');
  const r = await page.evaluate(async ({ FILE, FAMILY }) => {
    const w = window as W;
    const bytes = await (await fetch(`fonts/${FILE}`)).arrayBuffer();
    const glyphs = document.querySelectorAll('.latex-block tspan').length;
    let frames = 0, without = 0, run = true;
    const watch = () => {
      frames++;
      if (![...document.fonts].some(f => f.family.replace(/["']/g, '') === FAMILY && f.status === 'loaded')) without++;
      if (run) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    const took = await w.reflowtex.host.fonts.provide(FILE, bytes);
    await w.reflowtex.inspect.idle();
    run = false;
    const rec = w.reflowtex.inspect.faces().find((f: { family: string }) => f.family === FAMILY);
    return { took, frames, without, fromBytes: !!rec?.bytes && rec.url === null,
      faces: [...document.fonts].filter(f => f.family.replace(/["']/g, '') === FAMILY).length,
      glyphs: document.querySelectorAll('.latex-block tspan').length - glyphs, loaded: w.reflowtex.host.fonts.loaded(FILE) };
  }, { FILE, FAMILY });
  expect(r.took, 'provide resolves true once the new file is in effect').toBe(true);
  expect(r.frames).toBeGreaterThan(0);
  expect(r.without, 'frames with no loaded face for the family').toBe(0);
  expect(r.fromBytes).toBe(true);
  expect(r.faces, 'the old face is gone').toBe(1);
  expect(r.glyphs, 'the blocks are drawn again, whole').toBe(0);
  expect(r.loaded).toBe(true);
});

test('a file that fails to load leaves the face as it was', async ({ openPage }) => {
  const page = await openPage('live');
  const took = await page.evaluate(FILE => (window as W).reflowtex.host.fonts.provide(FILE, 'fonts/no-such-font.otf'), FILE);
  expect(took, 'provide resolves false: the file could not be loaded').toBe(false);
  await idle(page);
  // what the page reports: the missing file, and the viewer's warning
  expect(page.errors.some(e => /no-such-font\.otf/.test(e))).toBe(true);
  page.errors.length = 0;
  const r = await page.evaluate(({ FILE, FAMILY }) => ({
    url: (window as W).reflowtex.inspect.faces().find((f: { family: string }) => f.family === FAMILY)?.url,
    loaded: (window as W).reflowtex.host.fonts.loaded(FILE) }), { FILE, FAMILY });
  expect(r.url).toMatch(/\/fonts\/lmroman10-regular\.otf$/);
  expect(r.loaded).toBe(true);
});

test('live text asks document.fonts.check nothing', async ({ openPage }) => {
  const page = await openPage('live', { init: `
    window.__checks = 0;
    const fonts = document.fonts, check = fonts.check.bind(fonts);
    fonts.check = (...a) => { window.__checks++; return check(...a); };` });
  await page.evaluate(() => { (window as W).__checks = 0; for (const t of ['one', 'two apples', 'three apples here']) (window as W).reflowtex.host.setText('apples', t); });
  await idle(page);
  expect(await page.evaluate(() => (window as W).__checks)).toBe(0);
});

test('live text in a face that failed to load settles: measured once, the viewer goes idle', async ({ openPage }) => {
  const page = await openPage('live', { init: `
    document.addEventListener('reflowtex:host', e => { e.detail.host.fonts.provide('${FILE}', 'fonts/no-such-font.otf'); });` });
  const r = await page.evaluate(async () => {
    const w = window as W;
    w.reflowtex.host.setText('apples', 'a few apples');
    const idle = await Promise.race([w.reflowtex.inspect.idle().then(() => 'idle'), new Promise(r => setTimeout(() => r('still busy'), 5000))]);
    return { idle, pending: w.reflowtex.inspect.pending() };
  });
  expect(r.idle, JSON.stringify(r.pending)).toBe('idle');
  // what the page reported: the missing file, and the viewer's bar naming the font
  expect(page.errors.some(e => /no-such-font\.otf/.test(e))).toBe(true);
  page.errors.length = 0;
});

test('a font that failed to load and is given again: failed no more, and the log says so', async ({ openPage }) => {
  const page = await openPage('live', { route: [`**/${FILE}`, r => r.fulfill({ status: 404 })] });
  page.errors.length = 0;                               // (the 404 is the point)
  const failure = await page.evaluate(() => (window as W).reflowtex.host.log.records().filter((r: { code: string }) => r.code === 'font-load-failed').at(-1));
  expect(failure?.details.files.split(', '), 'the record names the file, as host.fonts takes it').toContain(FILE);
  expect(failure?.details.fonts.split(', ')).toContain('lmroman10-regular');
  const bar = page.locator('.latex-notice');
  await expect(bar.locator('p[data-code="font-load-failed"]')).toBeVisible();
  // the file can be had now: the same URL again is fetched again
  await page.context().unroute(`**/${FILE}`);
  const r = await page.evaluate(async ({ FILE, FAMILY }) => {
    const w = window as W;
    const url = w.reflowtex.inspect.faces().find((f: { family: string }) => f.family === FAMILY)?.url;
    const took = await w.reflowtex.host.fonts.provide(FILE, url);
    await w.reflowtex.inspect.idle();
    return { took, loaded: w.reflowtex.host.fonts.loaded(FILE),
      records: w.reflowtex.host.log.records().filter((r: { code: string }) => r.code.startsWith('font-load'))
        .map((r: { level: string; code: string; details: Record<string, string> }) => ({ level: r.level, code: r.code, details: r.details })) };
  }, { FILE, FAMILY });
  expect(r.took).toBe(true);
  expect(r.loaded).toBe(true);
  expect(r.records.at(-1)).toEqual({ level: 'info', code: 'font-loaded-after-failure', details: { font: 'lmroman10-regular', file: FILE } });
  // the reader is told no more
  await expect(bar).toBeHidden();
  expect(await bar.locator('p[data-code="font-load-failed"]').count()).toBe(0);
});
