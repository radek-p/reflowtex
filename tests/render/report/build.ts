#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The report page's script: app.ts, as the browser runs it (app.js, an ES
// module beside index.html, with bands.ts in it). Built when the report is
// served (serve.ts) and for the website (website/build.sh), so nothing
// generated is committed.
//
//     node tests/render/report/build.ts <out.js>
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const APP = fileURLToPath(new URL('app.ts', import.meta.url));

/** app.ts with its types taken out and the report's own modules it imports
 *  (bands.ts) put in: one module, not minified (its other imports are types
 *  only; Preact comes from the inspector's folder at run time). */
export function reportScript(): string {
  return buildSync({
    entryPoints: [APP], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    charset: 'utf8', legalComments: 'none',
  }).outputFiles[0].text;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tests/render/report/build.ts <out.js>'); process.exit(2); }
  writeFileSync(out, reportScript());
}
