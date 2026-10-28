#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Download the corpus's sources into the cache (corpus/.cache/, or
// CORPUS_CACHE), each once, checked against the manifest's sha256.
//
//     node tools/corpus/fetch.ts [--only <id>,…] [--check]
//     node tools/corpus/fetch.ts --record [--only <id>,…]
//
// One request at a time, at least REQUEST_GAP_MS apart, with a User-Agent that
// names the project and nothing else. A source already in the cache is not
// asked for again. --check also unpacks each one (into a temporary folder) and
// applies its patch, to show that it builds a work copy. --record is for
// adding papers: a paper whose sha256 is empty is downloaded and the sha256 of
// what came is written into the manifest.
import { parseArgs } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST, checkManifest, type Manifest } from './manifest.ts';
import { CACHE, cached, download, prepare, sha256, sourceBytes } from './source.ts';
import { existsSync, mkdirSync, renameSync } from 'node:fs';

const { values: o } = parseArgs({ options: { only: { type: 'string' }, record: { type: 'boolean', default: false }, check: { type: 'boolean', default: false } } });
const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
const only = o.only ? new Set(o.only.split(',')) : null;
const papers = m.papers.filter(p => !only || only.has(p.id));

if (o.record) {
  for (const p of papers) {
    if (p.source.sha256) continue;
    const b = await download(p.source.url);
    p.source.sha256 = sha256(b);
    mkdirSync(CACHE, { recursive: true });
    if (!existsSync(cached(p.source.sha256))) { writeFileSync(`${cached(p.source.sha256)}.part`, b); renameSync(`${cached(p.source.sha256)}.part`, cached(p.source.sha256)); }
    console.log(`${p.id}: ${b.length} bytes, sha256 ${p.source.sha256}`);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

checkManifest(m);
let failed = 0;
for (const p of papers) {
  try {
    const b = await sourceBytes(p);
    let note = `${b.length} bytes`;
    if (o.check) {
      const tmp = mkdtempSync(join(tmpdir(), 'corpus-check-'));
      try { const r = prepare(p, b, join(tmp, 'src')); note += `, unpacked${r.patched.length ? `, patched ${r.patched.length} file(s)` : ''}`; }
      finally { rmSync(tmp, { recursive: true, force: true }); }
    }
    console.log(`${p.id}: ${note}`);
  } catch (e) { failed++; console.error(`${p.id}: ${(e as Error).message}`); }
}
console.log(`${papers.length - failed} of ${papers.length} sources in ${CACHE}`);
process.exit(failed ? 1 : 0);
