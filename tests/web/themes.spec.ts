// SPDX-License-Identifier: AGPL-3.0-or-later
// Themes: the typeset text follows the page's colour scheme.
import { test, expect, type WebPage } from './fixtures.ts';

const fill = (page: WebPage) => page.locator('.latex-block svg text tspan').first().evaluate(t => getComputedStyle(t).fill);

test('dark changes the ink', async ({ openPage }) => {
  const light = await fill(await openPage('notes'));
  const dark = await fill(await openPage('notes', { theme: 'dark' }));
  expect(light).not.toBe(dark);
});
