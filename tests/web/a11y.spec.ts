// SPDX-License-Identifier: AGPL-3.0-or-later
// The accessible layer (src/pipeline/a11y.ts, vanilla's --a11y): what a
// screen reader is given – the text in reading order with MathML for every
// formula – and that the drawing is hidden from it, not from the eye.
import { test, expect } from './fixtures.ts';

test('every formula reaches assistive technology as MathML; the drawing does not', async ({ openPage }) => {
  const page = await openPage('mathml');
  const tree = await page.locator('body').ariaSnapshot();
  const maths = tree.split('\n').filter(l => /^\s*- math\b/.test(l));
  // first block: three inline formulas, the integral, the alignment (one
  // table for its rows); second block: two inline formulas; third: two
  expect(maths.length).toBe(9);
  expect(tree).toContain('Inline');
  expect(tree).toContain('The end.');
  expect(tree).not.toMatch(/- img\b/);            // the drawn block, glyph by glyph, is hidden

  const blocks = page.locator('.latex-block[data-nodelist-b64]');   // the page's, not the viewer's popovers
  for (const b of await blocks.all()) expect(await b.getAttribute('aria-hidden')).toBe('true');
  // (the viewer moves the layer before its block: see 'the layer is anchored …')
  expect(await page.locator('.latex-a11y + .latex-block[data-nodelist-b64]').count()).toBe(await blocks.count());

  const align = page.locator('.latex-a11y math[display="block"]').nth(1);
  expect(await align.locator('mtable').first().locator(':scope > mtr').count()).toBe(2);
  expect(await align.locator('mtable mtable').count()).toBe(2);   // cases, pmatrix
});

test('the layer is not seen: the page looks as it did', async ({ openPage }) => {
  const page = await openPage('mathml');
  // the layer takes no room (its pieces hang over the block, invisible)
  for (const layer of await page.locator('.latex-a11y').all()) expect((await layer.boundingBox())!.height).toBeLessThanOrEqual(1);
  const opacities = await page.locator('.latex-a11y > *').evaluateAll(ps => ps.map(p => getComputedStyle(p).opacity));
  expect(new Set(opacities)).toEqual(new Set(['0']));
  // the drawing is there, and drawn
  expect(await page.locator('.latex-block svg').count()).toBeGreaterThan(0);
});

// Where each piece of the layer is: over what it stands for. A screen reader
// scrolls to the element it reads (and VoiceOver draws its cursor around it),
// so a layer placed anywhere else sends the reader to the wrong place.
async function layerBoxes(page: import('@playwright/test').Page) {
  return page.evaluate(() => [...document.querySelectorAll('.latex-block[data-nodelist-b64]')].map(block => {
    const b = block.getBoundingClientRect();
    const layer = block.previousElementSibling!;
    return {
      block: { top: b.top + scrollY, bottom: b.bottom + scrollY },
      pieces: [...layer.children].map(p => {
        const r = p.getBoundingClientRect();
        return { top: r.top + scrollY, bottom: r.bottom + scrollY, height: r.height, text: (p.textContent ?? '').slice(0, 30) };
      }),
    };
  }));
}

function expectPlaced(blocks: Awaited<ReturnType<typeof layerBoxes>>) {
  for (const { block, pieces } of blocks) {
    let lastTop = -Infinity;
    for (const p of pieces) {
      expect(p.height, `"${p.text}" has a height`).toBeGreaterThan(5);
      expect(p.top, `"${p.text}" starts inside its block`).toBeGreaterThanOrEqual(block.top - 2);
      expect(p.bottom, `"${p.text}" ends inside its block`).toBeLessThanOrEqual(block.bottom + 2);
      expect(p.top, `"${p.text}" follows the piece before it`).toBeGreaterThanOrEqual(lastTop);
      lastTop = p.top;
    }
  }
}

test('each paragraph and display of the layer lies over its own lines', async ({ openPage }) => {
  const page = await openPage('mathml', { height: 600 });
  const blocks = await layerBoxes(page);
  expectPlaced(blocks);
  // the three paragraphs of one segment are placed apart, not all at its top
  const [p1, p2, p3] = blocks[1].pieces;
  expect(p2.top).toBeGreaterThan(p1.bottom - 2);
  expect(p3.top).toBeGreaterThan(p2.bottom - 2);
  // and the layer is still not seen, nor in the way of the pointer
  const style = await page.locator('.latex-a11y > *').first().evaluate(e => {
    const s = getComputedStyle(e);
    return { opacity: s.opacity, pointer: s.pointerEvents };
  });
  expect(style).toEqual({ opacity: '0', pointer: 'none' });
});

