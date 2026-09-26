// SPDX-License-Identifier: AGPL-3.0-or-later
// Every Type 1 face in TeX Live's pdftex.map, converted by type1.ts, against
// t1_convert.py's conversion (t1_sweep.py writes it): the same addressing,
// and every code point drawn the same. Slow: it runs when build/t1-sweep/
// holds the Python side (REFLOWTEX_PYTHON=… .venv/bin/python3
// tests/parity/t1_sweep.py build/t1-sweep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findOutline, convertOutline } from '../../src/pipeline/fonts/type1.ts';
import { sameDrawing } from './font-compare.ts';
import { REPO } from './helpers.ts';

const dir = join(REPO, 'build/t1-sweep');
const manifestPath = join(dir, 'manifest.json');

test('Type 1 sweep: every face in pdftex.map', { skip: existsSync(manifestPath) ? false : 'no sweep (tests/parity/t1_sweep.py)' }, () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, null | { pfb: string; served?: string; addressing?: Record<string, number>; error?: string }>;
  let same = 0, bothFail = 0;
  const differ: string[] = [];
  for (const [name, py] of Object.entries(manifest)) {
    const found = findOutline(name);
    if (!py) { if (found) differ.push(`${name}: no outline for Python, one for us`); continue; }
    let ts: ReturnType<typeof convertOutline> | null = null, err = '';
    try { ts = convertOutline(found![0], name, found![1]); } catch (e) { err = (e as Error).message; }
    if (py.error || !ts) {
      if (py.error && !ts) bothFail++;
      else differ.push(`${name}: py ${py.error ?? 'ok'} / ts ${err || 'ok'}`);
      continue;
    }
    try {
      assert.deepEqual(Object.fromEntries([...ts.addressing].map(([k, v]) => [String(k), v])), py.addressing, 'addressing');
      sameDrawing(readFileSync(join(dir, py.served!)), ts.bytes, name);
      same++;
    } catch (e) { differ.push(`${name}: ${(e as Error).message.split('\n')[0]}`); }
  }
  console.log(`  ${same} face(s) identical, ${bothFail} rejected by both, ${differ.length} different`);
  if (differ.length) console.log(differ.slice(0, 20).join('\n'));
  assert.deepEqual(differ, []);
});
