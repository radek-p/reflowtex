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

// The page loaded inspector/inspector.js whether or not it was installed:
// the render tests' pages (site-from-run.ts) and testmath's asked for a
// script that was not there, a 404 on every one of them.
test('the page loads the inspector only where it is installed', () => {
  const o = { title: 't', blocks: [], fontMap: {}, sourceUrl: 'https://example.org/src', fontsBase: 'fonts/' };
  assert.ok(renderPage({ ...o, inspector: true }).includes('<script src="inspector/inspector.js">'));
  assert.ok(!renderPage(o).includes('inspector/inspector.js"'), 'no inspector: no script tag for it');
});

// The viewer's log is configured by a JSON island (#latex-log-config), which
// the page has only when the build was given a configuration, and then with
// only what was given: the viewer has its defaults for the rest.
test('the page carries the viewer\'s log configuration only when given one', () => {
  const o = { title: 't', blocks: [], fontMap: {}, sourceUrl: 'https://example.org/src', fontsBase: 'fonts/' };
  const island = (page: string) => {
    const m = /<script id="latex-log-config" type="application\/json">(.*?)<\/script>/.exec(page);
    return m ? JSON.parse(m[1]) : null;
  };
  assert.ok(!renderPage(o).includes('id="latex-log-config"'), 'none without a configuration');
  assert.deepEqual(island(renderPage({ ...o, log: { alert: 'warning', show: ['error', 'missing-char'] } })),
    { alert: 'warning', show: ['error', 'missing-char'] });
  assert.deepEqual(island(renderPage({ ...o, log: { alert: 'none' } })), { alert: 'none' });
  assert.deepEqual(island(renderPage({ ...o, log: { show: [] } })), { show: [] }, 'an empty list shows nothing: it is kept');
  // after the font map, and nothing in it can end its script element
  const page = renderPage({ ...o, log: { show: ['</script><b>'] } });
  assert.ok(page.indexOf('id="latex-log-config"') > page.indexOf('id="latex-font-map"'));
  assert.ok(!page.includes('</script><b>'));
  assert.deepEqual(island(page), { show: ['</script><b>'] });
});
