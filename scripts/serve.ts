#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// A static file server for a built site, for local previews:
//     node scripts/serve.ts <dir> [port]
import { resolve } from 'node:path';
import { serveDirectory } from '../tools/lib/static-server.ts';

const root = resolve(process.argv[2] ?? '.');
const { url } = await serveDirectory(root, Number(process.argv[3] ?? 8000), 'localhost');
console.log(`serving ${root} at ${url}  (Ctrl-C to stop)`);
