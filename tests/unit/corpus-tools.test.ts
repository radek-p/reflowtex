// SPDX-License-Identifier: AGPL-3.0-or-later
// The corpus's tools that need no TeX: unpacking an untrusted archive, a
// recorded patch, the notable packages, the manifest's checks, a paper's
// entry in corpus.json, and the render report's batches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { writeTar } from '../../tools/lib/tar.ts';
import { members, unpack } from '../../tools/corpus/archive.ts';
import { applyPatch, patchReason } from '../../tools/corpus/patch.ts';
import { loaded, notable, type Loaded } from '../../tools/corpus/packages.ts';
import { checkManifest, safeRelative, loadManifest, type Manifest, type Paper } from '../../tools/corpus/manifest.ts';
import { paperEntry, totals, pc, compareLink } from '../../tools/corpus/report.ts';
import { batchHref, batchRoot, chooseBatch, readBatches, DEFAULT_BATCHES } from '../../tests/render/report/batches.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'corpus-test-'));
const enc = (s: string) => new Uint8Array(Buffer.from(s));

/** A tar with one entry of a given type flag (writeTar writes plain files; the type byte is set after). */
function tarWith(name: string, type: string): Uint8Array {
  const t = writeTar([[name, enc('x')]]);
  t[156] = type.charCodeAt(0);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : t[i];
  t.set(enc(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  return t;
}

test('a gzipped tar unpacks into place; a single gzipped file is named as the main file', () => {
  const d = tmp();
  try {
    unpack(gzipSync(writeTar([['main.tex', enc('\\documentclass{article}')], ['fig/a.pdf', enc('%PDF')]])), join(d, 'a'), 'main.tex');
    assert.equal(readFileSync(join(d, 'a', 'main.tex'), 'utf8'), '\\documentclass{article}');
    assert.ok(existsSync(join(d, 'a', 'fig', 'a.pdf')));
    unpack(gzipSync(enc('hello')), join(d, 'b'), 'paper.tex');
    assert.equal(readFileSync(join(d, 'b', 'paper.tex'), 'utf8'), 'hello');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('unsafe archives are refused before anything is written', () => {
  for (const bad of ['../evil.tex', '/etc/passwd', 'a/../../b.tex'])
    assert.throws(() => members(writeTar([[bad, enc('x')]]), 'main.tex'), /unsafe member name/, bad);
  assert.throws(() => members(tarWith('link.tex', '2'), 'main.tex'), /not a plain file/);      // a symbolic link
  assert.throws(() => members(tarWith('hard.tex', '1'), 'main.tex'), /not a plain file/);      // a hard link
  assert.throws(() => members(enc('%PDF-1.5 …'), 'main.tex'), /a PDF/);
  const d = tmp();
  try {
    assert.throws(() => unpack(writeTar([['a', enc('1')], ['a/b.tex', enc('2')]]), join(d, 'x'), 'main.tex'), /both a file and a folder/);
    assert.equal(existsSync(join(d, 'x')), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a patch applies exactly, or changes nothing', () => {
  const d = tmp();
  try {
    writeFileSync(join(d, 'macros.tex'), 'one\n\\usepackage{xy}\nthree\n');
    const patch = '# Removes an unused package.\n--- a/macros.tex\n+++ b/macros.tex\n@@ -2 +2 @@\n-\\usepackage{xy}\n+% \\usepackage{xy}\n';
    assert.equal(patchReason(patch), 'Removes an unused package.');
    assert.deepEqual(applyPatch(d, patch), [join(d, 'macros.tex')]);
    assert.equal(readFileSync(join(d, 'macros.tex'), 'utf8'), 'one\n% \\usepackage{xy}\nthree\n');
    assert.throws(() => applyPatch(d, patch), /does not apply/);                                  // applied already
    assert.throws(() => applyPatch(d, patch.replace(/macros\.tex/g, '../macros.tex')), /unsafe path/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('packages are read through \\input, without comments, verbatim or shipped styles; notable ones are rare', () => {
  const d = tmp();
  try {
    mkdirSync(join(d, 'sec'));
    writeFileSync(join(d, 'main.tex'), '\\documentclass[11pt]{amsart}\n\\usepackage{amsmath,tikz}\n% \\usepackage{commented}\n\\usepackage{own}\n\\input{sec/pre}\n' +
      '\\begin{verbatim}\\usepackage{shown}\\end{verbatim}\n');
    writeFileSync(join(d, 'sec', 'pre.tex'), '\\usepackage[all]{xy}\n\\RequirePackage{nicematrix}\n');
    writeFileSync(join(d, 'own.sty'), '\\usepackage{inside}');
    const l = loaded(d, 'main.tex');
    assert.equal(l.class, 'amsart');
    assert.deepEqual(l.packages, ['amsmath', 'tikz', 'xy', 'nicematrix']);
    const papers = new Map<string, Loaded>([['me', l]]);
    for (let i = 0; i < 5; i++) papers.set(`p${i}`, { class: 'article', packages: ['amsmath', 'tikz', 'hyperref'] });
    const n = notable(papers);
    // tikz is in all six papers, amsmath too (and universal): only the rare ones, rarest first
    assert.deepEqual(n.get('me'), ['amsart', 'xy', 'nicematrix']);
    assert.deepEqual(n.get('p0'), ['article']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the manifest in the repository passes its checks; a bad one does not', () => {
  const m = loadManifest();
  assert.ok(m.papers.length >= 1);
  for (const p of m.papers) assert.ok(p.supported || p.reason, p.id);
  assert.equal(safeRelative('src/main.tex'), true);
  assert.equal(safeRelative('../x'), false);
  const bad = structuredClone(m) as Manifest;
  bad.papers[0].source.sha256 = 'abc';
  assert.throws(() => checkManifest(bad), /sha256/);
  const twice = structuredClone(m) as Manifest;
  twice.papers.push(twice.papers[0]);
  assert.throws(() => checkManifest(twice), /twice/);
});

test('a paper\'s entry: displayed with its scores, or stopped with why; the totals', () => {
  const p = loadManifest().papers.find(x => x.supported)!, goal = { placement: 0.99, jumps: 0 };
  const scores = (share: number, jumps: number) => ({ scores: { placement: { share, tex_glyphs: 1000, tex_glyphs_in_unmatched_lines: 3 },
    vertical: { jumps, max_abs_pt: jumps ? 2.5 : 0 }, absolute: { share: 0.5 } } });
  const a = paperEntry(p, scores(0.99912, 0), goal, null);
  assert.equal(a.status, 'displayed');
  assert.equal(a.at_goal, true);
  assert.equal(a.page, `docs/showcase/papers/${p.id}/`);
  assert.equal(a.compare, compareLink(p.id));
  const b = paperEntry(p, scores(0.995, 2), goal, null);
  assert.equal(b.at_goal, false);
  const c = paperEntry(p, { failed_at: 'capture', error: 'TeX stopped\nmore' }, goal, null);
  assert.equal(c.status, 'stopped');
  assert.match(c.reason!, /^stopped at the capture stage: TeX stopped$/);
  const off: Paper = { ...p, supported: false, reason: 'Needs pdfTeX.' };
  assert.equal(paperEntry(off, scores(1, 0), goal, null).reason, 'Needs pdfTeX.');
  assert.deepEqual(totals([a, b, c]), { papers: 3, displayed: 2, at_goal: 1, mean_placement: 0.99706, jumps: 2 });
  // never 100.00 % unless all
  assert.equal(pc(0.99996), '99.99 %');
  assert.equal(pc(1), '100.00 %');
  assert.equal(pc(0.99905), '99.91 %');
});

test('the report\'s batches: listed in order, chosen by the URL, each with its own root', () => {
  assert.deepEqual(readBatches(null), DEFAULT_BATCHES);
  const list = readBatches({ batches: [{ id: 'corpus', label: 'Paper corpus', index: '../corpus/report.json', order: 2 },
    { id: 'tests', label: 'Tests', index: 'build/report.json', order: 1 }, { id: 'broken' }] });
  assert.deepEqual(list.map(b => b.id), ['tests', 'corpus']);
  assert.equal(chooseBatch(list, '?batch=corpus').id, 'corpus');
  assert.equal(chooseBatch(list, '').id, 'tests');
  assert.equal(chooseBatch(list, '?batch=nope').id, 'tests');
  assert.equal(batchRoot(list[1]), '../corpus/');
  assert.equal(batchHref(list[1], 'arxiv-2608.05234'), '?batch=corpus#arxiv-2608.05234');
});
