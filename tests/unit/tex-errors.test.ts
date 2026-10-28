// SPDX-License-Identifier: AGPL-3.0-or-later
// TeX errors (src/pipeline/tex-log.ts, lualatex.ts): a run stops the build
// only where lualatex gives the author nothing – TeX stopped, or wrote no
// output; an error TeX carried on past (nonstopmode) is returned, each
// distinct one once with its count, file and line, for the caller to log –
// unless the caller asks for the stricter rule (texErrors: 'error'). The
// logs here are lualatex's own, cut to what matters; a lualatex of the
// test's own stands in for TeX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fatalStop, texErrors } from '../../src/pipeline/tex-log.ts';
import { runLuaLatex, type LuaLatexOptions } from '../../src/pipeline/lualatex.ts';
import { TexError } from '../../src/pipeline/errors.ts';
import { texErrorWarning } from '../../src/pipeline/warnings.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'rtx-tex-errors-'));

/** A log of a document with errors TeX carried on past: an undefined control
 *  sequence, a package's two-line error, the same error twice at one place
 *  (\section writes its title twice), one in an \input file, and an
 *  overfull box whose text opens a parenthesis it does not close. */
const RECOVERED = `This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)  (format=lualatex 2026.10.1)
 restricted system commands enabled.
(./doc.tex
LaTeX2e <2026-06-01>
(/nowhere/texmf-dist/tex/latex/base/article.cls
Document Class: article 2025/01/22 v1.4n Standard LaTeX document class
(/nowhere/texmf-dist/tex/latex/base/size10.clo
File: size10.clo 2025/01/22 v1.4n Standard LaTeX file (size option)
)
\\c@part=\\count275
)
No file doc.aux.
! Undefined control sequence.
l.3 Hello \\undefinedmacro
                         {} world.
The control sequence at the end of the top line
of your error message was never \\def'ed. If you have
misspelled it (e.g., \`\\hobx'), type \`I' and the correct
spelling (e.g., \`I\\hbox'). Otherwise just continue,
and I'll forget about whatever was undefined.


! Package mypkg Error: Something is wrong
(mypkg)                on two lines.

See the mypkg package documentation for explanation.
Type  H <return>  for immediate help.
 ...

l.4 ...g is wrong\\MessageBreak on two lines}{help}

help

Overfull \\hbox (12.0pt too wide) in paragraph at lines 5--5
[]\\TU/lmr/m/n/10 A long line (that opens
 []

! Undefined control sequence.
<argument> \\alsoundefined

l.5 \\section{\\alsoundefined}

The control sequence at the end of the top line
of your error message was never \\def'ed.

! Undefined control sequence.
<argument> ...ction\\endcsname }\\fi \\alsoundefined
                                                  }{\\thepage }{}\\protected@f...
l.5 \\section{\\alsoundefined}

The control sequence at the end of the top line
of your error message was never \\def'ed.

(./sub.tex
! Undefined control sequence.
l.1 In sub \\subundefined
                        .
The control sequence at the end of the top line
of your error message was never \\def'ed.

) [1

{/nowhere/pdftex.map}]
(./doc.aux) )
Output written on doc.pdf (1 page, 12345 bytes).
`;

/** A document whose class is not there: TeX stops. */
const MISSING_CLASS = `This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)  (format=lualatex 2026.10.1)
(./doc.tex
LaTeX2e <2026-06-01>

! LaTeX Error: File \`nosuchclass.cls' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: cls)

Enter file name:
! Emergency stop.
<read *>

l.2 \\begin
          {document}
*** (cannot \\read from terminal in nonstop modes)
`;

/** The document's files, as the logs above read them. */
function documentDir(): string {
  const dir = tmp();
  writeFileSync(join(dir, 'doc.tex'), '\\documentclass{article}\n\\begin{document}\nHello \\undefinedmacro{} world.\n'
    + '\\PackageError{mypkg}{Something is wrong\\MessageBreak on two lines}{help}\n\\section{\\alsoundefined}\n\\input{sub}\n\\end{document}\n');
  writeFileSync(join(dir, 'sub.tex'), 'In sub \\subundefined.\n');
  return dir;
}

