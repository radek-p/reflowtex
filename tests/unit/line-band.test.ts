// SPDX-License-Identifier: AGPL-3.0-or-later
// A paragraph's lines at the reader's width keep their distances from both
// edges of the column, as TeX had them at its own width – narrower than the
// column (a quote, a list) or wider (a page with smaller margins, a negative
// \rightmargin or \rightskip), where a distance is negative.
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface Band { indentSp: number; rightSp: number; availSp: number }
interface BandModule { lineBandAtWidth(band: { indent?: number; width?: number }, widthSp: number, sourceWidthSp: number): Band }
// The viewer is imported by a path the Node project does not follow (see
// node-kinds.test.ts); the signature used is written out above.
const VIEWER = new URL('../../src/viewer/src/', import.meta.url).href;
const band: BandModule = await import(`${VIEWER}engine/layout/band.ts`);

const PT = 65536, SOURCE = 345 * PT;

test('a paragraph narrower than the column keeps both its margins', () => {
  assert.deepEqual(band.lineBandAtWidth({ indent: 25 * PT, width: 295 * PT }, SOURCE, SOURCE), { indentSp: 25 * PT, rightSp: 25 * PT, availSp: 295 * PT });
  assert.equal(band.lineBandAtWidth({ indent: 25 * PT, width: 295 * PT }, 200 * PT, SOURCE).availSp, 150 * PT);
});

test('a paragraph TeX set wider than the column is set at its own width, and as much wider at any other', () => {
  assert.deepEqual(band.lineBandAtWidth({ indent: 0, width: SOURCE + 40 * PT }, SOURCE, SOURCE), { indentSp: 0, rightSp: -40 * PT, availSp: SOURCE + 40 * PT });
  assert.equal(band.lineBandAtWidth({ indent: 0, width: SOURCE + 40 * PT }, 200 * PT, SOURCE).availSp, 240 * PT);
  // reaching past both edges
  assert.equal(band.lineBandAtWidth({ indent: -10 * PT, width: SOURCE + 30 * PT }, 200 * PT, SOURCE).availSp, 230 * PT);
});
