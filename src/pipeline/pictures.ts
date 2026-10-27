// SPDX-License-Identifier: AGPL-3.0-or-later
// Pictures – captured TikZ boxes, included PDF pages and included PNG and
// JPEG files – as inline SVG.
//
// Each picture keeps TeX's box metrics (so it behaves as an ordinary box
// anywhere) and gains an SVG payload the browser draws.
//
// A PDF page – an included PDF's, or the page the capture made of a TikZ
// picture – is drawn by MuPDF as a PDF viewer draws it, and made safe to
// inline and themed: src/pictures/ (pdf-svg.ts, rewrite.ts), which uses no
// Node API, so that a browser can convert a picture as this does. This
// module is the pipeline's side: it reads the files, and loads the converter
// with a dynamic import, on the first PDF page – MuPDF is 10 MB of
// WebAssembly, and nothing a browser may bundle imports it statically.
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
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { forEachNode, type SerializerOutput } from './nodes.ts';
import { PictureError } from './errors.ts';
import type { PictureSource } from './backend/types.ts';
import { rewritePictureSvg, type Picture } from '../pictures/rewrite.ts';

export { rewritePictureSvg, type Picture };

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
 *  one, each picture's PDF page is drawn by MuPDF (src/pictures/pdf-svg.ts,
 *  loaded on the first PDF page). */
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
        const { pdfPageSvg } = await import('../pictures/pdf-svg.ts');
        try { svg = (await pdfPageSvg(readFileSync(pdf), page)).svg; }
        catch (e) { throw new PictureError(`MuPDF could not draw page ${page} of ${pdf}: ${(e as Error).message}`, block); }
      }
      const strip = source?.stripsBackground?.(ref) ?? (!externalized && !generated);
      try { pictures.push(rewritePictureSvg(svg, `p${docTag}-${pictures.length + 1}-`, strip)); }
      catch (e) { throw new PictureError(`${(e as Error).message} (${src}, page ${page})`, block); }
      bySource.set(key, pictures.length);          // 1-based
      converted++;
    }
    n.picture = bySource.get(key);
  }
  return converted;
}
