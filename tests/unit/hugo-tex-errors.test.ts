// SPDX-License-Identifier: AGPL-3.0-or-later
// The Hugo shortcode and the errors TeX carried on past in a block
// (tex_errors in its data, written by prebuild): the page is built with the
// block as TeX set it, unless the site sets params.reflowtexFailOnTexError,
// which stops hugo with the errors and the page. Needs hugo (no TeX: the
// block's data is written here); skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const hasHugo = (() => { try { execFileSync('hugo', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('the Hugo shortcode: a block with TeX errors is shown, unless params.reflowtexFailOnTexError stops the build', { skip: !hasHugo && 'no hugo' }, () => {
  const site = mkdtempSync(join(tmpdir(), 'rtx-hugo-tex-errors-'));
  try {
    mkdirSync(join(site, 'content'), { recursive: true });
    mkdirSync(join(site, 'layouts/_default'), { recursive: true });
    mkdirSync(join(site, 'data/latex_blocks'), { recursive: true });
    cpSync(join(REPO, 'integrations/hugo/layouts/shortcodes'), join(site, 'layouts/shortcodes'), { recursive: true });
    writeFileSync(join(site, 'layouts/_default/single.html'), '{{ .Content }}');
    writeFileSync(join(site, 'data/latex_files.json'), JSON.stringify({ 'a.tex': 'k1', 'b.tex': 'k2' }));
    writeFileSync(join(site, 'data/latex_blocks/k1.json'), JSON.stringify({ nodelist_b64: 'AAAA', content_hash: 'k1',
      tex_errors: ['TeX error: Undefined control sequence. (./reflowtex-document.tex:6: Before \\undefinedmacro)'] }));
    writeFileSync(join(site, 'data/latex_blocks/k2.json'), JSON.stringify({ nodelist_b64: 'BBBB', content_hash: 'k2' }));
    const build = (page: string, params: string) => {
      writeFileSync(join(site, 'content/a.md'), `---\ntitle: A\n---\n${page}\n`);
      writeFileSync(join(site, 'hugo.toml'), `baseURL = "/"\ndisableKinds = ["taxonomy", "term", "RSS", "sitemap", "home", "section", "404"]\n[params]\n${params}\n`);
      execFileSync('hugo', ['-s', site, '-d', join(site, 'public')], { stdio: 'pipe' });
      return readFileSync(join(site, 'public/a/index.html'), 'utf8');
    };
    assert.match(build('{{< latex file="a.tex" />}}', ''), /data-nodelist-b64="AAAA"/, 'not set: the block is shown');
    assert.match(build('{{< latex file="a.tex" />}}', 'reflowtexFailOnTexError = false'), /data-nodelist-b64="AAAA"/);
    assert.match(build('{{< latex file="b.tex" />}}', 'reflowtexFailOnTexError = true'), /data-nodelist-b64="BBBB"/, 'a block without errors');
    assert.throws(() => build('{{< latex file="a.tex" />}}', 'reflowtexFailOnTexError = true'), (e: Error & { stdout?: Buffer; stderr?: Buffer }) =>
      /a\.md:\d+:\d+"?: the LaTeX block has 1 TeX error\(s\), and params\.reflowtexFailOnTexError is on: TeX error: Undefined control sequence\. \(\.\/reflowtex-document\.tex:6: Before \\undefinedmacro\)/
        .test(`${e.stdout}${e.stderr}`));
  } finally { rmSync(site, { recursive: true, force: true }); }
});
