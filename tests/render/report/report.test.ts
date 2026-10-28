// SPDX-License-Identifier: AGPL-3.0-or-later
// The report page in Chromium, on results made up here: a long document –
// a strip 48,000 pt tall with 160,000 glyphs, every one off, and a page as
// tall – opens quickly and draws only what is near the view; the TeX side,
// the boxes and the live page stay at the same x and y as it scrolls; a
// short one is drawn whole, as before; and what a test says is one line above
// the two sides, and in full in the list's Summary tab. And a real page, a
// long document the pipeline builds: after a jump far down, the live page
// shows there the lines the measurement saw there. A document whose lines
// all sit lower in TeX from the first on: by placement, nothing is off, and
// the one jump is marked. And batches: a second set of results (a paper
// corpus, its files gzipped) beside the tests, each shown on its own.
//
//     node --test tests/render/report/report.test.ts      (make test-render runs it)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { serveMounts } from '../../../tools/lib/static-server.ts';
import { ensureBundles } from '../../../src/pipeline/bundles.ts';
import { dumpDom, type DomGlyph } from '../../../tools/pageless-pdf/dom-dump.ts';
import { reportScript } from './build.ts';
import { writeIndex, writeResult } from './results.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');
const BP = 72 / 72.27, LINE = 12, PER_LINE = 40, HSIZE = 345, MARGIN = 36;
// a column of no whole number of px (2 px per pt): 905.94 px, which rounds to 906, i.e. 453 pt
const ODD_HSIZE = 452.9678955078125;

/** A test's results: `lines` lines of glyphs, every glyph 0.3 pt lower in
 *  the browser than in TeX; the page a block as tall, with a mark at
 *  `markPt`; the column `hsize` pt wide. */
