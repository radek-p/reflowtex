// SPDX-License-Identifier: AGPL-3.0-or-later
// A PDF page as SVG (pictures-mupdf.ts), then rewritten for the page
// (pictures.ts): one small PDF for each kind of content an included figure
// may hold that has been lost on the way before (figure-pdfs.ts). Images in
// the SVG are decoded and checked pixel by pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mupdf from 'mupdf';
import { dropForbiddenCharRefs, pdfPageSvg } from '../../src/pipeline/pictures-mupdf.ts';
import { rewritePictureSvg } from '../../src/pipeline/pictures.ts';
import * as F from './figure-pdfs.ts';

/** The RGB pixels of every data: image in `svg`, in order (getNumberOfComponents counts alpha). */
function images(svg: string): { w: number; h: number; px: (x: number, y: number) => number[] }[] {
  return [...svg.matchAll(/href="data:image\/(?:png|jpeg);base64,([^"]+)"/g)].map(m => {
    const img = new mupdf.Image(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'));
    const pm = img.toPixmap();
    const n = pm.getNumberOfComponents(), colours = n - pm.getAlpha(), stride = pm.getStride(), p = pm.getPixels();
    return {
      w: pm.getWidth(), h: pm.getHeight(),
      px: (x: number, y: number) => {
        const i = y * stride + x * n;
        return colours === 1 ? [p[i], p[i], p[i]] : [p[i], p[i + 1], p[i + 2]];
      },
    };
  });
}

const near = (got: number[], want: number[], tol = 3) => got.every((v, i) => Math.abs(v - want[i]) <= tol);
const hex = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
/** The glyph uses: their text, the outline they draw, and their attributes. */
const uses = (svg: string) => [...svg.matchAll(/<use data-text="([^"]*)" xlink:href="#([^"]+)"([^>]*)>/g)]
  .map(m => ({ text: m[1], ref: m[2], attrs: m[3] }));
/** The element with id `id`, whole. */
const element = (svg: string, id: string) => {
  const at = svg.indexOf(`id="${id}"`);
  const start = svg.lastIndexOf('<', at), name = /<(\w+)/.exec(svg.slice(start))![1];
  return svg.slice(start, svg.indexOf(`</${name}>`, at) + name.length + 3);
};
const scaleOf = (attrs: string) => {
  const [a, b, c, d] = /transform="matrix\(([^)]*)\)"/.exec(attrs)![1].split(',').map(Number);
  return Math.sqrt(Math.abs(a * d - b * c));
};

test('Type 3 text with glyphs drawn by paths (as Matplotlib writes it) is drawn, glyph by glyph', () => {
  const svg = pdfPageSvg(F.type3VectorPdf(), 1);
  const g = uses(svg);
  assert.deepEqual(g.map(u => u.text), ['A', 'B']);
  assert.match(element(svg, g[0].ref), /d="M50 0H550V700H50ZM150 100V600H450V100Z"/, 'A: a square with a square hole');
  assert.match(element(svg, g[1].ref), /d="M50 0V700C400 700 600 600 600 350 600 100 400 0 50 0Z"/, 'B: the bowl');
  for (const u of g) {
    assert.match(u.attrs, /fill="#0000ff"/);
    assert.equal(scaleOf(u.attrs), 20, 'at 20 bp');
  }
  // and themed like any other drawing
  const pic = rewritePictureSvg(svg, 'p1-', true);
  assert.equal((pic.svg.match(/fill="var\(--latex-color-0000ff, #0000ff\)"/g) ?? []).length, 2);
});

test('Type 3 text in a bitmap font (as pdfTeX writes METAFONT\'s) is drawn: each glyph its bitmap, in the text\'s colour', () => {
  const svg = pdfPageSvg(F.type3BitmapPdf(), 1);
  const g = uses(svg);
  assert.equal(g.length, 2);
  for (const u of g) {
    assert.match(u.attrs, /fill="#ff0000"/);
    const def = element(svg, u.ref);
    // the bitmap is a mask over a rectangle that takes the use's fill
    assert.match(def, /<rect [^>]*mask="url\(#[^)]+\)"\/>/);
    assert.doesNotMatch(/<rect [^>]*>/.exec(def)![0], /fill=/);
    const [img] = images(def);
    assert.deepEqual([img.w, img.h], [8, 8]);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const inked = (F.BITMAP_GLYPH[y] >> (7 - x)) & 1;
      assert.deepEqual(img.px(x, y), inked ? [255, 255, 255] : [0, 0, 0], `pixel ${x}, ${y}`);
    }
  }
  const pic = rewritePictureSvg(svg, 'p1-', true);
  assert.match(pic.svg, /<use data-text="a" xlink:href="#p1-font_1_97"[^>]*fill="var\(--latex-color-ff0000, #ff0000\)"/);
});

