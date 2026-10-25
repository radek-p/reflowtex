// SPDX-License-Identifier: AGPL-3.0-or-later
// Pictures – captured TikZ boxes, included PDF pages and included PNG and
// JPEG files – as inline SVG.
//
// Each picture keeps TeX's box metrics (so it behaves as an ordinary box
// anywhere) and gains an SVG payload the browser draws.
//
// An included PNG or JPEG (told by its first bytes, not its name) does not go
// through dvisvgm: its payload is one <image> holding the file's bytes as a
// data: URI, as wide and as tall as the image's box in TeX (in bp, with a
// viewBox of the same size), filling it. (graphicx scales an image with a
// transform around that box, drawn like any other.) The bytes are kept as
// they are – neither recompressed nor resized – so a page carries each bitmap
// whole, base64-encoded (a third larger than the file): a large photograph
// makes a large page. Uses of one file at the same aspect ratio share one
// payload. A bitmap is not themed: its colours are its own.
//
// Two rewrites make dvisvgm's payload safe to inline:
//
//  * ids – dvisvgm names glyph paths "g1-4855" and clip paths "cp0" and refers
//    to them with <use> and url(#…). The names restart per file, so two
//    pictures on one page would draw each other's glyphs and clips. Every id
//    gets a prefix unique to its picture and its document.
//  * colours – rewritten to CSS custom properties, so a theme recolours
//    drawings as it recolours text. Black is the default text colour, and
//    dvisvgm often omits it (SVG's initial fill is black), so the renderer sets
//    the inherited fill on the wrapping <g> instead.
//
// dvisvgm draws a bitmap inside a PDF as a <symbol> with a viewBox and a
// <use> of it with no size. A <use> of a <symbol> without width and height is
// 100 % of the viewport – inside a block, the whole block – so each such
// <use> gets the symbol's viewBox size, which its transform then scales.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { inflateSync, constants as zlibConstants } from 'node:zlib';
import { forEachNode, type SerializerOutput } from './nodes.ts';
import { PictureError } from './errors.ts';
import type { PictureSource } from './backend/types.ts';
import { cleanSvgMarkup } from '../viewer/src/engine/safe.ts';

const run = promisify(execFile);

