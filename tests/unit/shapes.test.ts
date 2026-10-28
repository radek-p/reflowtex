// SPDX-License-Identifier: AGPL-3.0-or-later
// tools/pageless-pdf/shapes.ts: what counts as a rule, for the strip's paths
// (MuPDF's walker calls) and the viewer's (SVG path data) alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Outline, filledRule, strokedRule, svgOutline, type Affine } from '../../tools/pageless-pdf/shapes.ts';

const I: Affine = [1, 0, 0, 1, 0, 0];

test('SVG path data: absolute, relative, H and V, as SVG writers write them', () => {
  assert.deepEqual(svgOutline('M.39896 34.91104V.89496H34.41504V34.91104Z').subpaths,
    [{ pts: [[.39896, 34.91104], [.39896, .89496], [34.41504, .89496], [34.41504, 34.91104]], closed: true }]);
  assert.deepEqual(svgOutline('m1 2l3 0 0 4h-3z').subpaths,
    [{ pts: [[1, 2], [4, 2], [4, 6], [1, 6]], closed: true }]);
  // pairs after a moveto are linetos; a segment after a close starts a new subpath at its start
  assert.deepEqual(svgOutline('M0 0 1 0Z L2 2').subpaths,
    [{ pts: [[0, 0], [1, 0]], closed: true }, { pts: [[0, 0], [2, 2]], closed: false }]);
});

test('SVG path data: each curve takes its own parameters, and marks the path curved', () => {
  for (const d of ['M0 0C1 1 2 2 3 3L4 4', 'M0 0S2 2 3 3L4 4', 'M0 0Q2 2 3 3L4 4', 'M0 0T3 3L4 4', 'M0 0A1 1 0 0 1 3 3L4 4', 'M0 0c1 1 2 2 3 3s1 1 1 1L4 4']) {
    const o = svgOutline(d);
    assert.equal(o.curved, true, d);
    assert.deepEqual(o.subpaths[0].pts.at(-1), [4, 4], d);
  }
  assert.throws(() => svgOutline('M0 0C1 1 2'), /ends early/);
});

test('a stroke of one straight segment is a rule, its corners lw/2 either side; a cap reaches past the ends', () => {
  assert.deepEqual(strokedRule(svgOutline('M0 0H10'), 2, false, I), [[0, 1], [10, 1], [10, -1], [0, -1]]);
  assert.deepEqual(strokedRule(svgOutline('M0 0H10'), 2, true, I), [[-1, 1], [11, 1], [11, -1], [-1, -1]]);
  assert.deepEqual(strokedRule(svgOutline('M0 0H10'), 2, false, [2, 0, 0, 2, 5, 0]), [[5, 2], [25, 2], [25, -2], [5, -2]]);
  // not: a curve after the segment, two segments, two subpaths, no length
  for (const d of ['M0 0L10 0C11 1 12 2 13 3', 'M0 0H10V5', 'M0 0H10M0 5H10', 'M3 3L3 3'])
    assert.equal(strokedRule(svgOutline(d), 1, false, I), null, d);
});

test('a fill of one four-cornered shape with straight sides is a rule', () => {
  const quad = [[0, 0], [4, 0], [4, 2], [0, 2]];
  assert.deepEqual(filledRule(svgOutline('M0 0H4V2H0Z'), I), quad);
  assert.deepEqual(filledRule(svgOutline('M0 0H4V2H0V0'), I), quad);       // the closing side drawn
  assert.deepEqual(filledRule(svgOutline('M0 0L4 0 4 2 0 2'), I), quad);   // an arrow tip: closed by the fill
  // PDF's `re`, as MuPDF walks it: a moveto after the close, which draws nothing
  const re = new Outline();
  re.moveTo(0, 0); re.lineTo(4, 0); re.lineTo(4, 2); re.lineTo(0, 2); re.closePath(); re.moveTo(4, 2);
  assert.deepEqual(filledRule(re, I), quad);
  // not: a triangle, a pentagon, a curved side, two shapes in one fill
  for (const d of ['M0 0H4V2Z', 'M0 0H4V2H2L0 1Z', 'M0 0H4V2C3 3 1 3 0 2Z', 'M0 0H4V2H0ZM5 5H6V6H5Z'])
    assert.equal(filledRule(svgOutline(d), I), null, d);
});

test('SVG path data: numbers as the grammar reads them', () => {
  const pts = (d: string) => svgOutline(d).subpaths.map(s => s.pts);
  // an exponent, as JavaScript writes a number near zero: not a command
  assert.deepEqual(pts('M4.973799150320701e-14 7.1H13.4V13.7H4.9Z'), [[[4.973799150320701e-14, 7.1], [13.4, 7.1], [13.4, 13.7], [4.9, 13.7]]]);
  assert.deepEqual(pts('M1E2 2e+1L-1.5e-1 3'), [[[100, 20], [-0.15, 3]]]);
  // numbers run together: a second dot, or a sign, starts the next one
  assert.deepEqual(pts('M.5.5L1.5.25'), [[[.5, .5], [1.5, .25]]]);
  assert.deepEqual(pts('M1-2L-3-4'), [[[1, -2], [-3, -4]]]);
  assert.deepEqual(pts('M+1+2l1e1-1E1'), [[[1, 2], [11, -8]]]);
  // commas and any white space between them
  assert.deepEqual(pts('M 1,2\n\tL 3 , 4'), [[[1, 2], [3, 4]]]);
  // an arc's flags are one digit each, and may run into what follows
  assert.deepEqual(pts('M0 0a1 1 0 011 1'), [[[0, 0], [1, 1]]]);
  assert.deepEqual(pts('M0 0A1 1 0 1,0 2,3'), [[[0, 0], [2, 3]]]);
  // what is not a number is an error, not a command
  assert.throws(() => svgOutline('M1 2L3x'), /not a number/);
  assert.throws(() => svgOutline('M1 2L3'), /ends early/);
  assert.throws(() => svgOutline('M0 0A1 1 0 2 0 1 1'), /ends early/);
});
