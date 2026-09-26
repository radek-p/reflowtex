// SPDX-License-Identifier: AGPL-3.0-or-later
// The vanilla integration's page: page.template.html filled in. Shared by the
// vanilla build, examples/testmath and the pageless tools, which all show
// blocks on this one self-contained page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escapeHtml, schemaBase64 } from '../../src/pipeline/site.ts';

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
}

export function renderPage(o: PageOptions): string {
  const viewerTag = '<script src="latex-viewer.js"></script>';
  let page = readFileSync(TEMPLATE, 'utf8')
    .replace('{{TITLE}}', () => escapeHtml(o.title))
    .replace('{{SCHEMA_B64}}', () => schemaBase64())
    .replace('{{FONT_MAP_JSON}}', () => JSON.stringify(o.fontMap))
    .replace('{{SOURCE_URL}}', () => escapeHtml(o.sourceUrl))
    .replace('{{FONTS_BASE}}', () => escapeHtml(o.fontsBase))
    .replace('{{BLOCKS}}', () => o.blocks.join('\n'));
  if (o.extraScripts?.length) {
    if (!page.includes(viewerTag)) throw new Error(`page.template.html has no ${viewerTag} to load extra scripts after`);
    page = page.replace(viewerTag, () => viewerTag + o.extraScripts!.map(s => `\n<script src="${escapeHtml(s)}"></script>`).join(''));
  }
  return page;
}
