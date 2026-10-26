// SPDX-License-Identifier: AGPL-3.0-or-later
// The page's log (src/viewer/README.md, The log): the warnings a block's data
// carries from the build, and the viewer's own records; the inspector's Log
// tab, which lists them all; the alerted level, which decides what reaches
// the console; and what readers are shown, by code or level.
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';
import type { LogRecord } from '../../src/shared/log.ts';

/** A script for openPage's `init`: the page's #latex-log-config island, as an
 *  integration writes it, in place before the viewer sets up its blocks. */
const config = (c: Record<string, unknown>) => `document.addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('script');
  s.type = 'application/json'; s.id = 'latex-log-config'; s.textContent = ${JSON.stringify(JSON.stringify(c))};
  document.head.appendChild(s);
});`;

/** Open the inspector and wait for its page agent (its promise awaited in the page). */
async function agent(page: WebPage) {
  await page.evaluate(async () => { await reflowtex.inspector.open(undefined, { scroll: false }); });
  await page.waitForFunction(() => window.__rtxInspector && window.__rtxInspector.logs);
}
const viewerLines = (page: WebPage) => {
  const lines: string[] = [];
  page.on('console', m => { if (m.text().startsWith('[latex-viewer]')) lines.push(`${m.type()}: ${m.text()}`); });
  return lines;
};

// The glyph-text page has a block set in a font with no face (drawn as
// boxes): the build writes a warning into that block's data.
test("a block's warnings from the build are in the page's log, and nothing of them on the page", async ({ openPage }) => {
  const page = await openPage('glyph-text');
  const r = await page.evaluate(() => ({
    records: reflowtex.host.log.records().map((r: LogRecord) => ({ level: r.level, code: r.code, source: r.source, block: r.block, details: r.details, message: r.message })),
    keys: reflowtex.host.blocks().map((b: { key: string }) => b.key),
    alert: reflowtex.host.log.alertLevel(), shown: reflowtex.host.log.shown(),
  }));
  const w = r.records.find((x: { code: string }) => x.code === 'font-without-face');
  expect(w, JSON.stringify(r.records)).toBeTruthy();
  expect(w!.level).toBe('warning');
  expect(w!.source).toBe('pipeline');
  expect(r.keys).toContain(w!.block);
  expect(w!.details.font).toBe('rtxnoface10');
  expect(w!.message).toMatch(/has no face/);
  expect(r.alert).toBe('error');
  expect(r.shown).toEqual(['font-load-failed']);
  // only in the log: no notice, and the block is drawn as before
  expect(await page.locator('.latex-notice').count()).toBe(0);
});

test('the Log tab lists every record, filters them by level, code and text, and counts them on its tab', async ({ openPage }) => {
  const page = await openPage('glyph-text');
  await page.evaluate(() => {
    const { log } = reflowtex.host;
    log.report('info', 'test-note', 'a note from the page', { id: 'n1' });
    log.report('warning', 'test-warn', 'a warning from the page');
    log.report('debug', 'test-debug', 'a debug line');
  });
  await agent(page);
  const ui = page.locator('[data-rtx-ui]');
  const total = await page.evaluate(() => reflowtex.host.log.records().length);
  expect(total).toBeGreaterThanOrEqual(4);
  await expect(ui.locator('[role="tab"][data-view="log"] .badge')).toHaveText(String(total));
  await ui.locator('[role="tab"][data-view="log"]').click();
  const rows = ui.locator('.logs .lrow');
  await expect(rows).toHaveCount(total);
  // newest last
  await expect(rows.last()).toHaveAttribute('data-code', 'test-debug');
  // a record logged while the tab is open joins it, and the count follows
  await page.evaluate(() => { reflowtex.host.log.report('info', 'test-late', 'logged later'); });
  await expect(rows).toHaveCount(total + 1);
  await expect(ui.locator('[role="tab"][data-view="log"] .badge')).toHaveText(String(total + 1));
  // by text: in the message, the code or a particular
  const filter = ui.locator('.logs input.filter');
  await filter.fill('rtxnoface10');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-code', 'font-without-face');
  await filter.fill('n1');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-code', 'test-note');
  await filter.fill('');
  // by code
  await ui.locator('.logs select.lcodes').selectOption('test-warn');
  await expect(rows).toHaveCount(1);
  await ui.locator('.logs select.lcodes').selectOption('');
  await expect(rows).toHaveCount(total + 1);
  // by level: warnings alone (Alt-click), then debug as well
  await ui.locator('.logs .lvlbtn[data-level="warning"]').click({ modifiers: ['Alt'] });
  await expect(rows).toHaveCount(await page.evaluate(() => reflowtex.host.log.records().filter((r: LogRecord) => r.level === 'warning').length));
  for (const code of await rows.evaluateAll(els => els.map(e => e.getAttribute('data-level')))) expect(code).toBe('warning');
  await ui.locator('.logs .lvlbtn[data-level="debug"]').click();
  await expect(rows).toHaveCount(await page.evaluate(() => reflowtex.host.log.records().filter((r: LogRecord) => r.level === 'warning' || r.level === 'debug').length));
  await expect(ui.locator('.logs .lvlbtn[data-level="info"]')).toHaveAttribute('aria-pressed', 'false');
  await ui.locator('.logs button', { hasText: 'Clear filter' }).click();
  await expect(rows).toHaveCount(total + 1);
  // a record's block: Show block selects that block's row in the Boxes view
  const withBlock = rows.filter({ has: page.locator('.lblock') }).first();
  const key = await withBlock.getAttribute('data-block');
  await withBlock.locator('.lblock').click();
  await expect(ui.locator('[role="tab"][data-view="tree"]')).toHaveAttribute('aria-selected', 'true');
  await expect(ui.locator('.tree .row.sel')).toHaveCount(1);
  const [path, blocks] = await page.evaluate(k => [window.__rtxInspector!.logBlock(k), window.__rtxInspector!.blocks().map(b => b.id)], key!);
  expect(blocks).toContain(path![0]);
  expect(await ui.locator('.tree .row.sel').getAttribute('data-id')).toBe(String(path![0]));
  // nothing was drawn on the page for a record
  expect(await page.locator('.latex-notice').count()).toBe(0);
});

