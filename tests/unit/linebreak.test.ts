// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's line breaker against LuaTeX's, paragraph by paragraph: each
// fixture in tests/linebreak/<set>/ (capture.lua's par-NNNN.txt) replayed
// through it must come out byte for byte as TeX set it (par-NNNN.expected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { replay } from '../linebreak/replay.ts';

const ROOT = new URL('../linebreak/', import.meta.url).pathname;
const sets = readdirSync(ROOT).filter(d => statSync(join(ROOT, d)).isDirectory());

for (const set of sets) {
  const dir = join(ROOT, set);
  for (const f of readdirSync(dir).filter(f => /^par-\d+\.txt$/.test(f)).sort()) {
    const input = readFileSync(join(dir, f), 'utf8');
    const expected = readFileSync(join(dir, f.replace(/\.txt$/, '.expected')), 'utf8');
    test(`${set}/${f.replace(/\.txt$/, '')}`, () => {
      assert.equal(replay(input), expected);
    });
  }
}

// The break candidates at glue of infinite stretch, on lists made by hand.
// The breaker is imported by a path the Node project does not follow (see
// node-kinds.test.ts); the few signatures used are written out.
type Node = Record<string, unknown> & { type: string };
interface Candidate { kind: string; nodeIdx: number; cumFill: number; leadFill: number }
interface Breaker {
  buildBreakCandidates(nodes: Node[], fontInfo: object, para: object): Candidate[];
  kpBreakpoints(bcs: Candidate[], nodes: Node[], lineWidthSp: number, p: object): { bcIdx: number }[];
  kpPass(bcs: Candidate[], lineWidthSp: number, threshold: number, p: object, o?: object):
    { breaks: { bcIdx: number }[] | null };
}
const VIEWER = new URL('../../src/viewer/src/', import.meta.url).href;
const breaker: Breaker = await import(`${VIEWER}engine/breaker.ts`);
const { paramsFromData }: { paramsFromData(d: Record<string, string>, align: string): object } =
  await import(`${VIEWER}runtime/params.ts`);

const PT = 65536;
const box = (w: number): Node => ({ type: 'hlist', width: w * PT, height: 8 * PT, depth: 2 * PT, children: [] });
const glue = (w: number, stretch: number, order: number, subtype = 0): Node =>
  ({ type: 'glue', subtype, width: w * PT, stretch, stretch_order: order, shrink: 0, shrink_order: 0 });
const penalty = (n: number): Node => ({ type: 'penalty', penalty: n });
const parfillskip = glue(0, PT, 2, 15);
// LaTeX's \and between author blocks: \hskip 1em plus .17fil (at 12pt)
const and = () => glue(12, Math.round(0.17 * PT), 2);
const breaksOf = (nodes: Node[], widthPt: number, ragged: boolean) => {
  const bcs = breaker.buildBreakCandidates(nodes, {}, {});
  const p = { ...paramsFromData({ texFinalPass: 'strict' }, ragged ? 'center' : 'justify'), ragged };
  return breaker.kpBreakpoints(bcs, nodes, widthPt * PT, p).map(b => bcs[b.bcIdx].nodeIdx);
};

test('glue of infinite stretch after a box is a breakpoint, and a break there discards its fill', () => {
  const nodes = [box(150), and(), box(150), and(), box(150), parfillskip];
  const bcs = breaker.buildBreakCandidates(nodes, {}, {});
  assert.deepEqual(bcs.map(b => [b.kind, b.nodeIdx]), [['start', -1], ['space', 1], ['space', 3], ['end', 5]]);
  // a line ending there does not hold the fill; one starting there neither
  assert.deepEqual(bcs.map(b => [b.cumFill, b.leadFill]), [[0, 0], [0, 1], [1, 1], [2, 0]]);
});

test("the \\hfil of \\\\ is no breakpoint: it follows a \\nobreak", () => {
  const nodes = [box(100), penalty(10000), glue(0, PT, 2), penalty(-10000), glue(0, 0, 0), box(100), parfillskip];
  const bcs = breaker.buildBreakCandidates(nodes, {}, {});
  assert.deepEqual(bcs.map(b => [b.kind, b.nodeIdx]), [['start', -1], ['penalty', 3], ['end', 6]]);
});

