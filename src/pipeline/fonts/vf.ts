// SPDX-License-Identifier: AGPL-3.0-or-later
// Virtual fonts. A TFM face with a .vf file (the maths of newtx and newpx,
// mathdesign, fourier, kpfonts …) has no outline of its own: each of its
// characters is a packet of DVI commands drawing characters of other fonts,
// and rules – its local fonts, faces with outlines or virtual ones again.
// TeX typesets with the virtual face; only the driver (pdfTeX's and LuaTeX's
// backends, xdvipdfmx) looks inside. A capture sees the virtual face, which
// the browser cannot draw (its glyphs would stay metric boxes), so each glyph
// set in one is replaced by what its packet draws:
//  * one character of one font at the glyph's own origin: the glyph node
//    itself, now in that font. Its box stays the virtual character's, which
//    is what TeX typeset with;
//  * anything else (a character moved, several characters, rules): a box of
//    the virtual character's size holding the pieces where the packet puts
//    them – a kern to each piece's place, a lowered box for a piece moved
//    down or up – each glyph carrying the virtual glyph's attributes.
// The fonts the pieces are in join the font table, an entry per face and
// size, its file 'unknown': the classic-font conversion that follows gives
// it its outline. Pure (files in through `readFile`), so the editor's
// converter runs the same code.
import { readTfm, texScale, type Tfm } from './tfm.ts';

export interface LocalFont { name: string; /** fix_word: its size in units of the virtual font's */ scale: number }
export interface VirtualFont { fonts: Map<number, LocalFont>; first: number | null; packets: Map<number, Uint8Array> }

