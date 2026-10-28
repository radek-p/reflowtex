// SPDX-License-Identifier: AGPL-3.0-or-later
// The driver lualatex compiles (src/pipeline/driver.ts): the caller's
// metadata, the capture code, then the document as it is; a snippet set in
// the caller's preamble first. Nothing here reads the document's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREAMBLE, checkJobname, driverTex, metadataProbeTex, metadataTex, snippetDocument } from '../../src/pipeline/driver.ts';

test('the driver reads the capture code, then the document unchanged, by the primitive \\input', () => {
  assert.equal(driverTex({ document: 'reflowtex-document.tex', widthExtraSp: 5 }), [
    '% reflowtex driver: the capture code, then the document as it is.',
    '\\input{reflowtex-capture.tex}',
    '\\reflowtexWidthExtra=5sp\\relax',
    '\\AddToHook{begindocument/before}{\\input{reflowtex-capture-late.tex}}',
    '\\csname @@input\\endcsname{reflowtex-document.tex}', ''].join('\n'));
  // the caller's preamble before the capture's late part; a tool's lines last
  const t = driverTex({ document: '/src/main.tex', widthExtraSp: -65536, callerPreamble: 'reflowtex-caller-preamble.tex', extra: '\\relax\n' });
  assert.match(t, /\\reflowtexWidthExtra=-65536sp\\relax\n\\AddToHook\{begindocument\/before\}\{\\input\{reflowtex-caller-preamble.tex\}\}\n\\AddToHook\{begindocument\/before\}\{\\input\{reflowtex-capture-late.tex\}\}\n\\relax\n\\csname @@input\\endcsname\{\/src\/main.tex\}\n$/);
  // a name TeX would read differently is refused
  assert.throws(() => driverTex({ document: 'my paper.tex', widthExtraSp: 0 }), /cannot read/);
  assert.throws(() => driverTex({ document: 'a%b.tex', widthExtraSp: 0 }), /cannot read/);
  assert.equal(checkJobname('paper-2.v1'), 'paper-2.v1');
  assert.throws(() => checkJobname('sub/paper'), /cannot read/);
});

test('the caller\'s metadata: first in the driver; forced, the document\'s own only warns', () => {
  const keep = driverTex({ document: 'd.tex', widthExtraSp: 0, metadata: { keys: 'lang=de' } });
  assert.ok(keep.startsWith('% reflowtex driver: the capture code, then the document as it is.\n\\DocumentMetadata{lang=de}\n\\input{reflowtex-capture.tex}'), keep);
  assert.ok(!keep.includes('\\def\\DocumentMetadata'), 'nothing redefined unless forced');
  const forced = metadataTex({ keys: 'lang=de, pdfstandard={a-2b}', force: true });
  assert.match(forced, /^\\DocumentMetadata\{lang=de, pdfstandard=\{a-2b\}\}\n\\protected\\long\\def\\DocumentMetadata#1\{\\PackageWarningNoLine\{reflowtex\}/);
  assert.throws(() => metadataTex({ keys: 'lang={de' }), /unbalanced/);
  // the probe asks the kernel when the class begins, and stops there
  const probe = metadataProbeTex('d.tex');
  assert.match(probe, /\\AddToHook\{class\/before\}\{\\directlua\{.*\\IfDocumentMetadataTF\{1\}\{0\}.*os\.exit\(0\)\}\}/);
  assert.ok(probe.endsWith('\\csname @@input\\endcsname{d.tex}\n'));
});

test('a snippet is set in the caller\'s preamble as given, or in the default one without it', () => {
  assert.equal(snippetDocument('Body.', '\\documentclass{book}\n\\usepackage{x}\n'),
    '\\documentclass{book}\n\\usepackage{x}\n\\begin{document}\nBody.\n\\end{document}\n');
  assert.equal(snippetDocument('Body.', ''), `${DEFAULT_PREAMBLE}\n\\begin{document}\nBody.\n\\end{document}\n`);
  assert.match(DEFAULT_PREAMBLE, /^\\documentclass\{article\}\n\\usepackage\{mathtools\}\n\\usepackage\{amssymb\}\n\\usepackage\{tikz\}$/);
  // text holding a class line is still a snippet: set in the preamble, whatever TeX makes of it
  assert.equal(snippetDocument('\\documentclass{article}\nX', ''), `${DEFAULT_PREAMBLE}\n\\begin{document}\n\\documentclass{article}\nX\n\\end{document}\n`);
});
