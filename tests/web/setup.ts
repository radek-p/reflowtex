// SPDX-License-Identifier: AGPL-3.0-or-later
// Before the tests: the browser's scripts built if they are missing or stale
// (once, before the pages' builds, which run at once and would each build
// them), every fixture page and the Hugo site built (at once), and build/
// served; the workers find it in REFLOWTEX_WEB_URL.
import { ensureBundles } from '../../src/pipeline/bundles.ts';
import { serveDirectory } from '../../tools/lib/static-server.ts';
import { BUILD, build, buildHugo, names } from './web.ts';

export default async function setup(): Promise<() => Promise<void>> {
  ensureBundles();
  await Promise.all([...names().map(build), buildHugo()]);
  const { url, server } = await serveDirectory(BUILD);
  process.env.REFLOWTEX_WEB_URL = url;
  return () => new Promise(ok => server.close(() => ok()));
}
