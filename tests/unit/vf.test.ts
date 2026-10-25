// SPDX-License-Identifier: AGPL-3.0-or-later
// Virtual fonts (src/pipeline/fonts/vf.ts): a glyph set in a virtual face
// becomes what its packet draws. A small virtual font is made here over
// cmr10 and cmmi10, one character per shape of packet: a plain character, one
// moved right, several characters and a rule, one raised, an accent placed
// with push/pop – and a real one, TeX Live's aer10 (the ae package: T1
// emulated over Computer Modern): its é is push, moveright -0.02799, the
// acute, pop, e, as vftovp prints it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FontFiles, readVf, resolveVirtualFonts } from '../../src/pipeline/fonts/vf.ts';
import { readTfm, texScale } from '../../src/pipeline/fonts/tfm.ts';
import { kpsewhich } from '../../src/pipeline/fonts/type1.ts';

const EM = 2 ** 20;                                       // a fix_word of 1.0: the virtual font's size
const TENTH = 104858, FIFTH = 209715, RULE_H = 41943;           // 0.1, 0.2 and 0.04 of it, as fix_words
const SIZE = 655360;                                      // 10 pt
const be = (v: number, k: number) => { const out: number[] = []; for (let i = k - 1; i >= 0; i--) out.push((v >>> (8 * i)) & 255); return out; };
const fntDef = (k: number, name: string) => [243, k, ...be(0, 4), ...be(EM, 4), ...be(10 * EM, 4), 0, name.length, ...[...name].map(c => c.charCodeAt(0))];
const packet = (cc: number, dvi: number[]) => [dvi.length, cc, 0, 0, 0, ...dvi];
const SET_RULE = 132, PUSH = 141, POP = 142, RIGHT3 = 145, DOWN3 = 159, FNT_NUM_1 = 172;
const vfBytes = new Uint8Array([
  247, 202, 0, ...be(0, 4), ...be(10 * EM, 4),
  ...fntDef(0, 'cmr10'), ...fntDef(1, 'cmmi10'),
  ...packet(65, [66]),                                                    // A: cmr10 B
  ...packet(66, [RIGHT3, ...be(TENTH, 3), 65]),                         // B: cmr10 A, 0.1 em right
  ...packet(67, [97, FNT_NUM_1, 11, SET_RULE, ...be(RULE_H, 4), ...be(EM / 2, 4)]),   // C: a, cmmi10 alpha, a rule
  ...packet(68, [DOWN3, ...be(-FIFTH & 0xFFFFFF, 3), 65]),                // D: cmr10 A, 0.2 em up
  ...packet(69, [PUSH, RIGHT3, ...be(TENTH, 3), 0x13, POP, 101]),        // E: an acute over e
  248, 248, 248, 248,
]);

const files = new FontFiles(name => {
  if (name === 'testvf.vf') return vfBytes;
  const p = kpsewhich(name);
  return p ? readFileSync(p) : null;
});
// The small font is drawn from Computer Modern: without TeX Live's files (a
// machine without TeX) the tests that read them are skipped, by name.
const NO_CM = (!kpsewhich('cmr10.tfm') || !kpsewhich('cmmi10.tfm')) && 'not installed: cmr10.tfm, cmmi10.tfm';
const NO_AE = (NO_CM || !kpsewhich('aer10.vf')) && 'not installed: aer10.vf (ae), cmr10.tfm';
const tfm = (name: string) => { const p = kpsewhich(name); return p ? readTfm(readFileSync(p)) : null; };
const cmr = tfm('cmr10.tfm')!, cmmi = tfm('cmmi10.tfm')!;
const w = (t: typeof cmr, c: number) => t.char(c, SIZE)!.width;

type N = { type: string; [k: string]: unknown };
function resolve(chars: number[]) {
  const fonts = new Map<string, { name: string; size_sp: number; filename: string; [k: string]: unknown }>([
    ['3', { name: 'testvf', size_sp: SIZE, filename: 'unknown', codes: [{ char: 65, lp: 50, rp: 0, ef: 1000 }] }],
    ['4', { name: 'cmr10', size_sp: SIZE, filename: 'unknown' }],
  ]);
  const nodes: N[] = chars.map(c => ({ type: 'glyph', char: c, font: 3, width: 300000, height: 400000, depth: 1000, color: '#c2410c', link: 2 }));
  const each = (visit: (n: N) => void) => { const go = (ns: N[]) => { for (const n of ns) { visit(n); go((n.children as N[]) ?? []); } }; go(nodes); };
  const n = resolveVirtualFonts(fonts, each, files);
  return { n, nodes, fonts };
}

