// SPDX-License-Identifier: AGPL-3.0-or-later
// The static server's mounts (tools/lib/static-server.ts): the render report
// serves its own folder, the tests' build/ and the inspector from one origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { serveMounts } from '../../tools/lib/static-server.ts';

/** status and body; a raw path, so that ../ reaches the server as sent */
const get = (url: string, path: string) => new Promise<[number, string]>((ok, fail) => {
  const u = new URL(url);
  request({ host: u.hostname, port: u.port, path }, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => ok([res.statusCode!, body]));
  }).on('error', fail).end();
});

test('each prefix serves its own folder, the longest first, and nothing outside it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-mounts-'));
  for (const d of ['app', 'build/case', 'secret']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'app/index.html'), 'app');
  writeFileSync(join(dir, 'build/case/result.json'), '{}');
  writeFileSync(join(dir, 'build/index.html'), 'build');
  writeFileSync(join(dir, 'secret/key'), 'secret');
  const { url, server } = await serveMounts({ '/': join(dir, 'app'), '/build/': join(dir, 'build') });
  try {
    assert.deepEqual(await get(url, '/'), [200, 'app']);
    assert.deepEqual(await get(url, '/build/case/result.json'), [200, '{}']);
    assert.deepEqual(await get(url, '/build'), [200, 'build'], 'the prefix without its slash');
    assert.equal((await get(url, '/build/missing'))[0], 404);
    assert.notEqual((await get(url, '/build/../secret/key'))[1], 'secret');
    assert.notEqual((await get(url, '/build/%2e%2e/secret/key'))[1], 'secret');
    assert.notEqual((await get(url, '/%2e%2e/secret/key'))[1], 'secret');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
