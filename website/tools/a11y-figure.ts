#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The figure on the Accessibility page: the start of AMS testmath as Reflow
// TeX draws it, and under each drawn line what a screen reader is given for
// it – its text, each formula either as MathML (with its spoken form as
// alttext) or as that spoken form in words, as the reader chooses.
//
// Everything in it comes from a live render of testmath built with the
// accessible layer: the drawn lines are the viewer's glyphs, captured and
// turned into outlines from the served fonts (so the figure needs no font
// files); the regions are the layer's runs, where VoiceOver outlines what it
// reads; the reading rows are the layer's own content, so a screen reader on
// the page reads what the figure says it reads.
//
//     node website/tools/a11y-figure.ts > website/assets/a11y/testmath-reading.html
//     node website/tools/a11y-figure.ts --site build/testmath-a11y > …   (a build made already)
//
// The {{< a11y-reading >}} shortcode inlines it, with the switch.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import opentype, { type Font } from 'opentype.js';
import { chromium } from 'playwright';
import { serveDirectory } from '../../tools/lib/static-server.ts';
import { composeFigure, type Captured } from './a11y-figure-compose.ts';

const REPO = resolve(import.meta.dirname, '../..');
const { values: o } = parseArgs({ options: {
  site: { type: 'string' },
  from: { type: 'string', default: '1 Introduction' },     // the first paragraph shown
  displays: { type: 'string', default: '1' },              // … up to and with this many displays
  width: { type: 'string', default: '860' },               // the window the page is laid out in
} });

let site = o.site ? resolve(o.site) : '';
if (!site) {
  site = join(mkdtempSync(join(tmpdir(), 'a11y-figure-')), 'site');
  console.error(`a11y-figure: building testmath with the accessible layer into ${site}`);
  execFileSync('node', [join(REPO, 'examples/testmath/build.ts'), '--a11y', '-o', site], { stdio: ['ignore', 'ignore', 'inherit'] });
}

const { url, server } = await serveDirectory(site);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(o.width), height: 1400 } });
await page.goto(url + '/');
await page.waitForFunction(() => document.querySelector('.latex-a11y [data-run]'), undefined, { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);

/** In the page: the chosen pieces, line by line, in the reader's current mode. */
const readLines = ([from, displays]: readonly [string, number]) => {
  const layer = document.querySelector('.latex-a11y')!;
  const pieces = [...layer.children] as HTMLElement[];
  const start = pieces.findIndex(p => (p.textContent || '').trim().startsWith(from));
  const chosen: HTMLElement[] = [];
  let seen = 0;
  for (const p of pieces.slice(start)) {
    chosen.push(p);
    if (p.dataset.item && ++seen >= displays) break;
  }
  const clean = (m: Element) => { const c = m.cloneNode(true) as Element; c.removeAttribute('style'); c.removeAttribute('data-run'); return c.outerHTML; };
  const box = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  return chosen.map(p => {
    const lines: { parts: { kind: string; text?: string; mathml?: string; box: { x: number; y: number; w: number; h: number } }[] }[] = [{ parts: [] }];
    const runs = p.querySelectorAll('[data-run]');
    if (!runs.length) return { display: !!p.dataset.item, lines: [] };
    for (const node of p.querySelectorAll('[data-run], br')) {
      if (node.localName === 'br') { lines.push({ parts: [] }); continue; }
      const el = node as HTMLElement, kind = el.dataset.run!;
      const part = kind === 'math' || kind === 'display'
        ? { kind: 'math', mathml: clean(el), box: box(el) }
        : { kind: kind === 'spoken' ? 'spoken' : 'text', text: el.textContent || '', box: box(el) };
      lines[lines.length - 1].parts.push(part);
    }
    return { display: !!p.dataset.item, lines: lines.filter(l => l.parts.length) };
  });
};

const mathml = await page.evaluate(readLines, [o.from!, Number(o.displays)] as const);
await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('spoken'));
await page.waitForTimeout(500);
const spoken = await page.evaluate(readLines, [o.from!, Number(o.displays)] as const);
await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('mathml'));
await page.waitForTimeout(300);

// The drawn glyphs and rules of the block, in page coordinates, and where
// each font family's file is.
const drawn = await page.evaluate(() => {
  const block = document.querySelector('.latex-block[data-nodelist-b64]')!;
  const glyphs: { ch: string; family: string; size: number; x: number; y: number; scale: number }[] = [];
  for (const t of block.querySelectorAll('svg tspan')) {
    if (t.querySelector('tspan')) continue;
    const svg = (t as SVGElement).ownerSVGElement!, m = (t.parentNode as SVGGraphicsElement).getScreenCTM()!;
    const x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y'));
    const family = t.getAttribute('font-family') || '', size = Number(t.getAttribute('font-size') || 0);
    if (!svg || !family) continue;
    glyphs.push({ ch: t.textContent || '', family, size, x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, scale: m.a });
  }
  const rules = [...block.querySelectorAll('svg rect')].map(r => r.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0 && r.height < 20).map(r => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  const fonts: Record<string, string> = {};
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const fam = rule.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
      const src = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
      if (fam && src) fonts[fam] = new URL(src[1], document.baseURI).pathname;
    }
  }
  return { glyphs, rules, fonts };
});
await browser.close();
server.close();

// Each glyph an outline, from the served font file: drawn at 1000 px, y down,
// baseline at 0; the figure scales it to its size.
const fontCache = new Map<string, Font>();
const outline = (family: string, ch: string): string => {
  const file = drawn.fonts[family];
  if (!file) return '';
  let font = fontCache.get(file);
  if (!font) {
    const buf = readFileSync(join(site, decodeURIComponent(file)));
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    fontCache.set(file, font);
  }
  return font.charToGlyph(ch).getPath(0, 0, 1000).toPathData(1);
};

const captured: Captured = { mathml, spoken, glyphs: drawn.glyphs, rules: drawn.rules };
process.stdout.write(composeFigure(captured, outline));
console.error(`a11y-figure: ${mathml.reduce((n, p) => n + p.lines.length, 0)} line(s), ${fontCache.size} font(s)`);