export function readVf(b: Uint8Array): VirtualFont {
  if (b[0] !== 247 || b[1] !== 202) throw new Error('vf: not a virtual font');
  const u = (p: number, k: number) => { let v = 0; for (let i = 0; i < k; i++) v = v * 256 + b[p + i]; return v; };
  const s32 = (p: number) => (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
  const fonts = new Map<number, LocalFont>(), packets = new Map<number, Uint8Array>();
  let first: number | null = null;
  let p = 3 + b[2] + 8;                                   // pre i k comment[k] cs[4] ds[4]
  while (p < b.length) {
    const op = b[p];
    if (op <= 241) {                                      // short_char: pl cc tfm[3] dvi[pl]
      packets.set(b[p + 1], b.subarray(p + 5, p + 5 + op));
      p += 5 + op;
    } else if (op === 242) {                              // long_char: pl[4] cc[4] tfm[4] dvi[pl]
      const pl = u(p + 1, 4);
      packets.set(u(p + 5, 4), b.subarray(p + 13, p + 13 + pl));
      p += 13 + pl;
    } else if (op >= 243 && op <= 246) {                  // fnt_def1–4: k c[4] s[4] d[4] a l n[a+l]
      const k = op - 242, q = p + 1 + k;
      const id = k === 4 ? s32(p + 1) : u(p + 1, k);
      const a = b[q + 12], l = b[q + 13];
      const name = new TextDecoder('latin1').decode(b.subarray(q + 14 + a, q + 14 + a + l));
      fonts.set(id, { name, scale: s32(q + 4) });
      first ??= id;
      p = q + 14 + a + l;
    } else if (op === 248) break;                         // post
    else throw new Error(`vf: unexpected command ${op}`);
  }
  return { fonts, first, packets };
}

/** What a packet draws, in sp from the character's origin, y down (DVI's). */
export type Piece =
  | { kind: 'char'; font: string; size: number; char: number; x: number; y: number }
  | { kind: 'rule'; x: number; y: number; width: number; height: number };

/** The virtual fonts and TFMs a document's faces are read from. */
export class FontFiles {
  private vfs = new Map<string, VirtualFont | null>();
  private tfms = new Map<string, Tfm | null>();
  private readFile: (name: string) => Uint8Array | null;
  constructor(readFile: (name: string) => Uint8Array | null) { this.readFile = readFile; }
  vf(name: string): VirtualFont | null {
    if (!this.vfs.has(name)) {
      const b = this.readFile(`${name}.vf`);
      let vf: VirtualFont | null = null;
      try { vf = b ? readVf(b) : null; } catch { vf = null; }
      this.vfs.set(name, vf);
    }
    return this.vfs.get(name)!;
  }
  tfm(name: string): Tfm | null {
    if (!this.tfms.has(name)) {
      const b = this.readFile(`${name}.tfm`);
      let tfm: Tfm | null = null;
      try { tfm = b ? readTfm(b) : null; } catch { tfm = null; }
      this.tfms.set(name, tfm);
    }
    return this.tfms.get(name)!;
  }

  /** What character `char` of face `name` at `size` sp draws, local fonts
   *  that are virtual again followed through; null when the face is not
   *  virtual. A character without a packet draws nothing. */
  pieces(name: string, size: number, char: number, depth = 0): Piece[] | null {
    const vf = depth < 8 ? this.vf(name) : null;
    if (!vf) return null;
    const dvi = vf.packets.get(char);
    const out: Piece[] = [];
    if (!dvi) return out;
    const sc = (v: number) => texScale(v, size);
    const u = (p: number, k: number) => { let v = 0; for (let i = 0; i < k; i++) v = v * 256 + dvi[p + i]; return v; };
    const s = (p: number, k: number) => { const v = u(p, k), m = 2 ** (8 * k); return v >= m / 2 ? v - m : v; };
    let h = 0, v = 0, w = 0, x = 0, y = 0, z = 0, f = vf.first;
    const stack: number[][] = [];
    const draw = (c: number, advance: boolean) => {
      const lf = f === null ? undefined : vf.fonts.get(f);
      if (!lf) return;
      const at = sc(lf.scale);
      const inner = this.pieces(lf.name, at, c, depth + 1);
      if (inner) for (const q of inner) out.push({ ...q, x: q.x + h, y: q.y + v });
      else out.push({ kind: 'char', font: lf.name, size: at, char: c, x: h, y: v });
      if (advance) h += this.tfm(lf.name)?.char(c, at)?.width ?? 0;
    };
    const rule = (advance: boolean, p: number) => {
      const height = sc(s(p, 4)), width = sc(s(p + 4, 4));
      if (height > 0 && width > 0) out.push({ kind: 'rule', x: h, y: v, width, height });
      if (advance) h += width;
    };
    for (let p = 0; p < dvi.length;) {
      const op = dvi[p++];
      if (op <= 127) draw(op, true);
      else if (op <= 131) { const k = op - 127; draw(u(p, k), true); p += k; }          // set1–4
      else if (op === 132) { rule(true, p); p += 8; }                                     // set_rule
      else if (op <= 136) { const k = op - 132; draw(u(p, k), false); p += k; }         // put1–4
      else if (op === 137) { rule(false, p); p += 8; }                                    // put_rule
      else if (op === 138) continue;                                                      // nop
      else if (op === 141) stack.push([h, v, w, x, y, z]);                                // push
      else if (op === 142) [h, v, w, x, y, z] = stack.pop() ?? [h, v, w, x, y, z];        // pop
      else if (op <= 146) { const k = op - 142; h += sc(s(p, k)); p += k; }             // right1–4
      else if (op === 147) h += w;
      else if (op <= 151) { const k = op - 147; w = sc(s(p, k)); h += w; p += k; }
      else if (op === 152) h += x;
      else if (op <= 156) { const k = op - 152; x = sc(s(p, k)); h += x; p += k; }
      else if (op <= 160) { const k = op - 156; v += sc(s(p, k)); p += k; }             // down1–4
      else if (op === 161) v += y;
      else if (op <= 165) { const k = op - 161; y = sc(s(p, k)); v += y; p += k; }
      else if (op === 166) v += z;
      else if (op <= 170) { const k = op - 166; z = sc(s(p, k)); v += z; p += k; }
      else if (op <= 234) f = op - 171;                                                   // fnt_num_0–63
      else if (op <= 238) { const k = op - 234; f = k === 4 ? s(p, 4) : u(p, k); p += k; } // fnt1–4
      else if (op <= 242) { const k = op - 238; p += k + u(p, k); }                     // xxx1–4: a special, skipped
      else break;                                                                         // not a packet command
    }
    return out;
  }
}

type Node = { type: string; [field: string]: unknown };
type FontEntry = { name: string; size_sp: number; filename?: string | null; [field: string]: unknown };
type Code = { char: number; [field: string]: unknown };

/** The fields of a glyph that are its place and shape, not its attributes. */
const GLYPH_OWN = new Set(['type', 'char', 'font', 'gindex', 'width', 'height', 'depth']);

/** Replace every glyph set in a virtual face by what its packet draws (see
 *  the top of this file). `fonts`: the document's font table (id → entry),
 *  extended in place; `each`: calls its argument on every node of the
 *  document. Returns the glyphs replaced. */
export function resolveVirtualFonts(fonts: Map<string, FontEntry>, each: (visit: (n: Node) => void) => void,
                                    files: FontFiles): number {
  const virtual = new Map<string, FontEntry>();
  for (const [id, f] of fonts) if ((!f.filename || f.filename === 'unknown') && files.vf(f.name)) virtual.set(id, f);
  if (!virtual.size) return 0;
  let next = Math.max(0, ...[...fonts.keys()].map(Number).filter(Number.isFinite)) + 1;
  const ids = new Map<string, string>();
  /** the font table's id for face `name` at `size`, an entry made when there is none */
  const idOf = (name: string, size: number, from: FontEntry): string => {
    const key = `${name}@${size}`;
    let id = ids.get(key);
    if (id) return id;
    id = [...fonts].find(([, f]) => f.name === name && f.size_sp === size && (!f.filename || f.filename === 'unknown'))?.[0];
    if (!id) {
      id = String(next++);
      const entry: FontEntry = { name, size_sp: size, filename: 'unknown', quad: files.tfm(name)?.param(6, size) ?? 0 };
      // the virtual face's expansion is its pieces' (as an expanded copy of it would be drawn)
      for (const k of ['expand_stretch', 'expand_shrink', 'expand_step']) if (from[k] !== undefined) entry[k] = from[k];
      fonts.set(id, entry);
    }
    ids.set(key, id);
    return id;
  };
  let replaced = 0;
  each(n => {
    if (n.type !== 'glyph') return;
    const vfont = virtual.get(String(n.font));
    if (!vfont || typeof n.char !== 'number') return;
    const pieces = files.pieces(vfont.name, vfont.size_sp, n.char);
    if (!pieces) return;
    replaced++;
    const only = pieces.length === 1 ? pieces[0] : null;
    if (only && only.kind === 'char' && only.x === 0 && only.y === 0) {
      const id = idOf(only.font, only.size, vfont);
      carryCode(vfont, fonts.get(id)!, n.char, only.char);
      n.font = Number(id);
      n.char = only.char;
      delete n.gindex;
      return;
    }
    const attrs = Object.fromEntries(Object.entries(n).filter(([k]) => !GLYPH_OWN.has(k)));
    const children: Node[] = [];
    let at = 0;
    for (const q of pieces) {
      if (q.x !== at) children.push({ type: 'kern', kern: q.x - at, subtype: 1 });
      let piece: Node;
      if (q.kind === 'char') {
        const box = files.tfm(q.font)?.char(q.char, q.size) ?? { width: 0, height: 0, depth: 0 };
        piece = { type: 'glyph', char: q.char, font: Number(idOf(q.font, q.size, vfont)), width: box.width, height: box.height, depth: box.depth, ...attrs };
      } else piece = { type: 'rule', width: q.width, height: q.height, depth: 0 };
      const width = piece.width as number;
      if (q.y !== 0) piece = hbox(width, piece.height as number, piece.depth as number, [piece], q.y);
      children.push(piece);
      at = q.x + width;
    }
    for (const k of Object.keys(n)) if (k !== 'width' && k !== 'height' && k !== 'depth') delete n[k];
    Object.assign(n, hbox(n.width as number, n.height as number, n.depth as number, children, 0));
  });
  return replaced;
}

const hbox = (width: number, height: number, depth: number, children: Node[], shift: number): Node =>
  ({ type: 'hlist', subtype: 2, width, height, depth, shift, glue_set: 0, glue_sign: 0, glue_order: 0, children });

/** A glyph that keeps its node takes its protrusion and expansion codes along
 *  into the font it is now in (the first character there to bring one wins). */
function carryCode(from: FontEntry, to: FontEntry, char: number, now: number): void {
  const code = (from.codes as Code[] | undefined)?.find(c => c.char === char);
  if (!code) return;
  const codes = ((to.codes as Code[] | undefined) ??= []);
  if (!codes.some(c => c.char === now)) { codes.push({ ...code, char: now }); codes.sort((a, b) => a.char - b.char); }
}
