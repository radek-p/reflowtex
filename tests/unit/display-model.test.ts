// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import v8 from 'node:v8';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pyG, pyRepr, topologyError, checkSamples, wideVariants } from '../../src/pipeline/display-model.ts';
import { readSerializerOutput, type SerializerOutput, type TexNode } from '../../src/pipeline/nodes.ts';

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

// ── wideVariants: a probe's output is let go once read ──────────────────────
// Each probe compiles the whole document; on a long one that is tens of
// megabytes. The search reads only the probe's display items, so the rest of
// the output must not outlive its reading: the probes made earlier are
// counted (WeakRefs, after a full collection) while the next is made.

test('wideVariants keeps no probe output alive past its reading', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const pt = 65536, switchAt = 150 * pt;
  // One display, set narrow (two kerns) below the switch width, wide (one kern
  // as wide as the measure, affine) from it on; the paragraphs stand for the
  // rest of a long document.
  const doc = (w: number): SerializerOutput => ({
    source_width: w, fonts: new Map(), streams: [],
    paragraphs: Array.from({ length: 20_000 }, () => ({ nodes: [{ type: 'glue', width: pt }] })),
    content: [{
      kind: 'display', display_width: w,
      box: w < switchAt ? { type: 'hlist', children: [{ type: 'kern', kern: pt }, { type: 'kern', kern: pt }] }
        : { type: 'hlist', children: [{ type: 'kern', kern: w }] },
    }],
  });
  const made: WeakRef<SerializerOutput>[] = [];
  const liveBefore: number[] = [];
  const probe = async (w: number): Promise<SerializerOutput> => {
    await new Promise(r => setImmediate(r));      // a new task: WeakRefs read earlier are released
    gc();
    liveBefore.push(made.filter(r => r.deref() !== undefined).length);
    const d = doc(w);
    made.push(new WeakRef(d));
    return d;
  };
  const first = doc(100 * pt);
  const [nWide, nProbes] = await wideVariants(first, doc(200 * pt), doc(300 * pt), probe);
  assert.equal(nWide, 1);
  assert.equal(nProbes, made.length);
  assert.ok(nProbes >= 5, `bisection made ${nProbes} probe(s)`);
  const item = first.content[0];
  const from = item.display_wide_from as number;
  assert.ok(from >= switchAt && from - switchAt <= 2 * pt, `switch found at ${from / pt} pt`);
  assert.deepEqual(liveBefore, liveBefore.map(() => 0), `probe outputs alive when the next was made: ${liveBefore}`);
});
