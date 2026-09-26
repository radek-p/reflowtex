#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex – the Hugo integration's prebuild.
//
// A thin shell over reflowtex/src: it scans a Hugo site for {{< latex >}}
// shortcodes, compiles each with the pipeline, and writes the results where
// Hugo embeds them at build time. Run it before `hugo` / `hugo server`:
//
//     node integrations/hugo/prebuild.ts [SITE_DIR] [--force] [--prune] [-j N]
//
// The site looks like a normal Hugo site:
//
//     <site>/content/**/*.md            scanned for {{< latex >}}…{{< /latex >}}
//     <site>/latex-preambles/<n>.tex    named preambles (preamble="<n>")
//     <site>/latex-color-maps/<n>.json  named colour maps (color-map="<n>")
//     <site>/latex-fonts/*.otf          repo-shipped fonts (not in TeX)
//
// and this writes:
//
//     <site>/data/latex_blocks/<key>.json   {nodelist_b64, content_hash, toolchain}
//     <site>/data/latex_schema.json         {schema_b64}
//     <site>/data/latex_files.json          {"name.tex": key} for file refs and as="…"
//     <site>/data/latex_color_maps.json     {name: <colour map>, …}
//     <site>/data/latex_sources.json        {"name.tex": source} for show-source="true"
//     <site>/data/latex_font_map.json       {original font file: served file}
//     <site>/data/latex_link_map.json       {label: page that defines it}
//     <site>/static/fonts/*.otf             provisioned, patched, subset fonts
//     <site>/.reflowtex-build/<key>/        per-block build artefacts (git-ignore)
//
// Copy layouts/shortcodes/latex.html and layouts/partials/reflowtex-viewer.html
// from this directory into the site's layouts/ (see README.md). An inline block
// can carry as="name" to register under that name in latex_files.json, for
// content with no .tex file of its own that a template still looks up by name.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, relative, resolve, sep } from 'node:path';
import { Pipeline, contentKey, toolchainHash } from '../../src/pipeline/pipeline.ts';
import { readSerializerOutput } from '../../src/pipeline/nodes.ts';
import { installViewer, passesFor, REF_PASSES, schemaBase64, pyJsonDumps, jsonSorted } from '../../src/pipeline/site.ts';

// Two ways to write a block:
//   inline     {{< latex [attrs] >}} …LaTeX… {{< /latex >}}
//   file ref   {{< latex file="name.tex" [attrs] />}}   (self-closing)
// A file ref shares one .tex source with other integrations; it resolves
// against --demos-dir, and the name → key map lets the shortcode find it.
const BLOCK_RE = /\{\{<\s*latex((?![^>]*\bfile=)[^>]*?)>\}\}([\s\S]*?)\{\{<\s*\/latex\s*>\}\}/g;
const FILEREF_RE = /\{\{<\s*latex\s+([^>]*?)\/>\}\}/g;
const attr = (name: string, attrs: string, re = new RegExp(`${name}="([^"]+)"`)) => re.exec(attrs ?? '')?.[1];
const WEIGHT_RE = /weight="(-?[0-9]*\.?[0-9]+)"/;
const HASH_RE = /^[0-9a-f]{16}$/;

/** The key of a block in batch `batch`; must match the shortcode's. The batch
 *  is part of the key: the same text in another batch (or alone) is another
 *  block. */
const batchKey = (content: string, preamble: string, batch: string) => contentKey(content, `${preamble}\n===REFLOWTEX-BATCH===\n${batch}`);

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'demos-dir': { type: 'string', multiple: true },
    force: { type: 'boolean', default: false },
    prune: { type: 'boolean', default: false },
    jobs: { type: 'string', short: 'j', default: '4' },
    'no-font-subset': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (o.help) {
  console.log(`usage: node integrations/hugo/prebuild.ts [SITE_DIR] [--demos-dir DIR]… [--force] [--prune] [-j N] [--no-font-subset]`);
  process.exit(0);
}
const fail = (msg: string): never => { console.error(`ERROR: ${msg}`); process.exit(1); };

const site = resolve(positionals[0] ?? '.');
const contentDir = join(site, 'content'), preambleDir = join(site, 'latex-preambles'), colorMapDir = join(site, 'latex-color-maps');
const dataDir = join(site, 'data', 'latex_blocks'), buildRoot = join(site, '.reflowtex-build');
const localFonts = join(site, 'latex-fonts');
let demosDirs = (o['demos-dir'] ?? []).map(d => resolve(d));
if (!demosDirs.length && existsSync(join(site, 'latex-src'))) demosDirs = [join(site, 'latex-src')];
if (!existsSync(contentDir)) fail(`${contentDir} not found – is ${site} a Hugo site?`);
mkdirSync(dataDir, { recursive: true });

