// SPDX-License-Identifier: AGPL-3.0-or-later
// How many LuaTeX passes a snippet gets (site.ts passesFor). PGF pictures that
// remember their place on the page – nicematrix's cells, `remember picture` –
// are drawn from the .aux of the run before: in one pass nicematrix's blocks
// piled up at one point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesFor, REF_PASSES } from '../../src/pipeline/site.ts';

test('a snippet without references or remembered positions: one pass', () => {
  assert.equal(passesFor('Some text and $x^2$.\n\\begin{tabular}{cc} a & b \\end{tabular}'), 1);
});

test('references: more passes', () => {
  assert.equal(passesFor('See \\ref{x}.'), REF_PASSES);
});

test('nicematrix environments and remember picture: more passes', () => {
  for (const s of [
    '\\begin{NiceTabular}{cc}[hvlines] a & b \\end{NiceTabular}',
    '\\begin{NiceTabular*}{\\linewidth}{cc} a & b \\end{NiceTabular*}',
    '$\\begin{pNiceMatrix} 1 & \\Cdots & 1 \\end{pNiceMatrix}$',
    '\\begin{bNiceArray}{cc} 1 & 2 \\end{bNiceArray}',
    '\\begin{tikzpicture}[remember picture, overlay] \\end{tikzpicture}',
  ]) assert.equal(passesFor(s), REF_PASSES, s);
});
