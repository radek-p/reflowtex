// dom_dump.js <url> <out.json> [--hsize PT] [--margin PT] [--wait-log TEXT]
//
// Every glyph and rule the viewer put on the page, in the strip's
// coordinates (pt from the column's left margin edge and from the top of
// the block; 2 CSS px per pt): what vector_compare.py matches against
// MuPDF's trace of the strip. The page is pinned the way browser_capture.js
// pins it (column = \hsize, margin either side, light theme, all segments
// painted), so the two dumps describe the same frame.
const path = require('path');
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || __dirname, 'node_modules', 'playwright'));
const fs = require('fs');
const argv = process.argv.slice(2);
const url = argv[0], out = argv[1];
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? parseFloat(argv[i + 1]) : dflt; };
const hsize = opt('--hsize', 345), margin = opt('--margin', 36);
const waitLog = argv.includes('--wait-log') ? argv[argv.indexOf('--wait-log') + 1] : null;   // a console line to wait for
const colPx = Math.round(hsize * 2), marginPx = Math.round(margin * 2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: colPx + 2 * marginPx, height: 1200 } });
  const logs = []; page.on('console', m => logs.push(m.text()));
  await page.goto(url);
  const t = Date.now();
  while (waitLog && Date.now() - t < 30000 && !logs.some(l => l.includes(waitLog))) await page.waitForTimeout(100);
  await page.waitForTimeout(500);
  await page.evaluate(([colPx, marginPx]) => {
    if (window.__setTheme) window.__setTheme('light');
    if (window.__zoom) window.__zoom(0);
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
  const dump = await page.evaluate(([marginPx]) => {
    const root = document.querySelector('.latex-block');
    const blockTop = root.getBoundingClientRect().top + window.scrollY;
    const blockLeft = root.getBoundingClientRect().left + window.scrollX;
    const glyphs = [], rects = [];
    for (const svg of root.querySelectorAll('svg')) {
      const r = svg.getBoundingClientRect();
      const top = r.top + window.scrollY - blockTop, left = r.left + window.scrollX - blockLeft + marginPx;
      for (const t of svg.querySelectorAll('tspan')) {
        const x = parseFloat(t.getAttribute('x')), y = parseFloat(t.getAttribute('y'));
        if (isNaN(x) || isNaN(y)) continue;
        const te = t.closest('text');
        const ff = (t.getAttribute('font-family') || te.getAttribute('font-family') || '').split(',')[0].replace(/["']/g, '');
        const fs = parseFloat(t.getAttribute('font-size') || te.getAttribute('font-size') || '0');
        const bb = t.getBBox ? t.getBBox() : null;
        glyphs.push({ x: (left + x) / 2, y: (top + y) / 2, w: bb ? bb.width / 2 : 0, text: t.textContent, font: ff, size: fs / 2 });
      }
      // Drawn rules only: not a link's transparent hit area, nor the empty
      // mark a \webaside leaves where it stood.
      for (const e of svg.querySelectorAll('rect:not(.latex-link-hit):not(.latex-aside-mark)')) {
        if (e.closest('.latex-missing-glyph')) continue;
        rects.push({ x: (left + parseFloat(e.getAttribute('x'))) / 2, y: (top + parseFloat(e.getAttribute('y'))) / 2,
                     w: parseFloat(e.getAttribute('width')) / 2, h: parseFloat(e.getAttribute('height')) / 2 });
      }
    }
    return { height: root.getBoundingClientRect().height / 2, glyphs, rects };
  }, [marginPx]);
  fs.writeFileSync(out, JSON.stringify(dump));
  console.log(`dom: ${dump.glyphs.length} glyphs, ${dump.rects.length} rects, block ${dump.height.toFixed(2)} pt`);
  await browser.close();
})();
