// SPDX-License-Identifier: AGPL-3.0-or-later
// The committed bundles are built from the sources as they stand: each
// records the SHA-256 of its sources on its second line (build.sh), and a
// source edited without `make build-viewer` / `make build-companion` /
// `make build-inspector` fails here. (A stale companion.js once made a web test look like a code bug.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installViewer, viewerSourcesSha256 } from '../../src/pipeline/site.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** As build.sh: every file matching `keep` under dir/src, as its path from
 *  dir and a newline, then its contents, in byte order of the paths. */
function sourcesSha256(dir: string, keep: (f: string) => boolean): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (keep(f)) files.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(join(dir, 'src'));
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const h = createHash('sha256');
  for (const f of files) { h.update(`${f}\n`); h.update(readFileSync(join(dir, f))); }
  return h.digest('hex');
}

const secondLine = (file: string) => readFileSync(file, 'utf8').split('\n')[1];

test('latex-viewer.js is built from the viewer as it stands', () => {
  assert.ok(secondLine(join(SRC, 'viewer/latex-viewer.js')).includes(`sources sha256 ${viewerSourcesSha256()}`),
    'run make build-viewer');
});

test('companion.js is built from the companion as it stands', () => {
  const sha = sourcesSha256(join(SRC, 'companion'), f => f.endsWith('.ts') || f.endsWith('.tsx'));
  assert.ok(secondLine(join(SRC, 'companion/companion.js')).includes(`sources sha256 ${sha}`), 'run make build-companion');
});

test('the inspector is built from its sources as they stand', () => {
  const dir = join(SRC, 'inspector');
  const sha = sourcesSha256(dir, f => f.endsWith('.ts') || f.endsWith('.js'));
  const built = ['inspector.js', 'agent.js', ...readdirSync(join(dir, 'panel')).map(f => `panel/${f}`)];
  assert.ok(built.length > 2);
  for (const f of built)
    assert.ok(secondLine(join(dir, f)).includes(`sources sha256 ${sha}`), `${f}: run make build-inspector`);
  // every panel module has its source, and none is left over from one that went
  const sources = readdirSync(join(dir, 'src/panel')).map(f => f.replace(/\.(ts|js)$/, ''));
  assert.deepEqual(readdirSync(join(dir, 'panel')).map(f => f.replace(/\.js$/, '')).sort(), sources.sort());
});

test('a site gets the inspector as built, not its sources', () => {
  const out = mkdtempSync(join(tmpdir(), 'rtx-install-'));
  try {
    installViewer(out, { inspector: true, log: () => {} });
    for (const f of ['inspector.js', 'agent.js', 'inspector.css', 'panel/app.js', 'vendor/preact.js'])
      assert.ok(existsSync(join(out, 'inspector', f)), f);
    for (const f of ['src', 'build.sh', 'README.md'])
      assert.ok(!existsSync(join(out, 'inspector', f)), `${f} is not shipped`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
