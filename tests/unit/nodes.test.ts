// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSerializerOutput, writeSerializerOutput, walkNodes, filterNodes, contentItems, forEachNode, type TexNode } from '../../src/pipeline/nodes.ts';

const glyph = (char: number): TexNode => ({ type: 'glyph', char });

test('walkNodes: node, then its child lists in order, then its leader', () => {
  const tree: TexNode[] = [{
    type: 'hlist',
    children: [glyph(1), { type: 'disc', pre: [glyph(2)], post: [glyph(3)], replace: [glyph(4)] }],
  }, { type: 'glue', leader: { type: 'hlist', children: [glyph(5)] } }];
  const seen: string[] = [];
  walkNodes(tree, n => seen.push(n.type === 'glyph' ? String(n.char) : n.type));
  assert.deepEqual(seen, ['hlist', '1', 'disc', '2', '3', '4', 'glue', 'hlist', '5']);
});

test('filterNodes: removes at every depth, and drops a rejected leader', () => {
  const tree: TexNode[] = [
    { type: 'hlist', children: [glyph(1), { type: 'whatsit' }] },
    { type: 'glue', leader: { type: 'whatsit' } },
    { type: 'whatsit' },
  ];
  const out = filterNodes(tree, n => n.type !== 'whatsit');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].children, [glyph(1)]);
  assert.equal(out[1].leader, undefined);
});

test('readSerializerOutput keeps the font map in file order, and reads [] as an empty map', () => {
  const d = readSerializerOutput('{"fonts":{"15":{"name":"a","size_sp":1,"filename":"a.otf"},"3":{"name":"b","size_sp":1,"filename":"b.otf"}},"paragraphs":[]}');
  assert.deepEqual([...d.fonts.keys()], ['15', '3']);
  assert.equal(readSerializerOutput('{"fonts":[]}').fonts.size, 0);
  assert.match(writeSerializerOutput(d), /^\{"fonts":\{"15":.*"3":/);
});

test('contentItems and forEachNode reach streams and wide display forms', () => {
  const d = readSerializerOutput(JSON.stringify({
    fonts: [], paragraphs: [{ nodes: [glyph(1)] }],
    content: [{ kind: 'paragraph', para: 1 }, { kind: 'display', box: { type: 'hlist', children: [glyph(2)] },
      display_wide: { kind: 'display', box: { type: 'hlist', children: [glyph(3)] } } }],
    streams: [{ kind: 'footnote', content: [{ kind: 'display', box: { type: 'hlist', children: [glyph(4)] } }] }],
  }));
  assert.equal([...contentItems(d)].length, 4);
  const chars: number[] = [];
  forEachNode(d, n => { if (n.type === 'glyph') chars.push(n.char!); });
  assert.deepEqual(chars, [1, 2, 3, 4]);
});
