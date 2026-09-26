// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/pipeline.ts against pipeline.py, end to end: every compile()
// and compile_batch() the captured builds made is compiled again by the
// TypeScript pipeline, in a fresh build root, and its final data compared with
// the Python pipeline's (the last transform's result; for a batch, each part).
// Two differences are expected and normalised away: converted Type 1 fonts are
// named by a hash of bytes the two sides write differently, and dvisvgm
// numbers glyph fonts in an order that varies between runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { Pipeline } from '../../src/pipeline/pipeline.ts';
import { readSerializerOutput } from '../../src/pipeline/nodes.ts';
import { captures, readCapture, normalise, asDocument, canonicalSvg } from './helpers.ts';

/** Data as compared: converted font names and picture glyph numbering taken out. */
function comparable(d: any): unknown {
  d = asDocument(d);
  for (const f of (d.fonts as Map<string, any>).values())
    if (typeof f.filename === 'string') f.filename = f.filename.replace(/\.reflowtex-[0-9a-f]{8}\.otf$/, '.reflowtex-CONVERTED.otf');
  if (Array.isArray(d.pictures)) d.pictures = d.pictures.map((p: any) => ({ ...p, svg: canonicalSvg(p.svg) }));
  return normalise(d);
}

/** The Python pipeline's final data for a block: the last transform's result. */
function pythonFinal(dir: string): any {
  const last = readdirSync(dir).filter(f => f.endsWith('-normalise_glyph_addressing.json')).sort().pop();
  return last ? readCapture(join(dir, last)).after[0] : null;
}

const calls = [...captures('compile'), ...captures('compile_batch')];

test(`pipeline: ${calls.length} captured compilation(s) compiled again`, { skip: calls.length ? false : 'no captures (tests/parity/README.md)' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'parity-pipeline-'));
  // one TypeScript pipeline per captured configuration, as the builds had
  const pipes = new Map<string, Pipeline>();
  const pipeFor = (rec: any) => {
    const k = JSON.stringify([rec.template, rec.serializer, rec.search_dirs, rec.local_fonts_dir]);
    if (!pipes.has(k)) {
      const n = pipes.size;
      pipes.set(k, new Pipeline({ buildRoot: join(root, `build-${n}`), fontsDir: join(root, `fonts-${n}`),
        localFontsDir: rec.local_fonts_dir, searchDirs: rec.search_dirs, template: rec.template, serializer: rec.serializer, log: () => {} }));
    }
    return pipes.get(k)!;
  };
  const queue = calls.map(f => ({ f, rec: readCapture(f) }));
  const differ: string[] = [];
  let compared = 0;
  const work = async ({ f, rec }: (typeof queue)[number]) => {
    const pipe = pipeFor(rec);
    const blockDir = join(f, '..');
    try {
      if (f.endsWith('-compile.json')) {
        await pipe.compile(rec.content, rec.preamble, { key: rec.key ?? undefined, passes: rec.passes, name: rec.name ?? undefined });
        const key = blockDir.split('/').pop()!;
        const ts = readSerializerOutput(readFileSync(join(pipe.buildRoot, key, 'output.json'), 'utf8'));
        const py = pythonFinal(blockDir);
        if (!py) return;
        if (!isEqual(comparable(ts), comparable(py))) differ.push(`${f}`); else compared++;
      } else {
        const parts = (rec.parts as any[][]).map(p => ({ key: p[0], content: p[1], name: p[2] }));
        await pipe.compileBatch(parts, rec.preamble, { key: rec.key ?? undefined, passes: rec.passes, name: rec.name ?? undefined });
        const split = readdirSync(blockDir).filter(x => x.endsWith('-batch_parts.json')).sort().pop();
        const pyParts = readCapture(join(blockDir, split!)).result as any[];
        parts.forEach((p, i) => {
          const ts = readSerializerOutput(readFileSync(join(pipe.buildRoot, p.key, 'output.json'), 'utf8'));
          if (!isEqual(comparable(ts), comparable(pyParts[i]))) differ.push(`${f} part ${p.key}`); else compared++;
        });
      }
    } catch (e) { differ.push(`${f}: ${(e as Error).message.split('\n')[0]}`); }
  };
  // the first alone (luaotfload's cache), then in parallel
  if (queue.length) await work(queue.shift()!);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(availableParallelism(), 8)) }, async () => {
    for (let q = queue.shift(); q; q = queue.shift()) await work(q);
  }));
  console.log(`  ${compared} document(s) identical, ${differ.length} different`);
  if (differ.length) console.log(differ.slice(0, 10).join('\n'));
  assert.deepEqual(differ, []);
});

function isEqual(a: unknown, b: unknown): boolean {
  try { assert.deepStrictEqual(a, b); return true; } catch { return false; }
}
