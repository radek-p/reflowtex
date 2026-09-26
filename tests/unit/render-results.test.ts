// SPDX-License-Identifier: AGPL-3.0-or-later
// The render report's index (tests/render/report/results.ts): every
// result.json under build/, in the order the suite runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIndex, writeResult } from '../../tests/render/report/results.ts';

test('the index lists every result, cases in suite order, own width first', () => {
  const build = mkdtempSync(join(tmpdir(), 'rtx-report-'));
  try {
    const put = (name: string, extra: number, status: 'pass' | 'fail') => {
      const dir = join(build, name, extra ? `w${extra > 0 ? '+' : ''}${extra}` : 'w0');
      mkdirSync(dir, { recursive: true });
      writeResult(dir, { id: `${name}@${extra}`, case: name, extra, status, problems: [], tolerance: 0.05, target: 0.05 }, build);
    };
    put('zeta', 85, 'pass'); put('zeta', 0, 'fail'); put('zeta', -100, 'pass'); put('alpha', 0, 'pass');
    mkdirSync(join(build, 'zeta', 'site-run'));           // not a width: left out
    const results = writeIndex(build, ['zeta', 'alpha']);
    assert.deepEqual(results.map(r => r.id), ['zeta@0', 'zeta@-100', 'zeta@85', 'alpha@0']);
    assert.equal(results[0].dir, 'zeta/w0');
    assert.deepEqual(JSON.parse(readFileSync(join(build, 'report.json'), 'utf8')).results.map((r: { id: string }) => r.id), results.map(r => r.id));
  } finally { rmSync(build, { recursive: true, force: true }); }
});
