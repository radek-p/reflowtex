// SPDX-License-Identifier: AGPL-3.0-or-later
// Values written as Python writes them, where text made by the Python
// pipeline this project once had must not change: the Hugo integration's
// batch hash (a site's data stores it, pyJsonDumps), and the strip check's
// report (tools/pageless-pdf/check-against-paged.ts, pyRepr). Nothing else
// needs Python's formatting. It imports nothing, so it runs anywhere.

/** A float as Python's repr() writes it: 0 as "0.0", 1e-05, 1e+16, nan. */
export function pyFloat(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e < -4 || e >= 16) {
    const [m, ex] = x.toExponential().split('e');
    const en = Number(ex);
    return `${m}e${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(2, '0')}`;
  }
  if (Number.isInteger(x)) return `${x}.0`;
  const s = String(x);
  return s.includes('e') ? x.toFixed(20).replace(/0+$/, '') : s;
}

/** Python's repr() of JSON-shaped data. (A float that happens to be integral
 *  prints as an int: JSON cannot tell 1.0 from 1.) */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (typeof v === 'string') {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    const body = v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      .replace(new RegExp(q, 'g'), `\\${q}`)
      // what Python counts as not printable (other and separator characters
      // but the space), escaped as it writes them
      .replace(/(?! )[\p{C}\p{Z}]/gu, c => {
        const n = c.codePointAt(0)!, h = n.toString(16);
        return n <= 0xff ? `\\x${h.padStart(2, '0')}` : n <= 0xffff ? `\\u${h.padStart(4, '0')}` : `\\U${h.padStart(8, '0')}`;
      });
    return q + body + q;
  }
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (v instanceof Map) return `{${[...v].map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
  return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
}

/** json.dumps() of strings, floats and lists as Python writes them (ASCII
 *  escapes, ", " between items). Numbers here are floats. */
export function pyJsonDumps(v: unknown): string {
  if (typeof v === 'string') {
    return `"${v.replace(/[\\"\u0000-\u001f\u007f-￿]/g, c => {
      const named: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
      return named[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
    })}"`;
  }
  // json.dumps writes what repr() calls nan and inf as JavaScript does
  if (typeof v === 'number') return Number.isFinite(v) ? pyFloat(v) : String(v);
  if (Array.isArray(v)) return `[${v.map(pyJsonDumps).join(', ')}]`;
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  throw new Error(`pyJsonDumps: unsupported ${typeof v}`);
}
