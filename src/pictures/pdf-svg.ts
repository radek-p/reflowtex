// SPDX-License-Identifier: AGPL-3.0-or-later
// A PDF page as SVG, drawn by MuPDF's SVG writer (the `mupdf` package: the
// library in WebAssembly). It draws what a PDF viewer draws:
// every font kind (Type 3 among them, vector or bitmap), ICC colour, every
// kind of image, shadings (as images), tiling patterns, soft masks. Glyphs
// come out as outlines, each a <use data-text="…"> of its outline with the
// character it stands for.
//
// Two things in the writer's output are put right here:
//
//  * a glyph a font maps to a character XML forbids (a control character, as
//    a bitmap font's glyph names a27… give) is written as a reference to it,
//    `&#x1b;`, which no XML parser reads; those references go;
//  * the line width of stroked text (text render modes 1, 2, 5, 6: fake
//    bold, outlined text) is written in the glyph's space without the scale
//    of the page's transformation around the text, so text under a `cm` that
//    shrinks it was drawn as many times too heavy. The page is run a second
//    time, through a device that sees each stroked glyph with that
//    transformation, and each stroked glyph's width is set to the true one.
//
// No Node API here, so that the pipeline (src/pipeline/pictures.ts, which
// reads the files) and a browser (a host's worker) convert alike: bytes in,
// strings out. MuPDF itself is loaded on the first conversion, with a dynamic
// import – it is 10 MB of WebAssembly, and the modules that import this one
// statically must not pull it into a bundle that has no picture to draw.
// The package finds its .wasm beside its own module (new URL(…,
// import.meta.url)); a host that serves it elsewhere passes `wasmUrl`, which
// goes to the WebAssembly module's locateFile.
//
// The result is an object, { svg }, and the picture { svg, vb_w, vb_h }, so
// that more can come with it (the page's text, for a text layer).
import type * as Mupdf from 'mupdf';
import { rewritePictureSvg, type Picture } from './rewrite.ts';

export interface PdfSvgOptions {
  /** where mupdf-wasm.wasm is served (default: beside the mupdf package's
   *  module); read on the first conversion only */
  wasmUrl?: string;
}

let loaded: Promise<typeof Mupdf> | null = null;

/** The mupdf module, loaded once. */
export function loadMupdf(o: PdfSvgOptions = {}): Promise<typeof Mupdf> {
  if (!loaded) {
    const g = globalThis as { $libmupdf_wasm_Module?: { locateFile?(name: string, prefix: string): string } };
    if (o.wasmUrl && !g.$libmupdf_wasm_Module) {
      const url = o.wasmUrl;
      g.$libmupdf_wasm_Module = { locateFile: (name, prefix) => (name.endsWith('.wasm') ? url : prefix + name) };
    }
    loaded = import('mupdf');
  }
  return loaded;
}

/** Characters an XML document cannot hold, not even as a reference. */
const xmlForbidden = (cp: number) =>
  (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff || cp > 0x10ffff;

/** `svg` without its character references to characters XML forbids. */
export function dropForbiddenCharRefs(svg: string): string {
  return svg.replace(/&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));/g, (ref, hex: string | undefined, dec: string | undefined) =>
    xmlForbidden(hex !== undefined ? parseInt(hex, 16) : Number(dec)) ? '' : ref);
}

/** sqrt(|det|): how much a matrix scales lengths, as MuPDF reckons it. */
const expansion = (m: Mupdf.Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/** As C's %g writes a number (6 significant digits), which the writer uses. */
const g6 = (x: number) => String(Number(x.toPrecision(6)));

const STROKED_GLYPH_RE = /(<use data-text="[^"]*" xlink:href="[^"]*" stroke-width=")([^"]*)(")/g;

/** Each stroked glyph's width as the writer wrote it and as it should be, in
 *  the order they are drawn. The writer divides the line width by the scale
 *  of the glyph's whole matrix (the text's and the page's); in the glyph's
 *  space it is the line width divided by the text's alone. */
function strokedGlyphWidths(mupdf: typeof Mupdf, page: Mupdf.Page): { written: number; true: number }[] {
  const out: { written: number; true: number }[] = [];
  const device = new mupdf.Device({
    strokeText(text: Mupdf.Text, stroke: Mupdf.StrokeState, ctm: Mupdf.Matrix) {
      const lw = stroke.getLineWidth(), c = expansion(ctm);
      text.walk({
        showGlyph(_font: Mupdf.Font, trm: Mupdf.Matrix, glyph: number) {
          if (glyph < 0) return;
          const t = expansion(trm) || 1;
          out.push({ written: lw / ((t * c) || 1), true: lw / t });
        },
      });
    },
  });
  page.run(device, mupdf.Matrix.identity);
  device.close();
  return out;
}

/** The stroked glyphs of `svg` (the writer's drawing of `page`) given their
 *  true line widths. A glyph is matched to the next one the device saw with
 *  the width the writer wrote; one that matches none is left as it is. */
function fixStrokedText(mupdf: typeof Mupdf, svg: string, page: Mupdf.Page): string {
  if (!/<use data-text="[^"]*" xlink:href="[^"]*" stroke-width=/.test(svg)) return svg;
  const widths = strokedGlyphWidths(mupdf, page);
  let k = 0;
  return svg.replace(STROKED_GLYPH_RE, (all, head: string, w: string, tail: string) => {
    const written = Number(w);
    for (let j = k; j < widths.length; j++) {
      if (Math.abs(widths[j].written - written) <= 1e-5 * Math.max(written, 1e-9) + 1e-9) {
        k = j + 1;
        return head + g6(widths[j].true) + tail;
      }
    }
    return all;
  });
}

/** Page `page` (1-based) of the PDF in `bytes` as an SVG document: an <svg>
 *  root whose viewBox is the page's box (the crop box) at 0 0, in bp. Throws
 *  with MuPDF's messages when the PDF cannot be read. */
export async function pdfPageSvg(bytes: Uint8Array, page: number, o: PdfSvgOptions = {}): Promise<{ svg: string }> {
  const mupdf = await loadMupdf(o);
  const messages: string[] = [];
  mupdf.setLog((m: string) => { messages.push(m.trim()); });
  try {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const n = doc.countPages();
    if (page < 1 || page > n) throw new Error(`the PDF has ${n} page${n === 1 ? '' : 's'}, not a page ${page}`);
    const p = doc.loadPage(page - 1);
    const buf = new mupdf.Buffer();
    const writer = new mupdf.DocumentWriter(buf, 'svg', 'text=path');
    const device = writer.beginPage(p.getBounds());
    p.run(device, mupdf.Matrix.identity);
    writer.endPage();
    writer.close();
    return { svg: fixStrokedText(mupdf, dropForbiddenCharRefs(buf.asString()), p) };
  } catch (e) {
    const log = messages.length ? `\n${messages.slice(-20).join('\n')}` : '';
    throw new Error(`${(e as Error).message ?? e}${log}`);
  } finally {
    mupdf.setLog(null);
  }
}

/** Page `page` of the PDF in `bytes` as a picture to inline in a page, as
 *  the pipeline makes it: its markup cleaned, ids prefixed with `prefix`,
 *  colours themed (rewrite.ts). */
export async function pdfPagePicture(bytes: Uint8Array, page: number, prefix: string, o: PdfSvgOptions = {}): Promise<Picture> {
  return rewritePictureSvg((await pdfPageSvg(bytes, page, o)).svg, prefix);
}
