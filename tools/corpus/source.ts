// SPDX-License-Identifier: AGPL-3.0-or-later
// A paper's source: downloaded once into the cache, kept under its sha256
// (so a CI cache can keep the folder as it is), and unpacked from there into
// a fresh work copy, with its recorded patch applied.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpack } from './archive.ts';
import { applyPatch, patchReason } from './patch.ts';
import { CORPUS_DIR, REPO, type Paper } from './manifest.ts';

/** Who is asking, with the project's address and nothing personal. */
export const USER_AGENT = 'reflowtex-corpus/0.1 (+https://github.com/radek-p/reflowtex)';
/** The least time between two requests, in ms. */
export const REQUEST_GAP_MS = 5000;
export const CACHE = process.env.CORPUS_CACHE ? join(process.env.CORPUS_CACHE) : join(REPO, 'corpus', '.cache');

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export const cached = (sha: string): string => join(CACHE, `${sha}.src`);

let last = 0;
/** One GET, no sooner than REQUEST_GAP_MS after the one before; the body, or an error with the status. */
export async function download(url: string, timeoutMs = 300000): Promise<Uint8Array> {
  const wait = last + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** The paper's archive from the cache, fetched first if it is not there; its sha256 checked either way. */
export async function sourceBytes(p: Paper, { offline = false } = {}): Promise<Uint8Array> {
  const file = cached(p.source.sha256);
  if (existsSync(file)) {
    const b = new Uint8Array(readFileSync(file));
    if (sha256(b) === p.source.sha256) return b;
    rmSync(file);                                              // a damaged copy: fetched again
  }
  if (offline) throw new Error(`${p.id}: not in the cache (${file}) and fetching is off`);
  const b = await download(p.source.url);
  const got = sha256(b);
  if (got !== p.source.sha256) throw new Error(`${p.id}: ${p.source.url} has sha256 ${got}, the manifest ${p.source.sha256}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(`${file}.part`, b);
  renameSync(`${file}.part`, file);
  return b;
}

/** A fresh work copy of the source in `dest` (replaced): unpacked, the root taken, the patch applied. */
export function prepare(p: Paper, bytes: Uint8Array, dest: string): { patched: string[] } {
  rmSync(dest, { recursive: true, force: true });
  const tmp = `${dest}.unpack`;
  rmSync(tmp, { recursive: true, force: true });
  // a single-file e-print is the main file itself
  unpack(bytes, tmp, p.source.root ? `${p.source.root}/${p.main}` : p.main);
  const root = p.source.root ? join(tmp, p.source.root) : tmp;
  if (!existsSync(join(root, p.main))) throw new Error(`${p.id}: ${p.main} is not in the source${p.source.root ? ` (under ${p.source.root})` : ''}`);
  cpSync(root, dest, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  const patched = p.patch ? applyPatch(dest, readFileSync(join(CORPUS_DIR, p.patch), 'utf8')) : [];
  return { patched };
}

/** Why the paper's source was patched (the patch's header), or null. */
export function patchNote(p: Paper): string | null {
  return p.patch ? patchReason(readFileSync(join(CORPUS_DIR, p.patch), 'utf8')) : null;
}
