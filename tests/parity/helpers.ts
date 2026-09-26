// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared by the parity tests: where the Python-built block directories are,
// and how to run the Python side for one block.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

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

// ── Captures (tests/parity/capture.py) ──────────────────────────────────────

export const CAPTURE = resolve(REPO, process.env.REFLOWTEX_CAPTURE ?? 'build/capture');

/** Captured calls of one function: every <capture>/<run>/<key>/NNN-<fn>.json. */
export function captures(fn: string): string[] {
  if (!existsSync(CAPTURE)) return [];
  const out: string[] = [];
  for (const run of readdirSync(CAPTURE).sort()) {
    const r = join(CAPTURE, run);
    if (!statSync(r).isDirectory()) continue;
    for (const key of readdirSync(r).sort()) {
      const k = join(r, key);
      if (!statSync(k).isDirectory()) continue;
      for (const f of readdirSync(k).sort()) if (f.endsWith(`-${fn}.json`)) out.push(join(k, f));
    }
  }
  return out;
}

/** A capture file, with every "fonts" map kept in its written order (as
 *  readSerializerOutput reads output.json). */
export function readCapture(path: string): any {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text.replace(/"(\d+)":/g, '"#$1":'), (key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const entries = Object.entries(value).map(([k, v]) => [k.startsWith('#') ? k.slice(1) : k, v] as const);
    if (key === 'fonts') return new Map(entries);
    return Object.fromEntries(entries);
  });
}

/** Data as the comparison sees it: maps as entry lists (their order counts),
 *  documents without their `fonts` key when it is empty either way. */
export function normalise(x: unknown): unknown {
  if (x instanceof Map) return { __map: [...x].map(([k, v]) => [k, normalise(v)]) };
  if (Array.isArray(x)) return x.map(normalise);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).map(([k, v]) => [k, normalise(v)]));
  return x;
}

/** A document from a capture: fonts written as [] read as an empty map, the
 *  lists the pipeline always has present. */
export function asDocument(d: any): any {
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    if (!(d.fonts instanceof Map)) d.fonts = new Map();
    d.paragraphs ??= []; d.content ??= []; d.streams ??= [];
  }
  return d;
}

/** A picture's SVG with dvisvgm's run-to-run arbitrariness taken out: it
 *  numbers glyph fonts (g1-, g2-…) in an order that varies between runs, so
 *  each glyph definition is renamed after its path data and the definitions
 *  are sorted. What is drawn, and where, is compared exactly. */
export function canonicalSvg(svg: string): string {
  const names = new Map<string, string>();
  for (const m of svg.matchAll(/<path id='([^']+)' d='([^']*)'\/>/g)) {
    names.set(m[1], `glyph-${createHash('sha1').update(m[2]).digest('hex').slice(0, 12)}`);
  }
  let out = svg.replace(/(id='|#)([^')]+)/g, (all, pre, id) => (names.has(id) ? pre + names.get(id) : all));
  out = out.replace(/<defs>([\s\S]*?)<\/defs>/g, (_, body: string) => `<defs>${body.split('\n').filter(Boolean).sort().join('\n')}</defs>`);
  return out;
}
