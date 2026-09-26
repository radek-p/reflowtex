// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pyG, pyRepr, topologyError, checkSamples } from '../../src/pipeline/display-model.ts';
import { readSerializerOutput, type TexNode } from '../../src/pipeline/nodes.ts';

test("pyG formats as Python's format(x, 'g')", () => {
  const cases: [number, string][] = [[0, '0'], [3, '3'], [3.5, '3.5'], [123456, '123456'], [1234567, '1.23457e+06'],
    [0.0001, '0.0001'], [0.00001234, '1.234e-05'], [1e-6, '1e-06'], [2.5e-7, '2.5e-07'], [-4.25, '-4.25'], [999999.5, '1e+06']];
  for (const [x, s] of cases) assert.equal(pyG(x), s, String(x));
});

test("pyRepr writes a dict as Python's repr", () => {
  assert.equal(pyRepr({ type: 'glyph', char: 65, color: "it's" }), `{'type': 'glyph', 'char': 65, 'color': "it's"}`);
  assert.equal(pyRepr({ a: [true, null, 0.5] }), `{'a': [True, None, 0.5]}`);
});

test('topologyError: identity, counts and leaders, in walk order', () => {
  const box = (children: TexNode[]): TexNode => ({ type: 'hlist', children });
  assert.equal(topologyError(box([{ type: 'kern', kern: 1 }]), box([{ type: 'kern', kern: 2 }]), 'b'), null);   // geometry is not identity
  assert.equal(topologyError(box([{ type: 'kern' }]), box([{ type: 'glue' }]), 'b'),
    `b.children[0]: node identity changed ({'type': 'kern'} != {'type': 'glue'})`);
  assert.equal(topologyError(box([]), box([{ type: 'kern' }]), 'b'), 'b.children: node count changed (0 != 1)');
  assert.equal(topologyError({ type: 'glue', leader: box([]) }, { type: 'glue' }, 'g'), 'g.leader: presence changed');
});

test('checkSamples: widths must increase; affine displays pass', () => {
  const doc = (w: number, k: number) => readSerializerOutput(JSON.stringify({
    source_width: w, content: [{ kind: 'display', display_width: w, box: { type: 'hlist', width: 2 * k, children: [{ type: 'kern', kern: k }] } }] }));
  assert.deepEqual(checkSamples(doc(10, 1), doc(20, 2), doc(30, 3)), [true, null]);
  assert.deepEqual(checkSamples(doc(10, 1), doc(20, 2), doc(30, 9))[0], false);
  assert.match(checkSamples(doc(30, 1), doc(20, 2), doc(10, 3))[1]!, /not strictly increasing/);
});
