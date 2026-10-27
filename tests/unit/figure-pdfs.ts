// SPDX-License-Identifier: AGPL-3.0-or-later
// Small PDFs, written here byte by byte, each with one kind of content that
// included figures hold and that has been lost on the way to SVG before:
// Type 3 text (a vector font as Matplotlib writes it, a bitmap font as pdfTeX
// and LuaTeX write METAFONT's), fills in an ICC colour space, an Indexed
// image, a Matplotlib heatmap (an Indexed image behind PNG predictors), a
// shading, a tiling pattern, stroked text under a scaling transformation, a
// glyph whose name maps it to a control character, and a soft mask.
import { deflateSync } from 'node:zlib';

/** A one-page PDF, `w` × `h` bp: the page's resources and content, and the
 *  objects they refer to, numbered from 5 (1–4 are the catalogue, the page
 *  tree, the page and its content). */
export function onePagePdf(o: { resources: string; content: string; objects?: (string | Buffer)[]; w?: number; h?: number }): Buffer {
  const { w = 200, h = 100 } = o;
  const body: Buffer[] = [];
  const parts: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources ${o.resources} /Contents 4 0 R >>`,
    stream('', o.content),
    ...(o.objects ?? []),
  ];
  let at = 0;
  const push = (b: Buffer) => { body.push(b); at += b.length; };
  push(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1'));
  const offsets: number[] = [];
  parts.forEach((p, i) => {
    offsets.push(at);
    push(Buffer.from(`${i + 1} 0 obj\n`, 'latin1'));
    push(typeof p === 'string' ? Buffer.from(p, 'latin1') : p);
    push(Buffer.from('\nendobj\n', 'latin1'));
  });
  push(Buffer.from(`xref\n0 ${parts.length + 1}\n0000000000 65535 f \n${offsets.map(x => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(body);
}

/** A stream object: its dictionary's entries and its bytes. */
export function stream(dict: string, data: string | Buffer): Buffer {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${bytes.length} >>\nstream\n`, 'latin1'), bytes, Buffer.from('\nendstream', 'latin1')]);
}

const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

/** Type 3 text as Matplotlib writes it: glyphs drawn by filled paths after
 *  d1, named by their characters, in blue. "AB" at 20 bp from (10, 60). */
export function type3VectorPdf(): Buffer {
  const procs = {
    // a square with a square hole
    A: '600 0 50 0 550 700 d1\n50 0 m 550 0 l 550 700 l 50 700 l h\n150 100 m 150 600 l 450 600 l 450 100 l h\nf',
    // a bowl of curves
    B: '650 0 50 0 600 700 d1\n50 0 m 50 700 l 400 700 600 600 600 350 c 600 100 400 0 50 0 c h\nf',
  };
  return onePagePdf({
    resources: '<< /Font << /F1 5 0 R >> >>',
    content: '0 0 1 rg BT /F1 20 Tf 10 60 Td (AB) Tj ET',
    objects: [
      `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 700 700] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs 6 0 R
/Encoding << /Type /Encoding /Differences [65 /A /B] >> /FirstChar 65 /LastChar 66 /Widths [600 650] /Resources << >> >>`,
      '<< /A 7 0 R /B 8 0 R >>',
      stream('', procs.A), stream('', procs.B),
    ],
  });
}

/** The 8 × 8 bitmap of the bitmap font's glyph: a frame, one pixel wide, with
 *  a dot in its middle (rows top to bottom, a set bit inked). */
export const BITMAP_GLYPH = [0xff, 0x81, 0x81, 0x99, 0x99, 0x81, 0x81, 0xff];

/** Type 3 text as pdfTeX and LuaTeX write a METAFONT font's: each glyph an
 *  8 × 8 image mask after d1, named a<code> with no ToUnicode map – so code
 *  27 (an ff ligature in OT1) is named a27, which reads as U+001B. In red,
 *  codes 97 and 27 at 16 bp from (20, 20). */
export function type3BitmapPdf(): Buffer {
  const proc = Buffer.concat([
    Buffer.from('8 0 0 0 8 8 d1\nq 8 0 0 8 0 0 cm\nBI\n/W 8\n/H 8\n/IM true\n/BPC 1\n/D [1 0]\nID ', 'latin1'),
    // /D [1 0]: a 1 bit paints, as pdfTeX writes PK glyphs
    Buffer.from(BITMAP_GLYPH), Buffer.from('\nEI\nQ', 'latin1')]);
  return onePagePdf({
    resources: '<< /Font << /F1 5 0 R >> >>',
    content: '1 0 0 rg BT /F1 16 Tf 20 20 Td (a\\033) Tj ET',
    objects: [
      `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 8 8] /FontMatrix [0.125 0 0 0.125 0 0] /CharProcs 6 0 R
/Encoding << /Type /Encoding /Differences [27 /a27 97 /a97] >> /FirstChar 27 /LastChar 97 /Widths [8 ${'0 '.repeat(69)}8] /Resources << >> >>`,
      '<< /a27 7 0 R /a97 7 0 R >>',
      stream('', proc),
    ],
  });
}

/** An ICC profile for RGB: matrix and curves, gamma 1, `primaries` the XYZ
 *  (D50) of its red, green and blue. */
export function iccProfile(primaries: [number, number, number][]): Buffer {
  const s15 = (x: number) => { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(x * 65536)); return b; };
  const xyz = (v: number[]) => Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), ...v.map(s15)]);
  const curve = Buffer.from('curv\0\0\0\0\0\0\0\x01\x01\x00\0\0', 'latin1');          // one entry: gamma 1.0
  const text = 'test RGB';
  const desc = Buffer.concat([Buffer.from('desc\0\0\0\0', 'latin1'), Buffer.from([0, 0, 0, text.length + 1]), Buffer.from(text + '\0', 'latin1'), Buffer.alloc(4 + 4 + 2 + 1 + 67)]);
  const tags: [string, Buffer][] = [['desc', desc], ['wtpt', xyz([0.9642, 1, 0.8249])],
    ['rXYZ', xyz(primaries[0])], ['gXYZ', xyz(primaries[1])], ['bXYZ', xyz(primaries[2])],
    ['rTRC', curve], ['gTRC', curve], ['bTRC', curve]];
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)]);
  let offset = 128 + 4 + 12 * tags.length;
  const table: Buffer[] = [], data: Buffer[] = [];
  for (const [sig, b] of tags) {
    const e = Buffer.alloc(12);
    e.write(sig, 0, 'latin1'); e.writeUInt32BE(offset, 4); e.writeUInt32BE(b.length, 8);
    table.push(e); data.push(pad(b)); offset += pad(b).length;
  }
  const header = Buffer.alloc(128);
  header.writeUInt32BE(offset, 0);
  header.writeUInt32BE(0x02100000, 8);
  header.write('mntrRGB XYZ ', 12, 'latin1');
  header.write('acsp', 36, 'latin1');
  s15(0.9642).copy(header, 68); s15(1).copy(header, 72); s15(0.8249).copy(header, 76);
  const count = Buffer.alloc(4); count.writeUInt32BE(tags.length);
  return Buffer.concat([header, count, ...table, ...data]);
}

/** sRGB's primaries, adapted to D50. */
export const SRGB_PRIMARIES: [number, number, number][] = [[0.4361, 0.2225, 0.0139], [0.3851, 0.7169, 0.0971], [0.1431, 0.0606, 0.7141]];

/** Fills in an ICC colour space, as Figma writes all its colours: a square
 *  in the space's first colour (1 0 0), one in its third (0 0 1), and an
 *  opaque white page first. Its profile's primaries are sRGB's in another
 *  order – red is sRGB's green, green its blue, blue its red – so what is
 *  drawn shows the profile was read. */
export function iccFillsPdf(): Buffer {
  const icc = iccProfile([SRGB_PRIMARIES[1], SRGB_PRIMARIES[2], SRGB_PRIMARIES[0]]);
  return onePagePdf({
    resources: '<< /ColorSpace << /CS0 [/ICCBased 5 0 R] >> >>',
    content: '/CS0 cs 1 1 1 scn 0 0 200 100 re f 1 0 0 scn 10 10 40 40 re f 0 0 1 scn 60 10 40 40 re f',
    objects: [stream('/N 3 /Alternate /DeviceRGB', icc)],
  });
}

/** A 2 × 2 Indexed image, uncompressed, over 40 × 20 bp at (10, 10): red,
 *  green on top, blue, white below. */
export const INDEXED_PALETTE = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
export function indexedImagePdf(): Buffer {
  const hex = INDEXED_PALETTE.flat().map(v => v.toString(16).padStart(2, '0')).join('');
  return onePagePdf({
    resources: '<< /XObject << /Im1 5 0 R >> >>',
    content: 'q 40 0 0 20 10 10 cm /Im1 Do Q',
    objects: [stream(`/Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace [/Indexed /DeviceRGB 3 <${hex}>]`, Buffer.from([0, 1, 2, 3]))],
  });
}

/** A heatmap as Matplotlib's imshow writes it: an Indexed image of 16 × 4
 *  cells, Flate-compressed behind PNG predictors (each row's filter byte:
 *  Sub), its palette a ramp from dark blue to yellow. Cell (x, y) has
 *  colour HEATMAP_INDEX(x, y), y from the top. */
export const HEATMAP_W = 16, HEATMAP_H = 4;
export const HEATMAP_INDEX = (x: number, y: number) => (x + 4 * y) % 16;
export const HEATMAP_PALETTE = Array.from({ length: 16 }, (_, i) => [Math.round(i * 255 / 15), Math.round(i * 200 / 15), Math.round(120 - i * 120 / 15)]);
export function heatmapPdf(): Buffer {
  const rows: number[] = [];
  for (let y = 0; y < HEATMAP_H; y++) {
    rows.push(1);                              // PNG filter Sub: each byte less the one before it
    for (let x = 0; x < HEATMAP_W; x++) rows.push((HEATMAP_INDEX(x, y) - (x ? HEATMAP_INDEX(x - 1, y) : 0) + 256) % 256);
  }
  const hex = HEATMAP_PALETTE.flat().map(v => v.toString(16).padStart(2, '0')).join('');
  return onePagePdf({
    resources: '<< /XObject << /I1 5 0 R >> >>',
    content: 'q 160 0 0 40 20 30 cm /I1 Do Q',
    objects: [stream(`/Type /XObject /Subtype /Image /Width ${HEATMAP_W} /Height ${HEATMAP_H} /ColorSpace [/Indexed /DeviceRGB ${HEATMAP_PALETTE.length - 1} <${hex}>]
/BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 10 /Colors 1 /Columns ${HEATMAP_W} /BitsPerComponent 8 >>`, deflateSync(Buffer.from(rows)))],
  });
}

/** An axial shading, red at x = 10 to blue at x = 110, clipped to 10 10 100 50. */
export function shadingPdf(): Buffer {
  return onePagePdf({
    resources: '<< /Shading << /Sh1 5 0 R >> >>',
    content: 'q 10 10 100 50 re W n /Sh1 sh Q',
    objects: ['<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [10 0 110 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>'],
  });
}

/** A square of 80 bp filled with a tiling pattern: a red 5 × 5 square and a
 *  blue diagonal in each 10 × 10 cell. */
export function tilingPatternPdf(): Buffer {
  return onePagePdf({
    resources: '<< /Pattern << /P1 5 0 R >> >>',
    content: '/Pattern cs /P1 scn 10 10 80 80 re f',
    objects: [stream('/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources << >>',
      '1 0 0 rg 0 0 5 5 re f 0 0 1 RG 0 0 m 10 10 l S')],
  });
}

/** Text filled, then stroked (render mode 2: fake bold, as macOS's Quartz
 *  writes it) 2 units wide, under a `cm` that scales by 1/4: the stroke is
 *  0.5 bp wide on the page. "A" at 20 bp. Beside it, the same with no scale
 *  around the text, 0.5 wide: "B". */
export function strokedTextPdf(): Buffer {
  return onePagePdf({
    resources: '<< /Font << /F1 5 0 R >> >>',
    content: '1 0 0 RG q 0.25 0 0 0.25 0 0 cm BT 2 Tr 2 w /F1 80 Tf 40 160 Td (A) Tj ET Q BT 2 Tr 0.5 w /F1 20 Tf 100 40 Td (B) Tj ET',
    objects: [HELVETICA],
  });
}

/** A red rectangle seen through a luminosity soft mask: black (the default
 *  colour, which MuPDF writes as no fill at all) on the left half, white on
 *  the right. */
export function softMaskPdf(): Buffer {
  return onePagePdf({
    resources: '<< /ExtGState << /G1 5 0 R >> >>',
    content: '/G1 gs 1 0 0 rg 0 0 200 100 re f',
    objects: ['<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G 6 0 R >> >>',
      stream('/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Group << /S /Transparency /CS /DeviceRGB >>', '0 g 0 0 100 100 re f 1 g 100 0 100 100 re f')],
  });
}

/** A figure as plotting programs write them: an opaque white page, a black
 *  axis line, a blue square with a white one inside, a black square, and
 *  black text (Helvetica, "Ab"). */
export function themedFigurePdf(): Buffer {
  return onePagePdf({
    resources: '<< /Font << /F1 5 0 R >> >>',
    content: '1 g 0 0 200 100 re f 0 G 1 w 10 10 m 190 10 l S 0 0 1 rg 20 20 50 50 re f 1 g 30 30 20 20 re f 0 g 150 20 30 30 re f BT /F1 12 Tf 100 50 Td (Ab) Tj ET',
    objects: [HELVETICA],
  });
}
