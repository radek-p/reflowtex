// SPDX-License-Identifier: AGPL-3.0-or-later
// TeX never reads a terminal (src/pipeline/lualatex.ts): lualatex runs with
// stdin at end of file, so a document in \errorstopmode cannot make it wait
// for an answer. A lualatex of the test's own reads one line from its stdin,
// waiting at most five seconds, and says what it found: end of file at once,
// or nothing within the time (stdin left open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLuaLatex } from '../../src/pipeline/lualatex.ts';

test('lualatex runs with stdin at end of file: nothing waits for an answer', { timeout: 30_000 }, async () => {
  const bin = mkdtempSync(join(tmpdir(), 'rtx-stdin-bin-')), dir = mkdtempSync(join(tmpdir(), 'rtx-stdin-'));
  writeFileSync(join(bin, 'lualatex'), `#!/usr/bin/env bash
if read -r -t 5 line; then echo line > stdin; elif [ $? -gt 128 ]; then echo open > stdin; else echo eof > stdin; fi
echo 'This is a log.' > input.log
echo '{"source_width": 1, "content": [], "paragraphs": [], "streams": [], "fonts": []}' > output.json
`);
  chmodSync(join(bin, 'lualatex'), 0o755);
  writeFileSync(join(dir, 'input.tex'), '');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await runLuaLatex(dir, { texinputs: [], passes: 1, block: 'stdin' });
    assert.equal(readFileSync(join(dir, 'stdin'), 'utf8').trim(), 'eof');
  } finally {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
