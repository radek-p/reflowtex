// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walk, walk1, some, count, filterTree, mapTree, walkParallel, type TreeNode } from '../../src/shared/tree.ts';

interface N extends TreeNode { t: string; v?: number; children?: N[]; pre?: N[]; post?: N[]; replace?: N[]; leader?: N }
const leaf = (t: string, v?: number): N => ({ t, v });

const tree = (): N[] => [
  { t: 'box', children: [leaf('a'), { t: 'disc', pre: [leaf('b')], replace: [leaf('c')] }] },
  { t: 'glue', leader: { t: 'lbox', children: [leaf('d')] } },
];

test('walk: pre-order, lists in order, leader last; paths', () => {
  const seen: string[] = [];
  walk(tree(), (n, path) => { seen.push(`${n.t}@${path}`); });
  assert.deepEqual(seen, ['box@[0]', 'a@[0].children[0]', 'disc@[0].children[1]', 'b@[0].children[1].pre[0]',
    'c@[0].children[1].replace[0]', 'glue@[1]', 'lbox@[1].leader', 'd@[1].leader.children[0]']);
});

test('walk: false skips a subtree; walk1 starts at a node', () => {
  const seen: string[] = [];
  walk(tree(), n => { seen.push(n.t); return n.t !== 'disc'; });
  assert.deepEqual(seen, ['box', 'a', 'disc', 'glue', 'lbox', 'd']);
  const s2: string[] = [];
  walk1(tree()[0], (n, p) => { s2.push(p); }, 'box');
  assert.deepEqual(s2.slice(0, 2), ['box', 'box.children[0]']);
});

test('some and count reach leaders', () => {
  assert.ok(some(tree(), n => n.t === 'd'));
  assert.equal(count(tree(), n => n.t.length === 1), 4);
});

test('filterTree removes at every depth and drops a rejected leader', () => {
  const out = filterTree(tree(), n => n.t !== 'b' && n.t !== 'lbox');
  assert.deepEqual(out[0].children![1].pre, []);
  assert.equal(out[1].leader, undefined);
});

test('mapTree is copy-on-write', () => {
  const t = tree();
  const root: N = { t: 'root', children: t };
  const same = mapTree(root, n => n);
  assert.equal(same, root);
  const changed = mapTree(root, n => (n.t === 'd' ? { ...n, v: 1 } : n));
  assert.notEqual(changed, root);
  assert.equal(changed.children![0], t[0]);                        // untouched subtree shared
  assert.equal(changed.children![1].leader!.children![0].v, 1);
  assert.equal(t[1].leader!.children![0].v, undefined);            // input unchanged
});

test('walkParallel: corresponding nodes, list hook before descending, first error wins', () => {
  const a = tree(), b = tree();
  b[0].children![1].replace = [];                                  // a count differs in `replace`
  b[1].leader!.children![0].t = 'x';                               // and a node later on
  const err = walkParallel<N>([{ t: 'r', children: a }, { t: 'r', children: b }], {
    node: (ns, path) => (ns[0].t !== ns[1].t ? `${path}: ${ns[0].t} != ${ns[1].t}` : undefined),
    list: (key, lists, path) => (lists[0].length !== lists[1].length ? `${path}: count` : undefined),
  }, 'box');
  assert.equal(err, 'box.children[0].children[1].replace: count');
  b[0].children![1].replace = [leaf('c')];
  const err2 = walkParallel<N>([{ t: 'r', children: a }, { t: 'r', children: b }], {
    node: (ns, path) => (ns[0].t !== ns[1].t ? `${path}: ${ns[0].t} != ${ns[1].t}` : undefined),
  }, 'box');
  assert.equal(err2, 'box.children[1].leader.children[0]: d != x');
});
