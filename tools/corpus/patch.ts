// SPDX-License-Identifier: AGPL-3.0-or-later
// A recorded patch (corpus/patches/<id>.patch) applied to a paper's unpacked
// source: a unified diff, paths a/… and b/… relative to the paper's root, and
// a header of '#' lines saying why. Every hunk must apply exactly – its
// context and removed lines as the file has them, at its line or, if the file
// moved, at the one place they match – or nothing is changed. Paths are
// checked to stay inside the root.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeRelative } from './manifest.ts';

interface Hunk { at: number; old: string[]; new: string[] }
interface FilePatch { path: string; hunks: Hunk[] }

/** The patch's '#' header: why the source was changed. */
export function patchReason(text: string): string {
  return text.split('\n').filter(l => l.startsWith('#')).map(l => l.replace(/^#\s?/, '')).join(' ').trim();
}

export function parsePatch(text: string): FilePatch[] {
  const lines = text.split('\n');
  const files: FilePatch[] = [];
  let cur: FilePatch | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('--- ')) {
      const next = lines[i + 1] ?? '';
      if (!next.startsWith('+++ ')) throw new Error(`patch: --- without +++ at line ${i + 1}`);
      const path = next.slice(4).split('\t')[0].trim().replace(/^b\//, '');
      if (!safeRelative(path)) throw new Error(`patch: unsafe path ${path}`);
      cur = { path, hunks: [] };
      files.push(cur);
      i++;
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) {
      if (!cur) throw new Error(`patch: a hunk before any file at line ${i + 1}`);
      const oldCount = h[2] === undefined ? 1 : Number(h[2]), newCount = h[4] === undefined ? 1 : Number(h[4]);
      const hunk: Hunk = { at: Number(h[1]) - (oldCount === 0 ? 0 : 1), old: [], new: [] };
      let o = 0, n = 0;
      while (o < oldCount || n < newCount) {
        const b = lines[++i];
        if (b === undefined) throw new Error('patch: a hunk ends early');
        if (b.startsWith('\\')) continue;                       // "\ No newline at end of file"
        const tag = b[0] ?? ' ', body = b.slice(1);
        if (tag === ' ' || b === '') { hunk.old.push(body); hunk.new.push(body); o++; n++; }
        else if (tag === '-') { hunk.old.push(body); o++; }
        else if (tag === '+') { hunk.new.push(body); n++; }
        else throw new Error(`patch: unexpected line ${JSON.stringify(b)}`);
      }
      cur.hunks.push(hunk);
    }
  }
  if (!files.length) throw new Error('patch: no file in it');
  return files;
}

const same = (a: string[], from: number, b: string[]) => b.every((x, k) => a[from + k]?.replace(/\r$/, '') === x.replace(/\r$/, ''));

/** Apply the patch under root; returns the files changed. Throws, changing nothing, if any hunk does not apply. */
export function applyPatch(root: string, text: string): string[] {
  const out = new Map<string, string>();
  for (const f of parsePatch(text)) {
    const file = join(root, f.path);
    if (!existsSync(file)) throw new Error(`patch: ${f.path} is not in the source`);
    const raw = readFileSync(file, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    let lines = raw.split('\n').map(l => l.replace(/\r$/, ''));
    let shift = 0;
    for (const h of f.hunks) {
      let at = h.at + shift;
      if (!same(lines, at, h.old)) {
        const places = lines.map((_, k) => k).filter(k => same(lines, k, h.old));
        if (places.length !== 1) throw new Error(`patch: a hunk for ${f.path} at line ${h.at + 1} does not apply`);
        at = places[0];
      }
      lines = [...lines.slice(0, at), ...h.new, ...lines.slice(at + h.old.length)];
      shift = at - h.at + h.new.length - h.old.length;
    }
    out.set(file, lines.join(eol));
  }
  for (const [file, text2] of out) writeFileSync(file, text2);
  return [...out.keys()];
}
