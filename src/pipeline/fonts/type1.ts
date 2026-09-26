// SPDX-License-Identifier: AGPL-3.0-or-later
// Classic Type 1 TeX fonts (cmsy10, cmmi10, the AMS faces, EC/LM through an
// encoding vector…) have no OpenType form, but their outlines ship with TeX
// Live. Each is converted to a CFF-flavoured OpenType font the browser can
// load, addressed so the pipeline can rewrite glyph nodes to match.
//
// Addressing is the crux. A classic font is 8-bit: a glyph lives in a slot
// (0–255) whose meaning is the font's own – slot 0x22 of cmsy10 is
// 'arrowup', not '"'. Each slot gets a target code point:
//  * a slot whose glyph name resolves (Adobe Glyph List) to one common,
//    searchable character gets that real code point, so the text can be
//    selected and found – keyed on the name, not the slot (cmr's slot 0x3C
//    is 'exclamdown', and gets U+00A1, not '<');
//  * everything else keeps a private-use code, U+E000 + slot.
// Real code points are claimed first-come by ascending slot, so the cmap
// stays a function. Every converted font is its own @font-face, so private
// codes never collide across fonts.
//
// The outlines come from a Type 1 charstring interpreter that follows
// fontTools' T1OutlineExtractor exactly (flex through othersubrs 0–2, the
// hint-replacement no-op, seac, hsbw), rounded and cleaned up as fontTools'
// T2CharStringPen does, so a face converts to the same outlines the Python
// pipeline produced.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { toUnicode } from './agl.ts';
import { readSfnt, writeSfnt, setHeadTimes } from './sfnt.ts';

type Bytes = Uint8Array;
export const PUA_BASE = 0xE000;
/** head.created/modified of every converted font: fixed, so a conversion is
 *  byte-reproducible and its content-hashed name stable (1904-based seconds;
 *  the Python pipeline's value). */
const FIXED_TIME = 3_153_600_000;

// ── Finding a face ──────────────────────────────────────────────────────────

const kpseCache = new Map<string, string | null>();
export function kpsewhich(name: string): string | null {
  if (!kpseCache.has(name)) {
    let found: string | null = null;
    try { found = execFileSync('kpsewhich', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; }
    catch { found = null; }
    kpseCache.set(name, found);
  }
  return kpseCache.get(name)!;
}

let fontMap: Map<string, [string, string | null]> | null = null;
/** TeX font name → [outline file, encoding file] from pdftex.map, the map the
 *  TeX installation itself uses to embed Type 1 fonts. */
function mapEntries(): Map<string, [string, string | null]> {
  if (fontMap) return fontMap;
  fontMap = new Map();
  const path = kpsewhich('pdftex.map');
  if (!path) return fontMap;
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const t = line.trimStart();
    if (!line.trim() || '%#*;'.includes(t[0])) continue;
    const words = line.match(/"[^"]*"|\S+/g) ?? [];
    const files = words.slice(1).filter(w => w.startsWith('<')).map(w => w.replace(/^[<[]+/, ''));
    const outline = files.find(w => w.endsWith('.pfb') || w.endsWith('.pfa'));
    const enc = files.find(w => w.endsWith('.enc')) ?? null;
    const face = words[0];
    if (face && outline && !fontMap.has(face)) fontMap.set(face, [outline, enc]);
  }
  return fontMap;
}

/** The 256 glyph names of a PostScript encoding vector (.enc). */
export function readEncoding(path: string): string[] {
  const text = readFileSync(path, 'latin1').replace(/%[^\n]*/g, '');
  const body = text.slice(text.indexOf('[') + 1, text.lastIndexOf(']'));
  const names = [...body.matchAll(/\/([^\s/[\]{}()<>%]+)/g)].map(m => m[1]);
  return [...names, ...new Array(256).fill('.notdef')].slice(0, 256);
}

/** A face's outline in the TeX tree, and the encoding it is used with: its
 *  own (null) when the outline is named after the face, or the one the font
 *  map gives (ec-lmr10 is lmr10.pfb re-encoded through lm-ec.enc). */
export function findOutline(name: string): [string, string[] | null] | null {
  const own = kpsewhich(`${name}.pfb`);
  if (own) return [own, null];
  const entry = mapEntries().get(name);
  if (!entry) return null;
  const pfb = kpsewhich(entry[0]);
  if (!pfb) return null;
  const encPath = entry[1] ? kpsewhich(entry[1]) : null;
  return [pfb, encPath ? readEncoding(encPath) : null];
}

// ── The file ────────────────────────────────────────────────────────────────

function segments(buf: Bytes): { clear: string; enc: Bytes } {
  if (buf[0] !== 0x80) {                                  // PFA: the eexec part hex-encoded
    const text = Buffer.from(buf).toString('latin1');
    const i = text.indexOf('eexec') + 5;
    const hex = text.slice(i).replace(/0{64}[\s\S]*$/, '').replace(/[^0-9a-fA-F]/g, '');
    return { clear: text.slice(0, i), enc: Uint8Array.from(Buffer.from(hex, 'hex')) };
  }
  let clear = '';
  const enc: Bytes[] = [];
  let o = 0;
  while (o < buf.length && buf[o] === 0x80 && buf[o + 1] !== 3) {
    const type = buf[o + 1], len = buf[o + 2] | (buf[o + 3] << 8) | (buf[o + 4] << 16) | (buf[o + 5] << 24);
    const part = buf.subarray(o + 6, o + 6 + len);
    if (type === 1 && !enc.length) clear += Buffer.from(part).toString('latin1');
    else if (type === 2) enc.push(part);
    o += 6 + len;
  }
  return { clear, enc: Uint8Array.from(Buffer.concat(enc)) };
}

function decrypt(data: Bytes, r: number, skip: number): Bytes {
  const out = new Uint8Array(Math.max(0, data.length - skip));
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const p = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xFFFF;
    if (i >= skip) out[i - skip] = p;
  }
  return out;
}

