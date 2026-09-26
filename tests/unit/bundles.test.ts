// SPDX-License-Identifier: AGPL-3.0-or-later
// The committed bundles are built from the sources as they stand: each
// records the SHA-256 of its sources on its second line (build.sh), and a
// source edited without `make build-viewer` / `make build-companion` fails
// here. (A stale companion.js once made a web test look like a code bug.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewerSourcesSha256 } from '../../src/pipeline/site.ts';

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
