#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fetch the pixel comparison the accuracy page shows (Showcase › Accuracy).
//
// The comparison is 25 MB of pictures, too much to keep in git and new at every
// run, so it is published as one file in a GitHub release (see
// tools/pageless-pdf/publish-compare.ts), and pixel-compare.lock, beside this
// site, names that file and its SHA-256. build.sh runs this before Hugo:
//
//     node website/tools/fetch-pixel-compare.ts <site>
//
// It unpacks the file into <site>/static/pixel-compare/ and
// <site>/data/pixel_compare.json, unless they are already the ones the lock
// names. Offline, or with no lock, it says so and leaves the site as it is: the
// page then shows "No comparison data", and the build goes on.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readTar } from '../../tools/lib/tar.ts';

const MEMBERS = ['static/pixel-compare/', 'data/pixel_compare.json'];

export async function fetchPixelCompare(site: string): Promise<void> {
  const lockPath = join(site, 'pixel-compare.lock');
  const pics = join(site, 'static', 'pixel-compare');
  const marker = join(pics, '.sha256');
  if (!existsSync(lockPath)) { console.log('pixel-compare: no pixel-compare.lock; the accuracy page shows no comparison'); return; }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { url: string; sha256: string; bytes?: number };
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === lock.sha256) { console.log('pixel-compare: up to date'); return; }
  console.log(`pixel-compare: fetching ${lock.url} (${((lock.bytes ?? 0) / 1048576).toFixed(1)} MB)`);
  let tar: Uint8Array;
  try {
    const r = await fetch(lock.url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    tar = new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    console.error(`pixel-compare: WARNING – could not fetch it (${(e as Error).message}); the accuracy page shows no comparison`);
    return;
  }
  const digest = createHash('sha256').update(tar).digest('hex');
  if (digest !== lock.sha256) {
    console.error(`pixel-compare: WARNING – ${lock.url} is not the file pixel-compare.lock names (SHA-256 ${digest}); left out`);
    return;
  }
  const entries = readTar(tar);
  for (const e of entries)        // only the comparison's own files, nowhere else
    if (e.type === 'other' || e.name.split('/').includes('..') || !MEMBERS.some(m => e.name.startsWith(m))) {
      console.error(`ERROR: pixel-compare: unexpected entry ${JSON.stringify(e.name)} in ${lock.url}`);
      process.exit(1);
    }
  rmSync(pics, { recursive: true, force: true });
  for (const e of entries) {
    const to = join(site, e.name);
    if (e.type === 'dir') { mkdirSync(to, { recursive: true }); continue; }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, e.data);
  }
  mkdirSync(pics, { recursive: true });
  writeFileSync(marker, `${lock.sha256}\n`);
  const n = readdirSync(pics, { recursive: true }).filter(f => String(f).endsWith('.webp')).length;
  console.log(`pixel-compare: unpacked ${n} pictures`);
}

if (import.meta.main) await fetchPixelCompare(resolve(process.argv[2] ?? '.'));