function makeTest(build: string, name: string, lines: number, markPt: number, hsize = HSIZE, problems: string[] = []): void {
  const dir = join(build, name, 'w0'), heightPt = lines * LINE + 20, widthPt = hsize + 2 * MARGIN;
  mkdirSync(join(dir, 'vector'), { recursive: true });
  mkdirSync(join(dir, 'site'), { recursive: true });
  const glyphs: Glyph[] = [], matched: object[] = [];
  for (let l = 0; l < lines; l++) {
    const y = 10 + l * LINE;
    for (let g = 0; g < PER_LINE; g++) {
      const x = MARGIN + g * 8;
      glyphs.push({ x, y, size: 10, text: 'a' });
      matched.push({ x, y: y + 0.3, w: 5, size: 10, text: 'a', dx: 0, dy: -0.3 });
    }
  }
  writeStrip(dir, widthPt, heightPt, glyphs);
  writeFileSync(join(dir, 'vector', 'vector.json'), JSON.stringify({ hsize_pt: hsize, margin_pt: MARGIN, matched,
    glyphs: { strip: matched.length, viewer: matched.length, matched: matched.length } }));
  // the page: one block, as tall as the strip (2 px per pt), and a mark in it
  writeFileSync(join(dir, 'site', 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>
<header>a header the report hides</header>
<div id="lt-content"><div class="latex-block" style="position:relative;height:${heightPt * 2}px">
<div id="mark" style="position:absolute;left:${MARGIN * 2 + 20}px;top:${markPt * 2}px;width:40px;height:20px;background:#000"></div>
</div></div></body></html>`);
  writeResult(dir, { id: name, case: name, extra: 0, status: 'fail', problems, tolerance: 0.05, target: 0.05,
                     hsize_pt: hsize, page: `${name}/w0/site` }, build);
}

interface Glyph { x: number; y: number; size: number; text: string }
const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** A strip.svg of these glyphs (pt, on their baselines), each a box with its text. */
function writeStrip(dir: string, widthPt: number, heightPt: number, glyphs: Glyph[]): void {
  const uses = glyphs.map(g => `<use data-text="${xml(g.text)}" xlink:href="#font_1_1" transform="matrix(${(g.size * BP).toFixed(4)},0,0,${(-g.size * BP).toFixed(4)},${(g.x * BP).toFixed(4)},${(g.y * BP).toFixed(4)})"/>`);
  writeFileSync(join(dir, 'vector', 'strip.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${(widthPt * 2).toFixed(3)}" height="${(heightPt * 2).toFixed(3)}" viewBox="0 0 ${(widthPt * BP).toFixed(3)} ${(heightPt * BP).toFixed(3)}">
<defs>
<path id="font_1_1" d="M.05 0H.5V.7H.05Z"/>
</defs>
<g>
${uses.join('\n')}
</g>
</svg>`);
}

/** A test whose every line is JUMP pt lower in TeX than in the browser, from
 *  the first on: nothing within vector-compare's window, every glyph on one
 *  side only; its lines paired (lines.json). */
const JUMP = 31.39;
function makeJumped(build: string, name: string, lines: number): void {
  const dir = join(build, name, 'w0'), heightPt = lines * LINE + 20 + JUMP, widthPt = HSIZE + 2 * MARGIN;
  mkdirSync(join(dir, 'vector'), { recursive: true });
  mkdirSync(join(dir, 'site'), { recursive: true });
  const viewer: Glyph[] = [], strip: Glyph[] = [], paired: object[] = [];
  for (let l = 0; l < lines; l++) {
    const y = 10 + l * LINE;
    for (let g = 0; g < PER_LINE; g++) {
      viewer.push({ x: MARGIN + g * 8, y, size: 10, text: 'a' });
      strip.push({ x: MARGIN + g * 8, y: y + JUMP, size: 10, text: 'a' });
    }
    paired.push({ viewer_y: y, strip_y: y + JUMP, dy: JUMP, glyphs: PER_LINE, score: 1, text: 'a'.repeat(PER_LINE) });
  }
  writeStrip(dir, widthPt, heightPt, strip);
  const w = (g: Glyph) => ({ ...g, w: 5 });
  writeFileSync(join(dir, 'vector', 'vector.json'), JSON.stringify({ hsize_pt: HSIZE, margin_pt: MARGIN, matched: [],
    viewer_unmatched: viewer.map(w), strip_unmatched: strip.map(w), glyphs: { strip: strip.length, viewer: viewer.length, matched: 0 } }));
  writeFileSync(join(dir, 'vector', 'lines.json'), JSON.stringify({ lines: paired, steps: [], unmatched_viewer: 0, unmatched_strip: 0, matched_lines: lines }));
  writeFileSync(join(dir, 'site', 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>
<div id="lt-content"><div class="latex-block" style="height:${heightPt * 2}px"></div></div></body></html>`);
  writeResult(dir, { id: name, case: name, extra: 0, status: 'fail', problems: [], tolerance: 0.092, target: 0.092, hsize_pt: HSIZE,
                     page: `${name}/w0/site` }, build);
}

// A real page: a long document (400 parts, some 66,000 pt), built by the
// pipeline, its viewer laying out what is far from its screen in slices of
// idle time, by an estimate of the height until then.
const FAR_TEX = String.raw`\newcount\partn
\newcommand\onepart{%
  \section{Part \the\partn}
  Part \the\partn{} begins. The harmonic series diverges, though very slowly: its partial sums grow
  like the logarithm of the number of terms, and part \the\partn{} says so
  again at some length, with $\sum_{n \le N} 1/n = \ln N + \gamma + O(1/N)$
  in it, so that the lines break differently at every width.
  \[ \sum_{k=1}^{\the\partn} k = \frac{\the\partn\,(\the\partn+1)}{2}. \]
  After the display, part \the\partn{} goes on, shorter.

  Part \the\partn{} ends.
  \advance\partn by 1
  \ifnum\partn<401 \expandafter\onepart\fi}
\partn=1
\onepart
`;
/** Where the far test looks (pt), and how far either side of it. */
const FAR_AT = 0.8, FAR_SPAN = 150;
let farY = 0;
/** The page built, and its result: one step, at FAR_AT of its height. */
function buildFar(build: string): string {
  const dir = join(build, 'far', 'w0'), src = join(build, '.far-src');
  mkdirSync(src, { recursive: true });
  mkdirSync(join(dir, 'vector'), { recursive: true });
  writeFileSync(join(src, 'a-long.tex'), FAR_TEX);
  execFileSync('node', [join(REPO, 'integrations/vanilla/build.ts'), src, '--snippet', '-o', join(dir, 'site'), '--title', 'far'], { cwd: REPO, stdio: 'pipe' });
  return dir;
}
/** What the measurement saw on the page (dom-dump.ts), as the TeX side: the
 *  glyphs near where the test looks (the strip of all would be some 30 MB). */
async function measureFar(dir: string, url: string): Promise<void> {
  const dom = await dumpDom(url, { hsize: HSIZE, margin: MARGIN });
  farY = Math.round(dom.height * FAR_AT);
  const near = dom.glyphs.filter((g: DomGlyph) => Math.abs(g.y - farY) < 2 * FAR_SPAN && g.text.trim());
  writeStrip(dir, HSIZE + 2 * MARGIN, dom.height, near);
  writeFileSync(join(dir, 'vector', 'vector.json'), JSON.stringify({ hsize_pt: HSIZE, margin_pt: MARGIN, matched: [],
    glyphs: { strip: near.length, viewer: near.length, matched: near.length } }));
  writeResult(dir, { id: 'far', case: 'far', extra: 0, status: 'fail', tolerance: 0.05, target: 0.05, hsize_pt: HSIZE, page: 'far/w0/site',
    problems: [`step at browser y ${farY} (TeX y ${farY}): dy 0 → 1 (+1 pt)  "far down"`] }, dirname(dirname(dir)));
}

/** What a long document's test says, as a tool comparing whole documents
 *  writes it: line metrics, seven steps, and render.ts's verdict. */
const STEPS = [6000, 8000, 3000, 9000, 4000, 7000, 5000];
const SAID = [
  "lines: 990 of 1000 browser lines matched to TeX's; 7 step(s); dy at the end 12 pt; 10 browser and 10 TeX lines without a partner",
  "across (each matched line moved onto TeX's baseline): 660 of 40000 glyphs beyond 0.092 pt, worst 0.332 pt",
  ...STEPS.map((y, i) => `step at browser y ${y} (TeX y ${y - 4}): dy ${i} → ${i + 4} (+4 pt)  ${JSON.stringify(`line at ${y}`)}`),
  'glyphs TeX 40000 / drawn 40000 / matched 39000 (within 0.7 pt); within 0.092 pt: 81.4 %',
  "1000 of the browser's glyphs have no glyph in the PDF within 0.7 pt",
  '40000 glyphs off by more than 0.05 pt: "a" at y 10.3 off by (+0.000, -0.300), "a" at y 22.3 off by (+0.000, -0.300)',
  '666 rules in the PDF the browser did not draw (0 allowed): at y 2290.83, at y 2297.49',
  'a line of a shape the report does not know',
];
const STOPPED = 'stopped at capture after 5 s: TexError: lualatex failed:\n  ! Undefined control sequence.\n  l.12 \\foo';

let build = '', server: Server, url = '', browser: Browser;
before(async () => {
  build = mkdtempSync(join(tmpdir(), 'rtx-report-page-'));
  makeTest(build, 'long', 4000, 30000);
  makeTest(build, 'short', 12, 60);
  makeTest(build, 'odd-width', 12, 60, ODD_HSIZE);
  makeTest(build, 'said', 1000, 60, HSIZE, SAID);
  makeJumped(build, 'jumped', 40);
  const stopped = join(build, 'stopped', 'w0');
  mkdirSync(stopped, { recursive: true });
  writeResult(stopped, { id: 'stopped', case: 'stopped', extra: 0, status: 'error', problems: [STOPPED], tolerance: 0.05, target: 0.05 }, build);
  const far = buildFar(build);
  writeResult(far, { id: 'far', case: 'far', extra: 0, status: 'fail', problems: [], tolerance: 0.05, target: 0.05, hsize_pt: HSIZE,
                     page: 'far/w0/site' }, build);
  writeIndex(build, ['long', 'short', 'odd-width', 'said', 'stopped', 'jumped', 'far']);
  ensureBundles({ only: ['inspector'] });
  const page = join(build, '.page');
  mkdirSync(page);
  for (const f of ['index.html', 'report.css']) copyFileSync(join(HERE, f), join(page, f));
  writeFileSync(join(page, 'app.js'), reportScript());
  // a second batch, as the website has the paper corpus beside the tests: its own report.json, its files gzipped
  const corpus = join(build, '.corpus');
  makeTest(corpus, 'paper-a', 12, 60);
  for (const f of ['vector.json', 'strip.svg']) {
    const p = join(corpus, 'paper-a', 'w0', 'vector', f);
    writeFileSync(`${p}.gz`, gzipSync(readFileSync(p)));
    rmSync(p);
  }
  const paper = JSON.parse(readFileSync(join(corpus, 'paper-a', 'w0', 'result.json'), 'utf8'));
  writeFileSync(join(corpus, 'report.json'), JSON.stringify({ batch: { id: 'corpus', label: 'Paper corpus', order: 2 },
    // stopped papers first, as a batch may list them: the report lists them last and opens on a result
    results: [{ id: 'stopped-1', case: 'stopped-1', extra: 0, status: 'error', problems: ['Needs pdfTeX.'], at: paper.at, tolerance: 0.092, target: 0.092, dir: 'stopped-1' },
      { id: 'stopped-2', case: 'stopped-2', extra: 0, status: 'error', problems: ['Needs pdfTeX.'], at: paper.at, tolerance: 0.092, target: 0.092, dir: 'stopped-2' },
      { ...paper, label: 'A paper (paper-a)', gz: true }] }));
  writeFileSync(join(page, 'batches.json'), JSON.stringify({ batches: [{ id: 'corpus', label: 'Paper corpus', index: 'corpus/report.json', order: 2 },
    { id: 'tests', label: 'Tests', index: 'build/report.json', order: 1 }] }));
  ({ server, url } = await serveMounts({ '/': page, '/build/': build, '/corpus/': corpus, '/inspector/': join(REPO, 'src/inspector') }));
  browser = await chromium.launch();
  await measureFar(far, `${url}/build/far/w0/site/index.html`);
  writeIndex(build, ['long', 'short', 'odd-width', 'said', 'stopped', 'jumped', 'far']);
});
after(async () => {
  await browser?.close();
  server?.close();
  rmSync(build, { recursive: true, force: true });
});

async function open(id: string, ready = true): Promise<Page & { errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.setItem('render-report.inspector', 'closed'); });
  const page = Object.assign(await ctx.newPage(), { errors: [] as string[] });
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) page.errors.push(`${r.status()}: ${r.url()}`); });
  await page.goto(`${url}/#${id}`);
  if (ready) await drawn(page);
  return page;
}
/** Until both sides are drawn, and the list counted. */
async function drawn(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector<HTMLElement>('iframe.page')?.style.visibility === 'visible'
    && !!document.querySelector('.side:nth-child(1) svg.sheet use') && !!document.querySelector('.list .count')?.textContent);
  await settle(page);
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
    listed: document.querySelector('.list .count')!.textContent,
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

test('the live page is laid out at TeX\'s width, not at the nearest whole pixel', async () => {
  const page = await open('odd-width');
  const w = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>('iframe.page')!.contentDocument!;
    const b = doc.querySelector<HTMLElement>('#lt-content > .latex-block')!;
    return { pt: b.dataset.latexWidth, px: b.getBoundingClientRect().width };
  });
  // the viewer breaks lines at data-latex-width; the column is as wide (to Chromium's 1/64 px)
  assert.equal(w.pt, String(ODD_HSIZE));
  assert.ok(Math.abs(w.px - ODD_HSIZE * 2) < 1 / 32, `the column is ${w.px} px, not ${ODD_HSIZE * 2}`);
  assert.deepEqual(page.errors, []);
});

test('what a test says: one line above the sides, all of it in the Summary tab, a step a click away', async () => {
  const page = await open('said');
  // one line: the verdict and three numbers
  const top = await page.evaluate(() => {
    const h = document.querySelector<HTMLElement>('.headline')!;
    return { text: h.innerText.replace(/\s+/g, ' ').trim(), height: h.getBoundingClientRect().height,
             lines: h.querySelector('.nums')!.getClientRects().length, list: document.querySelectorAll('.problems, .headline li').length };
  });
  assert.equal(top.text, 'Fail 990 of 1000 lines matched, 7 step(s), 81.4 % of glyphs within 0.092 pt, 666 rules not drawn (0 allowed) Summary (14)');
  assert.ok(top.height <= 30 && top.lines === 1, `the line is ${top.height} px tall`);
  assert.equal(top.list, 0);
  // the Summary tab: the lines in groups, the steps five at first
  assert.equal(await page.locator('#panel-summary').isVisible(), false);
  await page.click('.headline button');
  assert.equal(await page.getAttribute('#tab-summary', 'aria-selected'), 'true');
  assert.equal(await page.locator('#panel-mismatches').isVisible(), false);
  const groups = () => page.evaluate(() => [...document.querySelectorAll('#panel-summary .group')].map(g => ({
    title: g.querySelector('h3')!.textContent, facts: g.querySelectorAll('.fact').length,
    steps: g.querySelectorAll('.srow.step').length, places: g.querySelectorAll('.srow.place').length })));
  assert.deepEqual(await groups(), [
    { title: 'Lines and steps', facts: 1, steps: 5, places: 0 },
    { title: 'Glyphs', facts: 4, steps: 0, places: 2 },
    { title: 'Rules', facts: 1, steps: 0, places: 2 },
    { title: 'Other', facts: 1, steps: 0, places: 0 },
  ]);
  await page.click('#panel-summary .steps .showall');
  assert.equal((await groups())[0].steps, 7);
  // a step: both sides go there, its browser y in the middle
  const step = page.locator('#panel-summary .srow.step').nth(3);
  assert.match((await step.textContent())!, /y 9000\s*\+4 pt\s*line at 9000/);
  await step.click();
  await settle(page);
  const at = await page.evaluate(() => {
    const [left, right] = [...document.querySelectorAll<HTMLElement>('.side .scroll')];
    const svg = document.querySelector<SVGSVGElement>('svg.boxes')!;
    const k = svg.getBoundingClientRect().height / svg.viewBox.baseVal.height;              // (px per pt)
    return { left: left.scrollTop, right: right.scrollTop, want: 9000 * k - right.clientHeight / 2 };
  });
  assert.ok(Math.abs(at.left - at.want) <= 1 && Math.abs(at.right - at.want) <= 1, `scrolled to ${at.left}, ${at.right}, not ${at.want}`);
  assert.equal(await step.getAttribute('aria-pressed'), 'true');
  // the tab is kept in this browser
  await page.reload();
  await drawn(page);
  assert.equal(await page.getAttribute('#tab-summary', 'aria-selected'), 'true');
  // and n goes to the next mismatch, in its tab
  await page.keyboard.press('n');
  assert.equal(await page.getAttribute('#tab-mismatches', 'aria-selected'), 'true');
  assert.deepEqual(page.errors, []);
});

test('a test that stopped: its message in full above the sides', async () => {
  const page = await open('stopped', false);
  await page.waitForSelector('.headline.error');
  assert.equal(await page.locator('.headline.error .msg').textContent(), STOPPED);
  assert.deepEqual(page.errors, []);
});

/** Both sides' lines between y0 and y1 (pt, on the stage): [baseline, text],
 *  the TeX side's from strip.svg, the live page's from its glyphs. */
const lines = (page: Page, y0: number, y1: number) => page.evaluate(([y0, y1]) => {
  const group = (gs: { x: number; y: number; t: string }[]) => {
    const by = new Map<number, { x: number; t: string }[]>();
    for (const g of gs) if (g.y > y0 && g.y < y1) { const k = Math.round(g.y); (by.get(k) ?? by.set(k, []).get(k)!).push(g); }
    return [...by].sort((a, b) => a[0] - b[0]).map(([k, l]) => [k, l.sort((a, b) => a.x - b.x).map(g => g.t).join('')] as [number, string]);
  };
  const strip = [...document.querySelectorAll<SVGUseElement>('svg.sheet use')].map(u => {
    const m = u.transform.baseVal.consolidate()!.matrix;
    return { x: m.e * 72.27 / 72, y: m.f * 72.27 / 72, t: u.dataset.text ?? '' };
  });
  // the live page: each glyph's origin, through the frame's place and scale on the stage
  const frame = document.querySelector<HTMLIFrameElement>('iframe.page')!, f = frame.getBoundingClientRect();
  const k = f.height / frame.offsetHeight, stage = document.querySelectorAll('.side .stage')[1].getBoundingClientRect();
  const live = [...frame.contentDocument!.querySelectorAll<SVGTSpanElement>('.latex-block svg tspan')].flatMap(t => {
    const x = parseFloat(t.getAttribute('x')!), y = parseFloat(t.getAttribute('y')!);
    if (isNaN(x) || isNaN(y) || !t.textContent!.trim()) return [];
    const p = new DOMPoint(x, y).matrixTransform(t.closest('text')!.getScreenCTM()!);
    return [{ x: (p.x * k + f.left - stage.left) / (2 * k), y: (p.y * k + f.top - stage.top) / (2 * k), t: t.textContent! }];
  });
  return { tex: group(strip), live: group(live) };
}, [y0, y1]);

test('far down a long page, the live page shows the lines the measurement saw there', async () => {
  const page = await open('far', false);
  // at once, as a reader may: a step far down, in the Summary tab
  await page.waitForFunction(() => document.querySelector<HTMLElement>('iframe.page')?.style.visibility === 'visible');
  await page.click('#tab-summary');
  await page.click('#panel-summary .srow.step');
  // until both sides have drawn their lines there
  const y0 = farY - FAR_SPAN, y1 = farY + FAR_SPAN;
  await page.waitForFunction(([y0, y1]) => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe.page')!, f = frame.getBoundingClientRect();
    const k = f.height / frame.offsetHeight, stage = document.querySelectorAll('.side .stage')[1].getBoundingClientRect();
    const ys = [...frame.contentDocument!.querySelectorAll('.latex-block svg tspan')].map(t => (t.getBoundingClientRect().top * k + f.top - stage.top) / (2 * k));
    return document.querySelectorAll('svg.sheet use').length > 0 && ys.filter(y => y > y0 && y < y1).length > 100;
  }, [y0, y1]);
  const { tex, live } = await lines(page, y0, y1);
  assert.ok(tex.length > 10, `${tex.length} lines of TeX's near y ${farY}`);
  // each of TeX's lines there, on the live page at the same height (to a point: a line is its baseline, rounded)
  const off = tex.filter(([y, t]) => !live.some(([ly, lt]) => lt === t && Math.abs(ly - y) <= 1));
  assert.deepEqual(off, [], `near y ${farY}, TeX's side has\n  ${tex.slice(0, 4).map(l => l.join(' ')).join('\n  ')}\nthe live page\n  ${live.slice(0, 4).map(l => l.join(' ')).join('\n  ')}`);
  assert.deepEqual(page.errors, []);
});

