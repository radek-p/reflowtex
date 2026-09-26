#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Publish a pixel comparison for the website's accuracy page.
//
//     node tools/pageless-pdf/publish-compare.ts [<tiles.ts out dir>] [--site website] [--upload]
//
// The comparison's pictures (tiles.ts: <ID>/{heat,fine,pdf,browser}-<k>.webp
// and manifest.json) are too big for git, and new at every run, so the website
// takes them from a GitHub release instead (website/tools/fetch-pixel-compare.ts,
// run by build.sh). This:
//
//   1. copies a tiles.ts output into the site, when given one:
//      <ID>/ → <site>/static/pixel-compare/<ID>/, manifest.json →
//      <site>/data/pixel_compare.json;
//   2. packs those into pixel-compare-<hash>.tar (reproducibly: the same
//      pictures give the same file and name);
//   3. with --upload, creates the release pixel-compare-<hash> holding it,
//      with the GitHub CLI (gh); otherwise prints how to;
//   4. writes <site>/pixel-compare.lock – the file's URL and SHA-256 – which is
//      what to commit.
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTar } from '../lib/tar.ts';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export function repoSlug(): string {
  const url = execFileSync('git', ['-C', REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  return url.replace(/\.git$/, '').split('github.com').at(-1)!.replace(/^[:/]+/, '');
}

/** Every file under `dir` matching `test`, recursively. */
const filesUnder = (dir: string, test: (f: string) => boolean): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true }).filter(e => e.isFile() && test(e.name)).map(e => join(e.parentPath, e.name));

/** Paths in the order Python sorts them: component by component. */
const byComponents = (a: string, b: string) => {
  const pa = a.split(sep), pb = b.split(sep);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return pa.length - pb.length;
};

/** static/pixel-compare/ and data/pixel_compare.json as one tar, the same bytes
 *  for the same files (sorted, no times or owners). */
export function pack(site: string): Uint8Array {
  const files = filesUnder(join(site, 'static', 'pixel-compare'), f => f.endsWith('.webp')).sort(byComponents);
  files.push(join(site, 'data', 'pixel_compare.json'));
  return writeTar(files.map(p => [relative(site, p).split(sep).join('/'), readFileSync(p)]));
}

if (import.meta.main) {
  const { values: v, positionals: [tiles] } = parseArgs({ allowPositionals: true, options: {
    site: { type: 'string', default: join(REPO, 'website') }, upload: { type: 'boolean', default: false } } });
  const site = resolve(v.site);

  if (tiles) {
    const manifest = JSON.parse(readFileSync(join(tiles, 'manifest.json'), 'utf8')) as { strips: { id: string }[] };
    const pics = join(site, 'static', 'pixel-compare');
    rmSync(pics, { recursive: true, force: true });
    for (const s of manifest.strips) cpSync(join(tiles, s.id), join(pics, s.id), { recursive: true });
    copyFileSync(join(tiles, 'manifest.json'), join(site, 'data', 'pixel_compare.json'));
  }

  const blob = pack(site);
  const sha = createHash('sha256').update(blob).digest('hex');
  const tag = `pixel-compare-${sha.slice(0, 8)}`;
  const out = join(site, '.reflowtex-build', `${tag}.tar`);
  mkdirSync(join(site, '.reflowtex-build'), { recursive: true });
  writeFileSync(out, blob);
  const url = `https://github.com/${repoSlug()}/releases/download/${tag}/${basename(out)}`;
  console.log(`packed ${out} (${(blob.length / 1048576).toFixed(1)} MB)`);

  const notes = "The pictures of the website's pixel comparison (Showcase › Accuracy), " +
    'fetched by website/tools/fetch-pixel-compare.ts. Made by tools/pageless-pdf.';
  if (v.upload)
    execFileSync('gh', ['release', 'create', tag, out, '--repo', repoSlug(), '--title', `Pixel comparison ${sha.slice(0, 8)}`, '--notes', notes], { stdio: 'inherit' });
  else
    console.log(`\nTo publish it: gh release create ${tag} ${out} --title "Pixel comparison ${sha.slice(0, 8)}" --notes "…"\n` +
      `(or on GitHub: Releases › Draft a new release, tag ${tag}, attach ${basename(out)}).`);

  writeFileSync(join(site, 'pixel-compare.lock'), JSON.stringify({ url, sha256: sha, bytes: blob.length }, null, 2) + '\n');
  console.log(`wrote ${join(site, 'pixel-compare.lock')} – commit it once the release exists`);
}
