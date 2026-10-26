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
import { listBackends, formatBackends } from '../../src/pipeline/backend/registry.ts';
import { LOG_LEVELS, consoleLog, isAlertLevel, parseSelection } from '../../src/shared/log.ts';

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
    'log-alert': { type: 'string' },
    'log-show': { type: 'string' },
    backend: { type: 'string' },
    'list-backends': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (o['list-backends']) {
  console.log(o.json ? JSON.stringify(listBackends(), null, 2) : formatBackends());
  process.exit(0);
}
if (o.help || positionals.length !== 1) {
  console.log(`usage: node integrations/vanilla/build.ts <snippets-dir> [-o site/] [--title T] [--source-url URL]
       [--fonts-base fonts/] [--batch] [-j N] [--local-fonts DIR] [--a11y]
       [--log-alert LEVEL] [--log-show LIST] [--backend ID]
       node integrations/vanilla/build.ts --list-backends [--json]

  --batch       compile all snippets as ONE document (a book's chapters, in
                file name order), so numbering, macros and cross-references
                carry across them; each is still its own block
  --fonts-base  URL prefix @font-face fetches fonts from (default fonts/,
                relative to latex-viewer.js's URL; an absolute URL for a CDN)
  --source-url  the published source (the AGPL-3.0 §13 offer in the footer)
  --a11y        after each block, its text for screen readers, and the
                drawing hidden from them; formulas as MathML where the
                document enables luamml (\\DocumentMetadata{tagging=on}, and
                \\tagpdfsetup{math/mathml/luamml/load=true} for classic fonts)
  --log-alert   the viewer's alerted level: its messages at LEVEL or above go
                to the browser's console and as a reflowtex:log event (none,
                error, warning, info or debug; the viewer's default: error)
  --log-show    which of the viewer's messages readers are shown on the page:
                codes (font-load-failed, missing-char) or level names (that
                level and above), separated by commas or spaces; none shows
                nothing (the viewer's default: font-load-failed)
  --backend     the capture backend (default: REFLOWTEX_BACKEND, else luatex);
                --list-backends lists them and what each can do`);
  process.exit(o.help ? 0 : 2);
}

// The build's messages: the pipeline's and these, each a record with its
// code, printed as lines (stdout; errors on stderr).
const log = consoleLog();
const alert = o['log-alert'], show = o['log-show'];
if (alert !== undefined && !isAlertLevel(alert)) {
  log.error('usage-error', `error: --log-alert is one of none, ${[...LOG_LEVELS].reverse().join(', ')}, not "${alert}"`);
  process.exit(2);
}
// The viewer's log, configured only as far as the flags say: the rest is its default.
const logConfig = alert === undefined && show === undefined ? undefined
  : { alert, show: show === undefined ? undefined : parseSelection(show) };

const srcDir = resolve(positionals[0]);
if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) { log.error('build-error', `error: ${srcDir} is not a directory`); process.exit(1); }
const out = resolve(o.out!);
const buildRoot = join(out, '_build');
const localFonts = o['local-fonts'] ?? (existsSync(join(srcDir, 'fonts')) ? join(srcDir, 'fonts') : null);
const preamble = existsSync(join(srcDir, 'preamble.tex')) ? readFileSync(join(srcDir, 'preamble.tex'), 'utf8') : '';
const snippets = readdirSync(srcDir).filter(f => f.endsWith('.tex') && f !== 'preamble.tex').sort();
if (!snippets.length) { log.error('build-error', `error: no .tex snippets found in ${srcDir}`); process.exit(1); }

// A snippet's figures and \input files are found next to it.
let pipe: Pipeline;
try {
  pipe = new Pipeline({ buildRoot, fontsDir: join(out, 'fonts'), localFontsDir: localFonts, searchDirs: [srcDir], backend: o.backend, log });
} catch (e) { log.error('build-error', `error: ${(e as Error).message}`); process.exit(1); }
log.info('compile-start', `reflowtex: compiling ${snippets.length} snippet(s) from ${srcDir}`, { snippets: String(snippets.length), dir: srcDir });
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
  for (const [key, e] of failures) {
    const name = jobs.find(j => j.key === key)!.name;
    log.error('block-failed', `ERROR: ${name}: ${e.message}`, { name, key, error: e.message });
  }
  if (failures.size) process.exit(1);
  blobs = results;
}
await pipe.finishFonts();

installViewer(out, { inspector: true, log });
writeFileSync(join(out, 'index.html'), renderPage({
  title: o.title!, blocks: jobs.map(j => blockHtml(blobs.get(j.key)!, {}, { a11y: o.a11y })), fontMap: pipe.fontMap(),
  sourceUrl: o['source-url']!, fontsBase: o['fonts-base']!, inspector: true, log: logConfig,
}));
log.info('site-written', `reflowtex: wrote ${join(out, 'index.html')} (${snippets.length} block(s)); open it, or serve ${out} with any static server`,
  { file: join(out, 'index.html'), blocks: String(snippets.length) });
