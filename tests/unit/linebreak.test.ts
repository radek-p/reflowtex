// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's line breaker against LuaTeX's, paragraph by paragraph: each
// fixture in tests/linebreak/<set>/ (capture.lua's par-NNNN.txt) replayed
// through it must come out byte for byte as TeX set it (par-NNNN.expected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { replay } from '../linebreak/replay.ts';

const ROOT = new URL('../linebreak/', import.meta.url).pathname;
const sets = readdirSync(ROOT).filter(d => statSync(join(ROOT, d)).isDirectory());

for (const set of sets) {
  const dir = join(ROOT, set);
  for (const f of readdirSync(dir).filter(f => /^par-\d+\.txt$/.test(f)).sort()) {
    const input = readFileSync(join(dir, f), 'utf8');
    const expected = readFileSync(join(dir, f.replace(/\.txt$/, '.expected')), 'utf8');
    test(`${set}/${f.replace(/\.txt$/, '')}`, () => {
      assert.equal(replay(input), expected);
    });
  }
}
