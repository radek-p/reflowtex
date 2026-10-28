// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import v8 from 'node:v8';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { topologyError, checkSamples, anchorModel } from '../../src/pipeline/display-model.ts';
import { readSerializerOutput, type SerializerOutput, type TexNode } from '../../src/pipeline/nodes.ts';
import { sampleDisplays, type Sample, type SamplingOptions } from '../../src/pipeline/pipeline.ts';
import { TexError } from '../../src/pipeline/errors.ts';
import { Log } from '../../src/shared/log.ts';

test('topologyError: identity, counts and leaders, in walk order', () => {
  const box = (children: TexNode[]): TexNode => ({ type: 'hlist', children });
  assert.equal(topologyError(box([{ type: 'kern', kern: 1 }]), box([{ type: 'kern', kern: 2 }]), 'b'), null);   // geometry is not identity
  assert.equal(topologyError(box([{ type: 'kern' }]), box([{ type: 'glue' }]), 'b'),
    `b.children[0]: node identity changed ({"type":"kern"} != {"type":"glue"})`);
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

// ── anchorModel: a probe's output is let go once read ───────────────────────
// Each probe compiles the whole document; on a long one that is tens of
// megabytes. The search reads only the probe's display items, so the rest of
// the output must not outlive its reading: the probes made earlier are
// counted (WeakRefs, after a full collection) while the next is made.

test('anchorModel keeps no probe output alive past its reading', async () => {
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
  const [nWide, nProbes] = await anchorModel(first, doc(200 * pt), doc(300 * pt), probe);
  assert.equal(nWide, 1);
  assert.equal(nProbes, made.length);
  assert.ok(nProbes >= 5, `bisection made ${nProbes} probe(s)`);
  const item = first.content[0];
  const from = item.display_wide_from as number;
  assert.ok(from >= switchAt && from - switchAt <= 2 * pt, `switch found at ${from / pt} pt`);
  assert.deepEqual(liveBefore, liveBefore.map(() => 0), `probe outputs alive when the next was made: ${liveBefore}`);
});

// ── sampleDisplays: TeX failing at a wider width ─────────────────────────────
// A compilation at a width the author never used may fail where the document
// compiles (a package's arithmetic overflowing at a wide measure). It is
// taken instead at the widest width below it that compiles (to 4 pt, by
// bisection), and the log says so; when none above the widest sample does,
// that is the ceiling, and samples are taken between the document's width
// and it. Only when the document's own width is the one width that compiles
// does it keep its data unmodelled.

const PT = 65536;
/** A document with one display: the narrow form (two kerns) below
 *  `switchAt`, from there one kern as wide as the measure (affine). */
const displayDoc = (w: number, switchAt = 0): SerializerOutput => ({
  source_width: w, fonts: new Map(), streams: [], paragraphs: [],
  content: [{
    kind: 'display', display_width: w,
    box: w < switchAt ? { type: 'hlist', children: [{ type: 'kern', kern: PT }, { type: 'kern', kern: PT }] }
      : { type: 'hlist', children: [{ type: 'kern', kern: w }] },
  }],
});
const overflow = (extraSp: number) => new TexError('lualatex reported 2 error(s):\n  ! Arithmetic overflow.\n  ! Missing number.',
  `sample +${extraSp / PT} pt`, '! Arithmetic overflow.');
const X0 = 100 * PT;

/** sampleDisplays over displayDoc at 100 pt, TeX failing where `atFails`
 *  (samples) or `probeFails` (probes) says; the extra widths asked, in pt. */
async function sampling(o: { switchAt?: number; atFails?: (extraSp: number) => boolean; probeFails?: (extraSp: number) => boolean;
                             otherError?: number }) {
  const first: Sample = { data: displayDoc(X0, o.switchAt), dir: 'own' };
  const before = structuredClone(first.data);
  const log = new Log('pipeline');
  const asked: { at: number[]; probe: number[] } = { at: [], probe: [] };
  const compile = async (kind: 'at' | 'probe', extraSp: number): Promise<SerializerOutput> => {
    asked[kind].push(extraSp / PT);
    await new Promise(r => setImmediate(r));
    if (extraSp === o.otherError) throw new Error('disk full');
    if ((kind === 'at' ? o.atFails : o.probeFails)?.(extraSp)) throw overflow(extraSp);
    return displayDoc(X0 + extraSp, o.switchAt);
  };
  const out = await sampleDisplays(first, {
    at: async extraSp => ({ data: await compile('at', extraSp), dir: `+${extraSp / PT}` }),
    probe: extraSp => compile('probe', extraSp),
    label: 'b1', log,
  });
  const warnings = log.records().filter(r => r.level === 'warning').map(r => [r.code, r.details]);
  const stable = log.records().filter(r => r.code === 'display-model-stable').map(r => r.details.widths);
  return { first, before, out, log, asked, warnings, stable };
}

test('sampleDisplays: a sample TeX fails is taken at the widest width below it that compiles, within 4 pt', async () => {
  const limit = 171.3 * PT;       // TeX fails above the document's width + this
  const { out, asked, warnings, stable } = await sampling({ atFails: x => x > limit });
  assert.equal(out.data.display_model, true, 'modelled');
  assert.deepEqual(asked.at, [128, 256, 192, 160, 176, 168, 172], 'the samples, then a bisection of (128, 256) pt');
  assert.deepEqual(stable, ['100, 228, 268']);
  const used = 168 * PT;
  assert.ok(used <= limit && limit - used < 4 * PT, 'the widest that compiles, to 4 pt');
  assert.deepEqual(warnings, [['display-sample-replaced', { block: 'b1', failed: '356', error: '! Arithmetic overflow.', used: '268' }]]);
});

test('sampleDisplays: TeX failing just above the first step: the model is measured below the ceiling, with one warning', async () => {
  const { out, asked, warnings, stable } = await sampling({ atFails: x => x > 130 * PT });
  assert.equal(out.data.display_model, true, 'modelled');
  // 356 pt fails, and every width tried above 228 pt: that is the ceiling;
  // the third sample goes halfway between the document's width and it
  assert.deepEqual(asked.at, [128, 256, 192, 160, 144, 136, 132, 64]);
  assert.deepEqual(stable, ['100, 164, 228'], 'every sample within [100, 228] pt');
  assert.deepEqual(warnings, [['display-sample-ceiling', { block: 'b1', ceiling: '228', failed: '356', error: '! Arithmetic overflow.' }]]);
});

test('sampleDisplays: below the ceiling the window slides up as above it; the model anchored at the document', async () => {
  // The document's own width is set the narrow way, so (100, 164, 228) is
  // rejected and (164, 196, 228) holds.
  const switchAt = 150 * PT;
  const { out, warnings, stable } = await sampling({ switchAt, atFails: x => x > 130 * PT });
  assert.equal(out.data.display_model, true);
  assert.deepEqual(stable, ['164, 196, 228']);
  const from = out.data.content[0].display_wide_from as number;
  assert.ok(from >= switchAt && from - switchAt <= 2 * PT, `switch found at ${from / PT} pt`);
  assert.deepEqual(warnings.map(([code]) => code), ['display-sample-ceiling']);
});

test('sampleDisplays: when only the document\'s own width compiles, it keeps its own data, unmodelled', async () => {
  const { first, before, out, asked, warnings } = await sampling({ atFails: () => true });
  assert.equal(out, first);
  assert.deepEqual(out.data, before, 'no rates, no display_model');
  assert.deepEqual(asked.at, [128, 256, 64, 32, 16, 8, 4]);
  assert.deepEqual(warnings, [['display-sample-failed', { block: 'b1', failed: '228', error: '! Arithmetic overflow.', compiled: '100' }]]);
});

test('sampleDisplays: a probe TeX fails is replaced by the same rule, and the switch is still found', async () => {
  // The document's own width is set the narrow way (rejected); the wider three
  // are stable, so the width the display switches at (150 pt) is probed for.
  const switchAt = 150 * PT;
  const { out, asked, warnings } = await sampling({ switchAt, probeFails: x => x >= 120 * PT && x <= 130 * PT });
  assert.equal(out.data.display_model, true);
  assert.deepEqual(asked.probe.slice(0, 6), [128, 64, 96, 112, 120, 116], 'the first probe fails; (100, 228) pt bisected');
  const from = out.data.content[0].display_wide_from as number;
  assert.ok(from >= switchAt && from - switchAt <= 2 * PT, `switch found at ${from / PT} pt`);
  assert.deepEqual(warnings, [['display-sample-replaced', { block: 'b1', failed: '228', error: '! Arithmetic overflow.', used: '216' }]]);
});

test('sampleDisplays: a probe TeX fails with nothing below it compiling ends sampling, leaving the document as it was', async () => {
  const { first, before, out, asked, warnings } = await sampling({ switchAt: 150 * PT, probeFails: () => true });
  assert.equal(out, first);
  assert.deepEqual(out.data, before, 'no rates, no wide form, no display_model');
  assert.deepEqual(asked.probe, [128, 64, 32, 16, 8, 4]);
  assert.deepEqual(warnings, [['display-sample-failed', { block: 'b1', failed: '228', error: '! Arithmetic overflow.', compiled: '100' }]]);
});

test('sampleDisplays: with every compilation succeeding, nothing is replaced', async () => {
  const { out, asked, warnings } = await sampling({ switchAt: 150 * PT });
  assert.equal(out.data.display_model, true);
  assert.ok(out.data.content[0].display_wide, 'the display gets its wide form');
  assert.deepEqual(asked.at, [128, 256, 384]);
  assert.deepEqual(warnings, []);
});

test('sampleDisplays: an error other than TeX\'s still stops the build', async () => {
  await assert.rejects(sampling({ otherError: 128 * PT }), /disk full/);
});
