// SPDX-License-Identifier: AGPL-3.0-or-later
// Values written as Python writes them (src/pipeline/python-format.ts),
// where text once made by Python must not change: the Hugo integration's
// batch hash, which a site's data stores; and the number format of the
// pipeline's messages (src/shared/numbers.ts), which needs no Python.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pyFloat, pyJsonDumps, pyRepr } from '../../src/pipeline/python-format.ts';
import { g6 } from '../../src/shared/numbers.ts';

test('a batch\'s hash is what it has always been: json.dumps of its name, preamble and parts', () => {
  const batch = ['book', '\\usepackage{amsmath}\n% żółw 😀 "q"\t', [[1, '0123456789abcdef'], [2.5, 'fedcba9876543210'], [-3, 'x'], [0, 'y']]];
  const text = pyJsonDumps(batch);
  assert.equal(text, String.raw`["book", "\\usepackage{amsmath}\n% \u017c\u00f3\u0142w \ud83d\ude00 \"q\"\t", [[1.0, "0123456789abcdef"], [2.5, "fedcba9876543210"], [-3.0, "x"], [0.0, "y"]]]`);
  assert.equal(createHash('sha256').update(text).digest('hex').slice(0, 16), '74f99225a71b42ef');
  assert.equal(pyJsonDumps([NaN, Infinity, -Infinity, null, true]), '[NaN, Infinity, -Infinity, null, true]');
});

test('floats as Python\'s repr() writes them', () => {
  const cases: [number, string][] = [[0, '0.0'], [-0, '-0.0'], [3, '3.0'], [0.5, '0.5'], [-4.25, '-4.25'], [1e-4, '0.0001'],
    [1.5e-5, '1.5e-05'], [1e16, '1e+16'], [123456789.125, '123456789.125'], [NaN, 'nan'], [-Infinity, '-inf']];
  for (const [x, s] of cases) assert.equal(pyFloat(x), s, String(x));
});

test('pyRepr writes a dict as Python\'s repr', () => {
  assert.equal(pyRepr({ type: 'glyph', char: 65, color: "it's" }), `{'type': 'glyph', 'char': 65, 'color': "it's"}`);
  assert.equal(pyRepr({ a: [true, null, 0.5] }), `{'a': [True, None, 0.5]}`);
});

test('numbers in messages: six significant digits, as short as that allows', () => {
  const cases: [number, string][] = [[345, '345'], [0.5, '0.5'], [12.3456789, '12.3457'], [-4.25, '-4.25'], [1e-5, '0.00001'], [430.000001, '430']];
  for (const [x, s] of cases) assert.equal(g6(x), s, String(x));
});
