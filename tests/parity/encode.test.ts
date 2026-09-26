// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/encode.ts against src/encode/encode_pb.py: byte-identical
// bundles from the same output.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSerializerOutput } from '../../src/pipeline/nodes.ts';
import { encodeDocument, SchemaMismatch } from '../../src/pipeline/encode.ts';
import { blockDirs, pythonEncode } from './helpers.ts';

const dirs = blockDirs();

test('encodeDocument is byte-identical to encode_pb.py', { skip: dirs.length ? false : 'no parity fixtures (tests/parity/prepare.sh)' }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'parity-encode-'));
  let same = 0, rejected = 0;
  const differ: string[] = [];
  for (const dir of dirs) {
    const json = join(dir, 'output.json');
    let ts: Uint8Array | null;
    try { ts = encodeDocument(readSerializerOutput(readFileSync(json, 'utf8'))); }
    catch (e) { if (e instanceof SchemaMismatch) ts = null; else throw e; }
    let py: Buffer | null = existsSync(join(dir, 'nodelist.pb')) ? readFileSync(join(dir, 'nodelist.pb')) : null;
    if (!(ts && py && Buffer.compare(Buffer.from(ts), py) === 0)) py = pythonEncode(json, join(tmp, 'x.pb'));   // stale file?
    if (ts === null && py === null) { rejected++; continue; }                 // both reject it (untransformed)
    if (ts && py && Buffer.compare(Buffer.from(ts), py) === 0) same++; else differ.push(dir);
  }
  console.log(`  ${same} identical, ${rejected} rejected by both, ${differ.length} different`);
  if (differ.length) console.log(differ.slice(0, 5).join("\n"));
  assert.deepEqual(differ, []);
  assert.ok(same > 0);
});
