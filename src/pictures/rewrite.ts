// SPDX-License-Identifier: AGPL-3.0-or-later
// A picture's SVG made safe to inline in a page, and themed: pure string
// work, no Node API and no MuPDF, so a browser can run it as the pipeline
// does (src/pictures/README.md).
//
//  * cleaned of what could run in the page (src/viewer/src/engine/safe.ts: a
//    picture may come from anyone's document);
//  * ids – MuPDF names glyph outlines "font_1_34", clip paths "clip_3", masks
//    "mask_2" and refers to them with <use> and url(#…). The names restart
//    per picture, so two pictures on one page would draw each other's glyphs
//    and clips. Every id gets a prefix unique to its picture and its
//    document.
//  * colours – rewritten to CSS custom properties, so a theme recolours
//    drawings as it recolours text. Black is the default text colour, and
//    MuPDF omits it on fills (SVG's initial fill is black), so the renderer sets
//    the inherited fill on the wrapping <g> instead. A mask's content
//    keeps its colours, black by default: they are not paint but how much of
//    what the mask covers shows (a soft mask, a clip by text), and themed,
//    a dark theme's white page would hide what the mask lets through.
//    Images keep their colours, as an included bitmap does.
import { cleanSvgMarkup } from '../viewer/src/engine/safe.ts';

// Attribute values in either quote: MuPDF writes "…", other sources '…'.
const SVG_ID_RE = /(?<![\w:-])id=(["'])([^"']+)\1/g;
const SVG_USE_RE = /((?:xlink:)?href)=(["'])#([^"']+)\2/g;
const SVG_URL_RE = /url\(#([^)]+)\)/g;
// A colour as SVG writers write one: #rrggbb (MuPDF), #rgb (an optimising
// writer), rgb(r, g, b), black or white.
const SVG_COLOR_RE = /\b(fill|stroke)=(["'])\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|black|white)\s*\2/gi;
/** A colour SVG_COLOR_RE matched, as 6 hex digits. */
function hexDigits(c: string): string {
  const v = c.toLowerCase();
  if (v === 'black') return '000000';
  if (v === 'white') return 'ffffff';
  const rgb = /^rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)$/.exec(v.replace(/\s+/g, ''));
  if (rgb) return rgb.slice(1).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  return v.length === 4 ? [...v.slice(1)].map(ch => ch + ch).join('') : v.slice(1);
}
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
 *  and not one inside a definition, a clip or a mask (a clipped PDF puts its
 *  <defs> first). Only white: a rectangle with no fill is black in MuPDF's
 *  output, which drops no colour, and a coloured or black page is content.
 *  A captured TikZ picture keeps it: a full-size rectangle there may be
 *  content. */
export function rewritePictureSvg(svg: string, prefix: string, stripPageBackground = false): Picture {
  const m = SVG_ROOT_RE.exec(svg);
  if (!m) throw new Error('the picture\'s SVG has no <svg viewBox=...> root');
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
  inner = inner.replace(SVG_COLOR_RE, (all, a: string, q: string, colour: string, at: number) => {
    if (within(masked, at)) return all;
    const digits = hexDigits(colour);
    const fallback = digits === '000000' ? 'currentColor' : `#${digits}`;
    return `${a}=${q}var(--latex-color-${digits}, ${fallback})${q}`;
  });
  // a mask's content inherits the mask's fill, not the picture's themed one
  inner = inner.replace(/<mask\b[^>]*>/g, tag => (attr(tag, 'fill') === undefined ? `<mask fill="#000000"${tag.slice(5)}` : tag));
  return { svg: inner.trim(), vb_w: vbW, vb_h: vbH };
}
