// SPDX-License-Identifier: AGPL-3.0-or-later
// The inspector with the host API (viewer v2): text drawn in surfaces (panes
// a component drew, popovers) in the tree; instances, kinds and marks among
// the resources; the colour maps, shown, edited live, exported and imported.
import { test, expect, type WebPage } from './fixtures.ts';

/** Open the inspector and wait for its page agent. */
async function agent(page: WebPage) {
  await page.evaluate(() => reflowtex.inspector.open(undefined, { scroll: false }));
  await page.waitForFunction(() => window.__rtxInspector && window.__rtxInspector.resources);
}
const A = (page: WebPage, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window.__rtxInspector as any)[fn](...(args as unknown[])), [fn, args] as const);

test('text in surfaces is in the tree', async ({ openPage }) => {
  const page = await openPage('accordion-v2');
  await agent(page);
  const r = await page.evaluate(() => {
    const I = window.__rtxInspector, [b] = I.blocks();
    const rows = I.children(b.id), surfaces = rows.filter((x: any) => x.kind === 'side');
    const first = surfaces[0] ? I.children(surfaces[0].id) : [];
    return { labels: surfaces.map((s: any) => s.label), segs: first.length };
  });
  expect(r.labels.some((l: string) => l.includes('pane · body') && l.includes('drawn by the page')), JSON.stringify(r.labels)).toBe(true);
  expect(r.segs, 'a surface opens to its segments').toBeGreaterThan(0);
});

test('instances, kinds and marks among the resources', async ({ openPage }) => {
  const page = await openPage('parts');
  await agent(page);
  const r = await A(page, 'resources');
  const labels = (k: string) => r[k].map((x: any) => x.label);
  expect(labels('instances')).toContain('popover (inline)');
  expect(labels('instances')).toContain('box (block)');
  expect(labels('marks')).toContain('#key');
  expect(labels('marks')).toContain('#inner .hot');
  const inst = r.instances.find((x: any) => x.label === 'popover (inline)');
  const d = await A(page, 'resource', inst.key);
  const rows = Object.fromEntries(d.rows);
  expect(rows['tone=']).toBe('warm');
  expect(rows['part label']).toContain('typeset');
  expect(rows['drawn by']).toContain('default');
  expect((await A(page, 'uses', r.marks.find((x: any) => x.label === '#key').key)).length, 'the mark is outlined').toBeGreaterThan(5);
});

test('the kinds the page defines', async ({ openPage }) => {
  const page = await openPage('lean-v2');
  await agent(page);
  const r = await A(page, 'resources');
  const kinds = r.kinds.map((k: any) => k.label);
  expect(kinds).toEqual(expect.arrayContaining(['accordion', 'leanproof', 'leantheorem', 'hint']));
  expect(await page.evaluate(() => reflowtex.host.kinds())).toEqual(expect.arrayContaining(['accordion', 'leanproof']));
});

const blueFill = (page: WebPage) => page.evaluate(() => {
  const t = [...document.querySelectorAll('.latex-block svg tspan')].find(e => e.textContent === 'b')!;
  return getComputedStyle(t).fill;
});

test('colour maps: listed, edited live, exported, imported, reset', async ({ openPage }) => {
  const page = await openPage('colours');
  await agent(page);
  const d = await A(page, 'colourMaps');
  expect(d.maps.map((m: any) => m.name)).toEqual(['test']);
  const m = d.maps[0];
  expect([m.used, m.usedBy]).toEqual([1, 'block 1']);
  expect(m.themes).toEqual(['light', 'dark']);
  expect(m.colors.find((c: any) => c.src === '#0000ff').by.dark).toBe('#99ccff');
  expect(m.tints).toEqual([expect.objectContaining({ hex: '#ccccff', base: '#0000ff', pct: 20 })]);
  expect(await blueFill(page)).toBe('rgb(0, 0, 255)');
  // edited live, in the page's theme (light)
  expect(await A(page, 'setMapColour', 'test', 'light', '#0000ff', '#008000')).toBe('ok');
  expect(await blueFill(page)).toBe('rgb(0, 128, 0)');
  const json = JSON.parse(await A(page, 'exportColourMaps'));
  expect(json.test.colors.light['#0000ff']).toBe('#008000');
  expect((await A(page, 'colourMaps')).edited).toBe(true);
  // imported: another map entirely
  expect(await A(page, 'importColourMaps', JSON.stringify({ test: { colors: { light: { '#0000ff': '#ff00ff' } } } }))).toBe('ok');
  expect(await blueFill(page)).toBe('rgb(255, 0, 255)');
  expect(await A(page, 'importColourMaps', '{ not json')).toContain('not JSON');
  // and the page's own again
  expect(await A(page, 'resetColourMaps')).toBe('ok');
  expect(await blueFill(page)).toBe('rgb(0, 0, 255)');
  expect((await A(page, 'colourMaps')).edited).toBe(false);
});

