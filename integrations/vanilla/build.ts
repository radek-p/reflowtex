#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex – the vanilla HTML+JS integration.
//
// The reference integration: it depends only on reflowtex/src. Point it at a
// directory of LaTeX snippets and it writes a self-contained static site – one
// HTML page, the viewer's scripts and the fonts – that renders the snippets in
// any browser:
//
//     node integrations/vanilla/build.ts <snippets-dir> -o site/
//
// Each *.tex file becomes one block on the page, in file name order. A file
// named preamble.tex is not a block: it is prepended to every snippet's
// preamble. Repo-local OTF fonts (faces not installed into TeX) go in a fonts/
// subdirectory of the snippets dir, or pass --local-fonts. The page works
// straight off disk, or served from anywhere: fonts resolve relative to
// latex-viewer.js's own URL.
import { parseArgs } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Pipeline, contentKey } from '../../src/pipeline/pipeline.ts';
import { DEFAULT_SOURCE_URL, blockHtml, installViewer, passesFor } from '../../src/pipeline/site.ts';
import { renderPage } from './page.ts';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o', default: 'site' },
    title: { type: 'string', default: 'reflowtex' },
    'source-url': { type: 'string', default: DEFAULT_SOURCE_URL },
    'fonts-base': { type: 'string', default: 'fonts/' },
    batch: { type: 'boolean', default: false },
    jobs: { type: 'string', short: 'j', default: '1' },
    'local-fonts': { type: 'string' },
    a11y: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (o.help || positionals.length !== 1) {
  console.log(`usage: node integrations/vanilla/build.ts <snippets-dir> [-o site/] [--title T] [--source-url URL]
       [--fonts-base fonts/] [--batch] [-j N] [--local-fonts DIR] [--a11y]

  --batch       compile all snippets as ONE document (a book's chapters, in
                file name order), so numbering, macros and cross-references
                carry across them; each is still its own block
  --fonts-base  URL prefix @font-face fetches fonts from (default fonts/,
                relative to latex-viewer.js's URL; an absolute URL for a CDN)
  --source-url  the published source (the AGPL-3.0 §13 offer in the footer)
  --a11y        after each block, its text and formulas (MathML) for screen
                readers, and the drawing hidden from them (links, footnote
                marks and hints are not in that layer yet)`);
  process.exit(o.help ? 0 : 2);
}

const srcDir = resolve(positionals[0]);
if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) { console.error(`error: ${srcDir} is not a directory`); process.exit(1); }
const out = resolve(o.out!);
const buildRoot = join(out, '_build');
const localFonts = o['local-fonts'] ?? (existsSync(join(srcDir, 'fonts')) ? join(srcDir, 'fonts') : null);
const preamble = existsSync(join(srcDir, 'preamble.tex')) ? readFileSync(join(srcDir, 'preamble.tex'), 'utf8') : '';
const snippets = readdirSync(srcDir).filter(f => f.endsWith('.tex') && f !== 'preamble.tex').sort();
if (!snippets.length) { console.error(`error: no .tex snippets found in ${srcDir}`); process.exit(1); }

// A snippet's figures and \input files are found next to it.
const pipe = new Pipeline({ buildRoot, fontsDir: join(out, 'fonts'), localFontsDir: localFonts, searchDirs: [srcDir] });
console.log(`reflowtex: compiling ${snippets.length} snippet(s) from ${srcDir}`);
const jobs = snippets.map(name => {
  const content = readFileSync(join(srcDir, name), 'utf8');
  return { key: contentKey(content, preamble), content, preamble, name, passes: passesFor(content) };
});
// A snippet's own bibliography (paper.bbl beside paper.tex) is read as
// \jobname.bbl, and every snippet compiles as input.tex in its build dir.
for (const j of jobs) {
  const bbl = join(srcDir, j.name.replace(/\.tex$/, '.bbl'));
  if (existsSync(bbl)) { mkdirSync(join(buildRoot, j.key), { recursive: true }); copyFileSync(bbl, join(buildRoot, j.key, 'input.bbl')); }
}

let blobs: Map<string, Uint8Array>;
if (o.batch) {
  blobs = await pipe.compileBatch(jobs.map(j => ({ key: j.key, content: j.content, name: j.name })), preamble,
    { passes: Math.max(...jobs.map(j => j.passes)), name: `batch ${basename(srcDir)}` });
} else {
  const { results, failures } = await pipe.compileMany(jobs, Number(o.jobs));
  for (const [key, e] of failures) console.error(`ERROR: ${jobs.find(j => j.key === key)!.name}: ${e.message}`);
  if (failures.size) process.exit(1);
  blobs = results;
}
await pipe.finishFonts();

installViewer(out, { inspector: true });
writeFileSync(join(out, 'index.html'), renderPage({
  title: o.title!, blocks: jobs.map(j => blockHtml(blobs.get(j.key)!, {}, { a11y: o.a11y })), fontMap: pipe.fontMap(),
  sourceUrl: o['source-url']!, fontsBase: o['fonts-base']!,
}));
console.log(`reflowtex: wrote ${join(out, 'index.html')} (${snippets.length} block(s)); open it, or serve ${out} with any static server`);
