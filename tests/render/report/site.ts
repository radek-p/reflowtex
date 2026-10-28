#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The render tests' results, for the website (Tools › Render tests).
//
//     node tests/render/report/site.ts <site>
//
// Copies what the report reads – build/report.json, and for each test its
// result.json, pageless.pdf, vector/{vector,strip,viewer}, and the page it
// tested – into <site>/static/render-tests/build/, beside the report page
// (website/build.sh puts it there). The results are of this checkout: the
// site's deploy takes CI's run of them (.github/workflows/hugo.yml), so the
// page shows the version it is part of. With no results, it says so and the
// site goes without.
//
// It also writes batches.json beside the page: the render tests, and every
// other batch of results published on the site – a folder of <site>/static
// whose report.json names its batch ({ "batch": { "id", "label", "order" },
// "results": [...] }, the paper corpus's: tools/corpus/report.ts). The report
// shows one batch at a time (?batch=<id>).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { allCases, BUILD } from '../render.ts';
import { writeIndex } from './results.ts';
import { DEFAULT_BATCHES, type Batch } from './batches.ts';

/** The batches for the report at <site>/static/<page>/: the render tests, and each folder of static/ with a batch's report.json. */
export function siteBatches(site: string, page = 'render-tests'): Batch[] {
  const statics = join(site, 'static'), out: Batch[] = [...DEFAULT_BATCHES];
  for (const d of existsSync(statics) ? readdirSync(statics).sort() : []) {
    const f = join(statics, d, 'report.json');
    if (d === page || !existsSync(f)) continue;
    const b = (JSON.parse(readFileSync(f, 'utf8')) as { batch?: { id?: unknown; label?: unknown; order?: unknown } }).batch;
    if (typeof b?.id !== 'string' || typeof b.label !== 'string' || out.some(x => x.id === b.id)) continue;
    out.push({ id: b.id, label: b.label, index: `../${d}/report.json`, ...(typeof b.order === 'number' ? { order: b.order } : {}) });
  }
  return out;
}

/** What the report reads, relative to build/: the index, each test's files,
 *  and each page it tested (with its fonts and scripts). */
export function reportFiles(build: string): string[] {
  const results = writeIndex(build, [...allCases().keys()]);
  const files = new Set(['report.json']);
  const pages = new Set<string>();
  for (const r of results) {
    for (const f of ['result.json', 'pageless.pdf', 'vector/vector.json', 'vector/strip.svg', 'vector/viewer.png'])
      if (existsSync(join(build, r.dir, f))) files.add(`${r.dir}/${f}`);
    if (r.page) pages.add(r.page);
  }
  for (const page of pages)
    for (const e of readdirSync(join(build, page), { withFileTypes: true, recursive: true }))
      if (e.isFile()) files.add(join(e.parentPath, e.name).slice(build.length + 1).split(sep).join('/'));
  return [...files].sort();
}

if (import.meta.main) {
  const site = resolve(process.argv[2] ?? 'website');
  const into = join(site, 'static', 'render-tests', 'build');
  rmSync(into, { recursive: true, force: true });
  const files = existsSync(BUILD) ? reportFiles(BUILD) : [];
  const tests = files.length ? JSON.parse(readFileSync(join(BUILD, 'report.json'), 'utf8')).results.length : 0;
  if (!tests) console.log('render-tests: no results (make test-render-all); the render tests page has none to show');
  else {
    for (const f of files) { mkdirSync(dirname(join(into, f)), { recursive: true }); writeFileSync(join(into, f), readFileSync(join(BUILD, f))); }
    console.log(`render-tests: ${tests} tests, ${files.length} files into ${into}`);
  }
  const batches = siteBatches(site);
  mkdirSync(join(site, 'static', 'render-tests'), { recursive: true });
  writeFileSync(join(site, 'static', 'render-tests', 'batches.json'), JSON.stringify({ batches }, null, 1));
  console.log(`render-tests: batches ${batches.map(b => b.id).join(', ')}`);
}