test('the alerted level decides what reaches the console and the reflowtex:log event', async ({ openPage }) => {
  const page = await openPage('glyph-text');
  const lines = viewerLines(page);
  const sent = () => page.evaluate(() => (window as unknown as { sent: string[] }).sent);
  await page.evaluate(() => {
    (window as unknown as { sent: string[] }).sent = [];
    document.addEventListener('reflowtex:log', e => (window as unknown as { sent: string[] }).sent.push((e as CustomEvent<{ record: LogRecord }>).detail.record.code));
  });
  const report = (level: string, code: string) => page.evaluate(([level, code]) => {
    reflowtex.host.log.report(level as 'info', code, `the page's ${code}`);
  }, [level, code]);
  // by default (error): a warning is only in the log
  await report('warning', 'w-default');
  await report('info', 'i-default');
  expect(lines).toEqual([]);
  expect(await sent()).toEqual([]);
  // at warning: warnings and errors
  await page.evaluate(() => reflowtex.host.log.setAlertLevel('warning'));
  await report('warning', 'w-warning');
  await report('info', 'i-warning');
  await expect.poll(() => lines.length).toBe(1);
  expect(lines[0]).toBe("warning: [latex-viewer] the page's w-warning");
  expect(await sent()).toEqual(['w-warning']);
  // none: not even an error
  await page.evaluate(() => reflowtex.host.log.setAlertLevel('none'));
  await report('error', 'e-none');
  // back to the page's own (error): an error is written as one
  await page.evaluate(() => reflowtex.host.log.setAlertLevel(null));
  expect(await page.evaluate(() => reflowtex.host.log.alertLevel())).toBe('error');
  await report('error', 'e-default');
  await expect.poll(() => lines.length).toBe(2);
  expect(lines[1]).toBe("error: [latex-viewer] the page's e-default");
  expect(await sent()).toEqual(['w-warning', 'e-default']);
  // every record is in the log all the same
  expect(await page.evaluate(() => reflowtex.host.log.records().filter((r: LogRecord) => r.source === 'page').map((r: LogRecord) => r.code)))
    .toEqual(['w-default', 'i-default', 'w-warning', 'i-warning', 'e-none', 'e-default']);
  page.errors.length = 0;                       // (the warning and the error were the point)
  await expect(page.evaluate(() => reflowtex.host.log.setAlertLevel('loud' as 'none'))).rejects.toThrow(/alert level/);
});

test("the page's configuration sets the alerted level: the build's warning reaches the console at 'warning'", async ({ openPage }) => {
  const page = await openPage('glyph-text', { init: config({ alert: 'warning' }) });
  expect(await page.evaluate(() => reflowtex.host.log.alertLevel())).toBe('warning');
  expect(page.errors.some(e => e.startsWith('console.warning: [latex-viewer] font rtxnoface10 has no face')), page.errors.join('\n')).toBe(true);
  page.errors.length = 0;
});

// ── What readers are shown ──────────────────────────────────────────────────

const noFonts: [string, (r: import('@playwright/test').Route) => unknown] = ['**/*.otf', r => r.fulfill({ status: 404 })];

test('fonts that fail to download are shown to readers by default', async ({ openPage }) => {
  const page = await openPage('notes', { route: noFonts });
  page.errors.length = 0;                               // the 404s are the point here
  const bar = page.locator('.latex-notice');
  await bar.waitFor({ state: 'visible' });
  await expect(bar.locator('p[data-code="font-load-failed"]')).toContainText(/Some fonts could not be downloaded \(.*(lmroman|cm)/);
  const r = await page.evaluate(() => reflowtex.host.log.records().filter((r: LogRecord) => r.code === 'font-load-failed').map((r: LogRecord) => [r.level, r.details.fonts]));
  expect(r.length).toBeGreaterThan(0);
  expect(r[0][0]).toBe('error');
});

test('fonts that fail are not shown when the page shows nothing', async ({ openPage }) => {
  const page = await openPage('notes', { route: noFonts, init: config({ show: [] }) });
  page.errors.length = 0;
  await expect.poll(() => page.evaluate(() => reflowtex.host.log.records().some((r: LogRecord) => r.code === 'font-load-failed'))).toBe(true);
  await idle(page);
  expect(await page.locator('.latex-notice').count()).toBe(0);
  page.errors.length = 0;
});

test('another kind is shown when the page shows it: by its code, or by its level', async ({ openPage }) => {
  const page = await openPage('glyph-text', { init: config({ show: ['font-load-failed', 'font-without-face'] }) });
  const bar = page.locator('.latex-notice');
  await bar.waitFor({ state: 'visible' });
  await expect(bar.locator('p[data-code="font-without-face"]')).toContainText('font rtxnoface10 has no face');
  await bar.locator('[data-act="close"]').click();
  expect(await bar.isVisible()).toBe(false);
  // by level, set by the page's script: an error of any kind
  await page.evaluate(() => { reflowtex.host.log.setShown(['error']); reflowtex.host.log.report('error', 'test-error', 'the page broke'); });
  await expect(bar).toBeVisible();
  await expect(bar.locator('p[data-code="test-error"]')).toHaveText('the page broke');
  page.errors.length = 0;                       // (the error was the point)
});
