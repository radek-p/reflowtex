// SPDX-License-Identifier: AGPL-3.0-or-later
// The browser's scripts are built where they are needed (src/pipeline/
// bundles.ts), never committed: none is tracked, a missing or stale one is
// built again, and a site gets the built files, not their sources. (A stale
// committed companion.js once made a web test look like a code bug, and a
// stale latex-viewer.js failed CI after a push.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleFiles, ensureBundles } from '../../src/pipeline/bundles.ts';
import { installViewer } from '../../src/pipeline/site.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

test('no generated file is tracked by git', () => {
  const files = bundleFiles();
  assert.ok(files.includes('src/viewer/latex-viewer.js') && files.includes('src/viewer/latex-viewer.min.js'));
  assert.ok(files.includes('src/companion/companion.js') && files.includes('src/inspector/panel/app.js'));
  // (a checkout without git, a release's source archive: nothing to ask)
  let tracked: string[];
  try { tracked = execFileSync('git', ['ls-files', '--', 'src/viewer', 'src/companion', 'src/inspector'], { cwd: REPO, encoding: 'utf8' }).split('\n'); }
  catch { return; }
  assert.deepEqual(tracked.filter(f => files.includes(f) || f.startsWith('src/inspector/panel/')), []);
  // and none would be added by mistake
  const ignored = execFileSync('git', ['check-ignore', '--no-index', ...files], { cwd: REPO, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(ignored.sort(), [...files].sort());
});

test('a bundle missing or built from other sources is built again; one up to date is not', () => {
  ensureBundles({ log: () => {} });
  assert.deepEqual(ensureBundles({ log: () => {} }), [], 'all up to date');
  const viewer = join(REPO, 'src/viewer/latex-viewer.js');
  // one built from other sources: its header's stamp does not match
  writeFileSync(viewer, readFileSync(viewer, 'utf8').replace(/sources sha256 [0-9a-f]+/, 'sources sha256 0'));
  assert.deepEqual(ensureBundles({ log: () => {} }), ['viewer']);
  // a newer file is no reason: what counts is what it was built from
  const t = new Date(Date.now() + 60000);
  utimesSync(join(REPO, 'src/viewer/src/index.ts'), statSync(join(REPO, 'src/viewer/src/index.ts')).atime, t);
  assert.deepEqual(ensureBundles({ log: () => {} }), []);
  rmSync(join(REPO, 'src/companion/companion.js'));
  assert.deepEqual(ensureBundles({ log: () => {} }), ['companion']);
  assert.match(readFileSync(viewer, 'utf8').split('\n')[1], /version \S+; sources sha256 [0-9a-f]{64}/);
});

test('a site gets the inspector as built, not its sources', () => {
  const out = mkdtempSync(join(tmpdir(), 'rtx-install-'));
  try {
    installViewer(out, { inspector: true, log: () => {} });
    for (const f of ['latex-viewer.js', 'protobuf.min.js', 'companion/companion.js', 'inspector/inspector.js', 'inspector/agent.js',
                     'inspector/inspector.css', 'inspector/panel/app.js', 'inspector/vendor/preact.js'])
      assert.ok(existsSync(join(out, f)), f);
    for (const f of ['src', 'README.md'])
      assert.ok(!existsSync(join(out, 'inspector', f)), `${f} is not shipped`);
    // the viewer shipped is the minified one, under the bundle's name
    assert.equal(readFileSync(join(out, 'latex-viewer.js'), 'utf8'), readFileSync(join(REPO, 'src/viewer/latex-viewer.min.js'), 'utf8'));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