interface Type1 { fontMatrix: number[]; encoding: string[]; subrs: Bytes[]; chars: Map<string, Bytes> }

function parsePrivate(p: Bytes): { subrs: Bytes[]; chars: Map<string, Bytes> } {
  // Byte offsets and latin-1 character offsets coincide: the text is scanned
  // for tokens and the binary charstrings are cut from the bytes.
  const text = Buffer.from(p).toString('latin1');
  const lenIV = Number(text.match(/\/lenIV\s+(-?\d+)/)?.[1] ?? 4);
  const cs = (bytes: Bytes) => (lenIV < 0 ? bytes : decrypt(bytes, 4330, lenIV));
  const skipWs = (i: number) => { while (i < text.length && /\s/.test(text[i])) i++; return i; };
  const skipToken = (i: number) => { while (i < text.length && !/\s/.test(text[i])) i++; return i; };
  // "<index or /name> <length> <RD token> <binary> <ND/NP token>", repeated
  const entries = (re: RegExp, from: number, onEntry: (k: string, b: Bytes) => void) => {
    let i = from;
    for (;;) {
      i = skipWs(i);
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m) return;
      const start = re.lastIndex, len = Number(m[2]);
      onEntry(m[1], p.subarray(start, start + len));
      i = skipToken(skipWs(start + len));
    }
  };
  const subrs: Bytes[] = [];
  const sAt = text.indexOf('/Subrs');
  if (sAt >= 0) entries(/dup\s+(\d+)\s+(\d+)\s+\S+ /y, text.indexOf('dup', sAt), (k, b) => { subrs[Number(k)] = cs(b); });
  const chars = new Map<string, Bytes>();
  const cAt = text.indexOf('/CharStrings');
  entries(/\/([^\s/[\]{}()<>%]+)\s+(\d+)\s+\S+ /y, text.indexOf('begin', cAt) + 5, (k, b) => { chars.set(k, cs(b)); });
  return { subrs, chars };
}

/** StandardEncoding, which seac's accent and base characters index. */
const STANDARD = (() => {
  const names = `space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde`.split(' ');
  const e: string[] = new Array(256).fill('.notdef');
  names.forEach((n, k) => { e[32 + k] = n; });
  const hi: Record<number, string> = { 161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin', 167: 'section', 168: 'currency', 169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft', 172: 'guilsinglleft', 173: 'guilsinglright', 174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger', 179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph', 183: 'bullet', 184: 'quotesinglbase', 185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright', 188: 'ellipsis', 189: 'perthousand', 191: 'questiondown', 193: 'grave', 194: 'acute', 195: 'circumflex', 196: 'tilde', 197: 'macron', 198: 'breve', 199: 'dotaccent', 200: 'dieresis', 202: 'ring', 203: 'cedilla', 205: 'hungarumlaut', 206: 'ogonek', 207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine', 232: 'Lslash', 233: 'Oslash', 234: 'OE', 235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash', 249: 'oslash', 250: 'oe', 251: 'germandbls' };
  for (const [k, v] of Object.entries(hi)) e[Number(k)] = v;
  return e;
})();

export function parseType1(path: string): Type1 {
  const { clear, enc } = segments(readFileSync(path));
  const priv = decrypt(enc, 55665, 4);
  const fm = clear.match(/\/FontMatrix\s*\[\s*([^\]]+)\]/);
  if (!fm) throw new Error('no /FontMatrix');
  let encoding: string[];
  if (/\/Encoding\s+StandardEncoding/.test(clear)) encoding = STANDARD.slice();
  else {
    encoding = new Array(256).fill('.notdef');
    for (const m of clear.matchAll(/dup\s+(\d+)\s*\/([^\s/[\]{}()<>%]+)\s+put/g)) encoding[Number(m[1])] = m[2];
  }
  return { fontMatrix: fm[1].trim().split(/\s+/).map(Number), encoding, ...parsePrivate(priv) };
}

