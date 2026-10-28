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
import { chromium, type Page } from 'playwright';
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

/** Chromium's page crashed, or its browser went away: on a very tall page its
 *  renderer can run out of memory. */
export class PageCrashed extends Error {}

/** `read` on a new page of a browser of its own, which is closed after. When
 *  the page crashes or the browser goes away, the call ends at once with
 *  PageCrashed, whatever step it was waiting on: Playwright does not always
 *  end a call in flight then, and the wait would last until the caller's own
 *  time limit. */
export async function withPage<T>(viewport: { width: number; height: number }, read: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  let lose: (e: Error) => void = () => {};
  const lost = new Promise<never>((_, reject) => { lose = reject; });
  lost.catch(() => {});
  let crashed = false, closing = false;
  browser.on('disconnected', () => { if (!closing) { crashed = true; lose(new PageCrashed('the browser went away')); } });
  try {
    const page = await browser.newPage({ viewport });
    page.on('crash', () => { crashed = true; lose(new PageCrashed('the page crashed')); });
    const reading = read(page);
    reading.catch(() => {});
    return await Promise.race([reading, lost]);
  } catch (e) {
    // a call the crash ended itself, before the page's event came
    if (!(e instanceof PageCrashed) && (crashed || /crashed/i.test((e as Error).message))) throw new PageCrashed((e as Error).message);
    throw e;
  } finally {
    closing = true;
    await browser.close().catch(() => {});
  }
}

/** `attempt`, and once more if Chromium's page crashed (a fresh browser, as
 *  withPage gives each attempt); a second crash is an error that says so. */
export async function onceMoreIfCrashed<T>(what: string, attempt: () => Promise<T>, log: (s: string) => void): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof PageCrashed)) throw e;
    log(`${what}: ${e.message}; once more, in a fresh browser`);
  }
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof PageCrashed)) throw e;
    throw new Error(`${what}: Chromium crashed twice (${e.message}); the page may be too large for the memory it has`);
  }
}

export interface DumpOptions { hsize?: number; margin?: number; waitLog?: string; screenshot?: string; log?: (s: string) => void }

/** `screenshot`: a PNG path for the page as dumped, in the same frame – the
 *  block and a margin either side, 2 px per pt, its top at the block's. */
export async function dumpDom(url: string, o: DumpOptions = {}): Promise<Dom> {
  // The column is exactly \hsize, not the nearest whole pixel: the block is
  // given its width in pt (data-latex-width), as its own pixel width would be
  // rounded, and so would every space of a justified line.
  const hsize = o.hsize ?? 345, colPx = hsize * 2, marginPx = (o.margin ?? 36) * 2;
  const log = o.log ?? (() => {});
  const viewport = { width: Math.ceil(colPx + 2 * marginPx), height: 1200 };
  return onceMoreIfCrashed(`dom of ${url}`, () => withPage(viewport, page => readPage(page, url, { ...o, hsize, colPx, marginPx, log })), log);
}

const SEGMENTS_PER_READ = 100;

/** The glyphs and shapes of the block's segments from..to (<svg>s in document
 *  order), in the strip's frame. */
