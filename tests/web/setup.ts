// SPDX-License-Identifier: AGPL-3.0-or-later
// Before the tests: every fixture page and the Hugo site built (at once), and
// build/ served; the workers find it in REFLOWTEX_WEB_URL.
import { serveDirectory } from '../../tools/lib/static-server.ts';
import { BUILD, build, buildHugo, names } from './web.ts';

export default async function setup(): Promise<() => Promise<void>> {
  await Promise.all([...names().map(build), buildHugo()]);
  const { url, server } = await serveDirectory(BUILD);
  process.env.REFLOWTEX_WEB_URL = url;
  return () => new Promise(ok => server.close(() => ok()));
}