// ── Charstrings → outlines (fontTools' T1OutlineExtractor) ──────────────────

type Point = [number, number];
interface Pen {
  moveTo(p: Point): void; lineTo(p: Point): void; curveTo(a: Point, b: Point, c: Point): void;
  closePath(): void; endPath(): void;
}

function outline(name: string, font: Type1, pen: Pen, depth = 0): { width: number } {
  if (depth > 2) throw new Error(`seac nested too deep at ${name}`);
  const st: number[] = [];
  let cur: Point = [0, 0], saw = false, flexing = false, width = 0, sbx = 0;
  const moveTo = (d: Point) => { cur = [cur[0] + d[0], cur[1] + d[1]]; pen.moveTo(cur); saw = true; };
  const endPath = () => { if (saw) pen.endPath(); saw = false; };
  const lineTo = (d: Point) => { if (!saw) moveTo([0, 0]); cur = [cur[0] + d[0], cur[1] + d[1]]; pen.lineTo(cur); };
  const curveTo = (a: Point, b: Point, c: Point) => {
    if (!saw) moveTo([0, 0]);
    const p1: Point = [cur[0] + a[0], cur[1] + a[1]], p2: Point = [p1[0] + b[0], p1[1] + b[1]], p3: Point = [p2[0] + c[0], p2[1] + c[1]];
    pen.curveTo(p1, p2, p3); cur = p3;
  };
  const popall = () => st.splice(0);
  const run = (code: Bytes): 'end' | void => {
    for (let i = 0; i < code.length;) {
      const v = code[i++];
      if (v >= 32) {
        if (v <= 246) st.push(v - 139);
        else if (v <= 250) st.push((v - 247) * 256 + code[i++] + 108);
        else if (v <= 254) st.push(-(v - 251) * 256 - code[i++] - 108);
        else { st.push((code[i] << 24) | (code[i + 1] << 16) | (code[i + 2] << 8) | code[i + 3]); i += 4; }
        continue;
      }
      const op = v === 12 ? 1200 + code[i++] : v;
      switch (op) {
        case 13: { const [s, w] = popall(); width = w; sbx = s; cur = [s, cur[1]]; break; }        // hsbw
        case 1207: popall(); break;                                                               // sbw (as fontTools: ignored)
        case 21: if (flexing) break; endPath(); { const a = popall(); moveTo([a[0], a[1]]); } break; // rmoveto
        case 22: if (flexing) { st.push(0); break; } endPath(); moveTo([popall()[0], 0]); break;     // hmoveto
        case 4:                                                                                   // vmoveto
          if (flexing) { st.push(0); const n = st.length; [st[n - 1], st[n - 2]] = [st[n - 2], st[n - 1]]; break; }
          endPath(); moveTo([0, popall()[0]]); break;
        case 5: { const a = popall(); lineTo([a[0], a[1]]); break; }                                 // rlineto
        case 6: { const a = popall(); lineTo([a[0], 0]); break; }                                    // hlineto
        case 7: { const a = popall(); lineTo([0, a[0]]); break; }                                    // vlineto
        case 8: { const a = popall(); curveTo([a[0], a[1]], [a[2], a[3]], [a[4], a[5]]); break; }    // rrcurveto
        case 30: { const a = popall(); curveTo([0, a[0]], [a[1], a[2]], [a[3], 0]); break; }         // vhcurveto
        case 31: { const a = popall(); curveTo([a[0], 0], [a[1], a[2]], [0, a[3]]); break; }         // hvcurveto
        case 9: if (saw) pen.closePath(); saw = false; break;                                        // closepath
        case 14: endPath(); return 'end';                                                            // endchar
        case 10: { const n = st.pop()!; if (run(font.subrs[n]) === 'end') return 'end'; break; }     // callsubr
        case 11: return;                                                                             // return
        case 1216: {                                                                                 // callothersubr
          const idx = st.pop(), n = st.pop();
          if (idx === 0 && n === 3) {                                                                // flex ends
            const fy = st.pop()!, fx = st.pop()!; st.pop();
            const v = st.splice(st.length - 14, 14);
            const [rpx, rpy, b1x, b1y, b2x, b2y, p2x, p2y, b3x, b3y, b4x, b4y, p3x, p3y] = v;
            curveTo([b1x + rpx, b1y + rpy], [b2x, b2y], [p2x, p2y]);
            curveTo([b3x, b3y], [b4x, b4y], [p3x, p3y]);
            st.push(fx, fy); flexing = false;
          } else if (idx === 1 && n === 0) flexing = true;                                           // flex starts
          break;                                                                                     // 2 (flex point), 3 (hints): nothing
        }
        case 1217: break;                                                                            // pop: ignored, as fontTools
        case 1233: { const [x, y] = popall(); cur = [x, y]; break; }                                 // setcurrentpoint
        case 1212: { const b = st.pop()!, a = st.pop()!; st.push(a / b); break; }                    // div
        case 1206: {                                                                                 // seac: base + shifted accent
          const [asb, adx, ady, bchar, achar] = popall();
          outline(STANDARD[bchar], font, pen, depth + 1);
          const dx = adx + sbx - asb;
          const shift = (p: Point): Point => [p[0] + dx, p[1] + ady];
          outline(STANDARD[achar], font, {
            moveTo: p => pen.moveTo(shift(p)), lineTo: p => pen.lineTo(shift(p)),
            curveTo: (a, b, c) => pen.curveTo(shift(a), shift(b), shift(c)),
            closePath: () => pen.closePath(), endPath: () => pen.endPath(),
          }, depth + 1);
          return 'end';
        }
        default: popall();                                                                           // stems, dotsection
      }
    }
  };
  const code = font.chars.get(name);
  if (!code) throw new Error(`no glyph ${name}`);
  run(code);
  return { width };
}

