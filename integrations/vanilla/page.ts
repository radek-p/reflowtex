// SPDX-License-Identifier: AGPL-3.0-or-later
// The vanilla integration's page: page.template.html filled in. Shared by the
// vanilla build, examples/testmath and the pageless tools, which all show
// blocks on this one self-contained page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escapeHtml, schemaBase64 } from '../../src/pipeline/site.ts';
import type { AlertLevel } from '../../src/shared/log.ts';

const TEMPLATE = fileURLToPath(new URL('page.template.html', import.meta.url));

export interface PageOptions {
  title: string;
  /** the blocks' HTML, in order (site.ts blockHtml) */
  blocks: string[];
  /** original font file → served file (Pipeline.fontMap) */
  fontMap: Record<string, string>;
  sourceUrl: string;
  /** URL prefix @font-face fetches fonts from; relative resolves against
   *  latex-viewer.js's own URL */
  fontsBase: string;
  /** more scripts, loaded right after the viewer (an alternative breaker) */
  extraScripts?: string[];
  /** the inspector is installed beside the page (installViewer's `inspector`):
   *  without it, the page does not load it – a script that is not there */
  inspector?: boolean;
  /** the viewer's log (#latex-log-config): `alert`, the level from which its
   *  messages go to the browser's console and as an event; `show`, which
   *  are shown to readers (codes, or level names: that level and above).
   *  What is not given is the viewer's default; without it, the page has
   *  no #latex-log-config. */
  log?: { alert?: AlertLevel; show?: string[] };
}

export function renderPage(o: PageOptions): string {
  const viewerTag = '<script src="latex-viewer.js"></script>';
  const inspectorTag = '<script src="inspector/inspector.js"></script>\n';
  // every use of a placeholder (the title is the <title> and the heading); the
  // blocks last, so that nothing in them is taken for one
  let page = readFileSync(TEMPLATE, 'utf8')
    .replaceAll('{{TITLE}}', () => escapeHtml(o.title))
    .replaceAll('{{SCHEMA_B64}}', () => schemaBase64())
    .replaceAll('{{FONT_MAP_JSON}}', () => JSON.stringify(o.fontMap))
    .replaceAll('{{SOURCE_URL}}', () => escapeHtml(o.sourceUrl))
    .replaceAll('{{FONTS_BASE}}', () => escapeHtml(o.fontsBase))
    // (its JSON with < escaped: nothing in it can end the script element)
    .replace('{{LOG_CONFIG}}', () => (o.log
      ? `\n<script id="latex-log-config" type="application/json">${JSON.stringify(o.log).replace(/</g, '\\u003c')}</script>` : ''))
    .replace('{{BLOCKS}}', () => o.blocks.join('\n'));
  if (!o.inspector) {
    if (!page.includes(inspectorTag)) throw new Error(`page.template.html has no ${inspectorTag.trim()} to leave out`);
    page = page.replace(inspectorTag, '');
  }
  if (o.extraScripts?.length) {
    if (!page.includes(viewerTag)) throw new Error(`page.template.html has no ${viewerTag} to load extra scripts after`);
    page = page.replace(viewerTag, () => viewerTag + o.extraScripts!.map(s => `\n<script src="${escapeHtml(s)}"></script>`).join(''));
  }
  return page;
}