// A file ref's figures (\includegraphics) are found beside it.
const pipe = new Pipeline({ buildRoot, fontsDir: join(site, 'static', 'fonts'),
  localFontsDir: existsSync(localFonts) ? localFonts : null, searchDirs: demosDirs });
writeFileSync(join(site, 'data', 'latex_schema.json'), JSON.stringify({ schema_b64: schemaBase64() }, null, 2));
// the viewer's assets, so the partial loads them from the site root
installViewer(join(site, 'static'));

// ── Scanning ────────────────────────────────────────────────────────────────
// Preambles given by path (preamble="….tex"): by that path, their text.
const pathPreambles: Record<string, string> = {};
function resolvePreamble(name: string): string {
  // preamble="name" is <site>/latex-preambles/name.tex; preamble="….tex" is
  // that file, relative to the site root (beside a book's sources, say)
  if (name.endsWith('.tex')) {
    const f = join(site, name);
    if (!existsSync(f)) fail(`preamble "${name}" not found at ${resolve(f)}`);
    return (pathPreambles[name] = readFileSync(f, 'utf8'));
  }
  const f = join(preambleDir, `${name}.tex`);
  if (!existsSync(f)) fail(`preamble "${name}" not found at ${f}`);
  return readFileSync(f, 'utf8');
}
/** How an inline block is named in messages: page and line, its as="…" name,
 *  and its first words – a line number alone is a poor handle once the page
 *  has been edited. */
function blockName(page: string, line: number, inner: string, as?: string): string {
  let excerpt = inner.split(/\s+/).filter(Boolean).join(' ');
  if (excerpt.length > 48) excerpt = `${excerpt.slice(0, 47).trimEnd()}…`;
  return `${page}:${line}${as ? ` as="${as}"` : ''} "${excerpt}"`;
}
const mdFiles = (d: string): string[] => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? mdFiles(p) : f.endsWith('.md') ? [p] : [];
});
const pagePath = (p: string) => relative(contentDir, p).split(sep).join('/');

type Part = { weight: number; at: [string, number]; key: string; content: string; preamble: string; name: string };
const blocks = new Map<string, { content: string; preamble: string; name: string }>();
const filesMap: Record<string, string> = {};
const blockPages = new Map<string, string>();
const colorMapNames = new Set<string>();
const batches = new Map<string, Part[]>();
const refFiles = new Set<string>();
const addPart = (attrs: string, page: string, pos: number, key: string, content: string, preamble: string, name: string) => {
  const b = attr('batch', attrs);
  if (!b) return false;
  const w = WEIGHT_RE.exec(attrs ?? '');
  if (!batches.has(b)) batches.set(b, []);
  batches.get(b)!.push({ weight: w ? Number(w[1]) : 0, at: [page, pos], key, content, preamble, name });
  return true;
};
const demosPreamble = (d: string) => (existsSync(join(d, 'preamble.tex')) ? readFileSync(join(d, 'preamble.tex'), 'utf8') : '');

// Paths in byte order, as Python's sorted(rglob) gives them.
for (const path of mdFiles(contentDir).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
  const text = readFileSync(path, 'utf8');
  const page = pagePath(path);
  for (const m of text.matchAll(BLOCK_RE)) {
    const attrs = m[1], inner = m[2].trim();
    const pm = attr('preamble', attrs);
    const preamble = pm ? resolvePreamble(pm) : '';
    const b = attr('batch', attrs);
    const key = b ? batchKey(inner, preamble, b) : contentKey(inner, preamble);
    const line = text.slice(0, m.index).split('\n').length;
    const as = attr('as', attrs);
    const name = blockName(page, line, m[2], as);
    if (!addPart(attrs, page, m.index!, key, inner, preamble, name) && !blocks.has(key)) blocks.set(key, { content: inner, preamble, name });
    if (!blockPages.has(key)) blockPages.set(key, page);
    const cm = attr('color-map', attrs);
    if (cm) colorMapNames.add(cm);
    if (as) filesMap[as] = key;
  }
  for (const m of text.matchAll(FILEREF_RE)) {
    const attrs = m[1];
    const name = attr('file', attrs);
    if (!name) continue;
    if (!demosDirs.length) fail(`${basename(path)} references file="${name}" but --demos-dir is not set`);
    const dir = demosDirs.find(d => existsSync(join(d, name)) && statSync(join(d, name)).isFile());
    if (!dir) fail(`file="${name}" not found in ${demosDirs.join(', ')}`);
    const content = readFileSync(join(dir!, name), 'utf8').trim();
    const pm = attr('preamble', attrs);
    const preamble = pm ? resolvePreamble(pm) : demosPreamble(dir!);
    refFiles.add(name);
    const b = attr('batch', attrs);
    let key: string;
    if (b) {
      // a file in a batch is looked up as "batch/name" (the shortcode)
      key = batchKey(content, preamble, b);
      addPart(attrs, page, m.index!, key, content, preamble, name);
      filesMap[`${b}/${name}`] = key;
    } else {
      key = contentKey(content, preamble);
      if (!blocks.has(key)) blocks.set(key, { content, preamble, name });
      filesMap[name] = key;
    }
    if (!blockPages.has(key)) blockPages.set(key, page);
    const cm = attr('color-map', attrs);
    if (cm) colorMapNames.add(cm);
  }
}

