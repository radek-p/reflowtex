#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The render tests' report, for a developer's own machine: each test's
// pageless PDF beside the page the browser reflowed, what does not match
// boxed in red (see README.md).
//
//     make render-report              # after make test-render
//     node tests/render/report/serve.ts [port]
//
// It serves this folder, the tests' build/ as /build/, and the inspector
// (src/inspector/) as /inspector/, which the page loads into the reflowed
// page on demand. build/report.json is written again from every result.json
// there, so a single test run since shows too.
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { serveMounts } from '../../../tools/lib/static-server.ts';
import { allCases, BUILD } from '../render.ts';
import { writeIndex } from './results.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');

const results = writeIndex(BUILD, [...allCases().keys()]);
if (!results.length) console.log('No results yet: run make test-render first (or one case, see tests/render/README.md).');
const { url } = await serveMounts({
  '/': HERE,
  '/build/': BUILD,
  '/inspector/': join(REPO, 'src/inspector'),
}, Number(process.argv[2] ?? 8010), 'localhost');
console.log(`render report: ${url}/  (${results.length} tests; Ctrl+C to stop)`);
