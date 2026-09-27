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
// site's deploy runs the tests first (.github/workflows/hugo.yml), so the
// page shows the version it is part of. With no results, it says so and the
// site goes without.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { allCases, BUILD } from '../render.ts';
import { writeIndex } from './results.ts';

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
}
