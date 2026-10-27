// SPDX-License-Identifier: AGPL-3.0-or-later
// The report page in Chromium, on results made up here: a long document –
// a strip 48,000 pt tall with 160,000 glyphs, every one off, and a page as
// tall – opens quickly and draws only what is near the view; the TeX side,
// the boxes and the live page stay at the same x and y as it scrolls; and a
// short one is drawn whole, as before.
//
//     node --test tests/render/report/report.test.ts      (make test-render runs it)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { serveMounts } from '../../../tools/lib/static-server.ts';
import { ensureBundles } from '../../../src/pipeline/bundles.ts';
import { reportScript } from './build.ts';
import { writeIndex, writeResult } from './results.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');
const BP = 72 / 72.27, LINE = 12, PER_LINE = 40, HSIZE = 345, MARGIN = 36;

/** A test's results: `lines` lines of glyphs, every glyph 0.3 pt lower in
 *  the browser than in TeX; the page a block as tall, with a mark at
 *  `markPt`. */
function makeTest(build: string, name: string, lines: number, markPt: number): void {
  const dir = join(build, name, 'w0'), heightPt = lines * LINE + 20, widthPt = HSIZE + 2 * MARGIN;
  mkdirSync(join(dir, 'vector'), { recursive: true });
  mkdirSync(join(dir, 'site'), { recursive: true });
  const uses: string[] = [], matched: object[] = [];
  for (let l = 0; l < lines; l++) {
    const y = 10 + l * LINE;
    for (let g = 0; g < PER_LINE; g++) {
      const x = MARGIN + g * 8;
      uses.push(`<use data-text="a" xlink:href="#font_1_1" transform="matrix(9.96264,0,0,-9.96264,${(x * BP).toFixed(4)},${(y * BP).toFixed(4)})"/>`);
      matched.push({ x, y: y + 0.3, w: 5, size: 10, text: 'a', dx: 0, dy: -0.3 });
    }
  }
  writeFileSync(join(dir, 'vector', 'strip.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${(widthPt * 2).toFixed(3)}" height="${(heightPt * 2).toFixed(3)}" viewBox="0 0 ${(widthPt * BP).toFixed(3)} ${(heightPt * BP).toFixed(3)}">
<defs>
<path id="font_1_1" d="M.05 0H.5V.7H.05Z"/>
</defs>
<g>
${uses.join('\n')}
</g>
</svg>`);
  writeFileSync(join(dir, 'vector', 'vector.json'), JSON.stringify({ hsize_pt: HSIZE, margin_pt: MARGIN, matched,
    glyphs: { strip: matched.length, viewer: matched.length, matched: matched.length } }));
  // the page: one block, as tall as the strip (2 px per pt), and a mark in it
  writeFileSync(join(dir, 'site', 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>
<header>a header the report hides</header>
<div id="lt-content"><div class="latex-block" style="position:relative;height:${heightPt * 2}px">
<div id="mark" style="position:absolute;left:${MARGIN * 2 + 20}px;top:${markPt * 2}px;width:40px;height:20px;background:#000"></div>
</div></div></body></html>`);
  writeResult(dir, { id: name, case: name, extra: 0, status: 'fail', problems: [], tolerance: 0.05, target: 0.05,
                     hsize_pt: HSIZE, page: `${name}/w0/site` }, build);
}

let build = '', server: Server, url = '', browser: Browser;
before(async () => {
  build = mkdtempSync(join(tmpdir(), 'rtx-report-page-'));
  makeTest(build, 'long', 4000, 30000);
  makeTest(build, 'short', 12, 60);
  writeIndex(build, ['long', 'short']);
  ensureBundles({ only: ['inspector'] });
  const page = join(build, '.page');
  mkdirSync(page);
  for (const f of ['index.html', 'report.css']) copyFileSync(join(HERE, f), join(page, f));
  writeFileSync(join(page, 'app.js'), reportScript());
  ({ server, url } = await serveMounts({ '/': page, '/build/': build, '/inspector/': join(REPO, 'src/inspector') }));
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
  rmSync(build, { recursive: true, force: true });
});

async function open(id: string): Promise<Page & { errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.setItem('render-report.inspector', 'closed'); });
  const page = Object.assign(await ctx.newPage(), { errors: [] as string[] });
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) page.errors.push(`${r.status()}: ${r.url()}`); });
  await page.goto(`${url}/#${id}`);
  await page.waitForFunction(() => document.querySelector<HTMLElement>('iframe.page')?.style.visibility === 'visible'
    && !!document.querySelector('.side:nth-child(1) svg.sheet use') && !!document.querySelector('.list .fill')?.textContent);
  await settle(page);
  return page;
}
/** Until the page has drawn what it draws while idle. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>(done => {
  let n = 0;
  const step = () => requestIdleCallback(() => (++n < 40 ? requestAnimationFrame(step) : done()), { timeout: 200 });
  step();
}));
/** What both sides draw, and where. */
const look = (page: Page) => page.evaluate(() => {
  const [left, right] = [...document.querySelectorAll<HTMLElement>('.side .scroll')];
  const frame = document.querySelector<HTMLIFrameElement>('iframe.page')!, win = frame.contentWindow!;
  const k = frame.getBoundingClientRect().width / frame.offsetWidth;                      // (the page's scale)
  const stage = right.querySelector('.stage')!.getBoundingClientRect();
  const mark = win.document.getElementById('mark')!.getBoundingClientRect(), f = frame.getBoundingClientRect();
  return {
    uses: document.querySelectorAll('svg.sheet use').length,
    // (a box: a rect, or one of a path's rects)
    boxes: [...document.querySelectorAll('svg.boxes')].map(s => s.querySelectorAll('rect').length
      + [...s.querySelectorAll('path')].reduce((n, p) => n + (p.getAttribute('d')!.match(/M/g) ?? []).length, 0)),
    boxElements: document.querySelectorAll('svg.boxes *').length,
    listed: document.querySelector('.list .fill')!.textContent,
    left: left.scrollTop, right: right.scrollTop, paneHeight: right.clientHeight,
    frameHeight: frame.offsetHeight * k, frameTop: f.top - stage.top, pageScroll: win.scrollY * k,
    // the mark, on the stage (CSS px)
    mark: mark.top * k + f.top - stage.top,
    scale: k * 2,
  };
});

