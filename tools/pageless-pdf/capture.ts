#!/usr/bin/env node
/// <reference lib="dom" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's rendering of a page, photographed in the strip's own frame.
//
//     node tools/pageless-pdf/capture.ts <url> <out dir> --hsize PT --margin PT --ppp N
//                                        [--y0 CSS --y1 CSS] [--band 2000] [--wait-log TEXT]
//                                        [--extra-css CSS] [--chromium-args "--flag …"]
//
// The page is stripped to its .latex-block (no switches, headings, footer),
// forced to the light theme at zoom 1 with TeX's black for its text (a page
// theme's text colour, often a dark grey, would tint every glyph) and without
// macOS's stem-thickening font smoothing, and its column pinned to exactly
// \hsize with `margin` of white either side – the geometry of the pageless
// strip. The viewer draws 2 CSS px per TeX point, so a device scale factor of
// ppp/2 gives ppp device pixels per point, the scale compare.ts draws the strip
// at. Every segment is painted (the viewer's print path), then the document is
// photographed in viewport-high bands by scrolling; the manifest records where
// each band landed, so compare.ts can stitch them.
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

export interface CaptureOptions {
  hsize: number; margin: number; ppp?: number; y0?: number | null; y1?: number | null; band?: number;
  waitLog?: string | null; extraCss?: string; chromiumArgs?: string; log?: (...a: unknown[]) => void;
}
export interface CaptureManifest {
  url: string; css_width: number; dsf: number; ppp: number; band: number; hsize: number; margin: number;
  extra_css: string; chromium_args: string; geometry: Record<string, number>; y0: number; y1: number;
  bands: { file: string; scroll_y: number; height_css: number }[]; errors: string[]; logs: string[];
}

