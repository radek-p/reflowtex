// SPDX-License-Identifier: AGPL-3.0-or-later
// What counts as a rule, on both sides of vector-compare.ts: a stroke of one
// straight segment, or a fill of one four-cornered shape with straight sides.
// LuaTeX strokes a rule along its centre line; a picture (TikZ's lines, its
// fills and arrow tips, the paths of an included PDF) draws the same shapes.
// The strip's paths come from MuPDF (traceStrip), the viewer's from its SVG
// (dom-dump.ts: TeX's rules as <rect>, a picture's drawing as dvisvgm's
// <path>), and both are read by this one definition, so that each side counts
// the same things in the same way.
export type Pt = [number, number];
/** An affine map [a, b, c, d, e, f]: (x, y) → (a x + c y + e, b x + d y + f). */
export type Affine = [number, number, number, number, number, number];

const apply = (m: Affine, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A path as drawn: its subpaths' points, in order; `curved` when any of its
 *  segments is not straight. It takes MuPDF's path walker calls as they come,
 *  and svgOutline feeds it the same calls from an SVG path's data. */
export class Outline {
  subpaths: { pts: Pt[]; closed: boolean }[] = [];
  curved = false;
  moveTo(x: number, y: number): void { this.subpaths.push({ pts: [[x, y]], closed: false }); }
  lineTo(x: number, y: number): void { this.open().pts.push([x, y]); }
  curveTo(_x1: number, _y1: number, _x2: number, _y2: number, x: number, y: number): void { this.curved = true; this.lineTo(x, y); }
  closePath(): void { if (this.subpaths.length) this.subpaths[this.subpaths.length - 1].closed = true; }
  /** the subpath a segment adds to: after a close, a new one from the closed
   *  one's start (as in PDF and SVG) */
  private open() {
    const last = this.subpaths[this.subpaths.length - 1];
    if (!last) throw new Error('a path segment before any moveto');
    if (last.closed) this.moveTo(...last.pts[0]);
    return this.subpaths[this.subpaths.length - 1];
  }
  /** the subpaths that draw: a lone moveto (PDF's `re` ends with one) does not */
  drawn() { return this.subpaths.filter(s => s.pts.length > 1); }
}

/** The four corners of the rule a stroke of `o` draws, `lw` thick, mapped by
 *  `m`; a square or round cap (`capped`) reaches lw/2 past each end. Null when
 *  the stroke is not one straight segment. */
export function strokedRule(o: Outline, lw: number, capped: boolean, m: Affine): Pt[] | null {
  const s = o.drawn();
  if (o.curved || s.length !== 1 || s[0].pts.length !== 2) return null;
  let [[x0, y0], [x1, y1]] = s[0].pts;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len === 0) return null;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, hw = lw / 2;
  const cap = capped ? hw : 0;
  x0 -= ux * cap; y0 -= uy * cap; x1 += ux * cap; y1 += uy * cap;
  const nx = -uy * hw, ny = ux * hw;
  return ([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]] as Pt[]).map(p => apply(m, p));
}

/** The four corners of a fill of `o`, mapped by `m`: one subpath of four
 *  points joined by straight sides (a fill closes it; a last point repeating
 *  the first is the closing side). Null for any other shape. */
export function filledRule(o: Outline, m: Affine): Pt[] | null {
  const s = o.drawn();
  if (o.curved || s.length !== 1) return null;
  let pts = s[0].pts;
  if (pts.length === 5 && pts[0][0] === pts[4][0] && pts[0][1] === pts[4][1]) pts = pts.slice(0, 4);
  return pts.length === 4 ? pts.map(p => apply(m, p)) : null;
}

/** An SVG path's data (`d`) as an Outline: absolute and relative commands,
 *  with arcs and curves marking it curved. */
export function svgOutline(d: string): Outline {
  const o = new Outline();
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  let i = 0, cmd = '', x = 0, y = 0, x0 = 0, y0 = 0;
  const num = () => { const t = tokens[i++]; if (t === undefined || /[a-z]/i.test(t)) throw new Error(`path data ends early: ${d.slice(0, 80)}`); return parseFloat(t); };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd || cmd === 'Z' || cmd === 'z') throw new Error(`a number with no command in path data: ${d.slice(0, 80)}`);
    const rel = cmd === cmd.toLowerCase(), dx = rel ? x : 0, dy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        x = num() + dx; y = num() + dy; x0 = x; y0 = y; o.moveTo(x, y);
        cmd = rel ? 'l' : 'L';                    // further pairs are linetos
        break;
      case 'L': x = num() + dx; y = num() + dy; o.lineTo(x, y); break;
      case 'H': x = num() + dx; o.lineTo(x, y); break;
      case 'V': y = num() + dy; o.lineTo(x, y); break;
      case 'C': num(); num(); num(); num(); x = num() + dx; y = num() + dy; o.curveTo(0, 0, 0, 0, x, y); break;
      case 'S': case 'Q': num(); num(); x = num() + dx; y = num() + dy; o.curveTo(0, 0, 0, 0, x, y); break;
      case 'T': x = num() + dx; y = num() + dy; o.curveTo(0, 0, 0, 0, x, y); break;
      case 'A': for (let k = 0; k < 5; k++) num(); x = num() + dx; y = num() + dy; o.curveTo(0, 0, 0, 0, x, y); break;
      case 'Z': o.closePath(); x = x0; y = y0; break;
    }
  }
  return o;
}