test('the layer follows a reflow', async ({ openPage }) => {
  const page = await openPage('mathml', { width: 1200, height: 600 });
  await page.setViewportSize({ width: 420, height: 600 });
  await page.waitForTimeout(600);                                 // the resize settles
  expectPlaced(await layerBoxes(page));
});

// Inside each piece, the text a screen reader reads is laid out to fill the
// piece as the drawn paragraph fills its lines: VoiceOver frames the words it
// reads, so text wrapped at another size puts its frame beside the
// paragraph, and text that runs past the piece's edge is clipped – and a
// screen reader skips what is clipped (a formula there went unread).
test('the text in each piece fills it, and nothing is cut off', async ({ openPage }) => {
  const page = await openPage('mathml', { height: 600 });
  // (a piece laid out line by line is checked run by run, below)
  const fits = await page.evaluate(() => [...document.querySelectorAll('.latex-a11y > *')].filter(p => !p.querySelector('[data-run]')).map(p => {
    const box = p.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(p);
    const ink = range.getBoundingClientRect();
    return { text: (p.textContent ?? '').slice(0, 30), para: !!(p as HTMLElement).dataset.para, overflow: p.scrollHeight - p.clientHeight,
             top: ink.top - box.top, bottom: box.bottom - ink.bottom, filled: ink.height / box.height };
  }));
  for (const f of fits) {
    expect(f.overflow, `"${f.text}" is not cut off`).toBeLessThanOrEqual(1);
    // (inline maths may overshoot its line by a pixel or two in ink, a
    // display's big operators by more: for a display, the layout fitting is
    // what counts)
    if (f.para) {
      expect(f.top, `"${f.text}" starts at the top of its piece`).toBeGreaterThanOrEqual(-3);
      expect(f.bottom, `"${f.text}" ends inside its piece`).toBeGreaterThanOrEqual(-3);
    }
    expect(f.filled, `"${f.text}" fills its piece`).toBeGreaterThan(0.6);
  }
});

// The browser's own accessibility tree, not Playwright's reading of the DOM:
// a style that spares the browser work (content-visibility, say) can take a
// piece out of what a screen reader is given while the DOM still has it.
// Chromium only: WebKit's tree is not reachable from here (VoiceOver is its test).
test('the browser gives a screen reader every formula of the layer', async ({ openPage, browserName }) => {
  test.skip(browserName !== 'chromium', 'the accessibility tree is read through Chromium\'s DevTools protocol');
  const page = await openPage('mathml-long', { height: 400 });   // most of the page far from the window
  expect(await page.locator('.latex-a11y math').count()).toBe(60);
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: { role?: { value: string }; ignored?: boolean }[] };
  const exposed = nodes.filter(n => n.role?.value === 'MathMLMath' && !n.ignored).length;
  expect(exposed).toBe(await page.locator('.latex-a11y math').count());
});

// Line by line: VoiceOver outlines each run of text it reads (and each
// formula), so each must cover exactly the drawn glyphs it stands for – a
// run of a line's text, stretched to that stretch of the line; a formula's
// MathML, scaled to the formula's drawn box; a display's, onto its ink.
// Checked against the union of the drawn glyphs whose middle lies inside the
// run: across, the two overlap almost wholly (a run spans the line's height,
// the ink less, so up and down the glyphs need only sit in its middle).
/** Each run against the drawn glyphs whose middle lies inside it: how much
 *  of their extent across the run spans, and how far off its middle they sit. */
