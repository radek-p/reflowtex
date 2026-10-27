// SPDX-License-Identifier: AGPL-3.0-or-later
// The space between a paragraph's lines is TeX's interline glue, from the
// leading the paragraph was broken with: lines whose leading leaves no space
// touch, and nothing is added for ink that comes close. The viewer's modules
// are imported by URL, outside the Node type check.
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface LineMeta { bskip: number; lskip: number; lskiplimit: number }
interface Lines {
  paragraphLeading(para: Record<string, unknown>): LineMeta;
  texInterlineAdvance(prevDepth: number, thisAscent: number, m: LineMeta): number;
}
const VIEWER = new URL('../../src/viewer/src/engine/', import.meta.url).href;
const { paragraphLeading, texInterlineAdvance }: Lines = await import(`${VIEWER}layout/lines.ts`);
const { SP_TO_PX }: { SP_TO_PX: number } = await import(`${VIEWER}core.ts`);

const PT = 65536;
const px = (pt: number) => pt * PT * SP_TO_PX;

test('a gap of 0 between lines stays 0', () => {
  // \baselineskip, \lineskip and \lineskiplimit all 0 (as under
  // \offinterlineskip): a line 3 pt deep above one 7 pt high, 10 pt apart
  const none = paragraphLeading({ nodes: [], baselineskip: 0, lineskip: 0, lineskiplimit: 0 });
  assert.equal(texInterlineAdvance(px(3), px(7), none), px(10));
  // a leading of 0 recorded as absent (the wire format leaves out zeros) is the same
  assert.equal(texInterlineAdvance(px(3), px(7), paragraphLeading({ nodes: [] })), px(10));
  // and with a \baselineskip, the lines stand that far apart
  const twelve = paragraphLeading({ nodes: [], baselineskip: 12 * PT, lineskip: 1 * PT });
  assert.equal(texInterlineAdvance(px(3), px(7), twelve), px(12));
});
