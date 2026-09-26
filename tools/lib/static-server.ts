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
  return serveMounts({ '/': dir }, port, host);
}

/** Several directories, each under a URL prefix ('/', '/build/'); the longest
 *  prefix that matches serves. Nothing is cached: what is served is what is on
 *  disk now. */
export function serveMounts(mounts: Record<string, string>, port = 0, host = '127.0.0.1'): Promise<{ url: string; server: Server }> {
  const table = Object.entries(mounts).map(([p, d]) => [p.endsWith('/') ? p : `${p}/`, resolve(d)] as const)
    .sort((a, b) => b[0].length - a[0].length);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const mount = table.find(([p]) => path.startsWith(p) || `${path}/` === p);
    if (!mount) { res.writeHead(404).end('not found'); return; }
    const [prefix, root] = mount;
    let file = normalize(join(root, path.slice(prefix.length - 1)));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({ url: `http://${host}:${(server.address() as { port: number }).port}`, server }));
  });
}
