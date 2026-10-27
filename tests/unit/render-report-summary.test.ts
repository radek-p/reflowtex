// SPDX-License-Identifier: AGPL-3.0-or-later
// The render report's summary (tests/render/report/summary.ts): a test's
// `problems`, as render.ts and other tools write them, read into groups and a
// headline; lines of other shapes kept whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../../tests/render/report/summary.ts';

/** A long document's, with line metrics, steps, and render.ts's verdict. */
const LONG = [
  "lines: 1468 of 1492 browser lines matched to TeX's; 3 step(s); dy at the end 12 pt; 24 browser and 25 TeX lines without a partner",
  "across (each matched line moved onto TeX's baseline): 660 of 56369 glyphs beyond 0.092 pt, worst 0.332 pt",
  'step at browser y 10074.47 (TeX y 10078.47): dy 0 → 4 (+4 pt)  "**OptionA:{a_name}**"',
  'step at browser y 20010.5 (TeX y 20002.5): dy 4 → -8 (-12 pt)  "Proof.\\"Let\\""',
  'jump at browser y 35.06 (TeX y 9.99), before the first line: dy 0 → -25.07 (-25.07 pt)  "Title"',
  'glyphs TeX 57928 / drawn 57928 / matched 47937 (within 0.7 pt); within 0.092 pt: 81.4 %',
  "9991 of the browser's glyphs have no glyph in the PDF within 0.7 pt",
  '807 glyphs off by more than 0.092 pt: "t" at y 2411.75 off by (+0.700, +0.001), "," at y 3000 off by (-0.100, +0.200)',
  '666 rules drawn by the browser are not in the PDF',
  '666 rules in the PDF the browser did not draw (0 allowed): at y 2290.83, at y 2297.49',
  '17 rules off by more than 0.007 pt: at y 10288.9 (corners 0.038 off; centre +0.038, -0.002)',
  'something new a tool says',
];

test('a long list: grouped, its steps and places read, a headline of three', () => {
  const s = summarise(LONG);
  assert.deepEqual(s.groups.map(g => g.key), ['lines', 'glyphs', 'rules', 'other']);
  const [lines, glyphs, rules, other] = s.groups;
  assert.equal(lines.facts.length, 1);
  assert.deepEqual(lines.steps.map(x => [x.y, x.texY, x.change, x.quote, x.first]),
    [[10074.47, 10078.47, 4, '**OptionA:{a_name}**', false], [20010.5, 20002.5, -12, 'Proof."Let"', false], [35.06, 9.99, -25.07, 'Title', true]]);
  assert.equal(glyphs.facts.length, 4);
  const off = glyphs.facts.find(f => f.head.startsWith('807'))!;
  assert.equal(off.head, '807 glyphs off by more than 0.092 pt');
  assert.deepEqual(off.places, [{ y: 2411.75, label: '"t" +0.700, +0.001' }, { y: 3000, label: '"," -0.100, +0.200' }]);
  assert.deepEqual(rules.facts.map(f => f.places.map(p => p.y)), [[], [2290.83, 2297.49], [10288.9]]);
  assert.deepEqual(other.facts.map(f => f.text), ['something new a tool says']);
  assert.deepEqual(s.headline, ['1468 of 1492 lines matched, 3 step(s)', '81.4 % of glyphs within 0.092 pt', '666 rules not drawn (0 allowed)']);
});

test('lines of other shapes, or known ones whose places do not read, are kept whole', () => {
  const s = summarise(['the PDF has no glyphs', '3 glyphs off by more than 0.05 pt: (cut short', 'stopped at site after 12 s: Error\n  more']);
  assert.deepEqual(s.groups.map(g => [g.key, g.facts.map(f => [f.head, f.places.length])]),
    [['glyphs', [['the PDF has no glyphs', 0], ['3 glyphs off by more than 0.05 pt: (cut short', 0]]],
     ['other', [['stopped at site after 12 s: Error\n  more', 0]]]]);
  assert.deepEqual(s.headline, ['the PDF has no glyphs']);
  assert.deepEqual(summarise([]), { groups: [], headline: [] });
});
