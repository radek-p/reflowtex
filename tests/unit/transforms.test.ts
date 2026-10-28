// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchParts, stripUnsupportedNodes } from '../../src/pipeline/transforms.ts';
import type { SerializerOutput } from '../../src/pipeline/nodes.ts';

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

test("a batch part keeps the missing characters of its own streams", () => {
  // The characters TeX could not set are recorded by stream: each part's
  // warnings list those in its text and in the streams it reaches (here part
  // 1's margin note), not the whole batch's.
  const missing = (char: number, stream: number) => ({ font: 'ec-lmr10', char, stream, count: 1, where: [] });
  const data: SerializerOutput = {
    paragraphs: [
      { nodes: [{ type: 'hlist', aside: 3, children: [] }] },
      { nodes: [] },
      { nodes: [] },
    ],
    content: [{ kind: 'stream', stream: 1 }, { kind: 'stream', stream: 2 }],
    streams: [
      { kind: 'batch-part', attrs: [{ key: 'part', value: '1' }], content: [{ kind: 'paragraph', para: 1 }] },
      { kind: 'batch-part', attrs: [{ key: 'part', value: '2' }], content: [{ kind: 'paragraph', para: 3 }] },
      { kind: 'marginpar', attrs: [{ key: 'aside', value: 'true' }], content: [{ kind: 'paragraph', para: 2 }] },
    ],
    missing_chars: [missing(0x142, 1), missing(0x141, 2), missing(0x17A, 3)],
    links: [], anchors: [], slots: [], pictures: [], outline: [], fonts: new Map(),
  };
  const [one, two] = batchParts(data);
  assert.deepEqual(one.missing_chars!.map(m => m.char), [0x142, 0x17A]);
  assert.deepEqual(two.missing_chars!.map(m => m.char), [0x141]);
});

test('a paragraph keeps a stand-in for each run of nodes the wire format does not model', () => {
  // "word. \index{a} \index{b} \index{c}" at a paragraph's end: TeX's line
  // breaker keeps the \write whatsits, so each run of them leaves an empty
  // box of size zero; inside a box they go as before.
  const glyph = (text: string) => ({ type: 'glyph', text });
  const space = () => ({ type: 'glue', width: 218453, stretch: 109226, shrink: 72818 });
  const whatsit = () => ({ type: 'whatsit' });
  const box = { type: 'hlist', width: 0, height: 0, depth: 0, children: [glyph('x'), whatsit()] };
  const data: any = {
    paragraphs: [{ nodes: [glyph('a'), box, space(), whatsit(), whatsit(), space(), whatsit(), { type: 'penalty', penalty: 10000 },
                           { type: 'glue', subtype: 15, width: 0, stretch: 65536, stretch_order: 2, shrink: 0 }] }],
    content: [{ kind: 'paragraph', para: 1 }, { kind: 'display', box: { type: 'vlist', children: [whatsit(), glyph('y')] } }],
    streams: [], links: [], anchors: [], slots: [], pictures: [], outline: [], fonts: {},
  };
  assert.equal(stripUnsupportedNodes(data), 5);
  const nodes = data.paragraphs[0].nodes;
  assert.deepEqual(nodes.map((n: any) => n.type), ['glyph', 'hlist', 'glue', 'hlist', 'glue', 'hlist', 'penalty', 'glue']);
  for (const k of [3, 5]) {
    const n = nodes[k];
    assert.deepEqual([n.width, n.height, n.depth, n.children], [0, 0, 0, []], 'a box of size zero with nothing in it');
  }
  assert.deepEqual(nodes[1].children.map((n: any) => n.type), ['glyph'], 'inside a box: stripped');
  assert.deepEqual(data.content[1].box.children.map((n: any) => n.type), ['glyph'], 'and in an item\'s box');
});
