// SPDX-License-Identifier: AGPL-3.0-or-later
// integrations/hugo/prebuild.ts against prebuild.py: the website built by
// each, compared output by output. The Python build's outputs are set aside in
// build/py-site/ (data/, fonts/), the TypeScript build's are the site's own:
//
//   mkdir -p build/py-site && cp -R website/data build/py-site/data
//   cp -R website/static/fonts build/py-site/fonts           (after a Python prebuild)
//   node integrations/hugo/prebuild.ts website … --force      (then this test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { messageType } from '../../src/pipeline/schema.ts';
import { sameDrawing, names } from './font-compare.ts';
import { REPO, canonicalSvg } from './helpers.ts';

const PY = join(REPO, 'build/py-site'), SITE = join(REPO, 'website');
const skip = existsSync(join(PY, 'data')) ? false : 'no Python site set aside (see the top of this file)';

test('data files byte-identical', { skip }, () => {
  for (const f of ['latex_files.json', 'latex_sources.json', 'latex_color_maps.json', 'latex_link_map.json', 'latex_schema.json'])
    assert.equal(readFileSync(join(SITE, 'data', f), 'utf8'), readFileSync(join(PY, 'data', f), 'utf8'), f);
});

test('blocks: the same keys, hashes and documents', { skip }, () => {
  const Document = messageType('Document');
  const decode = (file: string) => {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const doc: any = Document.toObject(Document.decode(Buffer.from(j.nodelist_b64, 'base64')), { enums: String, longs: Number, defaults: false });
    for (const f of doc.fonts ?? []) f.filename = String(f.filename).replace(/\.reflowtex-[0-9a-f]{8}\.otf$/, '.reflowtex-CONVERTED.otf');
    for (const p of doc.pictures ?? []) p.svg = canonicalSvg(p.svg);            // dvisvgm's glyph numbering varies
    return { hash: j.content_hash, doc };
  };
  const keys = (d: string) => readdirSync(d).filter(f => f.endsWith('.json')).sort();
  const ts = keys(join(SITE, 'data/latex_blocks')), py = keys(join(PY, 'data/latex_blocks'));
  assert.deepEqual(ts, py);
  const differ = ts.filter(k => {
    const a = decode(join(SITE, 'data/latex_blocks', k)), b = decode(join(PY, 'data/latex_blocks', k));
    try { assert.deepStrictEqual(a, b); return false; } catch { return true; }
  });
  console.log(`  ${ts.length - differ.length} of ${ts.length} block(s) identical`);
  assert.deepEqual(differ, []);
});

test('fonts: the same fonts served, identical per code point', { skip }, () => {
  const ts: Record<string, string> = JSON.parse(readFileSync(join(SITE, 'data/latex_font_map.json'), 'utf8'));
  const py: Record<string, string> = JSON.parse(readFileSync(join(PY, 'data/latex_font_map.json'), 'utf8'));
  const norm = (m: Record<string, string>) => Object.keys(m).map(k => k.replace(/\.reflowtex-[0-9a-f]{8}\.otf$/, '.reflowtex-CONVERTED.otf')).sort();
  assert.deepEqual(norm(ts), norm(py), 'the same original fonts');
  const byName = (m: Record<string, string>) => new Map(Object.entries(m).map(([k, v]) => [k.replace(/\.reflowtex-[0-9a-f]{8}\.otf$/, '.reflowtex-CONVERTED.otf') + '|' + k.split('.')[0], v]));
  const a = byName(ts), b = byName(py);
  for (const [k, served] of a) {
    const pyServed = [...b].find(([kk]) => kk === k)?.[1];
    assert.ok(pyServed, k);
    const x = readFileSync(join(SITE, 'static/fonts', served)), y = readFileSync(join(PY, 'fonts', pyServed));
    sameDrawing(x, y, k);
    if (!k.includes('CONVERTED')) assert.deepEqual(names(x), names(y), `${k}: names`);
  }
  console.log(`  ${a.size} served font(s) identical per code point`);
});
