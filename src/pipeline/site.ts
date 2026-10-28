// SPDX-License-Identifier: AGPL-3.0-or-later
// What every integration needs besides compiling: the viewer's files, a block's
// HTML, and a few formats shared with the page templates. (Integrations
// depend on src/; nothing here knows any of them.)
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { protoText } from './schema.ts';
import { a11yLayerFromBytes } from './a11y.ts';
import { ensureBundles } from './bundles.ts';
import { consoleLog, type Log } from '../shared/log.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const VIEWER_DIR = join(SRC, 'viewer');

/** AGPL-3.0 §13: a deployed page offers its users the Corresponding Source;
 *  this is where the page footer's source link points by default. */
export const DEFAULT_SOURCE_URL = process.env.REFLOWTEX_SOURCE_URL ?? 'https://github.com/radek-p/reflowtex';

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

/** `s` escaped for HTML text and attribute values: & < > " and '. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// ── The viewer bundle ───────────────────────────────────────────────────────

/** The latex-viewer.js to ship: the minified bundle, built first if it is
 *  missing or stale (bundles.ts). Ship it as latex-viewer.js: the DOM
 *  contract, the fonts resolved relative to the script's URL and the ?v=
 *  cache-buster all key off that name. */
export function viewerScript(log: Log = consoleLog()): string {
  ensureBundles({ only: ['viewer'], log });
  return join(VIEWER_DIR, 'latex-viewer.min.js');
}

/** What src/inspector holds that a site does not need: its sources (built into
 *  the files beside them) and its README. */
export const INSPECTOR_UNSHIPPED = new Set(['src', 'README.md']);

/** Copy the viewer (and, if asked, the inspector: its script and what it loads
 *  from beside itself when opened – the built files, not its sources) into a
 *  site directory, each built first if it is missing or stale. */
export function installViewer(outDir: string, { inspector = false, log = consoleLog() }: { inspector?: boolean; log?: Log } = {}): void {
  ensureBundles({ log });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(viewerScript(log), join(outDir, 'latex-viewer.js'));
  copyFileSync(join(VIEWER_DIR, 'protobuf.min.js'), join(outDir, 'protobuf.min.js'));
  if (inspector) cpSync(join(SRC, 'inspector'), join(outDir, 'inspector'), { recursive: true, filter: s => !INSPECTOR_UNSHIPPED.has(relative(join(SRC, 'inspector'), s)) });
  // The companion package's browser side, for a site that turns it on (the
  // Hugo integration's params.reflowtexCompanion): two files, no Node needed.
  mkdirSync(join(outDir, 'companion'), { recursive: true });
  for (const f of ['companion.js', 'companion.css']) copyFileSync(join(SRC, 'companion', f), join(outDir, 'companion', f));
}

// ── Data files ───────────────────────────────────────────────────────────────

/** JSON as the data files are written – sorted keys, two-space indent,
 *  non-ASCII escaped – as the data files have always been written, so a
 *  site's committed data does not churn when the builder changes. */
export function jsonSorted(v: unknown): string {
  const sort = (x: unknown): unknown => (Array.isArray(x) ? x.map(sort)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort((x as Record<string, unknown>)[k])])) : x);
  return JSON.stringify(sort(v), null, 2).replace(/[\u0080-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
