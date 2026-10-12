// SPDX-License-Identifier: AGPL-3.0-or-later
// The image's lualatex wrapper (docker/lualatex-autoinstall.sh), with a
// lualatex and a tlmgr of the test's own: a missing package is installed and
// the run tried again – unless REFLOWTEX_NO_AUTOINSTALL is set, as the tests
// set it, when it fails at once, naming the list the package belongs in, and
// asks tlmgr nothing. (The render tests' nicematrix once came from a CTAN
// mirror while they ran, and the mirror failed.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRAPPER = fileURLToPath(new URL('../../docker/lualatex-autoinstall.sh', import.meta.url));

function run(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-autoinstall-'));
  const script = (name: string, body: string) => { writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`); chmodSync(join(dir, name), 0o755); };
  // lualatex: fails for want of nicematrix.sty until tlmgr has "installed" it
  script('lualatex', `if [ -f "${dir}/installed" ]; then exit 0; fi
printf '%s\\n' "! LaTeX Error: File \\\`nicematrix.sty' not found." > doc.log; exit 1`);
  script('tlmgr', `echo "$*" >> "${dir}/tlmgr-calls"
case "$1" in
  search) printf 'nicematrix:\\n\\ttexmf-dist/tex/latex/nicematrix/nicematrix.sty\\n' ;;
  install) touch "${dir}/installed" ;;
esac`);
  script('kpsewhich', `[ -f "${dir}/installed" ]`);
  const r = spawnSync('bash', [WRAPPER, 'doc.tex'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REFLOWTEX_REAL_LUALATEX: join(dir, 'lualatex'), ...env },
  });
  const calls = existsSync(join(dir, 'tlmgr-calls')) ? readFileSync(join(dir, 'tlmgr-calls'), 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stderr: r.stderr, calls };
}

test('off: a missing package fails at once, naming the list, and tlmgr is not asked', () => {
  const r = run({ REFLOWTEX_NO_AUTOINSTALL: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /'nicematrix\.sty' is missing, and installing on demand is off/);
  assert.match(r.stderr, /docker\/test-packages\.txt/);
  assert.equal(r.calls, '');
});

test('on: the package is installed, the run tried again, and the install logged when asked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-autoinstall-log-'));
  const logFile = join(dir, 'installs.log');
  try {
    const r = run({ REFLOWTEX_NO_AUTOINSTALL: '0', REFLOWTEX_AUTOINSTALL_LOG: logFile });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.calls, /^install nicematrix$/m);
    assert.equal(readFileSync(logFile, 'utf8'), 'nicematrix nicematrix.sty\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