// fontTools.cffLib.specializer's topology-changing clean-up, which
// T2CharStringPen applies: successive movetos combine; a curve whose first and
// last control deltas are zero becomes a line; a zero-length line goes;
// adjacent horizontal (or vertical) lines merge. The shape is unchanged.
type Cmd = ['m' | 'l' | 'c', number[]];
function specialize(cmds: Cmd[]): Cmd[] {
  const out: Cmd[] = [];
  for (const c of cmds) {
    const last = out[out.length - 1];
    if (c[0] === 'm' && last && last[0] === 'm') last[1] = [last[1][0] + c[1][0], last[1][1] + c[1][1]];
    else out.push([c[0], c[1].slice()]);
  }
  const kind = (dx: number, dy: number) => (dx === 0 && dy === 0 ? '0' : dy === 0 ? 'h' : dx === 0 ? 'v' : 'r');
  for (let i = out.length - 1; i >= 0; i--) {
    let [op, a] = out[i];
    if (op === 'c' && a[0] === 0 && a[1] === 0 && a[4] === 0 && a[5] === 0) { op = 'l'; a = [a[2], a[3]]; out[i] = [op, a]; }
    if (op !== 'l') continue;
    const k = kind(a[0], a[1]);
    if (k === '0') { out.splice(i, 1); continue; }
    const prev = out[i - 1];
    if (i && (k === 'h' || k === 'v') && prev[0] === 'l' && kind(prev[1][0], prev[1][1]) === k) {
      prev[1] = [prev[1][0] + a[0], prev[1][1] + a[1]];
      out.splice(i, 1);
    }
  }
  return out;
}

// ── Addressing and conversion ───────────────────────────────────────────────

const SEARCHABLE_RANGES: [number, number][] = [
  [0x0020, 0x007E],   // ASCII
  [0x00A1, 0x00FF],   // Latin-1
  [0x0100, 0x017F],   // Latin Extended-A
  [0x0391, 0x03A9],   // Greek capitals
  [0x03B1, 0x03C9],   // Greek smalls
];
const SEARCHABLE_SINGLES = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2020, 0x2021, 0x2026, 0x2122]);
const searchable = (cp: number) => SEARCHABLE_SINGLES.has(cp) || SEARCHABLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

