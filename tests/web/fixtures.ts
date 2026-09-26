// SPDX-License-Identifier: AGPL-3.0-or-later
// The tests' `openPage`, and `test` and `expect` to write them with.
//
// openPage(name, { width = 1200, height = 900, theme, route, ...context })
// loads a fixture page and waits until every block is drawn and its fonts have
// loaded (then puts `theme` on <html>, if given); `context` goes to the
// browser context (colorScheme, …). Every test runs in Chromium and in WebKit
// (Safari's engine: the two projects of playwright.config.ts). Besides errors,
// the viewer must stay quiet: a log, info or warning line of its own
// ("[latex-viewer] …") fails the test too. Anything the page reports as an
// error – an uncaught exception, a console.error, a request that failed or
// answered 4xx/5xx – is collected in page.errors, and fails the test at its
// end (a test that expects some clears the list).
import { test as base, expect, type BrowserContextOptions, type Page, type Route } from '@playwright/test';
import { READY } from './web.ts';

export type WebPage = Page & { errors: string[] };
export interface OpenOptions extends BrowserContextOptions {
  width?: number; height?: number; theme?: string;
  route?: [string, (route: Route) => unknown];
}

export const test = base.extend<{ openPage: (name: string, o?: OpenOptions) => Promise<WebPage> }>({
  openPage: async ({ browser }, use) => {
    const opened: WebPage[] = [];
    await use(async (name, { width = 1200, height = 900, theme, route, ...context } = {}) => {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...context });
      if (route) await ctx.route(...route);
      const page = Object.assign(await ctx.newPage(), { errors: [] as string[] });
      page.on('pageerror', e => page.errors.push(`uncaught: ${e}`));
      page.on('console', m => {
        if (m.type() === 'error' || (['log', 'info', 'warning'].includes(m.type()) && m.text().startsWith('[latex-viewer]')))
          page.errors.push(`console.${m.type()}: ${m.text()}`);
      });
      page.on('requestfailed', r => page.errors.push(`request failed: ${r.url()}`));
      page.on('response', r => { if (r.status() >= 400) page.errors.push(`${r.status()}: ${r.url()}`); });
      opened.push(page);
      await page.goto(name.includes('://') ? name : pageUrl(name));
      await page.waitForFunction(READY, undefined, { timeout: 20000 });
      // The viewer draws every block again once its web fonts have loaded
      // (rerenderBlock): let that happen before a test interacts.
      await page.evaluate(() => document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)))));
      if (theme) {
        // As a site's theme switch does: a class on <html> (dark, sepia, contrast).
        await page.evaluate(t => document.documentElement.classList.add(t), theme);
        await page.waitForTimeout(100);
      }
      return page;
    });
    const errors = opened.flatMap(p => p.errors);
    for (const p of opened) await p.context().close();
    expect(errors, `the page reported errors:\n  ${errors.join('\n  ')}`).toEqual([]);
  },
});
export { expect };

/** A fixture page's URL; `hugo/<path>/` is a page of the Hugo site. */
export function pageUrl(name: string): string {
  const root = process.env.REFLOWTEX_WEB_URL;
  if (!root) throw new Error('REFLOWTEX_WEB_URL is not set: run the tests through playwright.config.ts');
  return name.startsWith('hugo/') ? `${root}/${name}` : `${root}/${name}/index.html`;
}
