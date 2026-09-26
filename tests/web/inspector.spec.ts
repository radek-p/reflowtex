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