test('the Colours tab shows the maps', async ({ openPage }) => {
  const page = await openPage('colours');
  await agent(page);
  await page.locator('[data-rtx-ui] [role="tab"][data-view="col"]').click();
  await expect(page.locator('[data-rtx-ui] .colours .cmap h3')).toContainText('test');
  expect(await page.locator('[data-rtx-ui] .colours .cgrid .pk-swatch').count()).toBeGreaterThan(1);
});

// A colour cell is one line, the picker before the field: its class once
// shared a name with the font table's cells (bordered, stacked).
test('a colour cell is one line', async ({ openPage }) => {
  const page = await openPage('colours');
  await agent(page);
  await page.locator('[data-rtx-ui] [role="tab"][data-view="col"]').click();
  const cell = page.locator('[data-rtx-ui] .colours .cgrid td .ccell').first();
  await cell.waitFor();
  const r = await cell.evaluate(c => {
    const [pick, field] = [c.querySelector('.pk-swatch')!, c.querySelector('input[type="text"]')!].map(e => e.getBoundingClientRect());
    return { h: c.getBoundingClientRect().height, beside: pick.right <= field.left + 1, border: getComputedStyle(c).borderTopWidth };
  });
  expect(r.h).toBeLessThan(28);
  expect(r.beside).toBe(true);
  expect(r.border).toBe('0px');
});

