#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Show a small font the way a font editor does: first the font view – every
// glyph slot, with its index, glyph name and code point, the chosen one
// highlighted – then that glyph as an SVG, zoomed in, with its vector
// controls: the outline, its on-curve anchors (squares) and the off-curve
// handles of each Bézier segment (circles on thin lines), over the glyph's
// advance box and baseline, as a vector editor shows a selected path.
// OpenType/CFF, or Type 1 (zoomed glyph only).
//
//     node website/tools/glyph-outline.ts website/latex-fonts/SegmentSymbol.otf \
//         segmentSymbol > website/assets/glyphs/segment-symbol.html
//
// The SVG uses currentColor and --lt-outline-accent, so it follows the page's
// theme; the {{< glyph-outline >}} shortcode inlines it.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import opentype, { type Font, type Glyph, type PathCommand } from 'opentype.js';
import { advanceWidths, parseCmap, readSfnt } from '../../src/pipeline/fonts/sfnt.ts';
import { glyphOutline } from '../../src/pipeline/fonts/type1.ts';

type Point = [number, number];
type Command = [string, Point[]];

/** A glyph's drawing commands in font units, y up (opentype.js's path is). */
function commandsOf(glyph: Glyph): Command[] {
  return glyph.path.commands.map((c: PathCommand): Command => {
    const p = (x?: number, y?: number): Point => [x!, y!];
    switch (c.type) {
      case 'M': return ['moveTo', [p(c.x, c.y)]];
      case 'L': return ['lineTo', [p(c.x, c.y)]];
      case 'C': return ['curveTo', [p(c.x1, c.y1), p(c.x2, c.y2), p(c.x, c.y)]];
      case 'Q': return ['qCurveTo', [p(c.x1, c.y1), p(c.x, c.y)]];
      default: return ['closePath', []];
    }
  });
}

// Numbers as the Python original printed them: its floats (a division, a
// product with a float) keep a ".0" when whole.
const F = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const N = (x: number) => String(x);
/** The Unicode subtable fontTools' getBestCmap takes, in its order of preference. */
function bestCmap(path: string): Map<number, number> {
  const subs = parseCmap(readSfnt(readFileSync(path)).tables.get('cmap')!);
  for (const [p, e] of [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]]) {
    const s = subs.find(t => t.platformID === p && t.encodingID === e);
    if (s) return s.map;
  }
  return new Map();
}
/** The first glyph slot named `name`. */
function glyphIndex(font: Font, name: string): number {
  for (let i = 0; i < font.glyphs.length; i++) if (font.glyphs.get(i).name === name) return i;
  throw new Error(`no glyph ${name}`);
}
const range = (a: number, b: number, step: number) => { const r: number[] = []; for (let x = a; x < b; x += step) r.push(x); return r; };

