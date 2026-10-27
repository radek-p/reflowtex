// SPDX-License-Identifier: AGPL-3.0-or-later
// Pictures – captured TikZ boxes, included PDF pages and included PNG and
// JPEG files – as inline SVG.
//
// Each picture keeps TeX's box metrics (so it behaves as an ordinary box
// anywhere) and gains an SVG payload the browser draws.
//
// A PDF page – an included PDF's, or the page the capture made of a TikZ
// picture – is drawn by MuPDF (pictures-mupdf.ts), as a PDF viewer draws it.
//
// An included PNG or JPEG (told by its first bytes, not its name) is not
// converted: its payload is one <image> holding the file's bytes as a data:
// URI, as wide and as tall as the image's box in TeX (in bp, with a viewBox of
// the same size), filling it. (graphicx scales an image with a transform
// around that box, drawn like any other.) The bytes are kept as they are –
// neither recompressed nor resized – so a page carries each bitmap whole,
// base64-encoded (a third larger than the file): a large photograph makes a
// large page. Uses of one file at the same aspect ratio share one payload.
// A bitmap is not themed: its colours are its own, as are those of the
// images inside a PDF page (shadings among them, which MuPDF draws as
// images).
//
// Two rewrites make a page's SVG safe to inline:
//
//  * ids – MuPDF names glyph outlines "font_1_34", clip paths "clip_3", masks
//    "mask_2" and refers to them with <use> and url(#…). The names restart
//    per picture, so two pictures on one page would draw each other's glyphs
//    and clips. Every id gets a prefix unique to its picture and its
//    document.
//  * colours – rewritten to CSS custom properties, so a theme recolours
//    drawings as it recolours text. Black is the default text colour, and
//    MuPDF omits it on fills (SVG's initial fill is black), so the renderer
//    sets the inherited fill on the wrapping <g> instead. A mask's content
//    keeps its colours, black by default: they are not paint but how much of
//    what the mask covers shows (a soft mask, a clip by text), and themed,
//    a dark theme's white page would hide what the mask lets through.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { forEachNode, type SerializerOutput } from './nodes.ts';
import { PictureError } from './errors.ts';
import type { PictureSource } from './backend/types.ts';
import { cleanSvgMarkup } from '../viewer/src/engine/safe.ts';

