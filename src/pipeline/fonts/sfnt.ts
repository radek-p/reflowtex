// SPDX-License-Identifier: AGPL-3.0-or-later
// A minimal sfnt (OpenType/TrueType) reader and writer – what the pipeline
// needs of a font file: looking up and extending the cmap, marking the name
// table, fixing the head timestamps. Tables are kept as raw bytes; only cmap,
// name and head are parsed, and only a changed table is rebuilt – every other
// table is written back byte for byte.

type Bytes = Uint8Array;
const u16 = (b: Bytes, o: number): number => (b[o] << 8) | b[o + 1];
const i16 = (b: Bytes, o: number): number => (u16(b, o) << 16) >> 16;
const u32 = (b: Bytes, o: number): number => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

export interface Sfnt { version: number; tables: Map<string, Bytes> }

export function readSfnt(buf: Uint8Array | ArrayBuffer): Sfnt {
  const b = new Uint8Array(buf);
  const version = u32(b, 0);
  const n = u16(b, 4);
  const tables = new Map<string, Bytes>();
  for (let i = 0; i < n; i++) {
    const r = 12 + 16 * i;
    const tag = String.fromCharCode(b[r], b[r + 1], b[r + 2], b[r + 3]);
    const off = u32(b, r + 8), len = u32(b, r + 12);
    tables.set(tag, b.slice(off, off + len));
  }
  return { version, tables };
}

function checksum(bytes: Bytes): number {
  let sum = 0;
  const n = bytes.length;
  for (let i = 0; i < n; i += 4) {
    sum = (sum + (((bytes[i] << 24) >>> 0) + ((bytes[i + 1] || 0) << 16)
      + ((bytes[i + 2] || 0) << 8) + (bytes[i + 3] || 0))) >>> 0;
  }
  return sum;
}

// Tables in tag order (as fontTools writes them), each 4-byte aligned, with
// checksums and head.checkSumAdjustment recomputed.
export function writeSfnt({ version, tables }: Sfnt): Bytes {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  let es = 0; while ((1 << (es + 1)) <= n) es++;
  const searchRange = (1 << es) * 16;
  let off = 12 + 16 * n;
  const layout = tags.map(tag => {
    const data = tables.get(tag)!;
    const at = off;
    off += (data.length + 3) & ~3;
    return { tag, data, at };
  });
  const out = new Uint8Array(off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, version); dv.setUint16(4, n); dv.setUint16(6, searchRange);
  dv.setUint16(8, es); dv.setUint16(10, n * 16 - searchRange);
  let headAt = -1;
  layout.forEach(({ tag, data, at }, i) => {
    let d = data;
    if (tag === 'head') { d = data.slice(); d.set([0, 0, 0, 0], 8); headAt = at; }
    const r = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[r + k] = tag.charCodeAt(k);
    dv.setUint32(r + 4, checksum(d)); dv.setUint32(r + 8, at); dv.setUint32(r + 12, data.length);
    out.set(d, at);
  });
  if (headAt >= 0) dv.setUint32(headAt + 8, (0xB1B0AFBA - checksum(out)) >>> 0);
  return out;
}

// ── cmap ─────────────────────────────────────────────────────────────────────
// Subtables in file order: {platformID, encodingID, format, language, map:
// Map(codepoint → glyph id), raw}. Formats 0, 4, 6, 12 are decoded; others
// (14: variation sequences) are kept raw with an empty map.
export interface CmapSubtable {
  platformID: number; encodingID: number; format: number; language: number;
  map: Map<number, number>; raw: Bytes; dirty?: boolean;
  /** The decoded data, shared by the encoding records that point at it. */
  shared: CmapSubtable;
}

export function parseCmap(t: Bytes): CmapSubtable[] {
  const n = u16(t, 2);
  const subs: CmapSubtable[] = [];
  const byOffset = new Map<number, CmapSubtable>();
  for (let i = 0; i < n; i++) {
    const r = 4 + 8 * i;
    const platformID = u16(t, r), encodingID = u16(t, r + 2), off = u32(t, r + 4);
    let s = byOffset.get(off);
    if (!s) {
      s = decodeSubtable(t, off) as CmapSubtable;
      s.shared = s;
      byOffset.set(off, s);
    }
    subs.push({ ...s, platformID, encodingID, shared: s });
  }
  return subs;
}