const SVG_ID_RE = /\bid='([^']+)'/g;
const SVG_USE_RE = /(xlink:href|href)='#([^']+)'/g;
const SVG_URL_RE = /url\(#([^)]+)\)/g;
// dvisvgm shortens colours to 3-digit hex under --optimize (#f00), so both
// forms are recognised, or the rewrite silently does nothing.
const SVG_COLOR_RE = /\b(fill|stroke)='#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})'/g;
const SVG_ROOT_RE = /<svg\b[^>]*\bviewBox='([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+)'[^>]*>([\s\S]*)<\/svg>/;
const SVG_SYMBOL_RE = /<symbol\b([^>]*)>/g;
const SVG_USE_TAG_RE = /<use\b([^>]*)>/g;
const SVG_VIEWBOX_RE = /\bviewBox='([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+)'/;
const SVG_PAGE_RECT_RE =/<path d='M0 0H([\d.eE+-]+)V([\d.eE+-]+)H0V0Z?'(?: fill='#(?:fff|ffffff)')?\/>\s*/g;

// Every optimisation but collapse-groups. In dvisvgm 3.4.4 (Debian trixie's,
// reading the PDF through mutool 1.25) that module drops the transform of a
// group around a single glyph: a TikZ node label is drawn at y = -8 in a
// picture 60 pt tall, a whole picture height above where it belongs.
export const DVISVGM_OPTIMIZE = '--optimize=all,-collapse-groups';

export interface Picture { svg: string; vb_w: number; vb_h: number }

/** The markup inside dvisvgm's <svg>, cleaned of what could run in the page
 *  (src/viewer/src/engine/safe.ts: a document's raw SVG specials reach it as
 *  they are), ids prefixed and colours themed, with its viewBox size. */
export function rewritePictureSvg(svg: string, prefix: string, stripPageBackground = false): Picture {
  const m = SVG_ROOT_RE.exec(svg);
  if (!m) throw new PictureError('dvisvgm output has no <svg viewBox=...> root');
  const vbW = Number(m[3]), vbH = Number(m[4]);
  let inner = cleanSvgMarkup(m[5]);
  // Figma exports an opaque white page rectangle (explicit white after the ICC
  // normalisation below; no fill at all from older or raw dvisvgm output). An
  // included PDF is artwork on the host page, so either form goes – but only
  // when its geometry is exactly the whole viewBox, and wherever it stands
  // (clipped PDFs put <defs> first). TikZ captures keep theirs: a full-size
  // rectangle there may be content.
  if (stripPageBackground) {
    for (const bg of inner.matchAll(SVG_PAGE_RECT_RE)) {
      if (Math.abs(Number(bg[1]) - vbW) < 1e-6 && Math.abs(Number(bg[2]) - vbH) < 1e-6) {
        inner = inner.slice(0, bg.index) + inner.slice(bg.index! + bg[0].length);
        break;
      }
    }
  }
  const symbolSizes = new Map<string, [string, string]>();
  for (const [, attrs] of inner.matchAll(SVG_SYMBOL_RE)) {
    const id = /\bid='([^']+)'/.exec(attrs)?.[1], vb = SVG_VIEWBOX_RE.exec(attrs);
    if (id && vb) symbolSizes.set(id, [vb[3], vb[4]]);
  }
  if (symbolSizes.size) {
    inner = inner.replace(SVG_USE_TAG_RE, (tag: string, attrs: string) => {
      const ref = /(?:xlink:href|href)='#([^']+)'/.exec(attrs)?.[1];
      const size = ref === undefined ? undefined : symbolSizes.get(ref);
      if (!size || /\b(?:width|height)=/.test(attrs)) return tag;
      return `<use width='${size[0]}' height='${size[1]}'${tag.slice(4)}`;
    });
  }
  const ids = new Set([...inner.matchAll(SVG_ID_RE)].map(x => x[1]));
  if (ids.size) {
    inner = inner.replace(SVG_ID_RE, (_, id) => `id='${prefix}${id}'`);
    inner = inner.replace(SVG_USE_RE, (all, attr, id) => (ids.has(id) ? `${attr}='#${prefix}${id}'` : all));
    inner = inner.replace(SVG_URL_RE, (all, id) => (ids.has(id) ? `url(#${prefix}${id})` : all));
  }
  inner = inner.replace(SVG_COLOR_RE, (_, attr: string, hex: string) => {
    let digits = hex.toLowerCase();
    if (digits.length === 3) digits = [...digits].map(c => c + c).join('');
    const fallback = digits === '000000' ? 'currentColor' : `#${digits}`;
    return `${attr}='var(--latex-color-${digits}, ${fallback})'`;
  });
  return { svg: inner.trim(), vb_w: vbW, vb_h: vbH };
}

export type PictureFormat = 'pdf' | 'png' | 'jpeg';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
export const BITMAP_MIME: Record<Exclude<PictureFormat, 'pdf'>, string> = { png: 'image/png', jpeg: 'image/jpeg' };

/** What an included file holds, by its first bytes: a PNG, a JPEG, or a PDF
 *  (whose header may follow up to 1024 bytes of anything, as PDF readers
 *  allow); null for anything else. */
export function pictureFormat(bytes: Uint8Array): PictureFormat | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'png';
  if (b.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'jpeg';
  if (b.subarray(0, 1024 + 5).includes('%PDF-')) return 'pdf';
  return null;
}

const SP_PER_BP = 65536 * 72.27 / 72;
const bp = (sp: number) => Number((sp / SP_PER_BP).toFixed(4));

/** A PNG or JPEG as a picture: one <image> holding its bytes, `widthSp` by
 *  `heightSp` (TeX's box, height plus depth) in bp, and a viewBox of that
 *  size. preserveAspectRatio='none': the bitmap fills the box as TeX scaled
 *  it, a distorted aspect ratio included. */
export function bitmapPicture(bytes: Uint8Array, format: Exclude<PictureFormat, 'pdf'>, widthSp: number, heightSp: number, prefix: string): Picture {
  const w = bp(widthSp), h = bp(heightSp);
  const uri = `data:${BITMAP_MIME[format]};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`;
  return { svg: `<image id='${prefix}image' width='${w}' height='${h}' preserveAspectRatio='none' href='${uri}'/>`, vb_w: w, vb_h: h };
}

