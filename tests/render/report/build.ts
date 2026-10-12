#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The report page's script: app.ts, as the browser runs it (app.js, an ES
// module beside index.html). Built when the report is served (serve.ts) and
// for the website (website/build.sh), so nothing generated is committed.
//
//     node tests/render/report/build.ts <out.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const APP = fileURLToPath(new URL('app.ts', import.meta.url));

/** app.ts with its types taken out: one module, as written (its imports are
 *  types only; Preact comes from the inspector's folder at run time). */
export function reportScript(): string {
  return transformSync(readFileSync(APP, 'utf8'), {
    loader: 'ts', format: 'esm', charset: 'utf8', sourcefile: 'app.ts', legalComments: 'none',
  }).code;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tests/render/report/build.ts <out.js>'); process.exit(2); }
  writeFileSync(out, reportScript());
}