async function coverage(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const out: { text: string; across: number; off: number; glyphs: number }[] = [];
    for (const block of document.querySelectorAll('.latex-block[data-nodelist-b64]')) {
      // A glyph's box: across, its text's (WebKit gives a <tspan> an empty
      // rectangle); up and down, a nominal em on its baseline, 0.75 above and
      // 0.25 below. Its text's box is the font's ascent and descent, which
      // macOS and Linux read from different tables: a 14 px glyph's box was
      // 18 px tall on one and 14 px on the other, and a big operator's middle
      // fell inside a run on one only – the median glyph moved, and the test
      // failed on Linux alone.
      const glyphs = [...block.querySelectorAll('svg text, svg tspan')].filter(g => !g.querySelector('tspan')).map(g => {
        const range = document.createRange(); range.selectNodeContents(g); const r = range.getBoundingClientRect();
        const te = g.closest('text')!, m = te.getScreenCTM()!;
        const y = parseFloat(g.getAttribute('y') ?? te.getAttribute('y') ?? 'NaN');
        const size = parseFloat(getComputedStyle(g).fontSize) * Math.hypot(m.b, m.d);
        const base = new DOMPoint(0, y).matrixTransform(m).y;
        return { left: r.left, right: r.right, width: r.width, top: base - 0.75 * size, bottom: base + 0.25 * size, height: size };
      }).filter(r => r.width > 0 && r.height > 0);
      for (const run of block.previousElementSibling!.querySelectorAll('[data-run]')) {
        const r = run.getBoundingClientRect();
        const inside = glyphs.filter(g => {
          const cx = g.left + g.width / 2, cy = g.top + g.height / 2;
          return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
        });
        if (!inside.length) { out.push({ text: (run.textContent ?? '').slice(0, 30), across: 0, off: 1, glyphs: 0 }); continue; }
        const u = { left: Math.min(...inside.map(g => g.left)), right: Math.max(...inside.map(g => g.right)) };
        const ix = Math.max(0, Math.min(r.right, u.right) - Math.max(r.left, u.left));
        const across = ix / (Math.max(r.right, u.right) - Math.min(r.left, u.left));
        // (the median glyph: a big operator's box is its font's, far taller than its ink)
        const mids = inside.map(g => (g.top + g.bottom) / 2).sort((a, b) => a - b);
        const off = Math.abs((r.top + r.bottom) / 2 - mids[mids.length >> 1]) / r.height;
        out.push({ text: (run.textContent ?? '').slice(0, 30), across, off, glyphs: inside.length });
      }
    }
    return out;
  });
}
function expectCovered(runs: Awaited<ReturnType<typeof coverage>>) {
  expect(runs.length, 'the layer is laid out line by line').toBeGreaterThan(10);
  for (const r of runs) {
    expect(r.across, `"${r.text}" (${r.glyphs} glyphs) spans its glyphs`).toBeGreaterThan(0.8);
    expect(r.off, `"${r.text}" has its glyphs in its middle`).toBeLessThan(0.3);
  }
}

test('each run of the layer covers exactly the glyphs it stands for', async ({ openPage }) => {
  const page = await openPage('mathml', { height: 900 });
  expectCovered(await coverage(page));
});

// Spoken, a formula is its words squeezed onto its glyphs – and the text
// after it stays on its own (WebKit spaces one letter fewer than Chromium).
test('spoken formulas, and the text after them, cover their glyphs too', async ({ openPage }) => {
  const page = await openPage('mathml', { height: 900 });
  await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('spoken'));
  await page.waitForTimeout(300);
  const runs = await coverage(page);
  await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('mathml'));
  expectCovered(runs);
});

// A display's MathML is scaled onto its ink – measured from its natural size,
// not from a scale left by the layout before (a transform shows in what the
// browser measures), and again after a reflow.
test('a display lies on its drawing, and still does after a reflow', async ({ openPage }) => {
  const page = await openPage('mathml', { width: 1200, height: 900 });
  const check = () => page.evaluate(() => [...document.querySelectorAll('.latex-a11y [data-run="display"]')].map(m => {
    const r = m.getBoundingClientRect();
    const piece = m.closest('.latex-a11y > *')!.getBoundingClientRect();
    return { w: r.width / piece.width, h: r.height / piece.height };
  }));
  for (const at of [1200, 800, 1200]) {
    await page.setViewportSize({ width: at, height: 900 });
    await page.waitForTimeout(600);
    for (const d of await check()) {
      expect(Math.abs(d.w - 1), `display width at ${at}px`).toBeLessThan(0.05);
      expect(Math.abs(d.h - 1), `display height at ${at}px`).toBeLessThan(0.05);
    }
  }
});

