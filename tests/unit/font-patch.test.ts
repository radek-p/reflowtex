// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/fonts/fonts.ts, patched a few fonts at a time (as the browser
// engine patches them, while blocks bring new code points): a patch removes
// only the earlier versions of the fonts it patches, never another font's
// renamed file, which the page and a dump of the fonts still need. prune()
// is the whole build's clean-up of fonts no longer used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fonts, type FileNeeds } from '../../src/pipeline/fonts/fonts.ts';
import { kpsewhich } from '../../src/pipeline/fonts/type1.ts';

const REGULAR = 'lmroman10-regular.otf', ITALIC = 'lmroman10-italic.otf';
const have = !!kpsewhich(REGULAR) && !!kpsewhich(ITALIC);
const quiet = () => {};
const req = (file: string, glyphs: number[]) => new Map([[file, new Map(glyphs.map(g => [0xE100 + g, g] as [number, number]))]]);
/** What the blocks need of OpenType files: code point → glyph index, by file. */
const files = (m: Map<string, Map<number, number | null>>): Map<string, FileNeeds> =>
  new Map([...m].map(([file, reached]) => [file, { name: file, face: { kind: 'opentype', file }, reached, slot: false }]));
const renamed = (dir: string, stem: string) => readdirSync(dir).filter(f => f.startsWith(`${stem}.reflowtex-`)).sort();

test('patching one font leaves the renamed files of fonts patched before', { skip: !have && 'Latin Modern OTF not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-font-patch-'));
  try {
    const a = new Fonts(dir);
    a.patch(files(req(REGULAR, [5, 6])), quiet);
    const regular = a.served.get(REGULAR)!;
    assert.match(regular, /^lmroman10-regular\.reflowtex-[0-9a-f]{8}\.otf$/);

    const b = new Fonts(dir);
    b.patch(files(req(ITALIC, [5])), quiet);
    assert.deepEqual(renamed(dir, 'lmroman10-regular'), [regular], 'the regular face patched before is still there');
    assert.equal(renamed(dir, 'lmroman10-italic').length, 1);

    // the regular face again, with one more glyph: its earlier version goes, the italic stays
    const c = new Fonts(dir);
    c.patch(files(req(REGULAR, [5, 6, 7])), quiet);
    const again = c.served.get(REGULAR)!;
    assert.notEqual(again, regular);
    assert.deepEqual(renamed(dir, 'lmroman10-regular'), [again]);
    assert.equal(renamed(dir, 'lmroman10-italic').length, 1);

    // a whole build's clean-up: renamed files of fonts it does not use go
    c.prune([REGULAR]);
    assert.deepEqual(renamed(dir, 'lmroman10-italic'), []);
    assert.deepEqual(renamed(dir, 'lmroman10-regular'), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a private-use entry in a font without a format-12 cmap: one is made, with the font\'s Unicode map', { skip: !have && 'Latin Modern OTF not installed' }, async () => {
  const { readFileSync } = await import('node:fs');
  const { readSfnt, parseCmap, codepointsToGlyphs } = await import('../../src/pipeline/fonts/sfnt.ts');
  const { PUA_BASE } = await import('../../src/pipeline/fonts/addressing.ts');
  const dir = mkdtempSync(join(tmpdir(), 'rtx-font-patch-'));
  try {
    const before = codepointsToGlyphs(readSfnt(readFileSync(kpsewhich(REGULAR)!)));
    const f = new Fonts(dir);
    f.patch(files(new Map([[REGULAR, new Map([[PUA_BASE + 300, 300]])]])), quiet);
    const served = f.served.get(REGULAR)!;
    assert.match(served, /\.reflowtex-[0-9a-f]{8}\.otf$/, 'patched (was: skipped, the glyph drawn blank)');
    const font = readSfnt(readFileSync(join(dir, served)));
    const f12 = parseCmap(font.tables.get('cmap')!).find(s => s.platformID === 3 && s.encodingID === 10 && s.format === 12);
    assert.ok(f12, 'a (3,10) format-12 subtable');
    assert.equal(f12!.map.get(PUA_BASE + 300), 300);
    assert.equal(f12!.map.get(0x41), before.get(0x41), "and it maps the font's own characters as before");
    assert.equal(f12!.map.get(0x2014), before.get(0x2014));
    // and a shaper reading the file finds the glyph by its code point (the browser's way)
    const hb = await import('harfbuzzjs');
    const bytes = readFileSync(join(dir, served));
    const hfont = new hb.Font(new hb.Face(new hb.Blob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))));
    const shape = (text: string) => { const b = new hb.Buffer(); b.addText(text); b.guessSegmentProperties(); hb.shape(hfont, b); return b.getGlyphInfos().map(g => g.codepoint); };
    assert.deepEqual(shape(String.fromCodePoint(PUA_BASE + 300)), [300]);
    assert.deepEqual(shape('A'), [before.get(0x41)]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('whole: a font patched for any glyph gets every glyph, the same file whatever the blocks drew', { skip: !have && 'Latin Modern OTF not installed' }, async () => {
  const { readFileSync } = await import('node:fs');
  const { readSfnt, codepointsToGlyphs, numGlyphs } = await import('../../src/pipeline/fonts/sfnt.ts');
  const { PUA_BASE } = await import('../../src/pipeline/fonts/addressing.ts');
  const dirs = [mkdtempSync(join(tmpdir(), 'rtx-font-patch-')), mkdtempSync(join(tmpdir(), 'rtx-font-patch-'))];
  try {
    const pua = (gs: number[]) => new Map(gs.map(g => [PUA_BASE + g, g] as [number, number | null]));
    const a = new Fonts(dirs[0]!), b = new Fonts(dirs[1]!);
    a.patch(files(new Map([[REGULAR, pua([300])], [ITALIC, new Map([[0x41, null]])]])), quiet, { whole: true });
    b.patch(files(new Map([[REGULAR, pua([5, 700])]])), quiet, { whole: true });
    const sa = a.served.get(REGULAR)!, sb = b.served.get(REGULAR)!;
    assert.match(sa, /\.reflowtex-[0-9a-f]{8}\.otf$/);
    assert.equal(sa, sb, 'one name for both documents');
    assert.deepEqual(readFileSync(join(dirs[0]!, sa)), readFileSync(join(dirs[1]!, sb)), 'the same bytes');
    const font = readSfnt(readFileSync(join(dirs[0]!, sa)));
    const map = codepointsToGlyphs(font);
    for (let g = 0; g < numGlyphs(font); g++) assert.equal(map.get(PUA_BASE + g), g, `glyph ${g} by its private-use code point`);
    assert.equal(a.served.get(ITALIC), ITALIC, 'a font that needs nothing stays the original');
  } finally { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
});
