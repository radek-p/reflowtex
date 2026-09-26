// SPDX-License-Identifier: AGPL-3.0-or-later
// Pictures – captured TikZ boxes and included PDF pages – as inline SVG.
//
// Each picture keeps TeX's box metrics (so it behaves as an ordinary box
// anywhere) and gains an SVG payload the browser draws. Two rewrites make the
// payload safe to inline:
//
//  * ids – dvisvgm names glyph paths "g1-4855" and clip paths "cp0" and refers
//    to them with <use> and url(#…). The names restart per file, so two
//    pictures on one page would draw each other's glyphs and clips. Every id
//    gets a prefix unique to its picture and its document.
//  * colours – rewritten to CSS custom properties, so a theme recolours
//    drawings as it recolours text. Black is the default text colour, and
//    dvisvgm often omits it (SVG's initial fill is black), so the renderer sets
//    the inherited fill on the wrapping <g> instead.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { inflateSync, constants as zlibConstants } from 'node:zlib';
import { forEachNode, type SerializerOutput } from './nodes.ts';
import { PictureError } from './errors.ts';

const run = promisify(execFile);

const SVG_ID_RE = /\bid='([^']+)'/g;
const SVG_USE_RE = /(xlink:href|href)='#([^']+)'/g;
const SVG_URL_RE = /url\(#([^)]+)\)/g;
// dvisvgm shortens colours to 3-digit hex under --optimize (#f00), so both
// forms are recognised, or the rewrite silently does nothing.
const SVG_COLOR_RE = /\b(fill|stroke)='#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})'/g;
const SVG_ROOT_RE = /<svg\b[^>]*\bviewBox='([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+)'[^>]*>([\s\S]*)<\/svg>/;
const SVG_PAGE_RECT_RE = /<path d='M0 0H([\d.eE+-]+)V([\d.eE+-]+)H0V0Z?'(?: fill='#(?:fff|ffffff)')?\/>\s*/g;

export interface Picture { svg: string; vb_w: number; vb_h: number }

/** The markup inside dvisvgm's <svg>, ids prefixed and colours themed, with
 *  its viewBox size. */
export function rewritePictureSvg(svg: string, prefix: string, stripPageBackground = false): Picture {
  const m = SVG_ROOT_RE.exec(svg);
  if (!m) throw new PictureError('dvisvgm output has no <svg viewBox=...> root');
  const vbW = Number(m[3]), vbH = Number(m[4]);
  let inner = m[5];
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

/** Turn every picture node's PDF page into inline SVG (Document.pictures);
 *  returns how many pictures were converted. */
export async function convertPictures(data: SerializerOutput, buildDir: string, block?: string): Promise<number> {
  // The build directory is named by the document's content key: its first
  // characters tell this document's pictures from another's on the same page.
  const docTag = basename(buildDir).replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
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
      const key = JSON.stringify([src, page, externalized, generated]);
      if (!bySource.has(key)) {
        let pdf: string, out: string;
        if (generated) { pdf = join(buildDir, src); out = join(buildDir, `captured-picture-${page}.svg`); }
        else if (externalized) { pdf = join(buildDir, `${src}.pdf`); out = join(buildDir, `${src}.svg`); }
        else {
          // src is what kpse.find_file returned inside LuaTeX, relative to *its*
          // working directory (the build dir) when TEXINPUTS was relative.
          pdf = isAbsolute(src) ? src : join(buildDir, src);
          out = join(buildDir, `included-${pictures.length + 1}.svg`);
        }
        if (!existsSync(pdf)) throw new PictureError(`picture source ${pdf} is missing`, block);
        if (!pdf.toLowerCase().endsWith('.pdf')) throw new PictureError(`picture source ${pdf} is not a PDF; only PDF includegraphics is supported`, block);
        const input = externalized || generated ? pdf : await normalised(pdf);
        // --tmpdir: dvisvgm's temporary files are not namespaced per process,
        // so concurrent conversions collide and some silently lose every glyph.
        const tmp = mkdtempSync(join(tmpdir(), 'dvisvgm-'));
        try {
          await run('dvisvgm', ['--pdf', `--page=${page}`, '--no-fonts', '--optimize=all', `--tmpdir=${tmp}`, `--output=${out}`, input], { cwd: buildDir });
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
