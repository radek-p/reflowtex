// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared by the parity tests: where the Python-built block directories are,
// and how to run the Python side for one block.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../..');
/** The venv's Python, or another (REFLOWTEX_PYTHON: a worktree can borrow the
 *  main checkout's venv). */
export const PYTHON = process.env.REFLOWTEX_PYTHON ?? join(REPO, '.venv/bin/python3');

/** Block directories (holding output.json) under the parity roots. */
export function blockDirs(): string[] {
  const roots = process.env.REFLOWTEX_PARITY_ROOTS
    ? process.env.REFLOWTEX_PARITY_ROOTS.split(':').map(r => resolve(REPO, r))
    : existsSync(join(REPO, 'build/parity'))
      ? readdirSync(join(REPO, 'build/parity')).map(d => join(REPO, 'build/parity', d))
      : [];
  return roots.flatMap(root => existsSync(root) && statSync(root).isDirectory()
    ? readdirSync(root).sort().map(d => join(root, d)).filter(d => existsSync(join(d, 'output.json')))
    : []);
}

/** The current Python encoder's bytes for one output.json, or null when it
 *  rejects the file. */
export function pythonEncode(outputJson: string, out: string): Buffer | null {
  try {
    execFileSync(PYTHON, [join(REPO, 'src/encode/encode_pb.py'), outputJson, out], { stdio: 'pipe' });
  } catch { return null; }
  return execFileSync('cat', [out]);
}
