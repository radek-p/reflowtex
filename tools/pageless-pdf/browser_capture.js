// SPDX-License-Identifier: AGPL-3.0-or-later
// Capture the viewer's rendering of a bundle page in the strip's own frame.
//
//   node browser_capture.js <url> <out dir> --hsize PT --margin PT --ppp N
//                           [--y0 CSS --y1 CSS] [--band 2000] [--wait-log TEXT]
//                           [--extra-css CSS] [--chromium-args "--flag ..."]
//
// The page is stripped to its .latex-block (no switches, headings, footer),
// forced to the light theme at zoom 1 with TeX's black for its text (a page
// theme's text colour, often a dark grey, would tint every glyph) and without
// macOS's stem-thickening font smoothing, and its column pinned to exactly
// \hsize with `margin` of white either side — the geometry of the pageless
// strip. The viewer draws 2 CSS px per TeX point, so a device scale factor
// of ppp/2 gives ppp device pixels per point, the same scale compare.py asks
// pdftoppm for. Every segment is painted (the viewer's print path), then the
// document is photographed in viewport-high bands by scrolling; the manifest
// records where each band actually landed so compare.py can stitch them.
//
// Playwright is resolved from $PLAYWRIGHT_DIR (a directory with node_modules)
// or from this directory.
const path = require('path'), fs = require('fs');
const PW = process.env.PLAYWRIGHT_DIR || __dirname;
const { chromium } = require(path.join(PW, 'node_modules', 'playwright'));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const hsize = parseFloat(opt('--hsize')), margin = parseFloat(opt('--margin')), ppp = parseFloat(opt('--ppp', '2'));
let y0 = opt('--y0', null), y1 = opt('--y1', null);
const band = parseInt(opt('--band', '2000'));
const extraCss = opt('--extra-css', '');                 // appended to the injected stylesheet
const chromiumArgs = opt('--chromium-args', '');       // space-separated, passed to the browser
const waitLog = opt('--wait-log', null);          // wait for a console line containing this (a page script that loads late)
const [url, outDir] = args;
if (!url || !outDir || !(hsize > 0) || !(margin >= 0)) {
  console.error('usage: browser_capture.js <url> <out dir> --hsize PT --margin PT --ppp N [--y0 CSS --y1 CSS] [--band N] [--wait-log TEXT]');
  process.exit(2);
}
const dsf = ppp / 2;
const wcss = Math.round((hsize + 2 * margin) * 2);       // frame width in CSS px
const t0 = Date.now(); const log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const watchdog = setTimeout(() => { log('WATCHDOG: capture did not finish in 240 s'); process.exit(3); }, 240000);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: chromiumArgs.split(/\s+/).filter(Boolean) });
  const ctx = await browser.newContext({ viewport: { width: wcss, height: band }, deviceScaleFactor: dsf, colorScheme: 'light' });
  const page = await ctx.newPage();
  const logs = [], errors = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  const until = async (pred, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (pred()) return true; await page.waitForTimeout(50); }
    log('timeout waiting for', what, '— last logs:', logs.slice(-3).join(' | '));
    return false;
  };
  await page.goto(url, { timeout: 30000 });
  await until(() => logs.some(l => /\[latex-viewer\] \d+ block\(s\) in/.test(l)), 30000, 'first layout');
  if (waitLog) {
    await until(() => logs.some(l => l.includes(waitLog)), 20000, waitLog);
    await page.waitForTimeout(500);
  }
  log('page up:', logs.filter(l => /block\(s\) in/.test(l) || (waitLog && l.includes(waitLog))).join(' | '));

  const before = logs.length;
  await page.evaluate(({ hsize, margin, extraCss }) => {
    if (window.__setTheme) window.__setTheme('light');
    if (window.__zoom) window.__zoom(0);
    const css = document.createElement('style');
    css.textContent = `
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
      /* TeX's black: the viewer draws default-coloured text in the page's
         text colour (currentColor), which a page's light theme may make a
         dark grey – every glyph would then differ from the PDF by that. */
      .latex-block { color: #000 !important; --latex-color-000000: #000000 !important; }
      /* and glyphs as a PDF renderer draws them: macOS Chromium otherwise
         thickens every stem (its default font smoothing), which MuPDF does
         not – half again as many near-black pixels on testmath. */
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
  }, { hsize, margin, extraCss });
  const want = `re-render at ${hsize.toFixed(0)}pt`;
  await until(() => logs.slice(before).some(l => l.includes(want)), 8000, want);
  await page.evaluate(() => document.fonts.ready);
  await until(() => true, 300, '');
  // webfonts arriving after the first paint make the viewer rebuild the block
  // (visible segments only); settle, then paint every segment as for print
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(500);
  const geom = await page.evaluate(() => {
    const b = document.querySelector('.latex-block');
    const r = b.getBoundingClientRect();
    return { blockTop: r.top + window.scrollY, blockLeft: r.left, blockWidth: r.width, blockHeight: r.height,
             docHeight: document.documentElement.scrollHeight, svgs: b.querySelectorAll('svg').length,
             empty: [...b.querySelectorAll('svg')].filter(s => s.childElementCount === 0).length };
  });
  log('geometry:', JSON.stringify(geom));

  y0 = y0 === null ? 0 : Math.max(0, Math.floor(parseFloat(y0)));
  y1 = y1 === null ? geom.docHeight : Math.min(geom.docHeight, Math.ceil(parseFloat(y1)));
  const bands = [];
  let k = 0;
  for (let y = y0; y < y1; ) {
    const actual = await page.evaluate(y => { window.scrollTo(0, y); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY)))); }, y);
    // a webfont wave after the print paint rebuilds the block and leaves
    // off-screen segments to the scroll observer: wait until nothing in view is
    // still unpainted
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      const pending = await page.evaluate(() => [...document.querySelectorAll('.latex-block svg')].filter(s => {
        const r = s.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && s.childElementCount === 0 && r.height > 2; }).length);
      if (!pending) break;
      await page.waitForTimeout(50);
    }
    const file = path.join(outDir, `band_${k++}.png`);
    await page.screenshot({ path: file });
    bands.push({ file, scroll_y: actual, height_css: band });
    if (actual + band >= y1 || actual < y) break;     // reached the end, or could not scroll further
    y = actual + band;
  }
  const manifest = { url, css_width: wcss, dsf, ppp, band, hsize, margin, extra_css: extraCss, chromium_args: chromiumArgs, geometry: geom, y0, y1, bands,
                     errors, logs: logs.filter(l => /latex-viewer/.test(l)).slice(-6) };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  log(`${bands.length} band(s), ${errors.length} page error(s)`);
  await browser.close();
  clearTimeout(watchdog);
})().catch(e => { log('FAILED', e); process.exit(1); });
