// SPDX-License-Identifier: AGPL-3.0-or-later
// A lualatex killed part-way (a container's memory limit, on a long document)
// must not pass for a finished run. Here a lualatex of the test's own writes a
// complete output.json in its first pass and is killed in its second: the
// first pass's file must not be returned as the run's, nor be left behind for
// a later reader, and the failure says the run was killed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLuaLatex } from '../../src/pipeline/lualatex.ts';

test('a pass killed by a signal: no output.json, and the failure names the signal', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'rtx-killed-bin-')), dir = mkdtempSync(join(tmpdir(), 'rtx-killed-'));
  writeFileSync(join(bin, 'lualatex'), `#!/bin/sh
if [ -f pass1 ]; then kill -9 $$; fi
touch pass1
echo 'This is a log.' > input.log
echo '{"source_width": 1, "content": [], "paragraphs": [], "streams": [], "fonts": []}' > output.json
`);
  chmodSync(join(bin, 'lualatex'), 0o755);
  writeFileSync(join(dir, 'input.tex'), '');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await assert.rejects(runLuaLatex(dir, { texinputs: [], passes: 2, settle: false, block: 'killed' }), /killed by SIGKILL/);
    assert.equal(existsSync(join(dir, 'output.json')), false);
  } finally {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
