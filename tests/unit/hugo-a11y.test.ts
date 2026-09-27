// SPDX-License-Identifier: AGPL-3.0-or-later
// The Hugo integration's accessible layer: prebuild stores each block's layer
// in its data (and gives it to a block compiled before it did, without
// compiling again); the shortcode puts it after the block, and hides the
// drawing from screen readers, when the site's params.reflowtexA11y (or the
// block's a11y="…") asks. Needs TeX and hugo; skipped without hugo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const luamml09 = (() => { try { execFileSync('kpsewhich', ['luamml-mathflatten.lua']); return true; } catch { return false; } })();
const hasHugo = (() => { try { execFileSync('hugo', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('Hugo blocks carry the accessible layer when the site asks', { skip: !hasHugo && 'no hugo' }, () => {
  const site = mkdtempSync(join(tmpdir(), 'rtx-hugo-a11y-'));
  try {
    mkdirSync(join(site, 'content'), { recursive: true });
    mkdirSync(join(site, 'layouts/_default'), { recursive: true });
    cpSync(join(REPO, 'integrations/hugo/layouts/shortcodes'), join(site, 'layouts/shortcodes'), { recursive: true });
    writeFileSync(join(site, 'layouts/_default/single.html'), '{{ .Content }}');
    // the first block's author enables luamml (its preamble), the second's not
    mkdirSync(join(site, 'latex-preambles'), { recursive: true });
    writeFileSync(join(site, 'latex-preambles/luamml.tex'), '\\DocumentMetadata{tagging=on}\n\\tagpdfsetup{math/mathml/luamml/load=true}\n');
    writeFileSync(join(site, 'content/a.md'), '---\ntitle: A\n---\n{{< latex preamble="luamml" >}}Let $x^2$ be big.{{< /latex >}}\n\n'
      + '{{< latex >}}And $y$ without.{{< /latex >}}\n\n{{< latex a11y="false" >}}Not this one.{{< /latex >}}\n');
    const prebuild = () => execFileSync('node', [join(REPO, 'integrations/hugo/prebuild.ts'), site], { stdio: 'pipe' });
    const hugo = (a11y: boolean) => {
      writeFileSync(join(site, 'hugo.toml'), `baseURL = "/"\ndisableKinds = ["taxonomy", "term", "RSS", "sitemap"]\n`
        + `[markup.goldmark.renderer]\n  unsafe = true\n[params]\n  reflowtexA11y = ${a11y}\n`);
      execFileSync('hugo', ['--quiet', '-s', site, '-d', join(site, 'public')], { stdio: 'pipe' });
      return readFileSync(join(site, 'public/a/index.html'), 'utf8');
    };
    prebuild();
    const dataDir = join(site, 'data/latex_blocks');
    const files = readdirSync(dataDir).map(f => join(dataDir, f));
    assert.equal(files.length, 3);
    for (const f of files) assert.match(JSON.parse(readFileSync(f, 'utf8')).a11y_html, /^<div class="latex-a11y"/);

    let page = hugo(true);
    assert.equal((page.match(/class="latex-a11y"/g) ?? []).length, 2, 'a layer for each block, none for a11y="false"');
    assert.match(page, /aria-hidden="true"\s+data-nodelist-b64="[^"]+"><\/div><div class="latex-a11y"/);
    // MathML where the author enabled luamml (it needs luamml 0.9, TeX Live
    // 2026); the other block's formula is its text
    if (luamml09) assert.match(page, /<math[^>]*alttext="x squared"/);
    assert.match(page, /<p data-para="1">And y without\.<\/p>/);
    page = hugo(false);
    assert.doesNotMatch(page, /latex-a11y|aria-hidden/, 'off unless asked');

    // A block's data from before the layer, or from an older layer builder:
    // its layer is made again, and nothing compiled.
    const layers = files.map(f => JSON.parse(readFileSync(f, 'utf8')).a11y_html);
    files.forEach((f, k) => { const d = JSON.parse(readFileSync(f, 'utf8'));
      if (k) d.a11y_html = '<div class="latex-a11y">old</div>'; else delete d.a11y_html; writeFileSync(f, JSON.stringify(d)); });
    const out = String(prebuild());
    assert.doesNotMatch(out, /compiling/);
    assert.deepEqual(files.map(f => JSON.parse(readFileSync(f, 'utf8')).a11y_html), layers);
  } finally { rmSync(site, { recursive: true, force: true }); }
});