function decodeSubtable(t: Bytes, o: number) {
  const format = u16(t, o);
  const map = new Map<number, number>();
  let len: number, language = 0;
  if (format === 0) {
    len = u16(t, o + 2); language = u16(t, o + 4);
    for (let c = 0; c < 256; c++) if (t[o + 6 + c]) map.set(c, t[o + 6 + c]);
  } else if (format === 4) {
    len = u16(t, o + 2); language = u16(t, o + 4);
    const segX2 = u16(t, o + 6), seg = segX2 / 2;
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
    for (let s = 0; s < seg; s++) {
      const end = u16(t, ends + 2 * s), start = u16(t, starts + 2 * s);
      const delta = i16(t, deltas + 2 * s), ro = u16(t, ros + 2 * s);
      for (let c = start; c <= end && c !== 0xFFFF; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xFFFF;
        else {
          const at = ros + 2 * s + ro + 2 * (c - start);
          g = u16(t, at); if (g) g = (g + delta) & 0xFFFF;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (format === 6) {
    len = u16(t, o + 2); language = u16(t, o + 4);
    const first = u16(t, o + 6), count = u16(t, o + 8);
    for (let i = 0; i < count; i++) { const g = u16(t, o + 10 + 2 * i); if (g) map.set(first + i, g); }
  } else if (format === 12) {
    len = u32(t, o + 4); language = u32(t, o + 8);
    const groups = u32(t, o + 12);
    for (let i = 0; i < groups; i++) {
      const r = o + 16 + 12 * i;
      const s = u32(t, r), e = u32(t, r + 4), g = u32(t, r + 8);
      for (let c = s; c <= e; c++) map.set(c, g + (c - s));
    }
  } else if (format === 14) {
    len = u32(t, o + 2);
  } else {
    len = u16(t, o + 2);
  }
  return { platformID: 0, encodingID: 0, format, language, map, raw: t.slice(o, o + len) };
}

function encodeFormat4(map: Map<number, number>, language: number): Bytes {
  // Runs of consecutive codepoints with consecutive glyph ids → one segment
  // each (idDelta); the 0xFFFF terminator closes the table.
  const cps = [...map.keys()].filter(c => c <= 0xFFFF).sort((a, b) => a - b);
  const segs: { start: number; end: number; g0: number }[] = [];
  for (const c of cps) {
    const g = map.get(c)!, last = segs[segs.length - 1];
    if (last && c === last.end + 1 && g === last.g0 + (c - last.start)) last.end = c;
    else segs.push({ start: c, end: c, g0: g });
  }
  if (!segs.length || segs[segs.length - 1].end !== 0xFFFF) segs.push({ start: 0xFFFF, end: 0xFFFF, g0: 1 });
  const n = segs.length;
  const len = 16 + 8 * n;
  const b = new Uint8Array(len), dv = new DataView(b.buffer);
  let es = 0; while ((1 << (es + 1)) <= n) es++;
  dv.setUint16(0, 4); dv.setUint16(2, len); dv.setUint16(4, language);
  dv.setUint16(6, 2 * n); dv.setUint16(8, 2 * (1 << es)); dv.setUint16(10, es); dv.setUint16(12, 2 * n - 2 * (1 << es));
  segs.forEach((s, i) => {
    dv.setUint16(14 + 2 * i, s.end);
    dv.setUint16(16 + 2 * n + 2 * i, s.start);
    dv.setUint16(16 + 4 * n + 2 * i, (s.g0 - s.start) & 0xFFFF);
    dv.setUint16(16 + 6 * n + 2 * i, 0);
  });
  return b;
}

function encodeFormat12(map: Map<number, number>, language: number): Bytes {
  const cps = [...map.keys()].sort((a, b) => a - b);
  const groups: { start: number; end: number; g0: number }[] = [];
  for (const c of cps) {
    const g = map.get(c)!, last = groups[groups.length - 1];
    if (last && c === last.end + 1 && g === last.g0 + (c - last.start)) last.end = c;
    else groups.push({ start: c, end: c, g0: g });
  }
  const len = 16 + 12 * groups.length;
  const b = new Uint8Array(len), dv = new DataView(b.buffer);
  dv.setUint16(0, 12); dv.setUint32(4, len); dv.setUint32(8, language); dv.setUint32(12, groups.length);
  groups.forEach((g, i) => { dv.setUint32(16 + 12 * i, g.start); dv.setUint32(20 + 12 * i, g.end); dv.setUint32(24 + 12 * i, g.g0); });
  return b;
}

// Rebuild the cmap: changed subtables are re-encoded, the rest reused raw;
// subtables that shared data keep sharing it.
export function buildCmap(subs: CmapSubtable[]): Bytes {
  const blobs: Bytes[] = [], blobOf = new Map<CmapSubtable, number>();
  for (const s of subs) {
    if (blobOf.has(s.shared)) continue;
    let raw = s.raw;
    if (s.shared.dirty) raw = s.format === 12 ? encodeFormat12(s.map, s.language) : encodeFormat4(s.map, s.language);
    blobOf.set(s.shared, blobs.length); blobs.push(raw);
  }
  const head = 4 + 8 * subs.length;
  const offs: number[] = []; let off = head;
  for (const r of blobs) { offs.push(off); off += r.length; }
  const b = new Uint8Array(off), dv = new DataView(b.buffer);
  dv.setUint16(0, 0); dv.setUint16(2, subs.length);
  subs.forEach((s, i) => {
    dv.setUint16(4 + 8 * i, s.platformID); dv.setUint16(6 + 8 * i, s.encodingID);
    dv.setUint32(8 + 8 * i, offs[blobOf.get(s.shared)!]);
  });
  blobs.forEach((r, i) => b.set(r, offs[i]));
  return b;
}

// ── name ─────────────────────────────────────────────────────────────────────
export interface NameRecord { platformID: number; encodingID: number; languageID: number; nameID: number; bytes: Bytes }

export function parseName(t: Bytes): NameRecord[] {
  const count = u16(t, 2), strOff = u16(t, 4);
  const recs: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + 12 * i;
    const rec: NameRecord = { platformID: u16(t, r), encodingID: u16(t, r + 2), languageID: u16(t, r + 4),
                  nameID: u16(t, r + 6), bytes: t.slice(strOff + u16(t, r + 10), strOff + u16(t, r + 10) + u16(t, r + 8)) };
    recs.push(rec);
  }
  return recs;
}
const utf16 = (rec: NameRecord): boolean => rec.platformID === 0 || (rec.platformID === 3 && (rec.encodingID === 1 || rec.encodingID === 10 || rec.encodingID === 0));
export function nameString(rec: NameRecord): string | null {
  if (utf16(rec)) { let s = ''; for (let i = 0; i + 1 < rec.bytes.length; i += 2) s += String.fromCharCode(u16(rec.bytes, i)); return s; }
  if (rec.platformID === 1 && rec.encodingID === 0) return String.fromCharCode(...rec.bytes);   // Mac Roman: ASCII part
  return null;
}
export function setNameString(rec: NameRecord, s: string): void {
  if (utf16(rec)) { const b = new Uint8Array(2 * s.length); for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) >> 8; b[2 * i + 1] = s.charCodeAt(i) & 255; } rec.bytes = b; }
  else rec.bytes = Uint8Array.from(s, c => c.charCodeAt(0));
}
export function buildName(recs: NameRecord[]): Bytes {
  // records sorted as the spec requires, strings deduplicated
  const sorted = [...recs].sort((a, b) => a.platformID - b.platformID || a.encodingID - b.encodingID
    || a.languageID - b.languageID || a.nameID - b.nameID);
  const pool: Bytes[] = [], at = new Map<string, number>(); let len = 0;
  const offs = sorted.map(r => {
    const key = r.bytes.join(',');
    if (!at.has(key)) { at.set(key, len); pool.push(r.bytes); len += r.bytes.length; }
    return at.get(key)!;
  });
  const strOff = 6 + 12 * sorted.length;
  const b = new Uint8Array(strOff + len), dv = new DataView(b.buffer);
  dv.setUint16(0, 0); dv.setUint16(2, sorted.length); dv.setUint16(4, strOff);
  sorted.forEach((r, i) => {
    const o = 6 + 12 * i;
    dv.setUint16(o, r.platformID); dv.setUint16(o + 2, r.encodingID); dv.setUint16(o + 4, r.languageID);
    dv.setUint16(o + 6, r.nameID); dv.setUint16(o + 8, r.bytes.length); dv.setUint16(o + 10, offs[i]);
  });
  let p = strOff; for (const s of pool) { b.set(s, p); p += s.length; }
  return b;
}

export const numGlyphs = (f: Sfnt): number => u16(f.tables.get('maxp')!, 4);

/** Set head.created and head.modified (seconds since 1904): a fixed value
 *  keeps a written font byte-reproducible, so its content hash is stable. */
export function setHeadTimes(f: Sfnt, seconds: number): void {
  const head = f.tables.get('head')!.slice();
  const dv = new DataView(head.buffer);
  // created at byte 20, modified at 28: 64-bit, high word 0
  for (const at of [20, 28]) { dv.setUint32(at, 0); dv.setUint32(at + 4, seconds); }
  f.tables.set('head', head);
}

/** Every code point → glyph id the font maps (all cmap subtables, the first
 *  one to map a code point winning). */
export function codepointsToGlyphs(f: Sfnt): Map<number, number> {
  const out = new Map<number, number>();
  const cmap = f.tables.get('cmap');
  if (!cmap) return out;
  for (const s of parseCmap(cmap)) for (const [c, g] of s.map) if (!out.has(c)) out.set(c, g);
  return out;
}
