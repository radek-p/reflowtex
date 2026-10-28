// SPDX-License-Identifier: AGPL-3.0-or-later
// A paper's source archive, unpacked safely. The archive is untrusted: it is
// read here, in memory, and only plain files and folders are written, each
// under the destination. A member with an absolute path, a '..', a link, a
// device or any other kind of entry stops the unpacking, as does an archive
// that would grow past a limit (a compression bomb). Nothing is run.
//
// The kinds arXiv serves (a tar, gzipped or not; a single gzipped file; a
// single plain file), and zip (CTAN, GitHub).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { readTar } from '../lib/tar.ts';
import { safeRelative } from './manifest.ts';

export interface Member { name: string; data: Uint8Array }
/** At most this much unpacked, in all. */
export const MAX_BYTES = 2 * 2 ** 30;

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPdf = (b: Uint8Array) => Buffer.from(b.subarray(0, 5)).toString('latin1') === '%PDF-';

/** Whether the bytes are a tar archive: a first header whose checksum is right. */
export function isTar(b: Uint8Array): boolean {
  if (b.length < 512) return false;
  const field = Buffer.from(b.subarray(148, 156)).toString('latin1').replace(/[\0 ]+$/, '').trim();
  if (!/^[0-7]+$/.test(field)) return false;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : b[i];
  return sum === parseInt(field, 8);
}

/** A member's name as written in the archive, checked: relative, inside, with './' and a trailing '/' taken off. */
function cleanName(raw: string, folder = false): string {
  const name = raw.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (folder && (name === '' || name === '.')) return '';     // the archive's own top folder
  if (!safeRelative(name)) throw new Error(`archive: unsafe member name ${JSON.stringify(raw)}`);
  return name;
}

/** The files of a zip archive (stored or deflated); links and other kinds refused. */
export function readZip(buf: Uint8Array): Member[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = b.readUInt16LE(eocd + 10);
  let at = b.readUInt32LE(eocd + 16);
  const out: Member[] = [];
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(at) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = b.readUInt16LE(at + 10), csize = b.readUInt32LE(at + 20), usize = b.readUInt32LE(at + 24);
    const nlen = b.readUInt16LE(at + 28), xlen = b.readUInt16LE(at + 30), clen = b.readUInt16LE(at + 32);
    const madeBy = b.readUInt16LE(at + 4) >> 8, attrs = b.readUInt32LE(at + 38), local = b.readUInt32LE(at + 42);
    const raw = b.subarray(at + 46, at + 46 + nlen).toString('utf8');
    at += 46 + nlen + xlen + clen;
    const mode = madeBy === 3 ? attrs >>> 16 : 0;           // unix: the file's mode
    const kind = mode & 0o170000;
    if (raw.endsWith('/')) { cleanName(raw, true); continue; }    // a folder
    if (kind !== 0 && kind !== 0o100000) throw new Error(`zip: ${JSON.stringify(raw)} is not a plain file`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new Error('zip: zip64 archives are not read');
    if (b.readUInt32LE(local) !== 0x04034b50) throw new Error('zip: bad local header');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + csize);
    const bytes = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: usize + 1 }) : null;
    if (!bytes) throw new Error(`zip: ${raw}: compression method ${method} is not read`);
    if (bytes.length !== usize) throw new Error(`zip: ${raw}: unpacked size differs from the directory's`);
    out.push({ name: cleanName(raw), data: new Uint8Array(bytes) });
  }
  return out;
}

/** The members of a source archive, by its kind; `single`: the name a single file is given (its main file). */
export function members(buf: Uint8Array, single: string): Member[] {
  if (isPdf(buf)) throw new Error('archive: a PDF, not a source');
  if (isZip(buf)) return readZip(buf);
  const bytes = isGzip(buf) ? new Uint8Array(gunzipSync(buf, { maxOutputLength: MAX_BYTES })) : buf;
  if (isTar(bytes)) {
    const out: Member[] = [];
    for (const e of readTar(bytes)) {
      if (e.type === 'dir') { cleanName(e.name, true); continue; }
      if (e.type !== 'file') throw new Error(`archive: ${JSON.stringify(e.name)} is not a plain file or folder`);
      out.push({ name: cleanName(e.name), data: e.data });
    }
    return out;
  }
  return [{ name: cleanName(single), data: bytes }];
}

/** Unpack into `dest` (which must not exist yet): every member checked first, then written. */
export function unpack(buf: Uint8Array, dest: string, single: string): Member[] {
  const list = members(buf, single);
  const names = new Set<string>();
  let total = 0;
  for (const m of list) {
    const key = m.name.toLowerCase();
    if (names.has(key)) throw new Error(`archive: ${m.name} twice`);
    names.add(key);
    total += m.data.length;
    if (total > MAX_BYTES) throw new Error('archive: unpacks to more than the limit');
  }
  // a file and a folder of the same name: refused before anything is written
  for (const m of list) for (let d = dirname(m.name); d !== '.'; d = dirname(d))
    if (names.has(d.toLowerCase())) throw new Error(`archive: ${d} is both a file and a folder`);
  if (existsSync(dest)) throw new Error(`archive: ${dest} exists already`);
  mkdirSync(dest, { recursive: true });
  for (const m of list) {
    const to = join(dest, m.name);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, m.data, { flag: 'wx', mode: 0o644 });
  }
  return list;
}