test('one character at the origin: the glyph node itself, in the base font, its box and attributes kept', { skip: NO_CM }, () => {
  const { n, nodes, fonts } = resolve([65]);
  assert.equal(n, 1);
  assert.deepEqual(nodes[0], { type: 'glyph', char: 66, font: 4, width: 300000, height: 400000, depth: 1000, color: '#c2410c', link: 2 });
  assert.deepEqual(fonts.get('4')!.codes, [{ char: 66, lp: 50, rp: 0, ef: 1000 }], 'its protrusion code goes along');
});

test('a moved character: a box of the virtual character\'s size, a kern to the piece', { skip: NO_CM }, () => {
  const { nodes } = resolve([66]);
  const tenth = texScale(TENTH, SIZE);
  assert.deepEqual(nodes[0], { type: 'hlist', subtype: 2, width: 300000, height: 400000, depth: 1000, shift: 0, glue_set: 0, glue_sign: 0, glue_order: 0, children: [
    { type: 'kern', kern: tenth, subtype: 1 },
    { type: 'glyph', char: 65, font: 4, width: w(cmr, 65), height: cmr.char(65, SIZE)!.height, depth: 0, color: '#c2410c', link: 2 },
  ] });
});

test('several characters in two fonts and a rule, each where the packet sets it', { skip: NO_CM }, () => {
  const { nodes, fonts } = resolve([67]);
  const kids = nodes[0].children as N[];
  assert.deepEqual(kids.map(k => [k.type, k.char ?? null, k.font ?? null]), [['glyph', 97, 4], ['glyph', 11, 5], ['rule', null, null]]);
  assert.deepEqual(fonts.get('5'), { name: 'cmmi10', size_sp: SIZE, filename: 'unknown', quad: cmmi.param(6, SIZE) });
  assert.equal(kids[1].width, w(cmmi, 11));
  assert.deepEqual(kids[2], { type: 'rule', width: texScale(EM / 2, SIZE), height: texScale(RULE_H, SIZE), depth: 0 });
});

test('a raised character: in a box shifted up', { skip: NO_CM }, () => {
  const { nodes } = resolve([68]);
  const [inner] = nodes[0].children as N[];
  assert.equal(inner.type, 'hlist');
  assert.equal(inner.shift, texScale(-FIFTH, SIZE));
  assert.deepEqual((inner.children as N[]).map(k => k.char), [65]);
});

test('push and pop: an accent placed over the letter that follows', { skip: NO_CM }, () => {
  const { nodes } = resolve([69]);
  const kids = nodes[0].children as N[];
  const tenth = texScale(TENTH, SIZE);
  // the acute 0.1 em right, then back to the origin (pop) for the e
  assert.deepEqual(kids.map(k => (k.type === 'kern' ? k.kern : k.char)), [tenth, 0x13, -(tenth + w(cmr, 0x13)), 101]);
});

test('a face that is not virtual is left alone', () => {
  const fonts = new Map([['1', { name: 'cmr10', size_sp: SIZE, filename: 'unknown' }]]);
  const nodes: N[] = [{ type: 'glyph', char: 65, font: 1 }];
  assert.equal(resolveVirtualFonts(fonts, visit => nodes.forEach(visit), files), 0);
  assert.deepEqual(nodes, [{ type: 'glyph', char: 65, font: 1 }]);
});

test('aer10.vf: its local fonts, and é as an acute moved left over e', { skip: NO_AE }, () => {
  const path = kpsewhich('aer10.vf')!;
  const vf = readVf(readFileSync(path));
  assert.deepEqual([...vf.fonts.values()].map(f => f.name), ['cmr10', 'cmmi10', 'cmmi10', 'cmsy10', 'cmu10']);
  const at = SIZE, pieces = files.pieces('aer10', at, 0o351)!;
  assert.deepEqual(pieces.map(p => p.kind === 'char' ? [p.font, p.char, p.y] : null), [['cmr10', 0o23, 0], ['cmr10', 101, 0]]);
  assert.ok(Math.abs(pieces[0].x + 0.02799 * at) < 2, `the acute ${pieces[0].x} sp from the origin`);
  assert.equal(pieces[1].x, 0);
});
