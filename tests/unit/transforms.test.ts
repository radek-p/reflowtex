// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchParts } from '../../src/pipeline/transforms.ts';

test("a batch part keeps its asides, found through their marks", () => {
  // A part's asides are reached through the marks their text leaves
  // (Node.aside), and renumbered with the other streams; they were dropped,
  // and margin notes vanished from a book's chapters.
  const glyph = (text: string) => ({ type: 'glyph', text });
  const data: any = {
    paragraphs: [
      { nodes: [glyph('a'), { type: 'hlist', aside: 3, children: [] }] },   // part 1, with a mark
      { nodes: [glyph('b')] },                                             // the aside's text
      { nodes: [glyph('c')] },                                             // part 2
    ],
    content: [{ kind: 'stream', stream: 1 }, { kind: 'stream', stream: 2 }],
    streams: [
      { kind: 'batch-part', attrs: [{ key: 'part', value: '1' }], content: [{ kind: 'paragraph', para: 1 }] },
      { kind: 'batch-part', attrs: [{ key: 'part', value: '2' }], content: [{ kind: 'paragraph', para: 3 }] },
      { kind: 'marginpar', attrs: [{ key: 'aside', value: 'true' }], content: [{ kind: 'paragraph', para: 2 }] },
    ],
    links: [], anchors: [], slots: [], pictures: [], outline: [], fonts: {},
  };
  const [one, two] = batchParts(data);
  assert.deepEqual(one.streams.map((s: any) => s.kind), ['marginpar']);
  const nodes = one.paragraphs.flatMap((p: any) => p.nodes);
  assert.deepEqual(nodes.filter((n: any) => n.aside).map((n: any) => n.aside), [1], 'the mark points at the renumbered aside');
  assert.ok(nodes.some((n: any) => n.text === 'b'), "the aside's paragraph is kept");
  assert.deepEqual(two.streams, []);
});
