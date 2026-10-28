// SPDX-License-Identifier: AGPL-3.0-or-later
// tests/render/render.ts's worst(): the largest offsets of a comparison, for a
// document of any length.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worst, type Vector } from '../../tests/render/render.ts';

const vector = (matched: Vector['matched'], rules: Vector['rules']): Vector => ({
  hsize_pt: 345, window_pt: 0.7, glyphs: { strip: matched.length, viewer: matched.length, matched: matched.length },
  matched, rules, rules_missing: [], colours: { compared: 0, mismatched: 0, first: [] },
});

test('worst: the largest offset across or down, and the farthest rule', () => {
  const v = vector([{ y: 0, text: 'a', dx: 0.01, dy: -0.03 }, { y: 12, text: 'b', dx: -0.02, dy: 0 }],
                   [{ y: 0, off: 0.004 }, { y: 5, unmatched: true }, { y: 9, off: 0.002 }]);
  assert.deepEqual(worst(v), [0.03, 0.004]);
  assert.deepEqual(worst(vector([], [])), [0, null]);
});

test('worst: more glyphs than a call has room for arguments', () => {
  const n = 300_000;
  const matched = Array.from({ length: n }, (_, k) => ({ y: k, text: 'x', dx: k === n - 1 ? 0.5 : 0.01, dy: 0 }));
  const rules = Array.from({ length: n }, (_, k) => ({ y: k, off: k === 7 ? 0.25 : 0.001 }));
  assert.deepEqual(worst(vector(matched, rules)), [0.5, 0.25]);
});
