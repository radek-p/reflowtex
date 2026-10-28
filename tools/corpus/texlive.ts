#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The TeX Live packages the corpus reads, for its image: from the TeX logs of
// a run in a full TeX Live, every file TeX opened in the tree (the logs name
// each input file and each font file it embedded), mapped to the package
// that ships it by TeX Live's own database (texlive.tlpdb).
//
//     node tools/corpus/texlive.ts <results dir> [--tlpdb FILE] [--root DIR]
//
// Run it where the TeX Live is (in the image the run used): --tlpdb defaults to
// <root>/tlpkg/texlive.tlpdb, --root to the tree kpsewhich names. Prints the
// packages, one per line, with the papers that need each as a comment; the
// names that are no package's file (TEXMFLOCAL, generated files) are listed at the end.
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The files of `known` (paths relative to `root`) a log names. TeX breaks long lines of its log, a file
 *  name too, at any character, so the log is read with its line breaks taken out, and each file name there is
 *  the longest known path that the text from it starts with; names of no known file are returned apart. */
export function filesInLog(text: string, root: string, known: Set<string>): { files: string[]; unknown: string[] } {
  const flat = text.replace(/\r?\n/g, '');
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const files = new Set<string>(), unknown = new Set<string>();
  for (const m of flat.matchAll(new RegExp(`${esc}/([^\\s()<>{}\\[\\]"']+)`, 'g'))) {
    let hit = '';
    for (let n = Math.min(m[1].length, 240); n > 3 && !hit; n--) if (known.has(m[1].slice(0, n))) hit = m[1].slice(0, n);
    if (hit) files.add(hit); else unknown.add(m[1].slice(0, 120));
  }
  return { files: [...files], unknown: [...unknown] };
}

/** file (relative to the tree's root) → package, from texlive.tlpdb's runfiles; binary (arch) packages left out. */
export function filesOfPackages(tlpdb: string): Map<string, string> {
  const map = new Map<string, string>();
  let name = '', inFiles = false;
  for (const line of tlpdb.split('\n')) {
    if (line.startsWith('name ')) { name = line.slice(5).trim(); inFiles = false; continue; }
    if (/^(runfiles|docfiles|srcfiles|binfiles)\b/.test(line)) { inFiles = line.startsWith('runfiles'); continue; }
    if (line.startsWith(' ') && inFiles && !name.includes('.')) map.set(line.trim().split(' ')[0], name);
    else if (!line.startsWith(' ')) inFiles = false;
  }
  return map;
}

if (import.meta.main) {
  const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { tlpdb: { type: 'string' }, root: { type: 'string' } } });
  const results = positionals[0];
  if (!results) { console.error('usage: texlive.ts <results dir> [--tlpdb FILE] [--root DIR]'); process.exit(2); }
  const root = o.root ?? execFileSync('kpsewhich', ['-var-value', 'SELFAUTOPARENT'], { encoding: 'utf8' }).trim();
  const owner = filesOfPackages(readFileSync(o.tlpdb ?? join(root, 'tlpkg', 'texlive.tlpdb'), 'utf8'));
  const known = new Set(owner.keys());
  const need = new Map<string, Set<string>>(), loose = new Set<string>();
  for (const id of readdirSync(results).sort()) {
    for (const sub of ['plain', 'build']) {
      const dir = join(results, id, sub);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter(f => f.endsWith('.log'))) {
        const found = filesInLog(readFileSync(join(dir, f), 'latin1'), root, known);
        for (const u of found.unknown) loose.add(u);
        for (const file of found.files) {
          const pkg = owner.get(file)!;
          if (!need.has(pkg)) need.set(pkg, new Set());
          need.get(pkg)!.add(id);
        }
      }
    }
  }
  for (const [pkg, ids] of [...need].sort((a, b) => a[0].localeCompare(b[0])))
    console.log(`${pkg.padEnd(28)} # ${ids.size === 1 ? [...ids][0] : `${ids.size} papers`}`);
  if (loose.size) { console.log('# files no package ships:'); for (const f of [...loose].sort()) console.log(`#   ${f}`); }
}