writeFileSync(join(site, 'data', 'latex_files.json'), jsonSorted(filesMap));
// The source of every file ref (show-source="true": the shortcode cannot read
// --demos-dir), and of every preamble given by path (an inline block's
// shortcode hashes it from here; Hugo reads no file outside the site).
const sources: Record<string, string> = {};
for (const name of [...refFiles].sort()) {
  const dir = demosDirs.find(d => existsSync(join(d, name)) && statSync(join(d, name)).isFile());
  if (dir) sources[name] = readFileSync(join(dir, name), 'utf8');
}
Object.assign(sources, pathPreambles);
writeFileSync(join(site, 'data', 'latex_sources.json'), jsonSorted(sources));
// Every colour map in latex-color-maps/ is embedded, not only those named: a
// site can make one the default (params.latexColorMap, which only the
// shortcode sees). A named map that does not exist is still an error.
if (existsSync(colorMapDir)) for (const f of readdirSync(colorMapDir)) if (f.endsWith('.json')) colorMapNames.add(f.slice(0, -5));
const colorMaps: Record<string, unknown> = {};
for (const name of [...colorMapNames].sort()) {
  const f = join(colorMapDir, `${name}.json`);
  if (!existsSync(f)) fail(`color-map "${name}" not found at ${f}`);
  try { colorMaps[name] = JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { fail(`color-map "${name}" (${f}) is not valid JSON: ${(e as Error).message}`); }
}
writeFileSync(join(site, 'data', 'latex_color_maps.json'), jsonSorted(colorMaps));
if (!blocks.size && !batches.size) { console.log('No {{< latex >}} blocks found.'); process.exit(0); }

// ── Compiling ───────────────────────────────────────────────────────────────
// Each block's data records the hash of its content and of the toolchain
// that compiled it (the packages, serializer, template, encoder): a block is
// up to date only when both match, so a new package version recompiles it.
const toolchain = toolchainHash();
const writeBlock = (key: string, bytes: Uint8Array, hash: string) =>
  writeFileSync(join(dataDir, `${key}.json`), JSON.stringify({ nodelist_b64: Buffer.from(bytes).toString('base64'), content_hash: hash, toolchain }, null, 2));
const storedHash = (key: string): string | undefined => {
  const f = join(dataDir, `${key}.json`);
  try {
    const d = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    return d && d.toolchain === toolchain ? d.content_hash : undefined;
  } catch { return undefined; }
};
// An up-to-date block needs no compilation, but its fonts are served all the
// same: it is declared current to the pipeline, which reads its build output
// (when there is one – a site may carry its data without its build root).
const current = (key: string) => { if (existsSync(join(buildRoot, key, 'output.json'))) pipe.useCached(key); };

const stale: { key: string; content: string; preamble: string; name: string; passes: number }[] = [];
for (const [key, b] of blocks) {
  if (!o.force && storedHash(key) === key) { current(key); console.log(`  ${b.name} (${key}): up to date`); continue; }
  stale.push({ key, ...b, passes: passesFor(b.content) });
}
let failed = 0;
if (stale.length) {
  console.log(`reflowtex: compiling ${stale.length} block(s)…`);
  const { results, failures } = await pipe.compileMany(stale, Number(o.jobs));
  for (const [key, bytes] of results) {
    writeBlock(key, bytes, key);
    console.log(`  ${blocks.get(key)!.name} (${key}): done (${bytes.length} bytes)`);
  }
  for (const [key, e] of failures) { console.error(`ERROR: ${blocks.get(key)!.name} (${key}):\n${e.message}`); failed++; }
}

// Batches: every block with the same batch="…", in weight order (then page
// and position), compiled as one document and cut back into one bundle per
// block. Each part's data records the hash of the whole batch, so changing,
// adding or reordering any part recompiles the batch.
const liveBatches = new Set<string>();
for (const [bname, all] of [...batches].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
  all.sort((a, b) => a.weight - b.weight || (a.at[0] < b.at[0] ? -1 : a.at[0] > b.at[0] ? 1 : a.at[1] - b.at[1]));
  // A part shown in several places is one part: compiled once, where its
  // lowest weight puts it; its labels belong to that first page.
  const seen = new Set<string>();
  const parts = all.filter(p => !seen.has(p.key) && (seen.add(p.key), true));
  for (const p of parts) blockPages.set(p.key, p.at[0]);
  const preambles = new Set(parts.map(p => p.preamble));
  if (preambles.size > 1) fail(`the blocks of batch "${bname}" use different preambles; give them all the same preamble="…"`);
  const preamble = [...preambles][0];
  const bhash = createHash('sha256').update(pyJsonDumps([bname, preamble, parts.map(p => [p.weight, p.key])])).digest('hex').slice(0, 16);
  liveBatches.add(bhash);
  if (!o.force && parts.every(p => storedHash(p.key) === bhash)) {
    for (const p of parts) current(p.key);
    console.log(`  batch "${bname}" (${parts.length} part(s)): up to date`);
    continue;
  }
  const passes = parts.some(p => passesFor(p.content) > 1) ? REF_PASSES : 1;
  console.log(`reflowtex: compiling batch "${bname}" (${parts.length} part(s), ${passes} pass(es))…`);
  try {
    const blobs = await pipe.compileBatch(parts.map(p => ({ key: p.key, content: p.content, name: p.name })), preamble,
      { key: bhash, passes, name: `batch "${bname}"` });
    for (const [key, bytes] of blobs) writeBlock(key, bytes, bhash);
    console.log(`  batch "${bname}": done (${[...blobs.values()].map(b => `${b.length} bytes`).join(', ')})`);
  } catch (e) { console.error(`ERROR: batch "${bname}":\n${(e as Error).message}`); failed++; }
}

console.log('font-patch:');
await pipe.finishFonts({ subset: !o['no-font-subset'] });
// original → served font file (a modified font is served renamed and
// hashed); the viewer partial embeds this so @font-face fetches the right file
writeFileSync(join(site, 'data', 'latex_font_map.json'), jsonSorted(pipe.fontMap()));

// label → the content page whose block defines it, from the compilation that
// produced the blocks (it cannot drift from what was typeset, as scanning the
// sources for \label could). Turning a page into a URL is the template's job.
const linkMap: Record<string, string> = {};
for (const [key, page] of [...blockPages].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const f = join(buildRoot, key, 'output.json');
  if (!existsSync(f)) continue;
  for (const label of (readSerializerOutput(readFileSync(f, 'utf8')).anchors as string[] | undefined) ?? []) linkMap[label] ??= page;
}
writeFileSync(join(site, 'data', 'latex_link_map.json'), jsonSorted(linkMap));
console.log(`link-map: ${Object.keys(linkMap).length} label(s) across ${new Set(Object.values(linkMap)).size} page(s)`);

if (o.prune) {
  console.log('prune:');
  const live = new Set([...blocks.keys(), ...[...batches.values()].flat().map(p => p.key), ...liveBatches]);
  let removed = 0;
  for (const f of readdirSync(dataDir).sort()) {
    const stem = f.replace(/\.json$/, '');
    if (f.endsWith('.json') && HASH_RE.test(stem) && !live.has(stem)) { rmSync(join(dataDir, f)); removed++; console.log(`  prune: data/latex_blocks/${f}`); }
  }
  if (existsSync(buildRoot)) for (const d of readdirSync(buildRoot).sort()) {
    if (HASH_RE.test(d) && !live.has(d) && statSync(join(buildRoot, d)).isDirectory()) { rmSync(join(buildRoot, d), { recursive: true }); removed++; console.log(`  prune: ${basename(buildRoot)}/${d}/`); }
  }
  console.log(`  prune: ${removed} stale entr${removed === 1 ? 'y' : 'ies'} removed`);
}
if (failed) { console.error(`${failed} block(s) or batch(es) failed; the others were written`); process.exit(1); }