test('a row of author blocks too wide for the line breaks at the \\and glue, as TeX does', () => {
  const nodes = [box(150), and(), box(150), and(), box(150), parfillskip];
  // centred (\leftskip and \rightskip 0pt plus 1fil): TeX sets 2 + 1
  assert.deepEqual(breaksOf(nodes, 345, true), [3, 5]);
  assert.deepEqual(breaksOf(nodes, 480, true), [5]);
});

test('\\hfill between two boxes in a centred paragraph breaks where TeX does', () => {
  const nodes = [box(250), glue(0, PT, 3), box(250), parfillskip];
  assert.deepEqual(breaksOf(nodes, 345, true), [1, 3]);
  assert.deepEqual(breaksOf(nodes, 520, true), [3]);
  // justified, the line before the \hfill has nothing to stretch: TeX sets
  // one overfull line rather than an infinitely bad one
  assert.deepEqual(breaksOf(nodes, 345, false), [3]);
});

// A start from which a line has become overfull is dropped in every pass, not
// only in the final one (TeX's §851). Negative glue at the paragraph's end
// makes it matter: the line from the start to the end is narrower than the
// one to the space before the glue, so a start kept alive would reach the end
// in one line, which TeX never tries.
test('a start dropped when its line is overfull, in a pass before the final one', () => {
  const hbox = (w: number): Node => ({ type: 'hlist', width: w * PT, height: 7 * PT, depth: 0, list: [] });
  const glueSp = (w: number, stretch = 0, shrink = 0, subtype = 0, order = 0): Node =>
    ({ type: 'glue', subtype, width: w * PT, stretch: stretch * PT, stretch_order: order, shrink: shrink * PT, shrink_order: 0 });
  // box 30 | glue 0 plus 40 | box 30 | glue 10 minus 2 | box 50 | glue -40 |
  // \parfillskip, at 100 pt: from the start, the line to the -40 glue is
  // 120 pt (overfull), the line to the end 80 pt. TeX breaks at the 10 pt
  // glue (a line of badness 100), as the old rule did only in the final pass.
  const nodes = [hbox(30), glueSp(0, 40), hbox(30), glueSp(10, 0, 2), hbox(50), glueSp(-40),
                 { type: 'penalty', penalty: 10000 }, glueSp(0, 1, 0, 15, 2)];
  const bcs = breaker.buildBreakCandidates(nodes, {}, {});
  const p = paramsFromData({}, 'justify');
  for (const o of [{ firstPass: true }, {}, { final: true }]) {
    const r = breaker.kpPass(bcs, 100 * PT, 200, p, o);
    assert.deepEqual(r.breaks?.map(b => b.bcIdx), [2, 4], JSON.stringify(o));
  }
});

// A formula that starts a line: TeX discards its math node with the
// \mathsurround, and the glue it opens with (a \,), as it discards the space
// before it (§879). The line keeps a copy of the math node without the
// surround, the mark of where the formula begins, which stands for the
// paragraph's own node.
test('a break before a formula discards its surround and its opening glue', async () => {
  const { extractLineNodes } = await import(`${VIEWER}engine/breaker.ts`) as
    { extractLineNodes(a: Candidate, b: Candidate, nodes: Node[]): Node[] };
  const { paragraphNode } = await import(`${VIEWER}engine/core.ts`) as { paragraphNode(n: Node): Node };
  const math = (subtype: number): Node => ({ type: 'math', subtype, surround: 6554 });   // 0.1pt
  const thin = glue(2, 0, 0);
  const nodes = [box(100), glue(3, PT, 0), math(0), thin, box(20), math(1), glue(3, PT, 0), box(100), parfillskip];
  const bcs = breaker.buildBreakCandidates(nodes, {}, {}) as (Candidate & { leadW: number; trailW: number })[];
  assert.deepEqual(bcs.map(b => [b.kind, b.nodeIdx]), [['start', -1], ['space', 1], ['space', 6], ['end', 8]]);
  // the space, the surround and the \, go with the break before the formula
  assert.equal(bcs[1].leadW, 3 * PT + 6554 + 2 * PT);
  // a break after it drops the closing surround from the line's end
  assert.equal(bcs[2].trailW, 6554);
  const line = extractLineNodes(bcs[1], bcs[2], nodes);
  assert.deepEqual(line.map(n => n.type), ['math', 'hlist']);
  assert.equal(line[0].surround, 0);
  assert.equal(paragraphNode(line[0]), nodes[2]);
});