function readSegments(page: Page, marginPx: number, from: number, to: number): Promise<{ glyphs: DomGlyph[]; shapes: DomShape[] }> {
  return page.evaluate(([marginPx, from, to]) => {
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
    for (const svg of [...root.querySelectorAll('svg')].slice(from, to)) {
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
      // <defs> (glyph outlines, a soft mask's drawing), nor a clip path or
      // the like.
      const unseen = (e: Element) => e.closest('defs, clipPath, mask, pattern, marker, symbol') !== null;
      // A picture's glyphs (TikZ labels, text in an included PDF): MuPDF
      // draws each as a <use data-text="…"> of the glyph's outline, its
      // origin at the use's own (0, 0) through its transform; the text is
      // the character the PDF maps the glyph to (◊ when it maps it to none),
      // in the font "picture". A glyph's stroke (fake bold, outlined text) is
      // a <use> of its own, with no fill: not counted, as the strip's trace
      // counts filled text only (vector-compare.ts).
      for (const u of svg.querySelectorAll<SVGUseElement>('.latex-picture use[data-text]')) {
        if (unseen(u) || u.getAttribute('fill') === 'none') continue;
        const x = parseFloat(u.getAttribute('x') ?? '0'), y = parseFloat(u.getAttribute('y') ?? '0');
        const [gx, gy] = at(toFrame(u), x, y);
        glyphs.push({ x: gx, y: gy, w: 0, text: u.dataset.text?.trim() ? u.dataset.text : '◊', font: 'picture', size: 0 });
      }
      // What may be a rule (shapes.ts decides): TeX's rules, drawn as
      // <rect> – not a link's transparent hit area, nor the empty mark a
      // \webaside leaves where it stood, nor a bitmap drawn through a mask (an
      // image mask) – and a picture's paths. Each as its
      // path data, how it is painted, and the map from its own coordinates
      // to the strip's frame.
      for (const e of svg.querySelectorAll<SVGGraphicsElement>('rect:not(.latex-link-hit):not(.latex-aside-mark):not([mask]), .latex-picture path')) {
        if (unseen(e)) continue;
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
    return { glyphs, shapes };
  }, [marginPx, from, to]);
}

async function readPage(page: Page, url: string, o: DumpOptions & { hsize: number; colPx: number; marginPx: number; log: (s: string) => void }): Promise<Dom> {
  const { hsize, colPx, marginPx } = o;
  const t0 = Date.now(), step = (what: string) => o.log(`dom: ${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const logs: string[] = [];
  page.on('console', m => logs.push(m.text()));
  await page.goto(url);
  step('loaded');
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
  step('laid out');
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
  step('painted');
  // Read a run of segments (<svg>s) at a time: on a very tall page, all of
  // them at once in one call took the renderer past its memory.
  const { segments, height } = await page.evaluate(() => {
    const root = document.querySelector('.latex-block')!;
    return { segments: root.querySelectorAll('svg').length, height: root.getBoundingClientRect().height / 2 };
  });
  const dom: { glyphs: DomGlyph[]; shapes: DomShape[] } = { glyphs: [], shapes: [] };
  for (let from = 0; from < segments; from += SEGMENTS_PER_READ) {
    const part = await readSegments(page, marginPx, from, from + SEGMENTS_PER_READ);
    for (const g of part.glyphs) dom.glyphs.push(g);
    for (const sh of part.shapes) dom.shapes.push(sh);
  }
  step(`read ${dom.glyphs.length} glyphs and ${dom.shapes.length} shapes in ${segments} segments`);
  if (o.screenshot) {
    const r = await page.evaluate(() => { const b = document.querySelector('.latex-block')!.getBoundingClientRect(); return { x: b.left + window.scrollX, y: b.top + window.scrollY, h: b.height }; });
    await page.screenshot({ path: o.screenshot, fullPage: true, clip: { x: r.x - marginPx, y: r.y, width: colPx + 2 * marginPx, height: Math.ceil(r.h) } });
    step('screenshot taken');
  }
  return { height, glyphs: dom.glyphs, rects: rulesOf(dom.shapes) };
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: { hsize: { type: 'string', default: '345' }, margin: { type: 'string', default: '36' }, 'wait-log': { type: 'string' } },
  });
  if (positionals.length !== 2) { console.error('usage: dom-dump.ts <url> <out.json> [--hsize PT] [--margin PT] [--wait-log TEXT]'); process.exit(2); }
  const dump = await dumpDom(positionals[0], { hsize: Number(v.hsize), margin: Number(v.margin), waitLog: v['wait-log'], log: s => console.log(s) });
  writeFileSync(positionals[1], JSON.stringify(dump));
  console.log(`dom: ${dump.glyphs.length} glyphs, ${dump.rects.length} rects, block ${dump.height.toFixed(2)} pt`);
}
