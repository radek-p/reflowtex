#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Public demo: AMS's testmath.tex (the amsmath "sample paper") as one page.
//
// testmath.tex is bundled verbatim (NOTICE.md – LPPL 1.3c, © American
// Mathematical Society and the LaTeX Project). This script does not modify it:
// the pipeline compiles it as it is, with the classic Computer Modern fonts the
// document was written for – no fontspec, no unicode-math – and preamble.tex
// (microtype, luamml) read at the end of its own preamble, with tagging on. Those 8-bit Type 1 fonts have no OpenType
// form, so the pipeline converts them (src/pipeline/fonts/type1.ts): the demo
// is also a stress test of that path on a dense, real amsmath document.
//
//     node examples/testmath/build.ts [-o build/testmath-site] [--fonts-base /fonts/]
//                                     [--extra-script FILE]…
import { parseArgs } from 'node:util';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '../../src/pipeline/pipeline.ts';
import { DEFAULT_SOURCE_URL, blockHtml, installViewer } from '../../src/pipeline/site.ts';
import { renderPage } from '../../integrations/vanilla/page.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../..');
// testmath is full of \eqref/\ref: a few passes let the .aux settle so they
// resolve instead of showing [?]
const PASSES = 3;

const { values: o } = parseArgs({
  options: {
    out: { type: 'string', short: 'o', default: join(REPO, 'build/testmath-site') },
    'fonts-base': { type: 'string', default: '/fonts/' },
    'source-url': { type: 'string', default: DEFAULT_SOURCE_URL },
    'extra-script': { type: 'string', multiple: true, default: [] },
    // the accessible layer after the block (vanilla's --a11y)
    a11y: { type: 'boolean', default: false },
  },
});
const out = resolve(o.out!);
const src = join(HERE, 'testmath.tex');
if (!existsSync(src)) { console.error(`error: ${src} missing (it ships with the repo – see NOTICE.md)`); process.exit(1); }

const pipe = new Pipeline({ buildRoot: join(REPO, 'build/testmath-build'), fontsDir: join(out, 'fonts'), searchDirs: [HERE] });
console.log(`reflowtex: compiling testmath.tex (${PASSES} passes so cross-references resolve) …`);
const bytes = await pipe.compile(readFileSync(src, 'utf8'),
  { kind: 'document', preamble: readFileSync(join(HERE, 'preamble.tex'), 'utf8'), key: 'testmath', passes: PASSES, name: 'testmath.tex', jobname: 'testmath', documentMetadata: { keys: 'tagging=on' } });
await pipe.finishFonts();
console.log(`  OK (${bytes.length} bytes)`);

installViewer(out);
for (const extra of o['extra-script']!) copyFileSync(extra, join(out, basename(extra)));
writeFileSync(join(out, 'index.html'), renderPage({
  title: 'AMS testmath.tex — Reflow TeX', blocks: [blockHtml(bytes, {}, { a11y: o.a11y })], fontMap: pipe.fontMap(),
  sourceUrl: o['source-url']!, fontsBase: o['fonts-base']!, extraScripts: o['extra-script']!.map(e => basename(e)),
}));
console.log(`reflowtex: wrote ${join(out, 'index.html')}`);
