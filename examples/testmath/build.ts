#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Public demo: AMS's testmath.tex (the amsmath "sample paper") as one page.
//
// testmath.tex is bundled verbatim (NOTICE.md – LPPL 1.3c, © American
// Mathematical Society and the LaTeX Project). This script does not modify it:
// it splits the file into its preamble and its body and compiles them with the
// classic Computer Modern fonts the document was written for – no fontspec, no
// unicode-math (see template.tex). Those 8-bit Type 1 fonts have no OpenType
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
  },
});
const out = resolve(o.out!);
const src = join(HERE, 'testmath.tex');
if (!existsSync(src)) { console.error(`error: ${src} missing (it ships with the repo – see NOTICE.md)`); process.exit(1); }

/** [preamble, body] of the file, both verbatim: the preamble from
 *  \documentclass up to \begin{document}, the body up to \end{document}. */
function splitVerbatim(tex: string): [string, string] {
  const c = /^[ \t]*\\documentclass/m.exec(tex), b = /^[ \t]*\\begin\{document\}[^\n]*\n/m.exec(tex), e = /^[ \t]*\\end\{document\}/m.exec(tex);
  if (!c || !b || !e) { console.error('error: could not find \\documentclass / \\begin{document} / \\end{document}'); process.exit(1); }
  return [tex.slice(c.index, b.index), tex.slice(b.index + b[0].length, e.index)];
}
const [preamble, body] = splitVerbatim(readFileSync(src, 'utf8'));

const pipe = new Pipeline({ buildRoot: join(REPO, 'build/testmath-build'), fontsDir: join(out, 'fonts'), template: join(HERE, 'template.tex') });
console.log(`reflowtex: compiling testmath.tex (${PASSES} passes so cross-references resolve) …`);
const bytes = await pipe.compile(body, preamble, { key: 'testmath', passes: PASSES, name: 'testmath.tex' });
await pipe.finishFonts();
console.log(`  OK (${bytes.length} bytes)`);

installViewer(out);
for (const extra of o['extra-script']!) copyFileSync(extra, join(out, basename(extra)));
writeFileSync(join(out, 'index.html'), renderPage({
  title: 'AMS testmath.tex — Reflow TeX', blocks: [blockHtml(bytes)], fontMap: pipe.fontMap(),
  sourceUrl: o['source-url']!, fontsBase: o['fonts-base']!, extraScripts: o['extra-script']!.map(e => basename(e)),
}));
console.log(`reflowtex: wrote ${join(out, 'index.html')}`);
