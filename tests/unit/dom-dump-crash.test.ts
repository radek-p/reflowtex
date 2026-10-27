// SPDX-License-Identifier: AGPL-3.0-or-later
// tools/pageless-pdf/dom-dump.ts when Chromium's page crashes (its renderer
// out of memory on a very tall page): the reading ends at once, is tried once
// more in a fresh browser, and a second crash is an error that says so. The
// crash is real: the renderer is crashed through the DevTools protocol while a
// call waits on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { PageCrashed, onceMoreIfCrashed, withPage } from '../../tools/pageless-pdf/dom-dump.ts';

const VIEWPORT = { width: 400, height: 300 };

/** a call that would wait for ever, and the renderer crashed under it */
async function crashWhileWaiting(page: Page): Promise<never> {
  await page.setContent('<p>a page</p>');
  const waiting = page.evaluate(() => new Promise<never>(() => {}));
  const cdp = await page.context().newCDPSession(page);
  cdp.send('Page.crash').catch(() => {});
  return waiting;
}

test('a crash ends the call waiting on the page at once', { timeout: 60000 }, async () => {
  const t0 = Date.now();
  await assert.rejects(withPage(VIEWPORT, crashWhileWaiting), PageCrashed);
  assert.ok(Date.now() - t0 < 30000, `took ${Date.now() - t0} ms`);
});

test('a crash is tried once more, in a fresh browser', { timeout: 120000 }, async () => {
  const logs: string[] = [];
  let attempts = 0;
  const text = await onceMoreIfCrashed('reading', () => withPage(VIEWPORT, async page => {
    if (++attempts === 1) return crashWhileWaiting(page);
    await page.setContent('<p>read</p>');
    return page.textContent('p');
  }), s => logs.push(s));
  assert.equal(text, 'read');
  assert.equal(attempts, 2);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^reading: .*crash.*; once more, in a fresh browser$/);
});

test('a second crash is an error that says so; other errors are not tried again', { timeout: 120000 }, async () => {
  let attempts = 0;
  await assert.rejects(onceMoreIfCrashed('reading', () => { attempts++; return withPage(VIEWPORT, crashWhileWaiting); }, () => {}),
    /^Error: reading: Chromium crashed twice \(.*\); the page may be too large for the memory it has$/);
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(onceMoreIfCrashed('reading', async () => { attempts++; throw new Error('not a crash'); }, () => {}), /^Error: not a crash$/);
  assert.equal(attempts, 1);
});
