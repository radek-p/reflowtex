#!/usr/bin/env node
/// <reference lib="dom" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// Every glyph and rule the viewer put on a page, in the strip's coordinates
// (pt from the column's left margin edge and from the top of the block; 2 CSS
// px per pt): what vector-compare.ts matches against MuPDF's trace of the
// strip. The page is pinned as the strip is laid out (column = \hsize, a margin
// either side, light theme, every segment painted), so both describe one frame.
//
//     node tools/pageless-pdf/dom-dump.ts <url> <out.json> [--hsize PT] [--margin PT] [--wait-log TEXT]
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

export interface DomGlyph { x: number; y: number; w: number; text: string; font: string; size: number }
export interface DomRect { x: number; y: number; w: number; h: number; pts: [number, number][] }
export interface Dom { height: number; glyphs: DomGlyph[]; rects: DomRect[] }

export async function dumpDom(url: string, o: { hsize?: number; margin?: number; waitLog?: string } = {}): Promise<Dom> {
  const colPx = Math.round((o.hsize ?? 345) * 2), marginPx = Math.round((o.margin ?? 36) * 2);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: colPx + 2 * marginPx, height: 1200 } });
    const logs: string[] = [];
    page.on('console', m => logs.push(m.text()));
    await page.goto(url);
    const t = Date.now();
    while (o.waitLog && Date.now() - t < 30000 && !logs.some(l => l.includes(o.waitLog!))) await page.waitForTimeout(100);
    await page.waitForTimeout(500);
    await page.evaluate(([colPx, marginPx]) => {
      const w = window as unknown as { __setTheme?(t: string): void; __zoom?(z: number): void };
      if (w.__setTheme) w.__setTheme('light');
      if (w.__zoom) w.__zoom(0);
      const css = document.createElement('style');
      css.textContent = `html, body { margin:0 !important; padding:0 !important }
        body > :not(#lt-content) { display:none !important }
        #lt-content > :not(.latex-block) { display:none !important }
        #lt-content { max-width:none !important; width:${colPx}px !important; margin:0 !important; padding:0 ${marginPx}px !important }
        .latex-block { margin:0 !important; width:${colPx}px !important }`;
      document.head.appendChild(css);
      window.dispatchEvent(new Event('resize'));
    }, [colPx, marginPx]);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.waitForTimeout(500);
    // a webfont wave after the print paint leaves off-screen segments to the
    // scroll observer: scroll through the page so every segment is painted
    await page.evaluate(async () => {
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) { window.scrollTo(0, y); await frame(); }
      for (let t = 0; t < 60; t++) {
        if (![...document.querySelectorAll('.latex-block svg')].some(s => s.childElementCount === 0 && s.getBoundingClientRect().height > 2)) break;
        await new Promise(r => setTimeout(r, 50));
      }
      window.scrollTo(0, 0); await frame();
    });
    return await page.evaluate(([marginPx]) => {
      const root = document.querySelector('.latex-block')!;
      const blockTop = root.getBoundingClientRect().top + window.scrollY;
      const blockLeft = root.getBoundingClientRect().left + window.scrollX;
      const glyphs: DomGlyph[] = [], rects: DomRect[] = [];
      // A point in an element's own coordinates, in the strip's frame (pt):
      // through the element's transform to the screen, so that what the viewer
      // rotates (\rotatebox: a matrix() on a group) comes out rotated.
      const at = (m: DOMMatrix, x: number, y: number): [number, number] => {
        const p = new DOMPoint(x, y).matrixTransform(m);
        return [(p.x + window.scrollX - blockLeft + marginPx) / 2, (p.y + window.scrollY - blockTop) / 2];
      };
      for (const svg of root.querySelectorAll('svg')) {
        for (const t of svg.querySelectorAll('tspan')) {
          const x = parseFloat(t.getAttribute('x')!), y = parseFloat(t.getAttribute('y')!);
          if (isNaN(x) || isNaN(y)) continue;
          const te = t.closest('text')!;
          const ff = (t.getAttribute('font-family') || te.getAttribute('font-family') || '').split(',')[0].replace(/["']/g, '');
          const fs = parseFloat(t.getAttribute('font-size') || te.getAttribute('font-size') || '0');
          const bb = t.getBBox ? t.getBBox() : null;
          const [gx, gy] = at(te.getScreenCTM()!, x, y);
          glyphs.push({ x: gx, y: gy, w: bb ? bb.width / 2 : 0, text: t.textContent ?? '', font: ff, size: fs / 2 });
        }
        // Drawn rules only: not a link's transparent hit area, nor the empty
        // mark a \webaside leaves where it stood. Each is its four corners
        // (`pts`, at any angle), and the box around them.
        for (const e of svg.querySelectorAll('rect:not(.latex-link-hit):not(.latex-aside-mark)')) {
          if (e.closest('.latex-missing-glyph')) continue;
          const x = parseFloat(e.getAttribute('x')!), y = parseFloat(e.getAttribute('y')!);
          const w = parseFloat(e.getAttribute('width')!), h = parseFloat(e.getAttribute('height')!);
          if (!(w > 0) || !(h > 0)) continue;
          const m = (e as SVGGraphicsElement).getScreenCTM()!;
          const pts = [at(m, x, y), at(m, x + w, y), at(m, x + w, y + h), at(m, x, y + h)];
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), pts });
        }
      }
      return { height: root.getBoundingClientRect().height / 2, glyphs, rects };
    }, [marginPx]);
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: { hsize: { type: 'string', default: '345' }, margin: { type: 'string', default: '36' }, 'wait-log': { type: 'string' } },
  });
  if (positionals.length !== 2) { console.error('usage: dom-dump.ts <url> <out.json> [--hsize PT] [--margin PT] [--wait-log TEXT]'); process.exit(2); }
  const dump = await dumpDom(positionals[0], { hsize: Number(v.hsize), margin: Number(v.margin), waitLog: v['wait-log'] });
  writeFileSync(positionals[1], JSON.stringify(dump));
  console.log(`dom: ${dump.glyphs.length} glyphs, ${dump.rects.length} rects, block ${dump.height.toFixed(2)} pt`);
}
