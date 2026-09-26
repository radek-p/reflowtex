// SPDX-License-Identifier: AGPL-3.0-or-later
// The vanilla page (integrations/vanilla/page.ts): every placeholder filled.
// The title is used twice, and only the first was: every vanilla page, and
// the render report's live page, showed a heading reading {{TITLE}}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../integrations/vanilla/page.ts';

test('every placeholder of the page is filled, each wherever it is used', () => {
  const page = renderPage({ title: 'A <title>', blocks: ['<div class="latex-block">{{TITLE}} stays</div>'], fontMap: {},
    sourceUrl: 'https://example.org/src', fontsBase: 'fonts/' });
  assert.deepEqual(page.match(/\{\{[A-Z_0-9-]+\}\}/g), ['{{TITLE}}'], 'none left but the one in a block\'s own text');
  assert.equal(page.split('A &lt;title&gt;').length - 1, 2, 'the title in <title> and in the heading');
  assert.equal(page.split('https://example.org/src').length - 1, 2);
});