export async function capture(url: string, outDir: string, o: CaptureOptions): Promise<CaptureManifest> {
  const ppp = o.ppp ?? 2, band = o.band ?? 2000, extraCss = o.extraCss ?? '', chromiumArgs = o.chromiumArgs ?? '';
  const dsf = ppp / 2, wcss = Math.round((o.hsize + 2 * o.margin) * 2);           // frame width in CSS px
  const t0 = Date.now();
  const log = o.log ?? ((...a: unknown[]) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a));
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: chromiumArgs.split(/\s+/).filter(Boolean) });
  const watchdog = setTimeout(() => { log('WATCHDOG: capture did not finish in 240 s'); void browser.close(); }, 240000);
  try {
    const ctx = await browser.newContext({ viewport: { width: wcss, height: band }, deviceScaleFactor: dsf, colorScheme: 'light' });
    const page = await ctx.newPage();
    const logs: string[] = [], errors: string[] = [];
    page.on('console', m => logs.push(m.text()));
    page.on('pageerror', e => errors.push(String(e)));
    const until = async (pred: () => boolean, ms: number, what: string) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (pred()) return true; await page.waitForTimeout(50); }
      log('timeout waiting for', what, '— last logs:', logs.slice(-3).join(' | '));
      return false;
    };
    await page.goto(url, { timeout: 30000 });
    await until(() => logs.some(l => /\[latex-viewer\] \d+ block\(s\) in/.test(l)), 30000, 'first layout');
    if (o.waitLog) { await until(() => logs.some(l => l.includes(o.waitLog!)), 20000, o.waitLog); await page.waitForTimeout(500); }
    log('page up:', logs.filter(l => /block\(s\) in/.test(l) || (o.waitLog && l.includes(o.waitLog))).join(' | '));

    const before = logs.length;
    await page.evaluate(({ hsize, margin, extraCss }) => {
      const w = window as unknown as { __setTheme?(t: string): void; __zoom?(z: number): void };
      if (w.__setTheme) w.__setTheme('light');
      if (w.__zoom) w.__zoom(0);
      const css = document.createElement('style');
      css.textContent = `
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        /* TeX's black: the viewer draws default-coloured text in the page's
           text colour (currentColor), which a light theme may make a dark grey. */
        .latex-block { color: #000 !important; --latex-color-000000: #000000 !important; }
        /* glyphs as a PDF renderer draws them: macOS Chromium otherwise
           thickens every stem (its default font smoothing), MuPDF does not */
        .latex-block svg { -webkit-font-smoothing: antialiased !important; }
        body > :not(#lt-content) { display: none !important; }
        #lt-content > :not(.latex-block) { display: none !important; }
        #lt-content { max-width: none !important; width: ${hsize * 2}px !important; margin: 0 !important;
                      padding: 0 ${margin * 2}px !important; }
        .latex-block { margin: 0 !important; width: ${hsize * 2}px !important; }
        html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }
        ${extraCss}`;
      document.head.appendChild(css);
      window.dispatchEvent(new Event('resize'));
    }, { hsize: o.hsize, margin: o.margin, extraCss });
    const want = `re-render at ${o.hsize.toFixed(0)}pt`;
    await until(() => logs.slice(before).some(l => l.includes(want)), 8000, want);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    // webfonts arriving after the first paint make the viewer rebuild the
    // block (visible segments only); settle, then paint every segment as for print
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.waitForTimeout(500);
    const geometry = await page.evaluate(() => {
      const b = document.querySelector('.latex-block')!;
      const r = b.getBoundingClientRect();
      return { blockTop: r.top + window.scrollY, blockLeft: r.left, blockWidth: r.width, blockHeight: r.height,
               docHeight: document.documentElement.scrollHeight, svgs: b.querySelectorAll('svg').length,
               empty: [...b.querySelectorAll('svg')].filter(s => s.childElementCount === 0).length };
    });
    log('geometry:', JSON.stringify(geometry));

    const y0 = o.y0 == null ? 0 : Math.max(0, Math.floor(o.y0));
    const y1 = o.y1 == null ? geometry.docHeight : Math.min(geometry.docHeight, Math.ceil(o.y1));
    const bands: CaptureManifest['bands'] = [];
    for (let y = y0, k = 0; y < y1; k++) {
      const actual = await page.evaluate(y => { window.scrollTo(0, y); return new Promise<number>(r => requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY)))); }, y);
      // a webfont wave after the print paint rebuilds the block and leaves
      // off-screen segments to the scroll observer: wait until nothing in view
      // is still unpainted
      const end = Date.now() + 3000;
      while (Date.now() < end) {
        const pending = await page.evaluate(() => [...document.querySelectorAll('.latex-block svg')].filter(s => {
          const r = s.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && s.childElementCount === 0 && r.height > 2; }).length);
        if (!pending) break;
        await page.waitForTimeout(50);
      }
      const file = join(outDir, `band_${k}.png`);
      await page.screenshot({ path: file });
      bands.push({ file, scroll_y: actual, height_css: band });
      if (actual + band >= y1 || actual < y) break;      // the end, or no further scrolling
      y = actual + band;
    }
    const manifest: CaptureManifest = { url, css_width: wcss, dsf, ppp, band, hsize: o.hsize, margin: o.margin, extra_css: extraCss,
      chromium_args: chromiumArgs, geometry, y0, y1, bands, errors, logs: logs.filter(l => /latex-viewer/.test(l)).slice(-6) };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    log(`${bands.length} band(s), ${errors.length} page error(s)`);
    return manifest;
  } finally {
    clearTimeout(watchdog);
    await browser.close();
  }
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: { hsize: { type: 'string' }, margin: { type: 'string' }, ppp: { type: 'string', default: '2' }, y0: { type: 'string' },
               y1: { type: 'string' }, band: { type: 'string', default: '2000' }, 'wait-log': { type: 'string' },
               'extra-css': { type: 'string', default: '' }, 'chromium-args': { type: 'string', default: '' } },
  });
  const [url, out] = positionals;
  if (!url || !out || !(Number(v.hsize) > 0) || !(Number(v.margin) >= 0)) {
    console.error('usage: capture.ts <url> <out dir> --hsize PT --margin PT --ppp N [--y0 CSS --y1 CSS] [--band N] [--wait-log TEXT]');
    process.exit(2);
  }
  await capture(url, out, { hsize: Number(v.hsize), margin: Number(v.margin), ppp: Number(v.ppp), y0: v.y0 === undefined ? null : Number(v.y0),
    y1: v.y1 === undefined ? null : Number(v.y1), band: Number(v.band), waitLog: v['wait-log'], extraCss: v['extra-css'], chromiumArgs: v['chromium-args'] });
}
