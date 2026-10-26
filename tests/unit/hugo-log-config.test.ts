// SPDX-License-Identifier: AGPL-3.0-or-later
// The Hugo partial's configuration of the viewer's log: the site's
// params.reflowtexLogAlert and params.reflowtexLogShow, written into a
// #latex-log-config island – only what is set, and no island when nothing
// is. Needs hugo (no TeX: the partial is rendered on its own); skipped
// without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const hasHugo = (() => { try { execFileSync('hugo', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('the Hugo partial writes the viewer\'s log configuration from the site\'s params, only when set', { skip: !hasHugo && 'no hugo' }, () => {
  const site = mkdtempSync(join(tmpdir(), 'rtx-hugo-log-'));
  try {
    mkdirSync(join(site, 'content'), { recursive: true });
    mkdirSync(join(site, 'layouts/_default'), { recursive: true });
    mkdirSync(join(site, 'static'), { recursive: true });
    cpSync(join(REPO, 'integrations/hugo/layouts/partials'), join(site, 'layouts/partials'), { recursive: true });
    writeFileSync(join(site, 'layouts/_default/single.html'), '{{ partial "reflowtex-viewer.html" . }}');
    for (const f of ['protobuf.min.js', 'latex-viewer.js']) writeFileSync(join(site, 'static', f), '');
    writeFileSync(join(site, 'content/a.md'), '---\ntitle: A\n---\n');
    const build = (params: string) => {
      writeFileSync(join(site, 'hugo.toml'), `baseURL = "/"\ndisableKinds = ["taxonomy", "term", "RSS", "sitemap", "home", "section", "404"]\n[params]\n${params}\n`);
      execFileSync('hugo', ['-s', site, '-d', join(site, 'public')], { stdio: 'pipe' });   // (--quiet would hide errorf's message)
      const page = readFileSync(join(site, 'public/a/index.html'), 'utf8');
      const m = /<script id="latex-log-config" type="application\/json">(.*?)<\/script>/.exec(page);
      return m ? JSON.parse(m[1]) : null;
    };
    assert.equal(build(''), null, 'nothing set: no island, the viewer\'s defaults');
    assert.deepEqual(build('reflowtexLogAlert = "warning"\nreflowtexLogShow = ["error", "missing-char"]'),
      { alert: 'warning', show: ['error', 'missing-char'] });
    assert.deepEqual(build('reflowtexLogShow = []'), { show: [] }, 'an empty list shows nothing: it is kept');
    assert.deepEqual(build('reflowtexLogShow = "warning, font-load-failed"'), { show: 'warning, font-load-failed' }, 'a string as written: the viewer splits it');
    assert.deepEqual(build('reflowtexLogAlert = "none"'), { alert: 'none' });
    assert.throws(() => build('reflowtexLogAlert = "loud"'), (e: Error & { stdout?: Buffer; stderr?: Buffer }) =>
      /params\.reflowtexLogAlert is one of none, error, warning, info or debug, not "loud"/.test(`${e.stdout}${e.stderr}`));
  } finally { rmSync(site, { recursive: true, force: true }); }
});