test('the live page in TeX\'s colours, inverted or not, is in the default theme; Light in the viewer\'s light one', async () => {
  for (const [colours, theme] of [['tex', 'default'], ['inverted', 'default'], ['light', 'light']]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(c => { localStorage.setItem('render-report.inspector', 'closed'); localStorage.setItem('render-report.colours', c); }, colours);
    const page = await ctx.newPage();
    await page.goto(`${url}/#far`);
    await page.waitForFunction(() => document.querySelector<HTMLElement>('iframe.page')?.style.visibility === 'visible');
    await settle(page);
    const shown = await page.evaluate(() => {
      const w = document.querySelector<HTMLIFrameElement>('iframe.page')!.contentWindow as Window & { reflowtex?: { theme?(): { theme: string } } };
      return w.reflowtex?.theme?.().theme;
    });
    assert.equal(shown, theme, `colours ${colours}`);
    await ctx.close();
  }
});

test('one jump at the first line: by placement nothing is off, and the jump is marked once; in absolute position, all of it', async () => {
  const page = await open('jumped');
  const shown = () => page.evaluate(() => ({
    count: document.querySelector('.list .count')!.textContent,
    red: [...document.querySelectorAll('svg.boxes path[stroke="#d93025"]')].reduce((n, p) => n + (p.getAttribute('d')!.match(/M/g) ?? []).length, 0),
    jumps: [...document.querySelectorAll('svg.boxes text')].map(t => t.textContent),
    rows: [...document.querySelectorAll('.list .row .what')].map(e => e.textContent),
    measure: [...document.querySelectorAll('.list .measure .seg button')].map(b => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
  }));
  const p = await shown();
  assert.deepEqual(p.measure, ['Placement*', 'Absolute']);
  assert.equal(p.count, 'Everything matches, 1 vertical jump');
  assert.equal(p.red, 0);
  assert.deepEqual(p.jumps, ['+31.39 pt', '+31.39 pt']);                     // (on both sides)
  assert.deepEqual(p.rows, ['jump +31.39 pt']);
  // the jump, a click away: the TeX side at its own height
  await page.click('.list .row');
  // absolute: every glyph on one side only
  await page.click('.list .measure .seg button:text-is("Absolute")');
  await settle(page);
  const a = await shown();
  assert.equal(a.count, `${2 * 40 * PER_LINE} not matching`);
  assert.ok(a.red > 0 && a.jumps.length === 0, `${a.red} red, ${a.jumps.length} jumps`);
  assert.deepEqual(page.errors, []);
});

test('a build without paired lines: in absolute position, and the report says so', async () => {
  const page = await open('short');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.list .measure .seg button')].map(b => b.textContent)), ['Absolute']);
  assert.match((await page.locator('.list .measure .muted').textContent())!, /no line pairing/);
  assert.deepEqual(page.errors, []);
});

test('batches: each its own list and totals, named by the URL, its gzipped files read', async () => {
  const page = await open('paper-a', false);
  // no result named: the first with a result opens, not one that stopped
  await page.goto(`${url}/?batch=corpus`);
  await drawn(page);
  assert.equal(await page.evaluate(() => document.querySelector<HTMLSelectElement>('select[aria-label="Test"]')!.value), 'paper-a');
  const listed = () => page.evaluate(() => ({
    options: [...document.querySelectorAll<HTMLOptionElement>('select[aria-label="Test"] option')].map(o => o.textContent!.trim()),
    totals: document.querySelector('.totals')!.textContent, batch: document.querySelector('[aria-label="Which results: each batch is its own list and summary"] [aria-pressed="true"]')?.textContent,
    uses: document.querySelectorAll('svg.sheet use').length }));
  const corpus = await listed();
  // the stopped ones listed, last
  assert.deepEqual(corpus.options.map(o => o.replace(/^\S+\s/, '')), ['A paper (paper-a)', 'stopped-1', 'stopped-2']);
  assert.equal(corpus.totals, '12');
  assert.equal(corpus.batch, 'Paper corpus');
  assert.ok(corpus.uses > 0, 'the TeX side drawn from strip.svg.gz');
  // the other batch: the tests alone, and the URL says so
  await page.click('button:text("Tests")');
  await page.waitForFunction(() => [...document.querySelectorAll('select[aria-label="Test"] option')].length > 1);
  const tests = await listed();
  assert.ok(tests.options.some(o => o.endsWith(' long')), JSON.stringify(tests.options));
  assert.ok(!tests.options.some(o => o.includes('paper-a') || o.includes('stopped-1')));
  // here too, what stopped comes last
  assert.ok(tests.options.at(-1)!.endsWith(' stopped'), JSON.stringify(tests.options));
  assert.equal(new URL(page.url()).searchParams.get('batch'), 'tests');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
