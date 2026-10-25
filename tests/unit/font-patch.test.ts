// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/fonts/fonts.ts, patched a few fonts at a time (as the browser
// engine patches them, while blocks bring new code points): a patch removes
// only the earlier versions of the fonts it patches, never another font's
// renamed file, which the page and a dump of the fonts still need. prune()
// is the whole build's clean-up of fonts no longer used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fonts } from '../../src/pipeline/fonts/fonts.ts';
import { kpsewhich } from '../../src/pipeline/fonts/type1.ts';

const REGULAR = 'lmroman10-regular.otf', ITALIC = 'lmroman10-italic.otf';
const have = !!kpsewhich(REGULAR) && !!kpsewhich(ITALIC);
const quiet = () => {};
const req = (file: string, glyphs: number[]) => new Map([[file, new Map(glyphs.map(g => [0xE100 + g, g] as [number, number]))]]);
const renamed = (dir: string, stem: string) => readdirSync(dir).filter(f => f.startsWith(`${stem}.reflowtex-`)).sort();

test('patching one font leaves the renamed files of fonts patched before', { skip: !have && 'Latin Modern OTF not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-font-patch-'));
  try {
    const a = new Fonts(dir);
    a.patch(req(REGULAR, [5, 6]), quiet);
    const regular = a.served.get(REGULAR)!;
    assert.match(regular, /^lmroman10-regular\.reflowtex-[0-9a-f]{8}\.otf$/);

    const b = new Fonts(dir);
    b.patch(req(ITALIC, [5]), quiet);
    assert.deepEqual(renamed(dir, 'lmroman10-regular'), [regular], 'the regular face patched before is still there');
    assert.equal(renamed(dir, 'lmroman10-italic').length, 1);

    // the regular face again, with one more glyph: its earlier version goes, the italic stays
    const c = new Fonts(dir);
    c.patch(req(REGULAR, [5, 6, 7]), quiet);
    const again = c.served.get(REGULAR)!;
    assert.notEqual(again, regular);
    assert.deepEqual(renamed(dir, 'lmroman10-regular'), [again]);
    assert.equal(renamed(dir, 'lmroman10-italic').length, 1);

    // a whole build's clean-up: renamed files of fonts it does not use go
    c.prune([REGULAR]);
    assert.deepEqual(renamed(dir, 'lmroman10-italic'), []);
    assert.deepEqual(renamed(dir, 'lmroman10-regular'), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
