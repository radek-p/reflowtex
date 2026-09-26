// SPDX-License-Identifier: AGPL-3.0-or-later
// A site's build is stale when the toolchain changed, not only its snippet:
// the Hugo prebuild once kept a block compiled before reflowtex-lean.sty
// gained parts, and the home page's Lean widget lost its theorem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolchainHash } from '../../src/pipeline/pipeline.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

test('the toolchain hash follows the packages, not their docs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-toolchain-'));
  try {
    for (const d of ['extract', 'latex', 'schema', 'pipeline']) cpSync(join(SRC, d), join(dir, d), { recursive: true });
    const h0 = toolchainHash(dir);
    assert.equal(h0, toolchainHash(), 'a copy hashes as the original');
    appendFileSync(join(dir, 'latex/README.md'), '\nmore words\n');
    assert.equal(toolchainHash(dir), h0, 'a README is not the toolchain');
    appendFileSync(join(dir, 'latex/reflowtex-lean.sty'), '\n% changed\n');
    assert.notEqual(toolchainHash(dir), h0, 'a package is');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
