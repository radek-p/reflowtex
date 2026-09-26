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
  expect(m.used.length).toBe(1);
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
  expect(await page.locator('[data-rtx-ui] .colours .cgrid input[type="color"]').count()).toBeGreaterThan(1);
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
    const [pick, field] = [c.querySelector('input[type="color"]')!, c.querySelector('input[type="text"]')!].map(e => e.getBoundingClientRect());
    return { h: c.getBoundingClientRect().height, beside: pick.right <= field.left + 1, border: getComputedStyle(c).borderTopWidth };
  });
  expect(r.h).toBeLessThan(28);
  expect(r.beside).toBe(true);
  expect(r.border).toBe('0px');
});
