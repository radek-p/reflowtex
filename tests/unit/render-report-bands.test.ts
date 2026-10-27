// SPDX-License-Identifier: AGPL-3.0-or-later
// The render report's bands (tests/render/report/bands.ts): a long strip.svg
// and its boxes, cut across so that the page draws only what is near the view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND_PT, bandsIn, cutStrip, indexBoxes } from '../../tests/render/report/bands.ts';

/** A strip as MuPDF draws one: a viewBox in bp, its size 2 px per TeX pt,
 *  glyph outlines and clip paths in <defs>, glyphs as <use>s with the y axis
 *  flipped, inside clipped groups. */
const BP = 72 / 72.27;
function strip(body: string, heightPt = 2000): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${(400 * 2).toFixed(3)}" height="${(heightPt * 2).toFixed(3)}" viewBox="0 0 ${400 * BP} ${heightPt * BP}">
<defs>
<clipPath id="clip_1">
<path transform="matrix(1,0,0,-1,0,${heightPt * BP})" d="M0 0H${400 * BP}V${heightPt * BP}H0Z"/>
</clipPath>
<path id="font_1_1" d="M.1 0 .5 0 .5 .7 .1 .7Z"/>
</defs>
<g clip-path="url(#clip_1)">
${body}
</g>
</svg>`;
}
/** A glyph whose baseline is at y (TeX pt from the top). */
const glyph = (x: number, yPt: number, text = 'a') =>
  `<use data-text="${text}" xlink:href="#font_1_1" transform="matrix(9.96264,0,0,-9.96264,${x},${yPt * BP})"/>`;

test('a strip is cut into bands by where its elements are, each drawn once, inside its groups', () => {
  const ys = [10, 480, 499, 501, 990, 1510];
  const s = cutStrip(strip(ys.map((y, i) => glyph(50, y, String.fromCharCode(97 + i))).join('\n')))!;
  assert.deepEqual(s.size, [400, 2000]);
  assert.equal(s.viewBox, `0 0 ${400 * BP} ${2000 * BP}`);
  // the definitions, once, apart
  assert.match(s.defs, /<clipPath id="clip_1">\s*<path [^>]*\/>\s*<\/clipPath>/);
  assert.match(s.defs, /<path id="font_1_1"/);
  assert.doesNotMatch(s.defs, /<use/);
  // each glyph in the band its top is in (a glyph reaches 0.7 em above its baseline, and the room for a stroke)
  const band = (t: string) => s.bands.findIndex(b => b.includes(`data-text="${t}"`));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map(band), [0, 0, 0, 0, 1, 3]);
  assert.equal(s.bands.join('').match(/<use /g)!.length, ys.length, 'each glyph drawn once');
  assert.equal(s.bands[2], '', 'a band with nothing in it');
  for (const b of s.bands.filter(Boolean)) assert.match(b, /^<g clip-path="url\(#clip_1\)">[\s\S]*<\/g>$/, 'inside its group');
  // how far down each band reaches: past its own end where a glyph does
  assert.ok(s.bottom[0] > 501 && s.bottom[0] < BAND_PT + 10, `band 0 reaches ${s.bottom[0]}`);
  assert.deepEqual(bandsIn(s.bottom, 502, 520), [0, 1]);
  assert.deepEqual(bandsIn(s.bottom, 1200, 1300), []);
  assert.deepEqual(bandsIn(s.bottom, 1400, 1600), [3]);
});

test('what has no place that can be told is drawn with every band', () => {
  const s = cutStrip(strip(`${glyph(50, 100)}
<path transform="matrix(1,0,0,-1,10,${1200 * BP})" d="M0 0l10 10" stroke="#000"/>
<text x="5" y="7">x</text>
<image width="10" height="20" transform="matrix(1,0,0,1,0,${1700 * BP})" xlink:href="data:image/png;base64,AAAA"/>`))!;
  assert.match(s.always, /d="M0 0l10 10"/, 'a relative path');
  assert.match(s.always, /<text x="5" y="7">x<\/text>/, 'text, taken whole');
  assert.match(s.bands[3], /<image /, 'an image, by its box');
  assert.match(s.bands[0], /<use /);
});

test('boxes are indexed by band, the selected one found by its item', () => {
  const ix = indexBoxes([{ x: 0, y: 10, w: 5, h: 8 }, undefined, { x: 0, y: 503, w: 5, h: 8 }, { x: 0, y: 1203, w: 5, h: 300 }]);
  assert.deepEqual(ix.bands, [[0], [2], [3]]);
  assert.deepEqual([...ix.bandOf], [0, -1, 1, 2]);
  assert.ok(ix.bottom[2] > 1500, 'a tall box reaches into the next band');
  assert.deepEqual(bandsIn(ix.bottom, 1550, 1600), []);
  assert.deepEqual(bandsIn(ix.bottom, 1450, 1600), [2]);
});

test('not an SVG with a size: nothing', () => {
  assert.equal(cutStrip('<html></html>'), null);
  assert.equal(cutStrip('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), null);
});