/** slot → target code point (see the top of this file). */
export function addressing(slots: Map<number, string>): Map<number, number> {
  const out = new Map<number, number>(), claimed = new Set<number>();
  for (const slot of [...slots.keys()].sort((a, b) => a - b)) {
    const u = [...toUnicode(slots.get(slot)!)];
    const cp = u.length === 1 ? u[0].codePointAt(0)! : null;
    if (cp !== null && searchable(cp) && !claimed.has(cp)) { out.set(slot, cp); claimed.add(cp); }
    else out.set(slot, PUA_BASE + slot);
  }
  return out;
}

/** The OTF bytes and addressing for a Type 1 outline, read with `encoding`
 *  (else its own). */
export function convertOutline(pfb: string, name: string, encoding: string[] | null): { bytes: Bytes; addressing: Map<number, number> } {
  const t1 = parseType1(pfb);
  const enc = encoding ?? t1.encoding;
  const upm = Math.round(1 / t1.fontMatrix[0]);
  // slot → glyph name, for slots naming a glyph the font has
  const slots = new Map<number, string>();
  enc.forEach((g, i) => { if (g && g !== '.notdef' && t1.chars.has(g)) slots.set(i, g); });
  const addr = addressing(slots);
  const order = ['.notdef', ...[...new Set(slots.values())].sort()];
  const cps = new Map(order.map(g => [g, [] as number[]]));
  for (const [slot, g] of [...slots].sort((a, b) => a[0] - b[0])) cps.get(g)!.push(addr.get(slot)!);
  const round = (v: number) => Math.floor(v + 0.5);                // T2CharStringPen rounds every point
  const glyphs = order.map(g => {
    const path = new opentype.Path();
    let advance = 0;
    if (t1.chars.has(g)) {
      const cmds: Cmd[] = [];                                     // relative, as in the Type 2 program
      let p0: Point = [0, 0];
      const rel = (p: Point): number[] => { const q: Point = [round(p[0]), round(p[1])]; const d = [q[0] - p0[0], q[1] - p0[1]]; p0 = q; return d; };
      advance = Math.trunc(outline(g, t1, {
        moveTo: p => cmds.push(['m', rel(p)]), lineTo: p => cmds.push(['l', rel(p)]),
        curveTo: (a, b, c) => cmds.push(['c', [...rel(a), ...rel(b), ...rel(c)]]),
        closePath: () => {}, endPath: () => {},
      }).width || 0);
      let x = 0, y = 0, open = false;
      for (const [op, a] of specialize(cmds)) {
        if (op === 'm') { if (open) path.close(); x += a[0]; y += a[1]; path.moveTo(x, y); open = true; }
        else if (op === 'l') { x += a[0]; y += a[1]; path.lineTo(x, y); }
        else {
          const x1 = x + a[0], y1 = y + a[1], x2 = x1 + a[2], y2 = y1 + a[3];
          x = x2 + a[4]; y = y2 + a[5];
          path.curveTo(x1, y1, x2, y2, x, y);
        }
      }
      if (open) path.close();
    }
    return new opentype.Glyph({ name: g, advanceWidth: advance, path, unicodes: cps.get(g)! });
  });
  const label = `${name} (ReflowTeX converted)`;
  const font = new opentype.Font({
    familyName: label, styleName: 'Regular', fullName: label, postScriptName: `${name}-ReflowTeXConverted`,
    unitsPerEm: upm, ascender: upm, descender: 0, glyphs,
  });
  const sfnt = readSfnt(new Uint8Array(font.toArrayBuffer()));
  setHeadTimes(sfnt, FIXED_TIME);
  return { bytes: writeSfnt(sfnt), addressing: addr };
}

export const MODIFIED_TAG = 'reflowtex';

/** Convert face `name` into `outDir` as NAME.reflowtex-HASH.otf. Returns the
 *  served file name and slot → code point, or null when it cannot be
 *  converted (no Type 1 outline – a bitmap-only face – or one that does not
 *  parse): the caller then keeps drawing metric boxes for it. */
export function convertType1(name: string, outDir: string): { served: string; addressing: Map<number, number> } | null {
  const found = findOutline(name);
  if (!found) return null;
  let result: ReturnType<typeof convertOutline>;
  try { result = convertOutline(found[0], name, found[1]); }
  catch (e) {
    console.log(`  t1-convert: ${name} skipped (${(e as Error).message}) – keeps metric boxes`);
    return null;
  }
  const served = `${name}.${MODIFIED_TAG}-${createHash('sha256').update(result.bytes).digest('hex').slice(0, 8)}.otf`;
  mkdirSync(outDir, { recursive: true });
  const tmp = join(outDir, `.${name}.building.otf`);
  writeFileSync(tmp, result.bytes, { mode: 0o644 });
  renameSync(tmp, join(outDir, served));
  return { served, addressing: result.addressing };
}
