// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/fonts against fonts.py and t1_convert.py. Fonts are compared as
// the browser uses them – per code point: the outline (as opentype.js decodes
// it) and the advance – since the files differ in bytes by construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findOutline, convertOutline } from '../../src/pipeline/fonts/type1.ts';
import { Fonts, glyphRequirements, drawnCodepoints } from '../../src/pipeline/fonts/fonts.ts';
import { normaliseGlyphAddressing, normaliseLegacyFontAddressing } from '../../src/pipeline/fonts/addressing.ts';
import { sameDrawing, names } from './font-compare.ts';
import { readSerializerOutput } from '../../src/pipeline/nodes.ts';
import { CAPTURE, REPO, captures, readCapture, normalise, asDocument } from './helpers.ts';


// the fonts directories the captured builds wrote
const FONT_DIRS = ['website/static/fonts', 'build/parity-testmath-site/fonts', 'build/parity-dmn-site/fonts'].map(d => join(REPO, d));
const findFont = (name: string) => FONT_DIRS.map(d => join(d, name)).find(existsSync);

const legacy = new Map<string, [string, Record<string, number>] | null>();
if (existsSync(CAPTURE)) for (const run of readdirSync(CAPTURE)) {
  const p = join(CAPTURE, run, 'legacy-fonts.json');
  if (existsSync(p)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(p, 'utf8')))) legacy.set(k, v as never);
}

test(`Type 1 conversion: ${legacy.size} face(s) the builds converted`, { skip: legacy.size ? false : 'no captures' }, () => {
  let compared = 0;
  for (const [name, py] of legacy) {
    const found = findOutline(name);
    if (!py) { assert.equal(found, null, `${name}: Python found no outline`); continue; }
    const ts = convertOutline(found![0], name, found![1]);
    assert.deepEqual(Object.fromEntries([...ts.addressing].map(([k, v]) => [String(k), v])), py[1], `${name}: addressing`);
    const file = findFont(py[0]);
    if (!file) continue;                                    // subset away since
    sameDrawing(readFileSync(file), ts.bytes, name);
    compared++;
  }
  assert.ok(compared > 0);
});

// A fresh copy of a capture's fonts directory, with what patch() removed put
// back from TeX Live (addressing reads the provisioned originals).
function fontsCopy(dir: string): string {
  const tmp = mkdtempSync(join(tmpdir(), 'parity-fonts-'));
  cpSync(dir, tmp, { recursive: true });
  return tmp;
}

test('normalise_glyph_addressing: captured calls replayed', { skip: captures('normalise_glyph_addressing').length ? false : 'no captures' }, () => {
  const copies = new Map<string, Fonts>();
  let n = 0;
  for (const f of captures('normalise_glyph_addressing')) {
    const rec = readCapture(f);
    const dir = rec.args[1].fonts_dir as string;
    if (!copies.has(dir)) copies.set(dir, new Fonts(fontsCopy(dir)));
    const d = asDocument(rec.args[0]);
    const r = normaliseGlyphAddressing(d, copies.get(dir)!, () => {});
    assert.equal(r, rec.result, `${f}: rewrites`);
    assert.deepStrictEqual(normalise(d), normalise(asDocument(rec.after[0])), `${f}: document`);
    n++;
  }
  assert.ok(n > 0);
});

test('normalise_legacy_font_addressing: captured calls replayed (converted file names mapped)', { skip: captures('normalise_legacy_font_addressing').length ? false : 'no captures' }, () => {
  const fonts = new Fonts(mkdtempSync(join(tmpdir(), 'parity-legacy-')));
  let n = 0;
  for (const f of captures('normalise_legacy_font_addressing')) {
    const rec = readCapture(f);
    const d = asDocument(rec.args[0]);
    assert.equal(normaliseLegacyFontAddressing(d, fonts), rec.result, `${f}: rewrites`);
    // Python's converted file names → ours (the hashes differ by construction)
    const want = asDocument(rec.after[0]);
    for (const [id, info] of want.fonts as Map<string, { name: string; filename: string }>) {
      const ours = fonts.legacyOtf(info.name);
      if (ours && info.filename.includes('.reflowtex-')) info.filename = ours.served;
      void id;
    }
    assert.deepStrictEqual(normalise(d), normalise(want), `${f}: document`);
    n++;
  }
  assert.ok(n > 0);
});

for (const f of captures('patch_fonts')) {
  test(`patch, subset and verify: ${f.split('/').slice(-3, -2)[0]} build – served fonts identical per code point`, async () => {
    const rec = readCapture(f);
    const pyServed: Record<string, string> = rec.served;
    const docs = readdirSync(rec.build_root).sort().map((k: string) => join(rec.build_root, k, 'output.json')).filter(existsSync)
      .map((p: string) => readSerializerOutput(readFileSync(p, 'utf8')));
    const dir = mkdtempSync(join(tmpdir(), 'parity-patch-'));
    // the converted faces the blocks name, as Python converted them
    const named = new Set(docs.flatMap(d => [...d.fonts.values()].map(i => i.filename)));
    for (const name of named) if (/\.reflowtex-[0-9a-f]{8}\.otf$/.test(name) && existsSync(join(rec.fonts_dir, name)))
      copyFileSync(join(rec.fonts_dir, name), join(dir, name));
    const fonts = new Fonts(dir, rec.local_dir);
    const reqs = glyphRequirements(docs);
    const { drawn, slotFonts } = drawnCodepoints(docs);
    fonts.patch(reqs, () => {});
    if (rec.subset) await fonts.subset(drawn, slotFonts, () => {});
    for (const [file, cps] of drawn) {
      const r = reqs.get(file) ?? new Map();
      for (const c of cps) if (!r.has(c)) r.set(c, null);
      reqs.set(file, r);
    }
    fonts.verify(new Map([...reqs].map(([file, m]) => [file, m.keys()])));
    let compared = 0;
    for (const [orig, ts] of fonts.served) {
      const py = pyServed[orig];
      assert.ok(py, `${orig}: Python served it too`);
      assert.equal(py === orig, ts === orig, `${orig}: modified on one side only (py ${py}, ts ${ts})`);
      const a = readFileSync(join(rec.fonts_dir, py)), b = readFileSync(join(dir, ts));
      sameDrawing(a, b, orig);
      assert.deepEqual(names(b), names(a), `${orig}: name records`);
      compared++;
    }
    assert.deepEqual([...fonts.served.keys()].sort(), Object.keys(pyServed).sort(), 'the same fonts served');
    console.log(`  ${compared} served font(s) compared, ${[...fonts.served].filter(([a, b]) => a !== b).length} of them patched or subset`);
  });
}