test('a glyph named for a control character is drawn, without the character XML forbids', () => {
  // a27 reads as U+001B, which MuPDF writes as a reference no XML parser takes
  const svg = pdfPageSvg(F.type3BitmapPdf(), 1);
  assert.doesNotMatch(svg, /&#x0*1b;/i);
  assert.deepEqual(uses(svg).map(u => u.text), ['a', ''], 'the glyph stays, with no text');
  assert.equal(dropForbiddenCharRefs('a&#x1b;b&#27;c&#x0009;&#xA;&#x3a9;&#x1d446;&#xfffe;&#xd800;&#x7;&#38;'), 'abc&#x0009;&#xA;&#x3a9;&#x1d446;&#38;');
});

test('fills in an ICC colour space come out in the profile\'s colours', () => {
  const svg = pdfPageSvg(F.iccFillsPdf(), 1);
  const fills = [...svg.matchAll(/<path [^>]*fill="(#[0-9a-f]{6})"/g)].map(m => hex(m[1]));
  assert.equal(fills.length, 3, svg);
  // red, then blue in the PDF: the profile's red is sRGB's green, its blue sRGB's red
  assert.ok(near(fills[1], [0, 255, 0]), `the first square: ${fills[1]}`);
  assert.ok(near(fills[2], [255, 0, 0]), `the second square: ${fills[2]}`);
  // the opaque white page goes from an included figure, not from a captured picture
  const page = /d="M0 0H200V100H0Z"/;
  assert.doesNotMatch(rewritePictureSvg(svg, 'p1-', true).svg, page);
  assert.match(rewritePictureSvg(svg, 'p1-', false).svg, page);
});

test('an Indexed image is drawn with its palette\'s colours', () => {
  const svg = pdfPageSvg(F.indexedImagePdf(), 1);
  const [img] = images(svg);
  assert.deepEqual([img.w, img.h], [2, 2]);
  assert.deepEqual([img.px(0, 0), img.px(1, 0), img.px(0, 1), img.px(1, 1)], F.INDEXED_PALETTE);
  assert.match(svg, /<g transform="matrix\(20,0,0,10,10,70\)">\s*<image id="image_1" width="2" height="2"/, 'over 40 × 20 bp at (10, 10)');
});

test('a Matplotlib heatmap (Indexed, behind PNG predictors) is drawn cell by cell', () => {
  const svg = pdfPageSvg(F.heatmapPdf(), 1);
  const [img] = images(svg);
  assert.deepEqual([img.w, img.h], [F.HEATMAP_W, F.HEATMAP_H]);
  for (let y = 0; y < F.HEATMAP_H; y++) for (let x = 0; x < F.HEATMAP_W; x++)
    assert.deepEqual(img.px(x, y), F.HEATMAP_PALETTE[F.HEATMAP_INDEX(x, y)], `cell ${x}, ${y}`);
});

test('an axial shading is drawn as a smooth fade, clipped to its area', () => {
  const svg = pdfPageSvg(F.shadingPdf(), 1);
  assert.match(svg, /<clipPath id="clip_1">\s*<path [^>]*d="M10 10H110V60H10Z"/);
  const [img] = images(svg);
  const row = Array.from({ length: img.w }, (_, x) => img.px(x, Math.floor(img.h / 2)));
  assert.ok(near(row[0], [255, 0, 0], 8) && near(row.at(-1)!, [0, 0, 255], 8), `ends ${row[0]} and ${row.at(-1)}`);
  const mid = row[Math.floor(row.length / 2)];
  assert.ok(mid[0] > 90 && mid[0] < 165 && mid[2] > 90 && mid[2] < 165, `the middle is a mix: ${mid}`);
  for (let x = 1; x < row.length; x++) assert.ok(row[x][0] <= row[x - 1][0] && row[x][2] >= row[x - 1][2], `fading at ${x}`);
});

test('a tiling pattern is drawn as an SVG pattern of its cell, themed', () => {
  const svg = pdfPageSvg(F.tilingPatternPdf(), 1);
  const pic = rewritePictureSvg(svg, 'p1-', true).svg;
  assert.match(pic, /<pattern id="p1-pattern_2" [^>]*width="10" height="10">/);
  assert.match(pic, /<rect [^>]*fill="url\(#p1-pattern_2\)" x="10" y="10" width="80" height="80"\/>/);
  const tile = element(pic, 'p1-pattern_tile_2');
  assert.match(tile, /d="M0 0H5V5H0Z" fill="var\(--latex-color-ff0000, #ff0000\)"/);
  assert.match(tile, /stroke="var\(--latex-color-0000ff, #0000ff\)" d="M0 0 10 10"/);
});

test('stroked text is stroked as wide as the PDF says, under a transformation that scales it too', () => {
  const svg = pdfPageSvg(F.strokedTextPdf(), 1);
  const stroked = uses(svg).filter(u => /stroke-width=/.test(u.attrs));
  assert.deepEqual(stroked.map(u => u.text), ['A', 'B']);
  for (const u of stroked) {
    const w = Number(/stroke-width="([^"]*)"/.exec(u.attrs)![1]) * scaleOf(u.attrs);
    assert.ok(Math.abs(w - 0.5) < 1e-4, `${u.text}: ${w} bp on the page, not 0.5`);
  }
  assert.equal(uses(svg).filter(u => !/stroke=/.test(u.attrs)).length, 2, 'and filled first');
});

test('a soft mask keeps its own colours, black by default, in every theme', () => {
  const pic = rewritePictureSvg(pdfPageSvg(F.softMaskPdf(), 1), 'p1-', false).svg;
  const content = element(pic, 'p1-mask_1_contents');
  assert.match(content, /d="M100 0H200V100H100Z" fill="#ffffff"/, 'white stays white: not the page\'s colour');
  assert.match(content, /d="M0 0H100V100H0Z"\/>/, 'black is written as no fill');
  assert.doesNotMatch(content, /var\(--latex-color/);
  assert.match(pic, /<mask fill="#000000" id="p1-mask_1"/, 'which the mask makes black, not the theme\'s text colour');
  assert.match(pic, /<g mask="url\(#p1-mask_1\)">\s*<path [^>]*fill="var\(--latex-color-ff0000, #ff0000\)"/, 'what it masks is themed');
});

test('a page MuPDF cannot draw, or a page it does not have, fails with a reason', () => {
  assert.throws(() => pdfPageSvg(F.indexedImagePdf(), 2), /the PDF has 1 page, not a page 2/);
  assert.throws(() => pdfPageSvg(Buffer.from('not a PDF'), 1), /./);
});
