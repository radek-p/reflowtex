// SPDX-License-Identifier: AGPL-3.0-or-later
// The website's own CSS against the page as the viewer leaves it. Each block
// has its accessible layer (.latex-a11y) just before it, so two blocks are no
// longer siblings side by side: a rule for "a block right after a block" has
// to allow for the layer between them. The home page's split cards lost their
// hairline and spacing that way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEAD = fileURLToPath(new URL('../../website/layouts/partials/head.html', import.meta.url));

test('a rule for a block after a block also takes the one with its layer between', () => {
  const css = readFileSync(HEAD, 'utf8');
  const adjacent = [...css.matchAll(/([^{}\n,]*)\.latex-block\s*\+\s*\.latex-block/g)].map(m => m[1].trim());
  assert.ok(adjacent.length > 0, 'the site has such rules');
  for (const scope of adjacent) {
    const withLayer = `${scope} .latex-block + .latex-a11y + .latex-block`.replace(/\s+/g, ' ').trim();
    assert.ok(css.replace(/\s+/g, ' ').includes(withLayer), `"${scope} .latex-block + .latex-block" has no "${withLayer}"`);
  }
});
