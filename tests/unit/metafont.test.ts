// SPDX-License-Identifier: AGPL-3.0-or-later
// METAFONT-only fonts (src/pipeline/fonts/metafont.ts): the PK reader, the
// bitmap-to-outline step, the code points a family's glyphs get, and a real
// font rendered by METAFONT and served as the outlines of its pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { readPk } from '../../src/pipeline/fonts/pk.ts';
import { pixelContours, type Contour } from '../../src/pipeline/fonts/pixels.ts';
import { classicAddressing, pixelFont, renderPk } from '../../src/pipeline/fonts/metafont.ts';
import { readTfm } from '../../src/pipeline/fonts/tfm.ts';
import { kpsewhich } from '../../src/pipeline/fonts/type1.ts';
import { Fonts } from '../../src/pipeline/fonts/fonts.ts';
import { slotCode } from '../../src/shared/glyph-text.ts';
import { Log } from '../../src/shared/log.ts';

// ── The PK reader ───────────────────────────────────────────────────────────

const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
/** A PK file: the preamble (a comment, 10 pt, 4 px per pt), these
 *  short-form character packets, a special, the postamble. A packet: [flag,
 *  code, tfm width (fix_word, 3 bytes), escapement, w, h, hoff, voff,
 *  raster…]; its length counts what follows the code. */
function pkFile(packets: number[][]): Uint8Array {
  const out = [247, 89, 2, 0x41, 0x42, ...u32(10 * 2 ** 20), ...u32(0), ...u32(4 * 2 ** 16), ...u32(4 * 2 ** 16), 240, 3, 1, 2, 3];
  for (const [flag, code, ...rest] of packets) out.push(flag, rest.length, code, ...rest);
  out.push(245, 246, 246);
  return new Uint8Array(out);
}
const rowsOf = (rows: Uint8Array[]) => rows.map(r => [...r].join(''));

test('PK: a raw bitmap (dyn_f 14), rows packed bit after bit', () => {
  // 5 × 2: 10111 01100, bits running on from one row to the next
  const pk = readPk(pkFile([[0xE0, 65, 0x08, 0x00, 0x00, 5, 5, 2, 1, 2, 0b10111011, 0b00000000]]));
  assert.equal(pk.designSize, 10);
  assert.equal(pk.hppp, 4);
  const g = pk.glyphs.get(65)!;
  assert.deepEqual([g.width, g.height, g.hoff, g.voff, g.tfmWidth], [5, 2, 1, 2, 0.5]);
  assert.deepEqual(rowsOf(g.rows), ['10111', '01100']);
});

test('PK: runs of alternating colour, a repeated row, a packed number of two nybbles', () => {
  // 3 × 3, black first (dyn_f 8): a run of 3 black with the row repeated once
  // (nybble 15), then white 1, black 1, white 1
  const a = readPk(pkFile([[0x88, 66, 0, 0, 0, 3, 3, 3, 0, 3, 0xF3, 0x11, 0x10]])).glyphs.get(66)!;
  assert.deepEqual(rowsOf(a.rows), ['111', '111', '010']);
  // 20 × 1, white first (dyn_f 1): a nybble up to dyn_f is the count itself
  // (1 white); a larger one takes the next too, (i − dyn_f − 1)·16 + next +
  // dyn_f + 1 (3, 0: 18 black); then 1 white
  const b = readPk(pkFile([[0x10, 67, 0, 0, 0, 20, 20, 1, 0, 1, 0x13, 0x01]])).glyphs.get(67)!;
  assert.deepEqual(rowsOf(b.rows), ['01111111111111111110']);
});

// ── Pixels to outlines ──────────────────────────────────────────────────────

const bitmap = (...rows: string[]) => rows.map(r => Uint8Array.from(r, c => (c === '#' ? 1 : 0)));
/** Signed area (y up): positive anticlockwise. */
const area = (c: Contour) => c.reduce((a, [x, y], i) => { const [x1, y1] = c[(i + 1) % c.length]; return a + (x * y1 - x1 * y); }, 0) / 2;

test('pixels: a block is one rectangle, at the reference point', () => {
  const cs = pixelContours(bitmap('###', '###'), 1, 2);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].length, 4, 'straight runs make one side each');
  assert.equal(area(cs[0]), 6);
  const xs = cs[0].map(p => p[0]), ys = cs[0].map(p => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-1, 2, 0, 2]);
});

test('pixels: a ring is an outer contour and a hole turning the other way', () => {
  const cs = pixelContours(bitmap('###', '#.#', '###'), 0, 3);
  assert.equal(cs.length, 2);
  const areas = cs.map(area).sort((a, b) => a - b);
  assert.deepEqual(areas, [-1, 9]);
});

test('pixels: an L has six corners; pixels meeting at a corner stay apart; ink is the pixel count', () => {
  const l = pixelContours(bitmap('#..', '#..', '###'), 0, 0);
  assert.equal(l.length, 1);
  assert.equal(l[0].length, 6);
  assert.equal(area(l[0]), 5);
  const diag = pixelContours(bitmap('#.', '.#'), 0, 0);
  assert.equal(diag.length, 2);
  assert.deepEqual(diag.map(area), [1, 1]);
  const blob = bitmap('.##.#', '##.##', '#####', '.#..#');
  const ink = blob.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
  assert.equal(pixelContours(blob, 0, 0).reduce((a, c) => a + area(c), 0), ink);
});

// ── Code points ─────────────────────────────────────────────────────────────

