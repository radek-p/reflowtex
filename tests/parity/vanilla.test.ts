// SPDX-License-Identifier: AGPL-3.0-or-later
// integrations/vanilla/build.ts and examples/testmath/build.ts against their
// Python versions: each Python-built site tests/parity/capture-all.sh left
// (build/parity-*-site) is built again with TypeScript and compared – the
// page's blocks decoded, the font map, and every served font per code point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { messageType } from '../../src/pipeline/schema.ts';
import { sameDrawing } from './font-compare.ts';
import { REPO, canonicalSvg } from './helpers.ts';

const conv = (s: string) => s.replace(/\.reflowtex-[0-9a-f]{8}\.otf$/, '.reflowtex-CONVERTED.otf');
function page(dir: string) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const Document = messageType('Document');
  const blocks = [...html.matchAll(/data-nodelist-b64="([^"]+)"/g)].map(m => {
    const doc: any = Document.toObject(Document.decode(Buffer.from(m[1], 'base64')), { enums: String, longs: Number, defaults: false });
    for (const f of doc.fonts ?? []) f.filename = conv(String(f.filename));
    for (const p of doc.pictures ?? []) p.svg = canonicalSvg(p.svg);
    return doc;
  });
  const fontMap = JSON.parse(/<script id="latex-font-map"[^>]*>(.*?)<\/script>/s.exec(html)?.[1] ?? '{}');
  return { blocks, fontMap: fontMap as Record<string, string>, title: /<title>(.*?)<\/title>/.exec(html)?.[1] };
}

const sites: [string, string[]][] = [
  ['parity-dmn-site', ['integrations/vanilla/build.ts', 'examples/display-model-narrow']],
  ['parity-otfmath-site', ['integrations/vanilla/build.ts', 'tests/parity/fixtures/otfmath']],
  ['parity-testmath-site', ['examples/testmath/build.ts']],
];
for (const [name, cmd] of sites) {
  const py = join(REPO, 'build', name);
  test(`${name}: built again with TypeScript`, { skip: existsSync(join(py, 'index.html')) ? false : 'no Python site (capture-all.sh)' }, () => {
    const ts = join(REPO, 'build', `ts-${name}`);
    rmSync(ts, { recursive: true, force: true });
    execFileSync('node', [...cmd, '-o', ts], { cwd: REPO, stdio: 'pipe' });
    const a = page(ts), b = page(py);
    assert.equal(a.title, b.title);
    assert.equal(a.blocks.length, b.blocks.length);
    a.blocks.forEach((d, i) => assert.deepStrictEqual(d, b.blocks[i], `block ${i + 1}`));
    const fa = new Map(Object.entries(a.fontMap).map(([k, v]) => [conv(k), v])), fb = new Map(Object.entries(b.fontMap).map(([k, v]) => [conv(k), v]));
    assert.deepEqual([...fa.keys()].sort(), [...fb.keys()].sort(), 'font map');
    for (const [k, v] of fa) sameDrawing(readFileSync(join(ts, 'fonts', v)), readFileSync(join(py, 'fonts', fb.get(k)!)), k);
  });
}
