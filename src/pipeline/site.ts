// SPDX-License-Identifier: AGPL-3.0-or-later
// What every integration needs besides compiling: the viewer's files, a block's
// HTML, the passes a snippet needs, and a few formats shared with the page
// templates. (Integrations depend on src/; nothing here knows any of them.)
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { protoText } from './schema.ts';
import { a11yLayerFromBytes } from './a11y.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const VIEWER_DIR = join(SRC, 'viewer');

/** AGPL-3.0 §13: a deployed page offers its users the Corresponding Source;
 *  this is where the page footer's source link points by default. */
export const DEFAULT_SOURCE_URL = process.env.REFLOWTEX_SOURCE_URL ?? 'https://github.com/radek-p/reflowtex';

/** A snippet that refers to labels, has a table of contents or a list of
 *  figures (read back from .toc/.lof) or cites needs the .aux round trip, or
 *  every \ref prints "??": up to three passes (revtex sets its ToC's number
 *  column from the pass before), stopping as soon as nothing changes. */
export const REF_RE = /\\(?:(?:eq|auto|c|C|name|page)?ref\*?\{|tableofcontents|listof(?:figures|tables)|cite)/;
export const REF_PASSES = 3;
export const passesFor = (content: string): number => (REF_RE.test(content) ? REF_PASSES : 1);

/** The schema as a page embeds it. */
export const schemaBase64 = (): string => Buffer.from(protoText(), 'utf8').toString('base64');

/** A block's element: the viewer finds it by data-nodelist-b64. `attrs`
 *  are more attributes for it (data-tex-final-pass="strict", say).
 *  `a11y`: the block's accessible layer follows it (src/pipeline/a11y.ts),
 *  and the drawing is hidden from assistive technology. Opt-in while the
 *  layer lacks links and the viewer's controls (footnote marks, hints),
 *  which the drawing exposes today. */
export const blockHtml = (bytes: Uint8Array, attrs: Record<string, string> = {}, { a11y = false } = {}): string =>
  `<div class="latex-block"${a11y ? ' aria-hidden="true"' : ''}${Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('')} ` +
  `data-nodelist-b64="${Buffer.from(bytes).toString('base64')}"></div>` + (a11y ? a11yLayerFromBytes(bytes) : '');

/** Python's html.escape(s, quote=True). */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// ── The viewer bundle ───────────────────────────────────────────────────────

/** The SHA-256 src/viewer/build.sh records in the bundle's second line: every
 *  module under src/viewer/src/ (.js and .ts), as its path (relative to
 *  src/viewer) and a newline, then its contents, in byte order of the paths. */
export function viewerSourcesSha256(): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js') || f.endsWith('.ts')) files.push(relative(VIEWER_DIR, p).split(sep).join('/'));
    }
  };
  walk(join(VIEWER_DIR, 'src'));
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const h = createHash('sha256');
  for (const f of files) { h.update(`${f}\n`); h.update(readFileSync(join(VIEWER_DIR, f))); }
  return h.digest('hex');
}

/** The latex-viewer.js to ship: the committed minified copy when it was made
 *  from the current bundle, else the bundle. A stale copy costs bytes, never
 *  correctness, and is reported. Ship it as latex-viewer.js either way: the
 *  DOM contract, the fonts resolved relative to the script's URL and the ?v=
 *  cache-buster all key off that name. */
export function viewerScript(log: (s: string) => void = console.log): string {
  const bundle = join(VIEWER_DIR, 'latex-viewer.js');
  const minified = join(VIEWER_DIR, 'latex-viewer.min.js');
  const secondLine = readFileSync(bundle, 'utf8').split('\n')[1] ?? '';
  if (!secondLine.includes(`sources sha256 ${viewerSourcesSha256()}`))
    log('  viewer: latex-viewer.js is stale (a module in src/viewer/src/ changed since it was bundled) – shipping it anyway; run `make build-viewer`');
  if (existsSync(minified)) {
    const header = readFileSync(minified, 'utf8').split('\n')[0];
    if (header.includes(`sha256 ${createHash('sha256').update(readFileSync(bundle)).digest('hex')}`)) return minified;
    log('  viewer: latex-viewer.min.js is stale (source changed since it was generated) – shipping the unminified source; run `make minify-viewer`');
  }
  return bundle;
}

/** Copy the viewer (and, if asked, the inspector: its script and what it loads
 *  from beside itself when opened) into a site directory. */
export function installViewer(outDir: string, { inspector = false, log }: { inspector?: boolean; log?: (s: string) => void } = {}): void {
  mkdirSync(outDir, { recursive: true });
  copyFileSync(viewerScript(log), join(outDir, 'latex-viewer.js'));
  copyFileSync(join(VIEWER_DIR, 'protobuf.min.js'), join(outDir, 'protobuf.min.js'));
  if (inspector) cpSync(join(SRC, 'inspector'), join(outDir, 'inspector'), { recursive: true, filter: s => !s.endsWith('README.md') });
  // The companion package's browser side, for a site that turns it on (the
  // Hugo integration's params.reflowtexCompanion): two files, no Node needed.
  mkdirSync(join(outDir, 'companion'), { recursive: true });
  for (const f of ['companion.js', 'companion.css']) copyFileSync(join(SRC, 'companion', f), join(outDir, 'companion', f));
}

// ── Python-compatible JSON, where a stored hash depends on it ────────────────

/** A float as Python's repr() writes it (so 0 is "0.0"). */
function pyFloat(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`;
  const s = String(x);
  if (!s.includes('e')) return s;
  const [m, e] = s.split('e');
  return `${m}e${e[0] === '-' ? '-' : '+'}${e.replace(/^[+-]/, '').padStart(2, '0')}`;
}

/** json.dumps() of strings, floats and lists as Python writes them (ASCII
 *  escapes, ", " between items): data files store hashes of such text, and a
 *  hash must not change when the builder does. Numbers here are floats. */
export function pyJsonDumps(v: unknown): string {
  if (typeof v === 'string') {
    return `"${v.replace(/[\\"\u0000-\u001f\u007f-￿]/g, c => {
      const named: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
      return named[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
    })}"`;
  }
  if (typeof v === 'number') return pyFloat(v);
  if (Array.isArray(v)) return `[${v.map(pyJsonDumps).join(', ')}]`;
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  throw new Error(`pyJsonDumps: unsupported ${typeof v}`);
}

/** JSON as the data files are written – sorted keys, two-space indent,
 *  non-ASCII escaped – byte for byte what the Python prebuild wrote, so a
 *  site's committed data does not churn when the builder changes. */
export function jsonSorted(v: unknown): string {
  const sort = (x: unknown): unknown => (Array.isArray(x) ? x.map(sort)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort((x as Record<string, unknown>)[k])])) : x);
  return JSON.stringify(sort(v), null, 2).replace(/[\u0080-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