/** Where an \includegraphics picture node's file is: the path LuaTeX's
 *  kpse.find_file gave, relative to the build directory it ran in. */
const includedPath = (src: string, buildDir: string) => (isAbsolute(src) ? src : join(buildDir, src));

/** The files a document's \includegraphics read, each once, in order, as
 *  paths (read before convertPictures, which takes the names off the nodes).
 *  Captured and externalised pictures are made by the build and not listed. */
export function includedPictureFiles(data: SerializerOutput, buildDir: string): string[] {
  const files = new Set<string>();
  forEachNode(data, n => {
    if (n.type === 'picture' && typeof n.file === 'string' && !n.externalized && !n.generated) files.add(includedPath(n.file, buildDir));
  });
  return [...files];
}

/** Whether a PDF paints in an ICC-based colour space – in a page's resources,
 *  or inside a compressed object stream (each Flate stream is inflated). */
export function usesIccColour(pdf: string): boolean {
  const data = readFileSync(pdf);
  if (data.includes('/ICCBased')) return true;
  for (const m of data.toString('latin1').matchAll(/stream\r?\n/g)) {
    try {
      // like Python's decompressobj: trailing bytes ignored, a truncated
      // stream gives what it has
      if (inflateSync(data.subarray(m.index! + m[0].length), { finishFlush: zlibConstants.Z_SYNC_FLUSH }).includes('/ICCBased')) return true;
    } catch { /* not a Flate stream */ }
  }
  return false;
}

/** Turn every picture node into inline SVG (Document.pictures) – its PDF
 *  page, or an included PNG or JPEG as an <image>;
 *  returns how many pictures were converted. `docTag` tells this document's
 *  pictures from another's on the same page: by default the first characters
 *  of the build directory's name, which is the document's content key. A
 *  backend that makes its pictures' SVG itself passes its `source`; without
 *  one, each picture's PDF page is converted with dvisvgm. */
