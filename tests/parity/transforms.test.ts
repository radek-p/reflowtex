// SPDX-License-Identifier: AGPL-3.0-or-later
// src/pipeline/transforms.ts and pictures.ts against transforms.py: every
// captured call replayed on the same inputs (pictures converted again, with
// the same Ghostscript and dvisvgm, in the same build directories).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { existsSync } from 'node:fs';
import * as T from '../../src/pipeline/transforms.ts';
import { convertPictures } from '../../src/pipeline/pictures.ts';
import { captures, readCapture, normalise, asDocument, canonicalSvg } from './helpers.ts';

const cases: [string, (args: any[]) => Promise<unknown> | unknown][] = [
  ['drop_unreferenced_paragraphs', ([d]) => T.dropUnreferencedParagraphs(asDocument(d))],
  ['strip_unsupported_nodes', ([d]) => T.stripUnsupportedNodes(asDocument(d))],
  ['batch_parts', ([d]) => T.batchParts(asDocument(d))],
  ['convert_pictures', ([d, dir]) => convertPictures(asDocument(d), dir)],
];

for (const [fn, run] of cases) {
  const files = captures(fn);
  test(`${fn}: ${files.length} captured call(s) replayed`, { skip: files.length ? false : 'no captures (tests/parity/README.md)' }, async () => {
    let n = 0;
    for (const f of files) {
      const rec = readCapture(f);
      if (fn === 'convert_pictures' && !existsSync(rec.args[1])) continue;     // its build dir is gone
      const result = await run(rec.args);
      // pictures compared in canonical form (dvisvgm's glyph numbering varies)
      const docs = (a: any[]) => a.filter(x => x && typeof x === 'object').map(asDocument).map((d: any) => {
        if (Array.isArray(d.pictures)) d.pictures = d.pictures.map((p: any) => ({ ...p, svg: canonicalSvg(p.svg) }));
        return d;
      });
      assert.ok(isDeepStrictEqual(normalise(Array.isArray(result) ? result.map(asDocument) : result),
        normalise(Array.isArray(rec.result) ? rec.result.map(asDocument) : rec.result)), `${f}: result`);
      assert.deepStrictEqual(normalise(docs(rec.args)), normalise(docs(rec.after)), `${f}: arguments after the call`);
      n++;
    }
    assert.ok(n > 0);
  });
}