// Attribute values in either quote: MuPDF writes "…", other sources '…'.
const SVG_ID_RE = /(?<![\w:-])id=(["'])([^"']+)\1/g;
const SVG_USE_RE = /((?:xlink:)?href)=(["'])#([^"']+)\2/g;
const SVG_URL_RE = /url\(#([^)]+)\)/g;
// 3-digit hex too (#f00), which an optimising writer shortens colours to.
const SVG_COLOR_RE = /\b(fill|stroke)=(["'])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\2/g;
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const SVG_ROOT_RE = new RegExp(`<svg\\b[^>]*\\bviewBox=(["'])(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})\\1[^>]*>([\\s\\S]*)<\\/svg>`);
const RECT_PATH_RE = new RegExp(`^M\\s*(${NUM})[\\s,]+(${NUM})\\s*H\\s*(${NUM})\\s*V\\s*(${NUM})\\s*H\\s*(${NUM})\\s*(?:V\\s*(${NUM})\\s*)?Z?$`);
const MATRIX_RE = new RegExp(`^matrix\\(\\s*(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})\\s*\\)$`);

export interface Picture { svg: string; vb_w: number; vb_h: number }

/** [start, end) of the element whose start tag begins at `at` in well-formed
 *  markup: past its matching end tag, or its own end when it closes itself. */
function elementExtent(s: string, at: number): [number, number] {
  const tags = /<(\/?)[A-Za-z][^>]*?(\/?)>/g;
  tags.lastIndex = at;
  let depth = 0;
  for (let m: RegExpExecArray | null; (m = tags.exec(s));) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) return [at, tags.lastIndex];
  }
  return [at, s.length];
}

/** The extents of every element named `name` (a pattern of names). */
const extentsOf = (s: string, name: string) =>
  [...s.matchAll(new RegExp(`<(?:${name})(?=[\\s/>])`, 'g'))].map(m => elementExtent(s, m.index));

const within = (ranges: [number, number][], i: number) => ranges.some(([a, b]) => i >= a && i < b);

/** Where a mask's content is: each <mask>, and each element a <use> inside one
 *  draws (MuPDF keeps a soft mask's drawing in a group of its own). */
function maskContent(s: string): [number, number][] {
  const masks = extentsOf(s, 'mask');
  const refs = new Set<string>();
  for (const [a, b] of masks) for (const r of s.slice(a, b).matchAll(SVG_USE_RE)) refs.add(r[3]);
  const drawn = [...s.matchAll(SVG_ID_RE)].filter(m => refs.has(m[2])).map(m => elementExtent(s, s.lastIndexOf('<', m.index)));
  return [...masks, ...drawn];
}

const attr = (tag: string, name: string) => new RegExp(`(?<![\\w:-])${name}=(["'])([^"']*)\\1`).exec(tag)?.[2];

/** Whether the <path> tag `tag` fills, in white and with no stroke, exactly
 *  the rectangle 0 0 w h. */
function isPageRectangle(tag: string, w: number, h: number): boolean {
  const fill = attr(tag, 'fill')?.toLowerCase();
  if (fill !== '#fff' && fill !== '#ffffff' && fill !== 'white') return false;
  const stroke = attr(tag, 'stroke');
  if (stroke !== undefined && stroke !== 'none') return false;
  const r = RECT_PATH_RE.exec(attr(tag, 'd')?.trim() ?? '');
  if (!r || Number(r[5]) !== Number(r[1]) || (r[6] !== undefined && Number(r[6]) !== Number(r[2]))) return false;
  const t = attr(tag, 'transform');
  const m = t === undefined ? [1, 0, 0, 1, 0, 0] : MATRIX_RE.exec(t.trim())?.slice(1).map(Number);
  if (!m || m[1] !== 0 || m[2] !== 0) return false;
  const xs = [Number(r[1]), Number(r[3])].map(x => m[0] * x + m[4]), ys = [Number(r[2]), Number(r[4])].map(y => m[3] * y + m[5]);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  return near(Math.min(...xs), 0) && near(Math.max(...xs), w) && near(Math.min(...ys), 0) && near(Math.max(...ys), h);
}

/** The markup inside a picture's <svg>, cleaned of what could run in the
 *  page (src/viewer/src/engine/safe.ts: a picture may come from anyone's
 *  document), ids prefixed and colours themed, with its viewBox size.
 *  `stripPageBackground`: an included PDF is artwork on the host page, so
 *  an opaque white rectangle over the whole viewBox (what Figma and
 *  Matplotlib draw first) goes – the first one drawn, wherever it stands,
 *  and not one inside a definition, a clip or a mask. A captured TikZ
 *  picture keeps it: a full-size rectangle there may be content. */
export function rewritePictureSvg(svg: string, prefix: string, stripPageBackground = false): Picture {
  const m = SVG_ROOT_RE.exec(svg);
  if (!m) throw new PictureError('the picture\'s SVG has no <svg viewBox=...> root');
  const vbW = Number(m[4]), vbH = Number(m[5]);
  let inner = cleanSvgMarkup(m[6]);
  if (stripPageBackground) {
    const hidden = extentsOf(inner, 'defs|clipPath|mask|pattern|symbol|marker');
    for (const p of inner.matchAll(/<path\b[^>]*>/g)) {
      if (within(hidden, p.index) || !isPageRectangle(p[0], vbW, vbH)) continue;
      const [a, b] = elementExtent(inner, p.index);
      inner = inner.slice(0, a) + inner.slice(b).replace(/^\s*\n/, '');
      break;
    }
  }
  const ids = new Set([...inner.matchAll(SVG_ID_RE)].map(x => x[2]));
  if (ids.size) {
    inner = inner.replace(SVG_ID_RE, (_, q: string, id: string) => `id=${q}${prefix}${id}${q}`);
    inner = inner.replace(SVG_USE_RE, (all, a: string, q: string, id: string) => (ids.has(id) ? `${a}=${q}#${prefix}${id}${q}` : all));
    inner = inner.replace(SVG_URL_RE, (all, id: string) => (ids.has(id) ? `url(#${prefix}${id})` : all));
  }
  const masked = maskContent(inner);
  inner = inner.replace(SVG_COLOR_RE, (all, a: string, q: string, hex: string, at: number) => {
    if (within(masked, at)) return all;
    let digits = hex.toLowerCase();
    if (digits.length === 3) digits = [...digits].map(c => c + c).join('');
    const fallback = digits === '000000' ? 'currentColor' : `#${digits}`;
    return `${a}=${q}var(--latex-color-${digits}, ${fallback})${q}`;
  });
  // a mask's content inherits the mask's fill, not the picture's themed one
  inner = inner.replace(/<mask\b[^>]*>/g, tag => (attr(tag, 'fill') === undefined ? `<mask fill="#000000"${tag.slice(5)}` : tag));
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

/** The files a document's \includegraphics read, each once, in order, as
 *  absolute paths (the serializer records them so; read before
 *  convertPictures, which takes the names off the nodes). Captured and
 *  externalised pictures are made by the build and not listed. */
export function includedPictureFiles(data: SerializerOutput): string[] {
  const files = new Set<string>();
  forEachNode(data, n => {
    if (n.type === 'picture' && typeof n.file === 'string' && !n.externalized && !n.generated) files.add(n.file);
  });
  return [...files];
}

/** Turn every picture node into inline SVG (Document.pictures) – its PDF
 *  page, or an included PNG or JPEG as an <image>;
 *  returns how many pictures were converted. `docTag` tells this document's
 *  pictures from another's on the same page: by default the first characters
 *  of the build directory's name, which is the document's content key. A
 *  backend that makes its pictures' SVG itself passes its `source`; without
 *  one, each picture's PDF page is drawn by MuPDF (pictures-mupdf.ts, loaded
 *  here, on the first PDF page: it is server-only, and this module is not). */
export async function convertPictures(data: SerializerOutput, buildDir: string, block?: string,
                                      docTag = basename(buildDir).replace(/[^0-9A-Za-z]/g, '').slice(0, 8),
                                      source?: PictureSource): Promise<number> {
  if (!Array.isArray(data.pictures)) data.pictures = [];
  const pictures = data.pictures as Picture[];
  const bySource = new Map<string, number>();
  const nodes: Record<string, unknown>[] = [];
  forEachNode(data, n => { if (n.type === 'picture') nodes.push(n); });
  let converted = 0;
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
      if (!existsSync(src)) throw new PictureError(`picture source ${src} is missing`, block);
      const bytes = readFileSync(src);
      const format = pictureFormat(bytes);
      if (!format && !src.toLowerCase().endsWith('.pdf'))
        throw new PictureError(`picture source ${src} is not a PDF, PNG or JPEG file; only those can be included`, block);
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
    if (!bySource.has(key)) {
      const ref = { file: src, page, externalized, generated };
      let svg: string;
      if (source) {
        try { svg = await source.svg(ref); }
        catch (e) { throw new PictureError(`the backend's picture source failed on ${src} (page ${page}): ${(e as Error).message}`, block); }
      } else {
        const pdf = generated ? join(buildDir, src) : externalized ? join(buildDir, `${src}.pdf`) : src;
        if (!existsSync(pdf)) throw new PictureError(`picture source ${pdf} is missing`, block);
        const { pdfPageSvg } = await import('./pictures-mupdf.ts');
        try { svg = pdfPageSvg(readFileSync(pdf), page); }
        catch (e) { throw new PictureError(`MuPDF could not draw page ${page} of ${pdf}: ${(e as Error).message}`, block); }
      }
      const strip = source?.stripsBackground?.(ref) ?? (!externalized && !generated);
      pictures.push(rewritePictureSvg(svg, `p${docTag}-${pictures.length + 1}-`, strip));
      bySource.set(key, pictures.length);          // 1-based
      converted++;
    }
    n.picture = bySource.get(key);
  }
  return converted;
}