test('a long document opens quickly and draws only what is near the view', async () => {
  const t0 = performance.now();
  const page = await open('long');
  const took = performance.now() - t0;
  const a = await look(page);
  assert.equal(a.listed, '160000 not matching');
  assert.ok(took < 30000, `opened in ${(took / 1000).toFixed(1)} s`);
  // a few views' worth, of 160,000 glyphs and boxes; the frame a few views tall, of 96,000 px
  assert.ok(a.uses > 0 && a.uses < 16000, `${a.uses} glyphs drawn`);
  for (const n of a.boxes) assert.ok(n > 0 && n < 16000, `${n} boxes drawn`);
  assert.ok(a.boxElements < 200, `the boxes are ${a.boxElements} elements`);
  assert.ok(a.frameHeight < 4 * a.paneHeight, `the frame is ${a.frameHeight} px tall, the pane ${a.paneHeight}`);
  assert.deepEqual(page.errors, []);
});

test('scrolling a long document: both sides drawn where the view is, at the same place', async () => {
  const page = await open('long');
  for (const at of [0.55, 0.2, 0.9]) {
    await page.evaluate(f => { const p = document.querySelector<HTMLElement>('.side .scroll')!; p.scrollTop = p.scrollHeight * f; }, at);
    await settle(page);
    const s = await look(page);
    assert.equal(s.right, s.left, 'scrolled together');
    // the strip's glyphs and both sides' boxes there: those whose top is in the view
    const drawn = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.side .scroll')!, svg = document.querySelector<SVGSVGElement>('svg.sheet')!;
      const scale = svg.getBoundingClientRect().height / svg.viewBox.baseVal.height;           // (px per bp)
      const y0 = p.scrollTop / scale, y1 = (p.scrollTop + p.clientHeight) / scale;
      const inView = (ys: number[]) => ys.filter(y => y > y0 + 12 && y < y1 - 12).length;
      const uses = [...svg.querySelectorAll('use')].map(u => (u as SVGUseElement).transform.baseVal.consolidate()!.matrix.f);
      const boxes = [...document.querySelectorAll<SVGSVGElement>('svg.boxes')].map(b => {
        const k = b.getBoundingClientRect().height / b.viewBox.baseVal.height;              // (px per pt)
        const ys = [...b.querySelectorAll('path')].flatMap(p => [...p.getAttribute('d')!.matchAll(/M[-\d.e]+ ([-\d.e]+)/g)].map(m => Number(m[1])));
        return inView(ys.map(y => y * k / scale));
      });
      return { uses: inView(uses), boxes, view: (y1 - y0) };
    });
    const lines = Math.floor((drawn.view - 24) / (LINE * BP)) - 1;
    assert.ok(drawn.uses >= lines * PER_LINE, `at ${at}: ${drawn.uses} glyphs in the view, ${lines} lines`);
    for (const n of drawn.boxes) assert.ok(n >= lines * PER_LINE, `at ${at}: ${n} boxes in the view`);
    // the live page where the stage says: its frame scrolled as far as it is moved, the mark at its place
    assert.ok(Math.abs(s.frameTop - s.pageScroll) < 0.5, `frame at ${s.frameTop}, its page scrolled ${s.pageScroll}`);
    assert.ok(Math.abs(s.mark - 30000 * s.scale) < 0.5, `the mark at ${s.mark}, not ${30000 * s.scale}`);
    assert.ok(s.frameTop <= s.right && s.frameTop + s.frameHeight >= s.right + s.paneHeight, 'the frame covers the view');
  }
  assert.deepEqual(page.errors, []);
});

test('the page scrolling itself (a link, the inspector): the pane follows', async () => {
  const page = await open('long');
  await page.evaluate(() => document.querySelector<HTMLIFrameElement>('iframe.page')!.contentDocument!.getElementById('mark')!.scrollIntoView({ block: 'center' }));
  await settle(page);
  const s = await look(page);
  assert.ok(s.mark > s.right && s.mark < s.right + s.paneHeight, `the mark at ${s.mark}, the view ${s.right}–${s.right + s.paneHeight}`);
  assert.ok(Math.abs(s.frameTop - s.pageScroll) < 0.5 && Math.abs(s.mark - 30000 * s.scale) < 0.5, 'still in place');
  assert.equal(s.left, s.right, 'the TeX side too');
  // and the wheel over the page scrolls the pane
  const box = (await page.locator('.side:nth-child(2) .scroll').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(was => document.querySelectorAll<HTMLElement>('.side .scroll')[1].scrollTop > was + 100, s.right);
  assert.deepEqual(page.errors, []);
});

test('a short document is drawn whole, as before', async () => {
  const page = await open('short');
  const s = await look(page);
  assert.equal(s.uses, 12 * PER_LINE);
  assert.deepEqual(s.boxes, [12 * PER_LINE, 12 * PER_LINE]);
  assert.equal(s.frameTop, 0);
  // the selected mismatch, in blue on both sides
  await page.keyboard.press('n');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('svg.boxes')].map(b => b.querySelectorAll('rect[stroke="#0b57d0"]').length)), [1, 1]);
  assert.deepEqual(page.errors, []);
});
