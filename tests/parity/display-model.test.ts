// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/display-model.ts against display_model.py: every captured call
// replayed on the same inputs; the result and everything the call changed in
// its arguments must be what Python's call left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as DM from '../../src/pipeline/display-model.ts';
import { captures, readCapture, normalise, asDocument } from './helpers.ts';

const cases: [string, (args: any[], rec: any) => Promise<unknown> | unknown][] = [
  ['wants_model', ([d]) => DM.wantsModel(asDocument(d))],
  ['check_samples', ([a, b, c]) => DM.checkSamples(asDocument(a), asDocument(b), asDocument(c))],
  ['attach_model', ([a, b, c]) => DM.attachModel(asDocument(a), asDocument(b), asDocument(c))],
  ['anchor_model', ([a, b, c]) => DM.anchorModel(asDocument(a), asDocument(b), asDocument(c))],
  ['wide_variants', ([a, b, c], rec) => DM.wideVariants(asDocument(a), asDocument(b), asDocument(c),
    async (w: number) => (String(w) in rec.probes ? asDocument(rec.probes[String(w)]) : assert.fail(`probe at ${w} was not captured`)))],
];

for (const [fn, run] of cases) {
  const files = captures(fn);
  test(`${fn}: ${files.length} captured call(s) replayed`, { skip: files.length ? false : 'no captures (tests/parity/README.md)' }, async () => {
    for (const f of files) {
      const rec = readCapture(f);
      const result = await run(rec.args, rec);
      assert.deepStrictEqual(normalise(result), normalise(rec.result), `${f}: result`);
      // (the documents only: wide_variants' fourth argument is the probe callback)
      if (rec.after) assert.deepStrictEqual(normalise(rec.args.slice(0, 3).map(asDocument)), normalise(rec.after.slice(0, 3).map(asDocument)), `${f}: arguments after the call`);
    }
  });
}
