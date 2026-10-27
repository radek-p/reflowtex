// SPDX-License-Identifier: AGPL-3.0-or-later
// The integrations say what they give the pipeline (docs/documents.md),
// which requires it: Hugo's blocks are snippets (or kind="document"),
// vanilla's files documents (or, with --snippet, snippets set in
// preamble.tex). Needs TeX; skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const hasLualatex = (() => { try { execFileSync('lualatex', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skip = !hasLualatex && 'lualatex not installed';
process.env.REFLOWTEX_NO_AUTOINSTALL ??= '1';

/** stdout and stderr of a CLI run, which must succeed. */
const cli = (args: string[]): string => {
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return `${r.stdout}\n${r.stderr}`;
};
const DOCUMENT = '\\documentclass{article}\n\\begin{document}\nA document of its own.\n\\end{document}\n';

test('vanilla: a .tex file is a document; with --snippet, a snippet in preamble.tex', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-vanilla-kinds-'));
  try {
    mkdirSync(join(dir, 'docs')); mkdirSync(join(dir, 'snippets'));
    writeFileSync(join(dir, 'docs', 'paper.tex'), DOCUMENT);
    writeFileSync(join(dir, 'snippets', 'preamble.tex'), '\\documentclass{book}\n');
    writeFileSync(join(dir, 'snippets', 'a.tex'), 'A snippet in a book: \\chaptername.');
    const docs = cli(['integrations/vanilla/build.ts', join(dir, 'docs'), '-o', join(dir, 'site-docs')]);
    const snippets = cli(['integrations/vanilla/build.ts', join(dir, 'snippets'), '--snippet', '-o', join(dir, 'site-snippets')]);
    for (const out of [docs, snippets]) assert.match(out, /compiled|done/, out);
    assert.match(readFileSync(join(dir, 'site-docs', 'index.html'), 'utf8'), /data-nodelist-b64=/);
    assert.match(readFileSync(join(dir, 'site-snippets', 'index.html'), 'utf8'), /data-nodelist-b64=/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Hugo: blocks are snippets, kind="document" a document', { skip }, () => {
  const site = mkdtempSync(join(tmpdir(), 'rtx-hugo-kinds-'));
  try {
    mkdirSync(join(site, 'content'), { recursive: true });
    writeFileSync(join(site, 'content/a.md'), '---\ntitle: A\n---\n{{< latex >}}A snippet, $x^2$.{{< /latex >}}\n\n'
      + `{{< latex kind="document" >}}${DOCUMENT}{{< /latex >}}\n`);
    const out = cli(['integrations/hugo/prebuild.ts', site]);
    assert.equal(readdirSync(join(site, 'data/latex_blocks')).filter(f => f.endsWith('.json')).length, 2);
  } finally { rmSync(site, { recursive: true, force: true }); }
});
