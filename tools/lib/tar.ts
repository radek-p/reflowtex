// SPDX-License-Identifier: AGPL-3.0-or-later
// Tar archives of regular files, the part of the format the tools need: write
// a reproducible one (no times, owners or order that depends on the disk; byte
// for byte what Python's tarfile writes for the same files), and
// read one back – ustar, with pax extended headers (their `path` is honoured)
// and GNU long names skipped. What a reader then does with an entry's name is
// its business: check it before writing anywhere.
const BLOCK = 512, RECORD = 20 * BLOCK;

function header(name: string, size: number, type: string): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const put = (s: string, at: number, len: number) => { const b = Buffer.from(s, 'utf8'); if (b.length > len) throw new Error(`tar: "${s}" too long`); h.set(b, at); };
  put(name, 0, 100);
  put('0000644'.padStart(7, '0'), 100, 8);               // mode
  put('0000000', 108, 8); put('0000000', 116, 8);          // uid, gid
  put(size.toString(8).padStart(11, '0'), 124, 12);       // size
  put('00000000000', 136, 12);                             // mtime 0
  h.fill(0x20, 148, 156);                                  // checksum field: spaces while summing
  put(type, 156, 1);
  put('ustar\u0000', 257, 6); put('00', 263, 2);
  const sum = h.reduce((a, b) => a + b, 0);
  put(sum.toString(8).padStart(6, '0') + '\u0000 ', 148, 8);
  return h;
}

/** One archive of `files` (name → bytes), in the order given. */
export function writeTar(files: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, data] of files) {
    parts.push(header(name, data.length, '0'), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(2 * BLOCK));                   // the end
  const body = Buffer.concat(parts);
  // padded to whole records of 20 blocks, as tar (and Python's tarfile) write
  const out = new Uint8Array(Math.ceil(body.length / RECORD) * RECORD);
  out.set(body);
  return out;
}

export interface TarEntry { name: string; type: 'file' | 'dir' | 'other'; data: Uint8Array }

/** Every entry of an archive. */
export function readTar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  const str = (at: number, len: number) => Buffer.from(buf.subarray(at, at + len)).toString('utf8').replace(/\u0000.*$/s, '');
  let o = 0, paxPath: string | null = null;
  while (o + BLOCK <= buf.length) {
    if (buf.subarray(o, o + BLOCK).every(b => b === 0)) break;
    const size = parseInt(str(o + 124, 12).trim() || '0', 8);
    const type = str(o + 156, 1) || '0';
    const prefix = str(o + 345, 155);
    let name = (prefix ? `${prefix}/` : '') + str(o, 100);
    const data = buf.subarray(o + BLOCK, o + BLOCK + size);
    o += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') {                                     // pax: its path, for the next entry
      for (const rec of Buffer.from(data).toString('utf8').split('\n')) { const m = / path=(.*)$/.exec(rec); if (m) paxPath = m[1]; }
      continue;
    }
    if (type === 'g' || type === 'L' || type === 'K') continue;
    if (paxPath !== null) { name = paxPath; paxPath = null; }
    out.push({ name, type: type === '0' || type === '\u0000' ? 'file' : type === '5' ? 'dir' : 'other', data });
  }
  return out;
}
