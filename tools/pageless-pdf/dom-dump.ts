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
import { filledRule, strokedRule, svgOutline, type Affine, type Pt } from './shapes.ts';

export interface DomGlyph { x: number; y: number; w: number; text: string; font: string; size: number }
/** A rule the viewer drew: its four corners (`pts`, at any angle), and the box around them. */
export interface DomRect { x: number; y: number; w: number; h: number; pts: Pt[] }
export interface Dom { height: number; glyphs: DomGlyph[]; rects: DomRect[] }
/** A drawn <rect> or <path>, as the page gives it: its path data, how it is
 *  painted, and `m`, from its own coordinates to the strip's frame. */
interface DomShape { d: string; fill: boolean; stroke: { width: number; capped: boolean } | null; m: Affine }

/** The rules among the shapes: each filled or stroked shape that shapes.ts
 *  takes for one, as the strip's are taken. */
function rulesOf(shapes: DomShape[]): DomRect[] {
  const rects: DomRect[] = [];
  const add = (pts: Pt[] | null) => {
    if (!pts) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), pts });
  };
  for (const s of shapes) {
    const o = svgOutline(s.d);
    if (s.fill) add(filledRule(o, s.m));
    if (s.stroke) add(strokedRule(o, s.stroke.width, s.stroke.capped, s.m));
  }
  return rects;
}

/** `screenshot`: a PNG path for the page as dumped, in the same frame – the
 *  block and a margin either side, 2 px per pt, its top at the block's. */
