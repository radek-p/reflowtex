// SPDX-License-Identifier: AGPL-3.0-or-later
// How many LuaTeX passes a run takes (lualatex.ts): another one only when
// what TeX reads back (.aux, .toc, .lof, .lot) changed in the last, or the
// run asked for one ("Rerun"), up to the most the caller allows. Nothing is
// read from the document's source. A lualatex of the test's own stands in
// for TeX: it writes what a pass of a document would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLuaLatex } from '../../src/pipeline/lualatex.ts';

/** Runs of a fake lualatex: `script` is its shell body, run in the build
 *  directory with $n the pass number (1, 2, …); returns how many passes ran
 *  and the job name it was called with. */
async function passes(script: string, max = 3): Promise<{ passes: number; jobname: string }> {
  const bin = mkdtempSync(join(tmpdir(), 'rtx-passes-bin-')), dir = mkdtempSync(join(tmpdir(), 'rtx-passes-'));
  writeFileSync(join(bin, 'lualatex'), `#!/bin/sh
for a in "$@"; do case "$a" in -jobname=*) job=\${a#-jobname=};; esac; done
n=$(( $(cat count 2>/dev/null || echo 0) + 1 )); echo $n > count; echo "$job" > job
echo 'This is a log.' > "$job.log"
${script}
echo '{"source_width": 1, "content": [], "paragraphs": [], "streams": [], "fonts": []}' > output.json
`);
  chmodSync(join(bin, 'lualatex'), 0o755);
  writeFileSync(join(dir, 'reflowtex-driver.tex'), '');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await runLuaLatex(dir, { texinputs: [], passes: max, main: 'reflowtex-driver.tex', jobname: 'paper', block: 'passes' });
    return { passes: Number(readFileSync(join(dir, 'count'), 'utf8')), jobname: readFileSync(join(dir, 'job'), 'utf8').trim() };
  } finally {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('nothing read back: one pass, though LaTeX writes an .aux every time', async () => {
  // \relax and the page count are in every .aux, whatever the document
  assert.deepEqual(await passes(`printf '\\\\relax \\n\\\\gdef \\\\@abspage@last{1}\\n' > paper.aux`), { passes: 1, jobname: 'paper' });
});

test('a label written in the first pass: a second, and no third once it settles', async () => {
  assert.equal((await passes(`printf '\\\\relax \\n\\\\newlabel{s}{{1}{1}}\\n' > paper.aux`)).passes, 2);
  // a table of contents too, written under the job's name
  assert.equal((await passes(`printf '\\\\contentsline {section}{\\\\numberline {1}One}{1}\\n' > paper.toc`)).passes, 2);
});

test('what a pass reads back keeps changing, or the run asks again: the most allowed, and no more', async () => {
  assert.equal((await passes(`printf '\\\\newlabel{s}{{%s}{1}}\\n' "$n" > paper.aux`)).passes, 3);
  assert.equal((await passes(`echo 'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.' >> paper.log`)).passes, 3);
  assert.equal((await passes(`printf '\\\\newlabel{s}{{%s}{1}}\\n' "$n" > paper.aux`, 2)).passes, 2);
});