export function glyphOutlineHtml(path: string, name: string): string {
  let font: Font | null = null, cmds: Command[], adv: number, advances: number[] = [];
  if (path.endsWith('.pfb')) ({ commands: cmds, width: adv } = glyphOutline(path, name));
  else {
    const bytes = readFileSync(path);
    font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    advances = advanceWidths(readSfnt(bytes));
    const gid = glyphIndex(font, name);
    cmds = commandsOf(font.glyphs.get(gid)); adv = advances[gid];
  }
  const xs = [...cmds.flatMap(([, pts]) => pts.map(p => p[0])), 0, adv];
  const ys = [...cmds.flatMap(([, pts]) => pts.map(p => p[1])), 0];
  const pad = 70;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
  const top = Math.max(...ys) + pad, bottom = Math.min(...ys) - pad - 40;     // room for the labels below
  const Y = (y: number) => top - y;                                           // font units, y up → SVG, y down
  const w = x1 - x0, h = top - bottom;

  const d: string[] = [], handles: [Point, Point][] = [], anchors: Point[] = [], controls: Point[] = [];
  let cur: Point | null = null;
  for (const [op, pts] of cmds) {
    if (op === 'moveTo' || op === 'lineTo') {
      cur = pts[0]; d.push(`${op === 'moveTo' ? 'M' : 'L'}${cur[0]} ${Y(cur[1])}`); anchors.push(cur);
    } else if (op === 'curveTo') {
      const [c1, c2, p] = pts;
      d.push(`C${c1[0]} ${Y(c1[1])} ${c2[0]} ${Y(c2[1])} ${p[0]} ${Y(p[1])}`);
      handles.push([cur!, c1], [p, c2]); controls.push(c1, c2); anchors.push(p); cur = p;
    } else if (op === 'closePath') d.push('Z');
  }

  const out: string[] = [];
  // The font view: one cell per glyph slot, each a small drawing of the glyph
  // on the same em box, so a one-glyph font reads as a font.
  if (font) {
    const n = font.glyphs.length;
    const codes = new Map<number, number>();
    for (const [cp, gid] of [...bestCmap(path)].sort((a, b) => a[0] - b[0]))
      if (!codes.has(gid)) codes.set(gid, cp);
    const upem = font.unitsPerEm, asc = font.tables.hhea.ascender, desc = font.tables.hhea.descender;
    // max()/min() keep the type of what wins: the font's integer, or a float
    const topFloat = upem * 0.8 > asc, botFloat = -upem * 0.2 < desc;
    const topEm = topFloat ? upem * 0.8 : asc, botEm = botFloat ? -upem * 0.2 : desc;
    const T = topFloat ? F : N, H = topFloat || botFloat ? F : N;
    out.push('<div class="font-view">');
    out.push(`<p class="fv-head"><span>${basename(path)}</span> ${n} glyph slot${n !== 1 ? 's' : ''}, ${upem} units per em</p>`);
    out.push('<ol class="fv-cells">');
    for (let i = 0; i < n; i++) {
      const g = font.glyphs.get(i);
      const d2 = commandsOf(g).map(([op, pts]) =>
        ({ moveTo: 'M', lineTo: 'L', curveTo: 'C', qCurveTo: 'Q', closePath: 'Z' })[op]! + pts.map(([x, y]) => `${x} ${T(topEm - y)}`).join(' '));
      const gw = advances[i], wide = upem * 0.6 > gw;
      const w2 = wide ? upem * 0.6 : gw, W2 = wide ? F : N;
      const x2 = (gw - w2) / 2;
      const cp = codes.get(i);
      const label = cp !== undefined ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : 'no code point';
      const sel = g.name === name ? ' fv-selected' : '';
      out.push(`<li class="fv-cell${sel}"><svg viewBox="${F(x2)} 0 ${W2(w2)} ${H(topEm - botEm)}" aria-hidden="true">` +
        `<path d="M${F(x2)} ${T(topEm)}H${F(x2 + w2)}" class="fv-base"/>` +
        (d2.length ? `<path d="${d2.join(' ')}" class="fv-glyph"/>` : '') +
        `</svg><span class="fv-index">${i}</span><span class="fv-name">${g.name}</span>` +
        `<span class="fv-code">${label}</span></li>`);
    }
    out.push('</ol>');
    out.push(`<p class="fv-zoom">Slot ${glyphIndex(font, name)}, <code>${name}</code>, drawn large:</p></div>`);
  }

  out.push(`<svg class="glyph-outline" xmlns="http://www.w3.org/2000/svg" viewBox="${x0} 0 ${w} ${h}" ` +
    `role="img" aria-label="The glyph ${name}, zoomed in, with its anchor points and control handles">`);
  const grid = range((Math.floor(x0 / 100) + 1) * 100, x1, 100).map(x => `M${x} 0V${h}`).join(' ') + ' ' +
    range((Math.floor(bottom / 100) + 1) * 100, top, 100).map(y => `M${x0} ${Y(y)}H${x1}`).join(' ');
  const maxY = Math.max(...ys), minY = Math.min(...ys);
  out.push(`<path d="${grid}" class="go-grid"/>`);
  out.push(`<rect x="0" y="${Y(maxY)}" width="${adv}" height="${maxY - Math.min(minY, 0)}" class="go-box"/>`);
  out.push(`<path d="M${x0} ${Y(0)}H${x1}" class="go-baseline"/>`);
  out.push(`<path d="${d.join(' ')}" class="go-fill"/>`);
  out.push(`<path d="${handles.map(([a, c]) => `M${a[0]} ${Y(a[1])}L${c[0]} ${Y(c[1])}`).join(' ')}" class="go-handle"/>`);
  out.push(`<path d="${d.join(' ')}" class="go-path"/>`);
  for (const [x, y] of controls) out.push(`<circle cx="${x}" cy="${Y(y)}" r="7" class="go-control"/>`);
  for (const [x, y] of anchors) out.push(`<rect x="${x - 8}" y="${Y(y) - 8}" width="16" height="16" class="go-anchor"/>`);
  out.push(`<text x="${x0 + 12}" y="${Y(0) - 12}" class="go-label">baseline</text>`);
  out.push(`<text x="${adv}" y="${Y(minY) + 60}" text-anchor="end" class="go-label">advance ${adv}</text>`);
  out.push('</svg>');
  return out.join('\n');
}

if (import.meta.main) {
  const [path, name] = process.argv.slice(2);
  if (!path || !name) { console.error('usage: glyph-outline.ts <font.otf|font.pfb> <glyph name>'); process.exit(2); }
  console.log(glyphOutlineHtml(path, name));
}