test('the errors TeX carried on past: each once, with its count, its file and line, and what TeX had read', () => {
  const dir = documentDir();
  try {
    assert.deepEqual(texErrors(RECOVERED, dir), [
      { message: 'Undefined control sequence.', file: './doc.tex', line: 3, context: 'Hello \\undefinedmacro', count: 1 },
      { message: 'Package mypkg Error: Something is wrong (mypkg) on two lines.', file: './doc.tex', line: 4,
        context: '...g is wrong\\MessageBreak on two lines}{help}', count: 1 },
      { message: 'Undefined control sequence.', file: './doc.tex', line: 5, context: '\\section{\\alsoundefined}', count: 2 },
      { message: 'Undefined control sequence.', file: './sub.tex', line: 1, context: 'In sub \\subundefined', count: 1 },
    ]);
    assert.equal(fatalStop(RECOVERED), null, 'TeX went on to the end');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file is named only when its line holds what TeX read; else the error has its line alone', () => {
  const dir = tmp();
  try {
    // doc.tex is not there to confirm the line: no file
    assert.deepEqual(texErrors('(./doc.tex\n! Undefined control sequence.\nl.3 Hello \\undefinedmacro\n\n)', dir),
      [{ message: 'Undefined control sequence.', line: 3, context: 'Hello \\undefinedmacro', count: 1 }]);
    writeFileSync(join(dir, 'doc.tex'), 'a\nb\nc\n');
    assert.deepEqual(texErrors('(./doc.tex\n! Undefined control sequence.\nl.3 Hello \\undefinedmacro\n\n)', dir),
      [{ message: 'Undefined control sequence.', line: 3, context: 'Hello \\undefinedmacro', count: 1 }], 'its line 3 is another');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file\'s name TeX broke at the end of a log line (79 characters) is read whole', () => {
  const dir = tmp();
  try {
    const sub = join(dir, 'a-directory-with-a-long-name', 'and-another-one-below-it', 'and-a-third');
    mkdirSync(sub, { recursive: true });
    const file = join(sub, 'doc.tex');
    writeFileSync(file, 'a\nb\nBefore \\undefinedmacro after.\n');
    const opened = `(${file}`;
    assert.ok(opened.length > 79);
    const log = `${opened.slice(0, 79)}\n${opened.slice(79)}\n! Undefined control sequence.\nl.3 Before \\undefinedmacro\n\n)`;
    assert.deepEqual(texErrors(log, dir), [{ message: 'Undefined control sequence.', file, line: 3, context: 'Before \\undefinedmacro', count: 1 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('TeX stopping: an emergency stop, a full memory, a hundred errors, no \\end, no output', () => {
  assert.equal(fatalStop(MISSING_CLASS), '! Emergency stop.');
  assert.equal(fatalStop('x\n! TeX capacity exceeded, sorry [main memory size=5000000].\n'), '! TeX capacity exceeded, sorry [main memory size=5000000].');
  assert.equal(fatalStop('(That makes 100 errors; please try again.)\n'), '(That makes 100 errors; please try again.)');
  assert.equal(fatalStop('*** (job aborted, no legal \\end found)\n'), '*** (job aborted, no legal \\end found)');
  assert.equal(fatalStop('!  ==> Fatal error occurred, no output PDF file produced!\n'), '!  ==> Fatal error occurred, no output PDF file produced!');
});

test('a TeX error as a warning: code tex-error, TeX\'s line, the place, the pass and the count', () => {
  assert.deepEqual(texErrorWarning({ message: 'Undefined control sequence.', file: './doc.tex', line: 5, context: '\\section{\\alsoundefined}', count: 2, pass: 1 }), {
    level: 'warning', code: 'tex-error',
    message: 'TeX error: Undefined control sequence. (./doc.tex:5: \\section{\\alsoundefined}), 2 times',
    details: { error: '! Undefined control sequence.', file: './doc.tex', line: '5', context: '\\section{\\alsoundefined}', pass: '1', count: '2' },
  });
  assert.equal(texErrorWarning({ message: 'Too wide.', line: 6 }).message, 'TeX error: Too wide. (line 6)');
});

// ── runLuaLatex ──────────────────────────────────────────────────────────────

/** runLuaLatex over a lualatex of the test's own, which leaves `log` as the
 *  run's log and, when `output`, an output.json; the run's directory holds
 *  the document's files. */
async function withLog(log: string, output: boolean, o: Partial<LuaLatexOptions> = {}) {
  const bin = tmp(), dir = documentDir();
  writeFileSync(join(dir, 'the.log'), log);
  writeFileSync(join(bin, 'lualatex'), `#!/bin/sh
cp the.log input.log
${output ? `echo '{"source_width": 1, "content": [], "paragraphs": [], "streams": [], "fonts": []}' > output.json` : ''}
exit 1
`);
  chmodSync(join(bin, 'lualatex'), 0o755);
  writeFileSync(join(dir, 'input.tex'), '');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const r = await runLuaLatex(dir, { texinputs: [], passes: 1, block: 'b', ...o }).catch((e: unknown) => e);
    return { r, outputLeft: existsSync(join(dir, 'output.json')) };
  } finally {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('errors TeX carried on past: the run returns its output and the errors (lualatex exits 1 all the same)', async () => {
  const { r } = await withLog(RECOVERED, true);
  assert.ok(!(r instanceof Error), String(r));
  const run = r as Awaited<ReturnType<typeof runLuaLatex>>;
  assert.match(run.output, /source_width/);
  assert.equal(run.passes, 1);
  assert.deepEqual(run.errors.map(e => [e.message, e.file, e.line, e.count]), [
    ['Undefined control sequence.', './doc.tex', 3, 1],
    ['Package mypkg Error: Something is wrong (mypkg) on two lines.', './doc.tex', 4, 1],
    ['Undefined control sequence.', './doc.tex', 5, 2],
    ['Undefined control sequence.', './sub.tex', 1, 1],
  ]);
});

test('texErrors: \'error\': the first error TeX carried on past fails the run, as TeX\'s error lines say', async () => {
  const { r, outputLeft } = await withLog(RECOVERED, true, { texErrors: 'error' });
  assert.ok(r instanceof TexError, String(r));
  assert.match(r.message, /^b: lualatex reported 5 error\(s\) \(nonstopmode continued, so the node list would be silently wrong\):\n  ! Undefined control sequence\.\n  ! Package mypkg Error: Something is wrong\n  see .*input\.log$/);
  assert.equal(r.texError, '! Undefined control sequence.');
  assert.equal(outputLeft, false, 'the run\'s output.json is removed');
});

test('TeX stopped: a TexError, even with an output file left, which is removed', async () => {
  for (const output of [false, true]) {
    const { r, outputLeft } = await withLog(MISSING_CLASS, output);
    assert.ok(r instanceof TexError, String(r));
    assert.match(r.message, /^b: lualatex failed \(exit code 1, ! Emergency stop\.\):\n/);
    assert.match(r.message, /File `nosuchclass\.cls' not found/);
    assert.equal(r.texError, '! LaTeX Error: File `nosuchclass.cls\' not found.');
    assert.equal(outputLeft, false);
  }
});