// A theme's heading switches the page, as its own switcher would.
test("a theme's heading switches the page's theme", async ({ openPage }) => {
  const page = await openPage('colours');
  await agent(page);
  await page.locator('[data-rtx-ui] [role="tab"][data-view="col"]').click();
  await page.locator('[data-rtx-ui] .colours th button.theme', { hasText: 'dark' }).click();
  await expect.poll(() => page.evaluate(() => [document.documentElement.classList.contains('dark'), document.documentElement.dataset.theme])).toEqual([true, 'dark']);
  expect(await blueFill(page), "the map's dark colour").toBe('rgb(153, 204, 255)');
  await expect(page.locator('[data-rtx-ui] .colours th button.theme[aria-pressed="true"]')).toHaveText('dark');
  await page.locator('[data-rtx-ui] .colours th button.theme', { hasText: 'light' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
});

// The panel's own picker, not the browser's (a system dialog on a Mac):
// the square, the hue, the hex; a drag edits live, Escape takes it back.
test('the colour picker', async ({ openPage }) => {
  const page = await openPage('colours');
  await agent(page);
  await page.locator('[data-rtx-ui] [role="tab"][data-view="col"]').click();
  expect(await page.locator('[data-rtx-ui] .colours input[type="color"]').count(), "no browser pickers").toBe(0);
  await page.locator('[data-rtx-ui] .colours .ccell .pk-swatch').first().click();
  const picker = page.locator('[data-rtx-ui] .picker');
  await expect(picker).toBeVisible();
  const hex = picker.locator('.pk-hex');
  await hex.fill('#008000');
  await expect.poll(() => blueFill(page)).toBe('rgb(0, 128, 0)');
  const sv = await picker.locator('.pk-sv').boundingBox();
  await page.mouse.click(sv!.x + sv!.width - 2, sv!.y + 2);       // saturated, bright: the hue's pure colour
  const [r, g, b] = (await hex.inputValue()).match(/[0-9a-f]{2}/g)!.map(x => parseInt(x, 16));
  expect(g > 240 && r < 16 && b < 16, 'near pure green').toBe(true);
  await expect.poll(() => blueFill(page)).toBe(`rgb(${r}, ${g}, ${b})`);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect.poll(() => blueFill(page), 'Escape puts back the colour it opened with').toBe('rgb(0, 0, 255)');
});

// In the dark theme the Colours view's buttons are the panel's, not the
// browser's light ones with light text.
test("the panel's buttons in the dark", async ({ openPage }) => {
  const page = await openPage('colours');
  await page.evaluate(() => { document.body.style.background = '#111'; document.body.style.color = '#eee'; });
  await agent(page);
  await page.locator('[data-rtx-ui] [role="tab"][data-view="col"]').click();
  await page.locator('[data-rtx-ui] .colours .cbar button', { hasText: 'Paste JSON' }).click();
  const r = await page.locator('[data-rtx-ui] .colours').evaluate(v => [...v.querySelectorAll('button:not(.pk-swatch):not(.x):not(.theme)')].map(b => {
    const cs = getComputedStyle(b), lum = (c: string) => { const [r, g, bl] = c.match(/[\d.]+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    return { text: b.textContent, bg: cs.backgroundColor, fg: lum(cs.color) };
  }));
  const lum = (c: string) => { const [r, g, bl] = c.match(/[\d.]+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  expect(r.length).toBeGreaterThan(4);
  for (const b of r) {
    expect(b.bg === 'rgba(0, 0, 0, 0)' || lum(b.bg) < 80, `${b.text}: ${b.bg}`).toBe(true);
    expect(b.fg, b.text!).toBeGreaterThan(150);
  }
});

// The render report keeps one panel in its own page and inspects the page an
// iframe shows, from test to test (inspect(win)).
test('one panel inspects another window, and follows it to the next page', async ({ openPage }) => {
  const page = await openPage('parts');
  const frame = () => (document.getElementById('other') as HTMLIFrameElement).contentWindow as any;
  // the iframe showing `path`, drawn, with the panel's agent in it: its first block's summary
  const shown = async (path: string) => {
    await page.waitForFunction(p => {
      const w = ((document.getElementById('other') as HTMLIFrameElement | null)?.contentWindow) as any;
      return w?.location.pathname.includes(p) && w.__rtxInspector && w.document.querySelector('.latex-block svg tspan');
    }, path, { timeout: 20000 });
    return page.evaluate(`(${frame})().__rtxInspector.blocks()[0].note`) as Promise<string>;
  };
  const treeText = () => page.evaluate(() => document.querySelector('[data-rtx-ui]')!.shadowRoot!.querySelector('.tree')!.textContent);
  await page.evaluate(u => {
    const f = Object.assign(document.createElement('iframe'), { id: 'other', src: u });
    f.style.cssText = 'width:800px;height:600px';
    f.onload = async () => { await reflowtex.inspector.inspect(f.contentWindow!); await reflowtex.inspector.open(undefined, { scroll: false }); };
    document.body.appendChild(f);
  }, new URL('../boxes/index.html', page.url()).href);
  const boxes = await shown('/boxes/');
  expect(await page.evaluate(() => !!window.__rtxInspector), 'the agent is in the inspected window, not here').toBe(false);
  await expect.poll(treeText).toContain(boxes);

  // the iframe goes on to another page: the same panel shows it
  await page.evaluate(u => {
    const f = document.getElementById('other') as HTMLIFrameElement;
    f.onload = () => reflowtex.inspector.inspect(f.contentWindow!);
    f.src = u;
  }, new URL('../colours/index.html', page.url()).href);
  const colours = await shown('/colours/');
  expect(colours).not.toBe(boxes);
  await expect.poll(treeText).toContain(colours);
  expect(await treeText()).not.toContain(boxes);
  expect(await page.evaluate(() => document.querySelectorAll('[data-rtx-ui]').length), 'one panel').toBe(1);
  expect(await page.evaluate(() => reflowtex.inspector.isOpen())).toBe(true);
});

// ── Accessibility ───────────────────────────────────────────────────────────
// What a screen reader is given for a box: the accessible layer's text for
// the paragraphs and displays it belongs to (src/pipeline/a11y.ts, laid over
// the drawing by the viewer), each formula as its MathML and its words.

/** A row of the Boxes tree: the block's, its first segment's, a line's. */
async function firstLine(page: WebPage, block = 0) {
  return page.evaluate(b => {
    const I = window.__rtxInspector as any;
    const blk = I.blocks()[b], seg = I.children(blk.id)[0], line = I.children(seg.id)[0];
    return { block: blk.id, seg: seg.id, line: line.id };
  }, block);
}

test('the accessible text of a box: its paragraph\'s text, formulas as MathML and words', async ({ openPage }) => {
  const page = await openPage('mathml');
  await agent(page);
  const { line, block } = await firstLine(page);
  const a = await A(page, 'accessible', line);
  expect(a.layer).toBe(true);
  expect(a.pieces.length).toBe(1);
  const [p] = a.pieces;
  expect(p.kind).toBe('paragraph');
  expect(p.parts.find((x: any) => x.type === 'text').text).toMatch(/^Inline/);
  const math = p.parts.filter((x: any) => x.type === 'math');
  expect(math.length).toBe(3);
  expect(math[0].mathml).toMatch(/^<math/);
  expect(math[0].alttext).toBe('x squared plus y squared equals z squared');
  // the whole block: every piece, the display's too
  const all = await A(page, 'accessible', block);
  expect(all.pieces.map((x: any) => x.kind)).toEqual(['paragraph', 'display', 'display', 'paragraph']);
});

test('the Accessibility layer overlay outlines the hidden text on the page', async ({ openPage }) => {
  const page = await openPage('mathml');
  await agent(page);
  await A(page, 'setOptions', { a11y: true });
  await page.waitForTimeout(100);
  const drawn = await page.evaluate(() => ({
    runs: document.querySelectorAll('[data-rtx-inspector] [data-a11y="run"]').length,
    math: document.querySelectorAll('[data-rtx-inspector] [data-a11y="math"]').length,
    pieces: document.querySelectorAll('[data-rtx-inspector] [data-a11y="piece"]').length,
  }));
  expect(drawn.pieces).toBeGreaterThan(3);
  expect(drawn.runs).toBeGreaterThan(5);
  expect(drawn.math).toBeGreaterThan(3);
});

test('the details have an Accessibility tab: a box’s accessible text, with MathML or spelled out', async ({ openPage }) => {
  const page = await openPage('mathml');
  await page.evaluate(() => reflowtex.inspector.open(document.querySelector('.latex-block[data-nodelist-b64]'), { scroll: false }));
  const details = page.locator('[data-rtx-ui] .details');
  const pane = details.locator('.a11y');
  await details.locator('[role="tab"][data-dtab="a11y"]').click();
  await expect(pane).toBeVisible();
  await expect(pane).toContainText('Inline');
  await pane.locator('[data-mode="mathml"]').click();
  await expect(pane.locator('math').first()).toBeAttached();
  expect(await pane.locator('math').count()).toBeGreaterThanOrEqual(5);
  await pane.locator('[data-mode="spoken"]').click();
  await expect(pane).toContainText('x squared plus y squared equals z squared');
  expect(await pane.locator('math').count()).toBe(0);
  // back to the node's own details
  await details.locator('[role="tab"][data-dtab="props"]').click();
  await expect(pane).toBeHidden();
  await expect(details.locator('table')).toBeVisible();
});

// ── Resizing the floating panel ─────────────────────────────────────────────
// Like a macOS window: every edge and corner resizes it, taken anywhere from
// 3 px outside the panel to 3 px inside.
test('the floating panel resizes from every edge and corner', async ({ openPage }) => {
  const page = await openPage('mathml', { width: 1400, height: 900 });
  await page.evaluate(() => { localStorage.clear(); reflowtex.inspector.open(undefined, { dock: 'float', scroll: false }); });
  const panel = page.locator('[data-rtx-ui] .rtx');
  await expect(panel).toBeVisible();
  const box = async () => (await panel.boundingBox())!;
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
  };
  // the left edge, taken 2 px outside: wider, to the left
  let a = await box();
  await drag(a.x - 2, a.y + a.height / 2, -60, 0);
  let b = await box();
  expect(Math.round(b.x - a.x)).toBe(-60);
  expect(Math.round(b.width - a.width)).toBe(60);
  // the top edge, taken 2 px inside: taller, upwards
  a = b;
  await drag(a.x + a.width / 2, a.y + 2, 0, -40);
  b = await box();
  expect(Math.round(b.y - a.y)).toBe(-40);
  expect(Math.round(b.height - a.height)).toBe(40);
  // the bottom right corner: both
  a = b;
  await drag(a.x + a.width + 1, a.y + a.height + 1, -30, -20);
  b = await box();
  expect(Math.round(b.width - a.width)).toBe(-30);
  expect(Math.round(b.height - a.height)).toBe(-20);
  // the cursor says which way
  const cursor = await page.evaluate(() => {
    const root = document.querySelector('[data-rtx-ui]')!.shadowRoot!;
    return [...root.querySelectorAll('.frame [data-edge]')].map(h => [(h as HTMLElement).dataset.edge, getComputedStyle(h).cursor]);
  });
  expect(Object.fromEntries(cursor)).toMatchObject({ n: 'ns-resize', e: 'ew-resize', se: 'nwse-resize', ne: 'nesw-resize' });
});