test('bbm: double-struck letters and digits, ℝ and the others Unicode had first; else ASCII; else private use', () => {
  const a = classicAddressing('bbm10', [0x52, 0x41, 0x31, 0x6B, 0x5A, 0x28, 0x0B]);
  assert.deepEqual([0x52, 0x41, 0x31, 0x6B, 0x5A].map(s => String.fromCodePoint(a.get(s)!)), ['ℝ', '𝔸', '𝟙', '𝕜', 'ℤ']);
  assert.equal(a.get(0x28), 0x28);
  assert.equal(a.get(0x0B), slotCode(0x0B));
  assert.equal(String.fromCodePoint(classicAddressing('bbmss12', [0x4E]).get(0x4E)!), 'ℕ');
  // a font of no known family: printable ASCII as itself
  assert.equal(classicAddressing('logo10', [0x41]).get(0x41), 0x41);
});

// ── A real METAFONT font ────────────────────────────────────────────────────

const HAVE_MF = !!kpsewhich('cmr10.mf') && (() => { try { execFileSync('mktexpk', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test("cmr10 rendered by METAFONT: every character's width is the TFM's, and its pixels are its outline", { skip: !HAVE_MF && 'METAFONT or the cm sources not installed' }, () => {
  const work = mkdtempSync(join(tmpdir(), 'rtx-metafont-'));
  try {
    const pkPath = renderPk('cmr10', work, 600);
    assert.equal(typeof pkPath, 'string', JSON.stringify(pkPath));
    const pkBytes = readFileSync(pkPath as string), tfmBytes = readFileSync(kpsewhich('cmr10.tfm')!);
    const pk = readPk(pkBytes), tfm = readTfm(tfmBytes);
    assert.ok(pk.glyphs.size >= 128, `${pk.glyphs.size} characters`);
    for (const [code, g] of pk.glyphs) {
      const w = tfm.char(code, tfm.designSize)!.width / tfm.designSize;
      assert.ok(Math.abs(g.tfmWidth - w) < 2 ** -16, `${code}: PK width ${g.tfmWidth}, TFM ${w}`);
    }
    // A: about as tall as the TFM says (its apex overshoots a little)
    const A = pk.glyphs.get(65)!, px = pk.vppp;
    const height = tfm.char(65, tfm.designSize)!.height / 65536;
    assert.ok(Math.abs(A.voff / px - height) < 0.5, `A: ${A.voff / px} pt above the baseline, TFM ${height}`);

    const { bytes, addressing } = pixelFont('cmr10', pkBytes, tfmBytes);
    const font = opentype.parse(new Uint8Array(bytes).buffer);
    const g = font.charToGlyph(String.fromCodePoint(addressing.get(65)!));
    // its outline is its bitmap, pixel for pixel (a unit is a pixel, near enough)
    const box = g.getBoundingBox(), k = font.unitsPerEm / (pk.designSize * pk.hppp);
    assert.deepEqual([box.x1, box.x2, box.y1, box.y2].map(v => Math.round(v / k)),
                     [-A.hoff, A.width - A.hoff, A.voff - A.height, A.voff]);
    const advance = tfm.char(65, tfm.designSize)!.width / tfm.designSize;
    assert.ok(Math.abs(g.advanceWidth! / font.unitsPerEm - advance) < 2 / font.unitsPerEm, 'the TFM width as its advance');
    // a code point past the BMP is in its cmap too (opentype.js writes none)
    const ds = pixelFont('bbm10', pkBytes, tfmBytes);
    const dsFont = opentype.parse(new Uint8Array(ds.bytes).buffer);
    assert.equal(ds.addressing.get(0x45), 0x1D53C);
    assert.equal(dsFont.charToGlyph('𝔼').name, 'g69', 'E as 𝔼 (U+1D53C)');
    // made again: the same bytes (a content-hashed name stays)
    assert.deepEqual(pixelFont('cmr10', pkBytes, tfmBytes).bytes, bytes);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

// ── The producer chain ──────────────────────────────────────────────────────

const HAVE_LOGO = HAVE_MF && !!kpsewhich('logo10.mf') && !kpsewhich('logo10.pfb');
test('a font with no Type 1 outline gets its METAFONT bitmaps; one with neither, boxes with both reasons; a cached face is made again', { skip: !HAVE_LOGO && 'METAFONT, or logo10 as METAFONT-only, not installed' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'rtx-fonts-')), work = mkdtempSync(join(tmpdir(), 'rtx-work-'));
  try {
    const got = new Fonts(out, null, work).legacyOtf('logo10');
    assert.ok('face' in got, JSON.stringify(got));
    assert.equal(got.face.kind, 'bitmap');
    assert.match(got.face.file, /^logo10\.reflowtex-[0-9a-f]{8}\.otf$/);
    assert.equal(got.addressing.get(0x4D), 0x4D, 'M as itself (no family table: ASCII)');
    const none = new Fonts(out, null, work).legacyOtf('rtxnoface10');
    assert.ok('reason' in none);
    assert.match(none.reason, /no Type 1 outline of rtxnoface10.*; no METAFONT source rtxnoface10\.mf/);
    // blocks restored from a cache name the file; with it gone, it is made again, the same
    rmSync(join(out, got.face.file));
    new Fonts(out, null, work).provision([{ name: 'logo10', face: got.face }], new Log('pipeline'));
    assert.ok(readFileSync(join(out, got.face.file)).length > 0);
  } finally { rmSync(out, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); }
});