// After a formula, the text goes on as the source has it: a space where there
// was one (" and"), none before punctuation (","). Run by run, a reader hears
// the words joined to the formula otherwise.
test('the words after a formula keep their space, and punctuation none', async ({ openPage }) => {
  const page = await openPage('mathml');
  const after = await page.evaluate(() => {
    const piece = document.querySelector('.latex-a11y [data-para]')!;
    const runs = [...piece.querySelectorAll('[data-run]')];
    return runs.map((r, k) => (k > 0 && runs[k - 1].getAttribute('data-run') === 'math' && r.getAttribute('data-run') === 'text') ? r.textContent : null)
      .filter(t => t !== null);
  });
  expect(after[0], 'x²+y²=z² then " and"').toMatch(/^ and/);
  expect(after[1], 'f:ℝ→ℝ then ","').toMatch(/^,/);
  // the words after a formula that end their line keep it too ("Short: a ends.")
  const last = await page.evaluate(() => [...document.querySelectorAll('.latex-a11y [data-para]')].map(p => p.textContent).find(t => t!.startsWith('Short')));
  expect(last).toMatch(/𝑎 ends\./);
});

// VoiceOver frames the text itself – the font's box at the run's size – not
// the run's element: so that box is what must lie on the drawn line, as tall
// as its ink. Checked against the drawn glyphs' own font boxes (median top
// and bottom), which reach past the ink: the run's box lies within them and
// fills most of them.
test('each run\'s text box lies on the drawn line, top and bottom', async ({ openPage }) => {
  const page = await openPage('mathml', { height: 900 });
  const off = await page.evaluate(() => {
    const out: { text: string; above: number; below: number; fills: number }[] = [];
    const box = (n: Node) => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect(); };
    for (const block of document.querySelectorAll('.latex-block[data-nodelist-b64]')) {
      const glyphs = [...block.querySelectorAll('svg text, svg tspan')].filter(g => !g.querySelector('tspan')).map(box).filter(r => r.height > 0);
      for (const run of block.previousElementSibling!.querySelectorAll('[data-run="text"]')) {
        const t = box(run);
        const mine = glyphs.filter(g => { const cx = g.left + g.width / 2, cy = g.top + g.height / 2; return cx >= t.left && cx <= t.right && cy >= t.top - 4 && cy <= t.bottom + 4; });
        if (mine.length < 3) continue;
        const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
        const top = med(mine.map(g => g.top)), bottom = med(mine.map(g => g.bottom));
        out.push({ text: (run.textContent ?? '').slice(0, 25), above: top - t.top, below: t.bottom - bottom, fills: t.height / (bottom - top) });
      }
    }
    return out;
  });
  expect(off.length).toBeGreaterThan(5);
  for (const o of off) {
    expect(o.above, `"${o.text}": not above the glyphs`).toBeLessThanOrEqual(1.5);
    expect(o.below, `"${o.text}": not below the glyphs`).toBeLessThanOrEqual(1.5);
    // (a line with no descenders, "The end.", has ink half its font box tall)
    expect(o.fills, `"${o.text}": as tall as the ink`).toBeGreaterThan(0.45);
  }
});

// The reader's choice (reflowtex.setAccessibleMath): formulas as MathML –
// explorable, VoiceOver stops at each part – or as their spoken form, read on
// with the sentence. Remembered.
test('formulas as MathML or as spoken text, as the reader chooses', async ({ openPage }) => {
  const page = await openPage('mathml');
  expect(await page.evaluate(() => (window as any).reflowtex.accessibleMath())).toBe('mathml');
  expect(await page.locator('.latex-a11y math').count()).toBeGreaterThan(5);
  await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('spoken'));
  await page.waitForTimeout(200);
  expect(await page.locator('.latex-a11y math').count()).toBe(0);
  const tree = await page.locator('body').ariaSnapshot();
  expect(tree).toContain('x squared plus y squared equals z squared');
  expect(tree).not.toMatch(/- math\b/);
  // the spoken runs lie where the formulas are drawn
  expect(await page.locator('.latex-a11y [data-run="spoken"]').count()).toBeGreaterThan(3);
  await page.reload();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).reflowtex.accessibleMath())).toBe('spoken');
  expect(await page.locator('.latex-a11y math').count()).toBe(0);
  await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('mathml'));
  await page.waitForTimeout(200);
  expect(await page.locator('.latex-a11y math').count()).toBeGreaterThan(5);
});

