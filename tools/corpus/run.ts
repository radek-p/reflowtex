#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Build and measure the corpus: each paper in a container of its own.
//
//     node tools/corpus/run.ts --image IMAGE [--only <id>,…] [--shard K/N] [--jobs N]
//                              [--results corpus/results] [--offline] [--keep-builds]
//
// For each paper the manifest supports (or those --only names; --shard K/N
// takes every N-th from the K-th, 1-based, for a CI matrix): its source from
// the cache (fetched first unless --offline; fetch.ts), a fresh copy in
// <results>/<id>/src with its patch applied, and then tools/corpus/paper.ts in
// a container: `docker run --network none`, the repository mounted read-only
// and only the paper's own folder writable, a memory limit, and a time limit
// for the whole. What paper.ts writes there is what report.ts reads.
//
// The paper is untrusted: nothing of it runs on this machine, and in the
// container TeX runs it without shell escape and without a network.
// The browser scripts are built first, in the same image (the only container
// that writes to the repository, and it runs no paper).
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadManifest, REPO, type Paper } from './manifest.ts';
import { prepare, sourceBytes } from './source.ts';

const { values: o } = parseArgs({ options: {
  image: { type: 'string' }, only: { type: 'string' }, shard: { type: 'string' }, jobs: { type: 'string', default: '1' },
  results: { type: 'string', default: join(REPO, 'corpus', 'results') }, offline: { type: 'boolean', default: false },
  'keep-builds': { type: 'boolean', default: false }, memory: { type: 'string', default: '3g' }, timeout: { type: 'string', default: '5400' } } });
if (!o.image) { console.error('usage: run.ts --image IMAGE [--only ids] [--shard K/N] [--jobs N] [--results DIR] [--offline]'); process.exit(2); }
const IMAGE = o.image;
const results = resolve(o.results!);
const manifest = loadManifest();

let papers: Paper[] = manifest.papers.filter(p => p.supported);
if (o.only) { const ids = new Set(o.only.split(',')); papers = manifest.papers.filter(p => ids.has(p.id)); }
if (o.shard) {
  const m = /^(\d+)\/(\d+)$/.exec(o.shard);
  if (!m || +m[1] < 1 || +m[1] > +m[2]) { console.error('--shard K/N, 1 ≤ K ≤ N'); process.exit(2); }
  papers = papers.filter((_, i) => i % +m[2] === +m[1] - 1);
}

function docker(args: string[], name: string): Promise<number> {
  return new Promise(res => {
    const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const line = (d: Buffer) => { for (const l of d.toString().split('\n')) if (l.trim()) console.log(`[${name}] ${l}`); };
    p.stdout.on('data', line); p.stderr.on('data', line);
    p.on('close', code => res(code ?? 1));
  });
}

// The repository at its own path; node_modules too where it is a link to elsewhere (it is followed in the container).
const mounts = (rw: boolean): string[] => {
  const m = ['-v', `${REPO}:${REPO}${rw ? '' : ':ro'}`];
  const nm = join(REPO, 'node_modules');
  if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) { const t = realpathSync(nm); m.push('-v', `${t}:${t}:ro`); }
  return m;
};
const common = ['run', '--rm', '--init', '--network', 'none', '--shm-size=2g', '-e', 'REFLOWTEX_NO_AUTOINSTALL=1', '-w', REPO];

const setup = await docker([...common, ...mounts(true), IMAGE, 'node', join(REPO, 'scripts', 'build-bundles.ts')], 'bundles');
if (setup !== 0) { console.error('run.ts: building the browser scripts failed'); process.exit(1); }

async function one(p: Paper): Promise<boolean> {
  const dir = join(results, p.id);
  try {
    const bytes = await sourceBytes(p, { offline: o.offline });
    mkdirSync(dir, { recursive: true });
    prepare(p, bytes, join(dir, 'src'));
  } catch (e) { console.error(`${p.id}: ${(e as Error).message}`); return false; }
  const mem = p.memory ?? o.memory!;
  const name = `corpus-${p.id.replace(/[^a-z0-9-]/g, '-')}`;
  await docker(['rm', '-f', name], name);
  const code = await docker([...common, '--name', name, '--memory', mem, '--memory-swap', mem, ...mounts(false), '-v', `${dir}:${dir}`, IMAGE,
    'timeout', '-k', '30', o.timeout!, 'node', join(REPO, 'tools', 'corpus', 'paper.ts'), dir, p.id, ...(o['keep-builds'] ? ['--keep-builds'] : [])], p.id);
  if (code !== 0) console.error(`${p.id}: the container ended with ${code}${code === 124 ? ' (time limit)' : code === 137 ? ' (killed: memory?)' : ''}`);
  return code === 0;
}

const t0 = Date.now();
const queue = [...papers];
let failed = 0;
await Promise.all(Array.from({ length: Math.max(1, Number(o.jobs)) }, async () => {
  for (let p = queue.shift(); p; p = queue.shift()) if (!(await one(p))) failed++;
}));
console.log(`run.ts: ${papers.length - failed} of ${papers.length} papers ran in ${Math.round((Date.now() - t0) / 1000)} s (results in ${results})`);
process.exit(failed ? 1 : 0);
