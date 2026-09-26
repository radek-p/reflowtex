// SPDX-License-Identifier: AGPL-3.0-or-later
// The one walk over TeX node trees, for the whole project: the build pipeline,
// the tools and (bundled by esbuild) the viewer. It imports nothing, so it
// runs anywhere.
//
// A node's descendants hang off it in two ways: child lists (a box's
// `children`, a discretionary's `pre`, `post` and `replace`) and a leader
// glue's single `leader` box, which TeX tiles across the glue's set width.
// Every walk below goes through childLists(), so that is the one place those
// fields are named – before this module there were some twenty hand-written
// recursions, and more than one forgot the leader.

/** Anything with a node's child fields. Payload fields are the caller's. */
export interface TreeNode {
  children?: TreeNode[];
  pre?: TreeNode[];
  post?: TreeNode[];
  replace?: TreeNode[];
  nobreak?: TreeNode[];
  leader?: TreeNode;
}

/** The child lists, in the order every walk takes them. */
export const CHILD_LISTS = ['children', 'pre', 'post', 'replace', 'nobreak'] as const;
export type ChildKey = (typeof CHILD_LISTS)[number] | 'leader';

/** A node's descendants as [key, list] pairs: each child list it has, then its
 *  leader as a list of one. */
export function* childLists<N extends TreeNode>(n: N): Generator<[ChildKey, N[]]> {
  for (const key of CHILD_LISTS) {
    const list = n[key] as N[] | undefined;
    if (list) yield [key, list];
  }
  if (n.leader) yield ['leader', [n.leader as N]];
}

/** Where a node sits below the root the walk started from, written as the
 *  pipeline's messages write it: `box.children[3].leader.children[0]`. */
export const childPath = (path: string, key: ChildKey, i: number): string =>
  key === 'leader' ? `${path}.leader` : `${path}.${key}[${i}]`;

/** Return `false` from a visitor to skip the node's descendants. */
export type Visitor<N> = (n: N, path: string) => void | boolean;

/** Every node of `nodes` and below, depth first: a node, then its child lists
 *  in CHILD_LISTS order, then its leader. `path` names the root list. */
export function walk<N extends TreeNode>(nodes: readonly N[] | undefined, visit: Visitor<N>, path = ''): void {
  (nodes ?? []).forEach((n, i) => {
    if (!n || typeof n !== 'object') return;
    const here = path ? `${path}[${i}]` : `[${i}]`;
    if (visit(n, here) === false) return;
    for (const [key, list] of childLists(n)) {
      if (key === 'leader') walk1(list[0], visit, `${here}.leader`);
      else walk(list, visit, `${here}.${key}`);
    }
  });
}
/** The same from one node (the root of a box, say). */
export function walk1<N extends TreeNode>(root: N, visit: Visitor<N>, path = ''): void {
  if (!root || typeof root !== 'object') return;
  if (visit(root, path) === false) return;
  for (const [key, list] of childLists(root)) {
    if (key === 'leader') walk1(list[0], visit, `${path}.leader`);
    else walk(list, visit, `${path}.${key}`);
  }
}

/** Whether any node at or below `nodes` satisfies `test` (stops at the first). */
export function some<N extends TreeNode>(nodes: readonly N[] | undefined, test: (n: N) => boolean): boolean {
  let found = false;
  walk(nodes, n => { if (found) return false; if (test(n)) { found = true; return false; } });
  return found;
}

/** How many nodes at or below `nodes` satisfy `test`. */
export function count<N extends TreeNode>(nodes: readonly N[] | undefined, test: (n: N) => boolean): number {
  let k = 0;
  walk(nodes, n => { if (test(n)) k++; });
  return k;
}

/** `nodes` without the nodes `keep` rejects, at every depth, rebuilt in place;
 *  a rejected leader is removed from its glue. */
export function filterTree<N extends TreeNode>(nodes: N[], keep: (n: N) => boolean): N[] {
  const out: N[] = [];
  for (const n of nodes) {
    if (!keep(n)) continue;
    for (const key of CHILD_LISTS) if (n[key]) (n[key] as N[]) = filterTree(n[key] as N[], keep);
    if (n.leader) {
      const [leader] = filterTree([n.leader as N], keep);
      if (leader) n.leader = leader; else delete n.leader;
    }
    out.push(n);
  }
  return out;
}

/** A copy of the tree with `edit` applied to every node, copy-on-write: a node
 *  whose edit and descendants are all unchanged is returned as it was, so the
 *  result shares every unchanged subtree with the input. `edit` returns the
 *  node itself for "no change", or a changed shallow copy. */
export function mapTree<N extends TreeNode>(root: N, edit: (n: N) => N): N {
  let out = edit(root);
  for (const [key, list] of childLists(root)) {
    const mapped = list.map(c => mapTree(c, edit));
    if (mapped.some((c, i) => c !== list[i])) {
      if (out === root) out = { ...root };
      if (key === 'leader') out.leader = mapped[0]; else (out[key] as N[]) = mapped;
    }
  }
  return out;
}

// ── Several trees in step ───────────────────────────────────────────────────
// The display model compares the same display compiled at several widths: the
// trees have one shape and are walked together, node by corresponding node.

export interface ParallelHooks<N> {
  /** Called for each set of corresponding nodes. Return false to skip their
   *  descendants, or a string to stop the whole walk with that result. */
  node(ns: N[], path: string): void | boolean | string;
  /** Called before descending into a child list (a leader counts as a list of
   *  0 or 1), with each tree's version of it – where a check that the lists
   *  match belongs. A string stops the walk. Without it, lists are paired up
   *  to the shortest and a leader is followed only where every tree has one. */
  list?(key: ChildKey, lists: N[][], path: string): void | string;
}

/** Walk trees of one shape together. Returns the string a hook stopped with,
 *  or null. The order is walk()'s: a node, then its lists in order. */
export function walkParallel<N extends TreeNode>(roots: N[], hooks: ParallelHooks<N>, path = ''): string | null {
  const r = hooks.node(roots, path);
  if (typeof r === 'string') return r;
  if (r === false) return null;
  const keys: ChildKey[] = [...CHILD_LISTS, 'leader'];
  for (const key of keys) {
    const lists = roots.map(n => (key === 'leader' ? (n.leader ? [n.leader as N] : []) : ((n[key] as N[] | undefined) ?? [])));
    if (hooks.list) {
      const e = hooks.list(key, lists, key === 'leader' ? `${path}.leader` : `${path}.${key}`);
      if (typeof e === 'string') return e;
    }
    const n = Math.min(...lists.map(l => l.length));
    for (let i = 0; i < n; i++) {
      const e = walkParallel(lists.map(l => l[i]), hooks, childPath(path, key, i));
      if (e !== null) return e;
    }
  }
  return null;
}