export async function convertPictures(data: SerializerOutput, buildDir: string, block?: string,
                                      docTag = basename(buildDir).replace(/[^0-9A-Za-z]/g, '').slice(0, 8),
                                      source?: PictureSource): Promise<number> {
  if (!Array.isArray(data.pictures)) data.pictures = [];
  const pictures = data.pictures as Picture[];
  const bySource = new Map<string, number>();
  // dvisvgm 3.4 drops every ICC `scn` fill in PDFs exported by Figma: coloured
  // shapes silently turn black. Ghostscript rewrites those paints to
  // DeviceRGB, which dvisvgm keeps. Only a PDF that uses ICC colour goes
  // through it: pdfwrite turns a rotation drawn with `cm` into a rotated text
  // matrix, and dvisvgm drops text set under one (a pgfplots y label vanished).
  const rgbPdfs = new Map<string, string>();
  const pdfTmp = mkdtempSync(join(tmpdir(), 'picture-pdf-'));
  const normalised = async (pdf: string) => {
    if (!rgbPdfs.has(pdf) && !usesIccColour(pdf)) rgbPdfs.set(pdf, pdf);
    if (!rgbPdfs.has(pdf)) {
      const out = join(pdfTmp, `source-${rgbPdfs.size + 1}.pdf`);
      try {
        // -r72: at its default 720 dpi pdfwrite puts the page under a 0.1 scale,
        // and dvisvgm folds that into coordinates and line widths but not into
        // dash patterns – every dashed line came out ten times too long.
        await run('gs', ['-q', '-dSAFER', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', '-r72', '-dCompatibilityLevel=1.7',
          '-sColorConversionStrategy=RGB', '-dProcessColorModel=/DeviceRGB', '-dUseCIEColor=false',
          `-sOutputFile=${out}`, pdf], { cwd: buildDir });
      } catch (e) {
        throw new PictureError(`Ghostscript failed while normalising colours in ${pdf}:\n${String((e as { stderr?: string }).stderr ?? e).slice(-2000)}`, block);
      }
      if (!existsSync(out)) throw new PictureError(`Ghostscript wrote nothing for ${pdf}`, block);
      rgbPdfs.set(pdf, out);
    }
    return rgbPdfs.get(pdf)!;
  };

  const nodes: Record<string, unknown>[] = [];
  forEachNode(data, n => { if (n.type === 'picture') nodes.push(n); });
  let converted = 0;
  try {
    for (const n of nodes) {
      const src = n.file as string | undefined;
      const page = Math.trunc(Number(n.page ?? 1) || 1);
      const externalized = Boolean(n.externalized), generated = Boolean(n.generated);
      delete n.file; delete n.page; delete n.externalized; delete n.generated;
      if (!src) throw new PictureError('a picture node has no source file – the template image hook did not record it', block);
      let key = JSON.stringify([src, page, externalized, generated]);
      if (!externalized && !generated) {
        // An included file: a PNG or JPEG becomes its own <image>, whatever
        // the backend; one picture per file and aspect ratio of its box.
        const file = includedPath(src, buildDir);
        if (!existsSync(file)) throw new PictureError(`picture source ${file} is missing`, block);
        const bytes = readFileSync(file);
        const format = pictureFormat(bytes);
        if (!format && !file.toLowerCase().endsWith('.pdf'))
          throw new PictureError(`picture source ${file} is not a PDF, PNG or JPEG file; only those can be included`, block);
        if (format === 'png' || format === 'jpeg') {
          const w = Number(n.width) || 0, h = (Number(n.height) || 0) + (Number(n.depth) || 0);
          key = JSON.stringify([src, 'bitmap', w ? Number((h / w).toFixed(6)) : 0]);
          if (!bySource.has(key)) {
            pictures.push(bitmapPicture(bytes, format, w, h, `p${docTag}-${pictures.length + 1}-`));
            bySource.set(key, pictures.length);          // 1-based
            converted++;
          }
        }
      }
      if (!bySource.has(key) && source) {
        const ref = { file: src, page, externalized, generated };
        let svg: string;
        try { svg = await source.svg(ref); }
        catch (e) { throw new PictureError(`the backend's picture source failed on ${src} (page ${page}): ${(e as Error).message}`, block); }
        pictures.push(rewritePictureSvg(svg, `p${docTag}-${pictures.length + 1}-`, source.stripsBackground?.(ref) ?? (!externalized && !generated)));
        bySource.set(key, pictures.length);          // 1-based
        converted++;
      }
      if (!bySource.has(key)) {
        let pdf: string, out: string;
        if (generated) { pdf = join(buildDir, src); out = join(buildDir, `captured-picture-${page}.svg`); }
        else if (externalized) { pdf = join(buildDir, `${src}.pdf`); out = join(buildDir, `${src}.svg`); }
        else {
          // src is what kpse.find_file returned inside LuaTeX, relative to *its*
          // working directory (the build dir) when TEXINPUTS was relative.
          pdf = includedPath(src, buildDir);
          out = join(buildDir, `included-${pictures.length + 1}.svg`);
        }
        if (!existsSync(pdf)) throw new PictureError(`picture source ${pdf} is missing`, block);
        const input = externalized || generated ? pdf : await normalised(pdf);
        // --tmpdir: dvisvgm's temporary files are not namespaced per process,
        // so concurrent conversions collide and some silently lose every glyph.
        const tmp = mkdtempSync(join(tmpdir(), 'dvisvgm-'));
        try {
          await run('dvisvgm', ['--pdf', `--page=${page}`, '--no-fonts', DVISVGM_OPTIMIZE, `--tmpdir=${tmp}`, `--output=${out}`, input], { cwd: buildDir });
        } catch (e) {
          if (!existsSync(out)) throw new PictureError(`dvisvgm failed on ${pdf}:\n${String((e as { stderr?: string }).stderr ?? e).slice(-2000)}`, block);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
        if (!existsSync(out)) throw new PictureError(`dvisvgm wrote nothing for ${pdf}`, block);
        pictures.push(rewritePictureSvg(readFileSync(out, 'utf8'), `p${docTag}-${pictures.length + 1}-`, !externalized && !generated));
        bySource.set(key, pictures.length);          // 1-based
        converted++;
      }
      n.picture = bySource.get(key);
    }
  } finally {
    rmSync(pdfTmp, { recursive: true, force: true });
  }
  return converted;
}