export async function dumpDom(url: string, o: { hsize?: number; margin?: number; waitLog?: string; screenshot?: string } = {}): Promise<Dom> {
  // The column is exactly \hsize, not the nearest whole pixel: the block is
  // given its width in pt (data-latex-width), as its own pixel width would be
  // rounded, and so would every space of a justified line.
  const hsize = o.hsize ?? 345, colPx = hsize * 2, marginPx = (o.margin ?? 36) * 2;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: Math.ceil(colPx + 2 * marginPx), height: 1200 } });
    const logs: string[] = [];
    page.on('console', m => logs.push(m.text()));
    await page.goto(url);
    const t = Date.now();
    while (o.waitLog && Date.now() - t < 30000 && !logs.some(l => l.includes(o.waitLog!))) await page.waitForTimeout(100);
    await page.waitForTimeout(500);
    await page.evaluate(([colPx, marginPx, hsize]) => {
      const w = window as unknown as { __setTheme?(t: string): void; __zoom?(z: number): void };
      if (w.__setTheme) w.__setTheme('light');
      if (w.__zoom) w.__zoom(0);
      for (const b of document.querySelectorAll<HTMLElement>('#lt-content > .latex-block')) b.dataset.latexWidth = String(hsize);
      const css = document.createElement('style');
      css.textContent = `html, body { margin:0 !important; padding:0 !important }
        body > :not(#lt-content) { display:none !important }
        #lt-content > :not(.latex-block) { display:none !important }
        #lt-content { max-width:none !important; width:${colPx}px !important; margin:0 !important; padding:0 ${marginPx}px !important }
        .latex-block { margin:0 !important; width:${colPx}px !important }`;
      document.head.appendChild(css);
      window.dispatchEvent(new Event('resize'));
    }, [colPx, marginPx, hsize]);
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
    const dom = await page.evaluate(([marginPx]) => {
      const root = document.querySelector('.latex-block')!;
      const blockTop = root.getBoundingClientRect().top + window.scrollY;
      const blockLeft = root.getBoundingClientRect().left + window.scrollX;
      const glyphs: DomGlyph[] = [], shapes: DomShape[] = [];
      // An element's own coordinates to the strip's frame (pt): through its
      // transform to the screen, so that what the viewer rotates (\rotatebox:
      // a matrix() on a group) comes out rotated.
      const frame = new DOMMatrix().scale(0.5).translate(window.scrollX - blockLeft + marginPx, window.scrollY - blockTop);
      const toFrame = (e: SVGGraphicsElement) => frame.multiply(e.getScreenCTM()!);
      const at = (m: DOMMatrix, x: number, y: number): [number, number] => {
        const p = new DOMPoint(x, y).matrixTransform(m);
        return [p.x, p.y];
      };
      for (const svg of root.querySelectorAll('svg')) {
        // Every glyph is a tspan at its origin: a glyph of a font with no face
        // too, whose tspan is the transparent text carrier over its boxes
        // (the strip has the glyph TeX drew). The boxes are not rules (below).
        for (const t of svg.querySelectorAll('tspan')) {
          const x = parseFloat(t.getAttribute('x')!), y = parseFloat(t.getAttribute('y')!);
          if (isNaN(x) || isNaN(y)) continue;
          const te = t.closest('text')!;
          const ff = (t.getAttribute('font-family') || te.getAttribute('font-family') || '').split(',')[0].replace(/["']/g, '');
          const fs = parseFloat(t.getAttribute('font-size') || te.getAttribute('font-size') || '0');
          const bb = t.getBBox ? t.getBBox() : null;
          const [gx, gy] = at(toFrame(te), x, y);
          glyphs.push({ x: gx, y: gy, w: bb ? bb.width / 2 : 0, text: t.textContent ?? '', font: ff, size: fs / 2 });
        }
        // Only what is drawn: not the definitions a picture's markup keeps in
        // <defs> (glyph outlines, and the same glyph at another size, a <use>
        // of it scaled), nor a clip path or the like.
        const unseen = (e: Element) => e.closest('defs, clipPath, mask, pattern, marker, symbol') !== null;
        // A picture's glyphs (TikZ labels, text in an included PDF): dvisvgm
        // draws each as a <use> of a glyph outline ("g1-4", prefixed per
        // picture), its origin at the use's x, y. They have no text; ◊ stands
        // for one, in the font "picture".
        for (const u of svg.querySelectorAll('.latex-picture use')) {
          if (unseen(u) || !/-g\d+-\d+$/.test(u.getAttribute('href') ?? u.getAttribute('xlink:href') ?? '')) continue;
          const x = parseFloat(u.getAttribute('x') ?? '0'), y = parseFloat(u.getAttribute('y') ?? '0');
          const [gx, gy] = at(toFrame(u as SVGGraphicsElement), x, y);
          glyphs.push({ x: gx, y: gy, w: 0, text: '◊', font: 'picture', size: 0 });
        }
        // What may be a rule (shapes.ts decides): TeX's rules, drawn as
        // <rect> – not a link's transparent hit area, nor the empty mark a
        // \webaside leaves where it stood – and a picture's paths. Each as its
        // path data, how it is painted, and the map from its own coordinates
        // to the strip's frame.
        for (const e of svg.querySelectorAll<SVGGraphicsElement>('rect:not(.latex-link-hit):not(.latex-aside-mark), .latex-picture path')) {
          if (unseen(e) || e.closest('.latex-missing-glyph')) continue;
          let d = e.getAttribute('d') ?? '';
          if (e.tagName === 'rect') {
            const x = parseFloat(e.getAttribute('x')!), y = parseFloat(e.getAttribute('y')!);
            const w = parseFloat(e.getAttribute('width')!), h = parseFloat(e.getAttribute('height')!);
            if (!(w > 0) || !(h > 0)) continue;
            d = `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
          }
          const cs = getComputedStyle(e), m = toFrame(e);
          shapes.push({ d, fill: cs.fill !== 'none', stroke: cs.stroke === 'none' ? null : { width: parseFloat(cs.strokeWidth), capped: cs.strokeLinecap !== 'butt' },
                        m: [m.a, m.b, m.c, m.d, m.e, m.f] });
        }
      }
      return { height: root.getBoundingClientRect().height / 2, glyphs, shapes };
    }, [marginPx]);
    if (o.screenshot) {
      const r = await page.evaluate(() => { const b = document.querySelector('.latex-block')!.getBoundingClientRect(); return { x: b.left + window.scrollX, y: b.top + window.scrollY, h: b.height }; });
      await page.screenshot({ path: o.screenshot, fullPage: true, clip: { x: r.x - marginPx, y: r.y, width: colPx + 2 * marginPx, height: Math.ceil(r.h) } });
    }
    return { height: dom.height, glyphs: dom.glyphs, rects: rulesOf(dom.shapes) };
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
