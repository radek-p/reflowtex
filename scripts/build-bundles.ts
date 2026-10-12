#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Build the browser's scripts from their TypeScript (src/pipeline/bundles.ts):
// the viewer, the companion package and the inspector. Nothing generated is
// committed; integrations, the website's build and the tests build what is
// missing or stale themselves, so this is for building by hand.
//
//     node scripts/build-bundles.ts                 # what is missing or stale
//     node scripts/build-bundles.ts --force [viewer|companion|inspector …]
import { BUNDLE_NAMES, ensureBundles, type BundleName } from '../src/pipeline/bundles.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const names = args.filter(a => !a.startsWith('--'));
const bad = names.filter(n => !(BUNDLE_NAMES as string[]).includes(n));
if (bad.length) {
  console.error(`unknown bundle: ${bad.join(', ')} (there are ${BUNDLE_NAMES.join(', ')})`);
  process.exit(2);
}
const built = ensureBundles({ only: names.length ? names as BundleName[] : BUNDLE_NAMES, force });
if (!built.length) console.log('  bundles up to date');
