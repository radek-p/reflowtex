// SPDX-License-Identifier: AGPL-3.0-or-later
// Every Type 1 outline in TeX Live's pdftex.map (through the first face that
// uses it), converted by type1.ts, against t1_convert.py's conversion
// (t1_sweep.py writes it): the same addressing, and every code point drawn the
// same. Slow: it runs when build/t1-sweep/ holds the Python side
// (.venv/bin/python3 tests/parity/t1_sweep.py build/t1-sweep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findOutline, convertOutline } from '../../src/pipeline/fonts/type1.ts';
import { sameDrawing } from './font-compare.ts';
import { REPO } from './helpers.ts';

const dir = join(REPO, 'build/t1-sweep');
const manifestPath = join(dir, 'manifest.jsonl');

test('Type 1 sweep: every face in pdftex.map', { skip: existsSync(manifestPath) ? false : 'no sweep (tests/parity/t1_sweep.py)' }, () => {
  type Row = { name: string; outline?: null; pfb?: string; served?: string; addressing?: Record<string, number>; error?: string };
  const rows = readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Row);
  let same = 0, bothFail = 0;
  const differ: string[] = [];
  for (const py of rows) {
    const name = py.name;
    const found = findOutline(name);
    if (py.outline === null) { if (found) differ.push(`${name}: no outline for Python, one for us`); continue; }
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
