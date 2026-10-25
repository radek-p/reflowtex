// SPDX-License-Identifier: AGPL-3.0-or-later
// dvisvgm as the pipeline calls it, on a captured TikZ picture: three circled
// nodes labelled $a$, $b$, $c$ (fixtures/tikz-node-labels.pdf, page 1 of a
// build's input.pdf). With dvisvgm 3.4.4's collapse-groups the labels lost
// their group's transform and stood a picture height above their circles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DVISVGM_OPTIMIZE, bitmapPicture, convertPictures, pictureFormat, rewritePictureSvg, type Picture } from '../../src/pipeline/pictures.ts';
import { Pipeline } from '../../src/pipeline/pipeline.ts';
import { forEachNode, readSerializerOutput, type SerializerOutput, type TexNode } from '../../src/pipeline/nodes.ts';
import { PictureError } from '../../src/pipeline/errors.ts';

const FIXTURE = fileURLToPath(new URL('fixtures/tikz-node-labels.pdf', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix =>
  [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];

/** An SVG transform attribute as one matrix: translate, scale and matrix, the
 *  forms dvisvgm writes. */
function parseTransform(s: string): Matrix {
  let m = IDENTITY;
  for (const [, fn, args] of s.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (fn === 'scale') m = mul(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (fn === 'matrix') m = mul(m, v as Matrix);
    else throw new Error(`transform ${fn} not handled`);
  }
  return m;
}

/** Where each <use> (a glyph) lands, its groups' transforms applied. */
function glyphPositions(svg: string): [number, number][] {
  const stack: Matrix[] = [IDENTITY];
  const out: [number, number][] = [];
  for (const [tag] of svg.matchAll(/<\/?(?:g|use)\b[^>]*>/g)) {
    if (tag.startsWith('</')) { stack.pop(); continue; }
    const t = /transform='([^']*)'/.exec(tag);
    const m = t ? mul(stack.at(-1)!, parseTransform(t[1])) : stack.at(-1)!;
    if (tag.startsWith('<use')) {
      const x = Number(/\bx='([^']*)'/.exec(tag)?.[1] ?? 0), y = Number(/\by='([^']*)'/.exec(tag)?.[1] ?? 0);
      out.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    } else if (!tag.endsWith('/>')) stack.push(m);
  }
  return out;
}

const hasDvisvgm = (() => { try { execFileSync('dvisvgm', ['--version']); return true; } catch { return false; } })();

test('a TikZ node label stays inside its picture after dvisvgm', { skip: !hasDvisvgm && 'dvisvgm not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-pictures-'));
  try {
    const out = join(dir, 'p.svg');
    execFileSync('dvisvgm', ['--pdf', '--page=1', '--no-fonts', DVISVGM_OPTIMIZE, `--tmpdir=${dir}`, `--output=${out}`, FIXTURE],
      { stdio: 'pipe' });
    const svg = readFileSync(out, 'utf8');
    const [, , w, h] = /viewBox='([^']*)'/.exec(svg)![1].split(' ').map(Number);
    const glyphs = glyphPositions(svg);
    assert.equal(glyphs.length, 3, 'the three labels');
    // Each label's baseline is below its circle's centre, within the picture:
    // the circles are 20 pt across, centred at y = 49.8 (a, b) and 10.1 (c).
    for (const [x, y] of glyphs) {
      assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `glyph at (${x.toFixed(2)}, ${y.toFixed(2)}) outside the ${w} × ${h} picture`);
    }
    const ys = glyphs.map(([, y]) => y).sort((p, q) => p - q);
    assert.ok(Math.abs(ys[0] - 12.3) < 1 && Math.abs(ys[2] - 53.3) < 1, `baselines ${ys.map(y => y.toFixed(2)).join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Included bitmaps ────────────────────────────────────────────────────────
// A PNG or JPEG \includegraphics is drawn as an <image> holding the file's
// bytes, sized to TeX's box. dvisvgm draws a bitmap inside a PDF as a
// <symbol> and a <use> with no size, which filled the whole block.

const PNG = fileURLToPath(new URL('fixtures/bitmap-6x4.png', import.meta.url));
const JPEG = fileURLToPath(new URL('fixtures/bitmap-8x8.jpg', import.meta.url));
const FIXTURES = fileURLToPath(new URL('fixtures/', import.meta.url));
const hasLualatex = (() => { try { execFileSync('lualatex', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const SP_PER_BP = 65536 * 72.27 / 72;

test('a file is told by its first bytes', () => {
  assert.equal(pictureFormat(readFileSync(PNG)), 'png');
  assert.equal(pictureFormat(readFileSync(JPEG)), 'jpeg');
  assert.equal(pictureFormat(readFileSync(FIXTURE)), 'pdf');
  assert.equal(pictureFormat(Buffer.from('GIF89a')), null);
});

test('a bitmap picture: one <image> of the bytes, the size of the box', () => {
  const bytes = readFileSync(PNG);
  const pic = bitmapPicture(bytes, 'png', 100 * SP_PER_BP, 50 * SP_PER_BP, 'pab-1-');
  assert.deepEqual([pic.vb_w, pic.vb_h], [100, 50]);
  assert.equal(pic.svg, `<image id='pab-1-image' width='100' height='50' preserveAspectRatio='none' href='data:image/png;base64,${bytes.toString('base64')}'/>`);
  assert.match(bitmapPicture(readFileSync(JPEG), 'jpeg', SP_PER_BP, SP_PER_BP, 'x').svg, /href='data:image\/jpeg;base64,\/9j\//);
});

test('a <use> of a symbol gets the symbol\'s size; other uses are left alone', () => {
  const svg = `<svg viewBox='0 0 612 792'><defs><symbol id='img1-ab' viewBox='0 0 6 4'><image width='6' height='4' xlink:href='data:image/png;base64,AA'/></symbol>`
    + `<path id='g1-5' d='M0 0'/></defs><g id='page1'><use x='0' y='0' xlink:href='#img1-ab' transform='matrix(14 0 0 14 148 124)'/>`
    + `<use x='1' y='2' xlink:href='#g1-5'/><use xlink:href='#img1-ab' width='3' height='2'/></g></svg>`;
  const { svg: out } = rewritePictureSvg(svg, 'p1-');
  assert.match(out, /<use width='6' height='4' x='0' y='0' xlink:href='#p1-img1-ab' transform='matrix\(14 0 0 14 148 124\)'\/>/);
  assert.match(out, /<use x='1' y='2' xlink:href='#p1-g1-5'\/>/, 'a glyph\'s <use> is unchanged');
  assert.match(out, /<use xlink:href='#p1-img1-ab' width='3' height='2'\/>/, 'a size already there is kept');
});

const tmpPipeline = (root: string, searchDirs: string[]) =>
  new Pipeline({ buildRoot: join(root, 'build'), fontsDir: join(root, 'fonts'), searchDirs, mathml: false, log: () => {} });
const picturesOf = (root: string, key: string) => {
  const data = readSerializerOutput(readFileSync(join(root, 'build', key, 'output.json'), 'utf8'));
  const nodes: TexNode[] = [];
  forEachNode(data, n => { if (n.type === 'picture') nodes.push(n); });
  return { pictures: data.pictures as Picture[], nodes };
};

test('PNG and JPEG \\includegraphics through the pipeline', { skip: !hasLualatex && 'lualatex not installed' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtx-bitmaps-'));
  try {
    const pipe = tmpPipeline(root, [FIXTURES]);
    // graphicx scales an image with a transform around a box of its natural
    // size: the PNG's three uses are one picture. The JPEG is named without
    // its extension.
    const content = '\\includegraphics[width=60pt]{bitmap-6x4.png} \\includegraphics[width=30pt]{bitmap-6x4.png}\n'
      + '\\includegraphics[width=30pt,height=30pt]{bitmap-6x4.png} \\includegraphics[height=20pt]{bitmap-8x8}';
    await pipe.compile(content, '', { key: 'bitmaps' });
    const { pictures, nodes } = picturesOf(root, 'bitmaps');
    assert.equal(nodes.length, 4);
    assert.deepEqual(nodes.map(n => n.picture), [1, 1, 1, 2]);
    assert.equal(pictures.length, 2);
    const png = readFileSync(PNG).toString('base64'), jpeg = readFileSync(JPEG).toString('base64');
    const box = (n: TexNode) => [Number(n.width) / SP_PER_BP, (Number(n.height) + Number(n.depth ?? 0)) / SP_PER_BP];
    nodes.forEach((n, i) => {
      const pic = pictures[Number(n.picture) - 1];
      const [w, h] = box(n);
      assert.ok(Math.abs(pic.vb_w - w) < 1e-3 && Math.abs(pic.vb_h - h) < 1e-3, `picture ${i}: ${pic.vb_w} × ${pic.vb_h}, box ${w} × ${h}`);
      const img = /^<image id='([^']+)' width='([^']+)' height='([^']+)' preserveAspectRatio='none' href='data:(image\/\w+);base64,([^']+)'\/>$/.exec(pic.svg);
      assert.ok(img, pic.svg.slice(0, 120));
      assert.deepEqual([Number(img[2]), Number(img[3])], [pic.vb_w, pic.vb_h]);
      assert.deepEqual([img[4], img[5]], i === 3 ? ['image/jpeg', jpeg] : ['image/png', png], 'the bytes as they are, with their type');
    });
    const ids = pictures.map(p => /id='([^']+)'/.exec(p.svg)![1]);
    assert.equal(new Set(ids).size, ids.length, `ids repeat: ${ids}`);
    assert.ok(ids.every(id => id.startsWith('pbitmaps-')), 'ids carry the document\'s tag');
    assert.deepEqual(Object.keys(pipe.inputs.get('bitmaps')!), [JPEG, PNG].sort(), 'the figures are the block\'s inputs');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('\\includegraphics options braced whole, holding a `]`', { skip: !hasLualatex && 'lualatex not installed' }, async () => {
  // The template's \includegraphics reads the options and passes them on to
  // graphicx's, with the braces round the whole list that protect a `]` in it.
  const root = mkdtempSync(join(tmpdir(), 'rtx-bitmap-braced-'));
  try {
    const pipe = tmpPipeline(root, [FIXTURES]);
    await pipe.compile('\\includegraphics[{width=30pt,alt=Figure [1]}]{bitmap-6x4.png}', '', { key: 'braced' });
    await pipe.compile('\\includegraphics[width=30pt,alt={Figure [1]}]{bitmap-6x4.png}', '', { key: 'inner' });
    const paragraphs = (key: string) => readSerializerOutput(readFileSync(join(root, 'build', key, 'output.json'), 'utf8')).paragraphs;
    assert.equal(picturesOf(root, 'braced').nodes.length, 1);
    assert.deepEqual(paragraphs('braced'), paragraphs('inner'), 'as with the braces round the value only');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a PDF holding a bitmap: dvisvgm\'s <use> sized to its symbol', { skip: (!hasLualatex || !hasDvisvgm) && 'lualatex or dvisvgm not installed' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtx-bitmap-pdf-'));
  try {
    const figs = join(root, 'figures');
    mkdirSync(figs);
    copyFileSync(PNG, join(figs, 'bitmap-6x4.png'));
    writeFileSync(join(figs, 'photo.tex'), '\\documentclass{article}\\usepackage{graphicx}\\pagestyle{empty}\n'
      + '\\begin{document}\\includegraphics[width=3cm]{bitmap-6x4.png}\\end{document}\n');
    execFileSync('lualatex', ['-interaction=nonstopmode', 'photo.tex'], { cwd: figs, stdio: 'ignore' });
    const pipe = tmpPipeline(root, [figs]);
    await pipe.compile('\\includegraphics[width=100pt]{photo.pdf}', '', { key: 'bitmap-pdf' });
    const { pictures } = picturesOf(root, 'bitmap-pdf');
    assert.equal(pictures.length, 1);
    const uses = pictures[0].svg.match(/<use\b[^>]*>/g) ?? [];
    assert.equal(uses.length, 1, pictures[0].svg.slice(0, 400));
    assert.match(uses[0], /^<use width='6' height='4' /);
    assert.match(pictures[0].svg, /<symbol id='pbitmappd-[^']+' viewBox='0 0 6 4'>/, 'ids prefixed as before');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a renamed PDF is read as the PDF it is', { skip: (!hasLualatex || !hasDvisvgm) && 'lualatex or dvisvgm not installed' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtx-bitmap-renamed-'));
  try {
    // LuaTeX reads an image by its bytes, so a PDF named .png compiles
    copyFileSync(FIXTURE, join(root, 'renamed.png'));
    const pipe = tmpPipeline(root, [root]);
    await pipe.compile('\\includegraphics[width=50pt]{renamed.png}', '', { key: 'renamed' });
    const svg = picturesOf(root, 'renamed').pictures[0].svg;
    assert.doesNotMatch(svg, /<image/);
    assert.match(svg, /<use\b/, 'drawn by dvisvgm: the labels');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a file that is neither a PDF, a PNG nor a JPEG is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtx-bitmap-gif-'));
  try {
    writeFileSync(join(root, 'a.gif'), 'GIF89a');
    const data = { paragraphs: [{ nodes: [{ type: 'picture', width: 65536, height: 65536, depth: 0, file: join(root, 'a.gif'), page: 1 }] }], content: [], streams: [] } as unknown as SerializerOutput;
    await assert.rejects(convertPictures(data, root, 'b'), (e: Error) => e instanceof PictureError && /is not a PDF, PNG or JPEG file/.test(e.message));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the Hugo prebuild compiles a block again when its figure changes', { skip: !hasLualatex && 'lualatex not installed' }, () => {
  const site = mkdtempSync(join(tmpdir(), 'rtx-hugo-figure-'));
  try {
    mkdirSync(join(site, 'content'), { recursive: true });
    mkdirSync(join(site, 'latex-src'), { recursive: true });
    copyFileSync(PNG, join(site, 'latex-src', 'figure.png'));
    writeFileSync(join(site, 'content', 'a.md'), '{{< latex >}}A figure: \\includegraphics[width=40pt]{figure.png}{{< /latex >}}\n');
    const prebuild = () => String(execFileSync('node', [join(REPO, 'integrations/hugo/prebuild.ts'), site, '--no-font-subset'], { stdio: 'pipe' }));
    const image = () => {
      const dir = join(site, 'data', 'latex_blocks');
      return readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
    };
    assert.match(prebuild(), /compiling 1 block/);
    const first = image();
    assert.match(prebuild(), /up to date/, 'nothing changed');
    copyFileSync(JPEG, join(site, 'latex-src', 'figure.png'));      // new bytes, the same name
    assert.match(prebuild(), /compiling 1 block/, 'the figure changed');
    assert.notEqual(image(), first);
    assert.match(prebuild(), /up to date/);
  } finally { rmSync(site, { recursive: true, force: true }); }
});
