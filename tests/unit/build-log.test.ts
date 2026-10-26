// SPDX-License-Identifier: AGPL-3.0-or-later
// A build's log (consoleLog, src/shared/log.ts): every message of the
// pipeline and the integrations is a record with a level and a code, and the
// console shows it as the build has always printed it – the record's message
// as one line, an error on stderr, the rest on stdout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleLog } from '../../src/shared/log.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

test('a build log prints each record\'s message as its line: errors on stderr, the rest on stdout, debug only when asked', t => {
  const out: string[] = [], err: string[] = [];
  t.mock.method(console, 'log', (s: string) => { out.push(s); });
  t.mock.method(console, 'error', (s: string) => { err.push(s); });
  const log = consoleLog();
  log.info('block-compiled', '  a.tex (0123): done (12 bytes)', { name: 'a.tex' });
  log.warn('font-not-found', '  font-provision: WARNING – x.otf not found');
  log.error('block-failed', 'ERROR: b.tex:\nwhy');
  log.debug('detail', 'not printed');
  consoleLog({ debug: true }).debug('detail', 'printed');
  assert.deepEqual(out, ['  a.tex (0123): done (12 bytes)', '  font-provision: WARNING – x.otf not found', 'printed']);
  assert.deepEqual(err, ['ERROR: b.tex:\nwhy']);
  assert.deepEqual(log.records().map(r => [r.level, r.code, r.source]),
    [['info', 'block-compiled', 'pipeline'], ['warning', 'font-not-found', 'pipeline'], ['error', 'block-failed', 'pipeline'], ['debug', 'detail', 'pipeline']]);
});

test('the vanilla build refuses a --log-alert that is not a level, before compiling anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-vanilla-log-'));
  try {
    assert.throws(() => execFileSync('node', [join(REPO, 'integrations/vanilla/build.ts'), dir, '-o', join(dir, 'site'), '--log-alert', 'loud'], { stdio: 'pipe' }),
      (e: Error & { status?: number; stderr?: Buffer; stdout?: Buffer }) =>
        e.status === 2 && /^error: --log-alert is one of none, error, warning, info, debug, not "loud"\n$/.test(String(e.stderr)) && String(e.stdout) === '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