test('the reading options offer the choice', async ({ openPage }) => {
  const page = await openPage('mathml');
  await page.locator('#lt-reader-button').click();
  const spoken = page.locator('#lt-reader-panel [data-m="spoken"]');
  await expect(spoken).toBeVisible();
  const [row, a, b] = await Promise.all(['#lt-math-row .lt-seg', '#lt-reader-panel [data-m="mathml"]', '#lt-reader-panel [data-m="spoken"]']
    .map(q => page.locator(q).boundingBox()));
  expect(a!.width + b!.width, 'the two options fill the row').toBeGreaterThan(row!.width - 12);
  await spoken.click();
  await expect(spoken).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => (window as any).reflowtex.accessibleMath())).toBe('spoken');
  await page.locator('#lt-reader-panel [data-m="mathml"]').click();
  expect(await page.evaluate(() => (window as any).reflowtex.accessibleMath())).toBe('mathml');
});

// A paragraph's text is one flow, as an ordinary paragraph's is: VoiceOver
// reads it through, instead of stopping (with its click) at every element –
// which a line placed on its own (position: absolute) would be.
test('a paragraph\'s runs are one flow of text, lines broken, none placed alone', async ({ openPage }) => {
  const page = await openPage('mathml');
  const r = await page.evaluate(() => {
    const piece = document.querySelector('.latex-a11y [data-para]')!;
    const runs = [...piece.querySelectorAll('[data-run="text"]')];
    return { runs: runs.length, placed: runs.filter(x => getComputedStyle(x).position !== 'static').length,
             blocks: runs.filter(x => getComputedStyle(x).display !== 'inline').length,
             // (a formula's MathML sits in a box of its own: that is the formula)
             others: [...piece.children].filter(c => !c.hasAttribute('data-run') && c.localName !== 'br' && !c.querySelector(':scope > math')).map(c => c.outerHTML.slice(0, 60)) };
  });
  expect(r.runs).toBeGreaterThan(2);
  expect(r.placed, 'runs placed on their own').toBe(0);
  expect(r.others, 'elements besides runs, formulas and line breaks').toEqual([]);
  expect(r.blocks, 'runs that are not inline text').toBe(0);
});

// Spoken, a formula's words take the source's spacing, no more: one space
// before "a" (the text's own), none between "i" and "th" – a reader heard
// "i (pause) th" otherwise.
test('spoken formulas are spaced as the source is', async ({ openPage }) => {
  const page = await openPage('mathml');
  await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('spoken'));
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => [...document.querySelectorAll('.latex-a11y [data-para]')].map(p => p.textContent!).find(t => t.startsWith('Short')));
  await page.evaluate(() => (window as any).reflowtex.setAccessibleMath('mathml'));
  expect(text!.trim()).toBe('Short: a ends. The ith one.');
});

// The layer is anchored at its block's start and every piece hangs below the
// anchor, at a positive offset: hung upwards from an anchor after the block
// (as shipped), Safari gave the page and its landmarks negative heights, and
// VoiceOver drew its first outline at the block's end. The viewer moves it
// before the block; empty in the flow, it moves nothing on the page.
test('the layer is anchored at its block\'s start, its pieces below the anchor', async ({ openPage }) => {
  const page = await openPage('mathml');
  const r = await page.evaluate(() => [...document.querySelectorAll('.latex-block[data-nodelist-b64]')].map(block => {
    const b = block.getBoundingClientRect(), layer = block.previousElementSibling as HTMLElement, l = layer.getBoundingClientRect();
    return { isLayer: layer.classList.contains('latex-a11y'), above: b.top - l.top, height: l.height,
             negative: [...layer.children].filter(p => (p as HTMLElement).offsetTop < -0.5).length };
  }));
  for (const x of r) {
    expect(x.isLayer, 'the layer comes before its block').toBe(true);
    expect(x.above, 'the anchor is at or above the block').toBeGreaterThanOrEqual(-1);
    expect(x.height, 'and takes no room').toBeLessThanOrEqual(0.5);
    expect(x.negative, 'pieces above the anchor').toBe(0);
  }
});
