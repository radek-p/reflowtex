// SPDX-License-Identifier: AGPL-3.0-or-later
// The modules a browser may bundle (the pipeline's core, run in a Web Worker
// by an editor: pipeline.ts, nodes.ts, encode.ts, fonts/*, the schema) must
// not import MuPDF statically (10 MB of WebAssembly), nor the converter that
// loads it (src/pictures/pdf-svg.ts): it is reached only through a dynamic
// import, where a picture is converted. The converter itself uses no Node
// API, so that a browser converts a picture as the pipeline does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const SERVER_ONLY_PACKAGES = new Set(['mupdf']);
const CONVERTER = join(SRC, 'pictures/pdf-svg.ts');
const SERVER_ONLY_MODULES = new Set([CONVERTER]);

/** What a module imports statically, as written: `import … from`, `export …
 *  from` and bare `import '…'`, but not `import type` (erased) nor `import()`. */
export function staticImports(source: string): string[] {
  const out: string[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const m of code.matchAll(/(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*['"]([^'"]+)['"]/g)) if (!m[2]) out.push(m[4]);
  for (const m of code.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

/** Every module and package reachable from `entries` by static imports. */
function reachable(entries: string[]): { modules: Map<string, string>; packages: Map<string, string> } {
  const modules = new Map<string, string>(), packages = new Map<string, string>();     // → who imports it
  const todo: [string, string][] = entries.map(e => [e, '(entry)']);
  for (let next = todo.pop(); next; next = todo.pop()) {
    const [file, by] = next;
    if (modules.has(file)) continue;
    modules.set(file, by);
    if (!/\.[cm]?[jt]s$/.test(file)) continue;
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        assert.ok(existsSync(target), `${file} imports ${spec}, which is not there`);
        todo.push([target, file]);
      } else if (!spec.startsWith('node:')) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!packages.has(name)) packages.set(name, file);
      }
    }
  }
  return { modules, packages };
}

const files = (dir: string) => readdirSync(join(SRC, dir)).filter(f => /\.(ts|proto)$/.test(f) && !f.endsWith('.d.ts')).map(f => join(SRC, dir, f));
const ENTRIES = [
  ...['pipeline.ts', 'nodes.ts', 'encode.ts'].map(f => join(SRC, 'pipeline', f)),
  ...files('pipeline/fonts'),
  ...files('schema'),
];

test('static imports are read as a bundler reads them', () => {
  assert.deepEqual(staticImports(`import a from './a.ts';\nimport type { B } from './b.ts';\nimport {\n  c,\n  type D,\n} from './c.ts';
export { e } from './e.ts';\nexport type { F } from './f.ts';\nimport './g.ts';\nconst h = await import('./h.ts');\n// import i from './i.ts';\n/* import j from './j.ts' */`),
  ['./a.ts', './c.ts', './e.ts', './g.ts']);
});

test('the modules a browser may bundle reach neither MuPDF nor its converter', () => {
  const { modules, packages } = reachable(ENTRIES);
  // the walk sees what it should: pictures.ts and the rewrite are in the graph
  assert.ok(modules.has(join(SRC, 'pipeline/pictures.ts')), 'pipeline.ts reaches pictures.ts');
  assert.ok(modules.has(join(SRC, 'pictures/rewrite.ts')), 'pictures.ts reaches the rewrite');
  assert.match(readFileSync(join(SRC, 'pipeline/pictures.ts'), 'utf8'), /await import\('\.\.\/pictures\/pdf-svg\.ts'\)/, 'and loads the converter itself');
  for (const m of SERVER_ONLY_MODULES) assert.ok(!modules.has(m), `${m} is imported statically by ${modules.get(m)}`);
  for (const p of SERVER_ONLY_PACKAGES) assert.ok(!packages.has(p), `${p} is imported statically by ${packages.get(p)}`);
});

test('the converter and the rewrite use no Node API', () => {
  const { modules, packages } = reachable([CONVERTER]);
  for (const m of modules.keys()) {
    const code = readFileSync(m, 'utf8');
    assert.ok(!staticImports(code).some(s => s.startsWith('node:')), `${m} imports a Node module`);
    assert.doesNotMatch(code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /(?<![.\w])(?:Buffer|process|require|__dirname)\b/, `${m} uses a Node global`);
  }
  assert.deepEqual([...packages.keys()], [], 'nor a package statically: MuPDF is loaded on the first conversion');
});
