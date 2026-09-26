// SPDX-License-Identifier: AGPL-3.0-or-later
// A directory over HTTP, for previews and for the tests that open built pages
// in a browser (scripts/serve.ts, tests/render, tests/web). A folder answers
// with its index.html; nothing outside the directory is served.
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.otf': 'font/otf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.xml': 'application/xml',
};

/** Serve `dir` on 127.0.0.1 at `port` (0: a free one). */
export function serveDirectory(dir: string, port = 0, host = '127.0.0.1'): Promise<{ url: string; server: Server }> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let file = normalize(join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({ url: `http://${host}:${(server.address() as { port: number }).port}`, server }));
  });
}
