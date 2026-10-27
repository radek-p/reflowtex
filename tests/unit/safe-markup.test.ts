// SPDX-License-Identifier: AGPL-3.0-or-later
// src/viewer/src/engine/safe.ts: a link's address keeps to a few schemes, and a
// picture's SVG markup loses what could run in the page – also when it is
// written the way the HTML parser still reads (unquoted values, '/' between
// attributes, entities, comments), since the viewer inserts it with that parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSvgMarkup, droppedAttribute, safeUrl } from '../../src/viewer/src/engine/safe.ts';
import { rewritePictureSvg } from '../../src/pipeline/pictures.ts';

test('safeUrl: web, mail and relative addresses kept; javascript:, data:, vbscript: not', () => {
  for (const u of ['https://example.org/a?b#c', 'http://x', 'mailto:a@b.c', 'tel:+48123', '#eq:basel', 'paper.pdf', '../a/b.html', '//cdn.example/x'])
    assert.equal(safeUrl(u), u, u);
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x',
    '\u0001javascript:x', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'blob:https://x/y'])
    assert.equal(safeUrl(u), null, JSON.stringify(u));
  assert.equal(safeUrl('data:image/png;base64,AAAA'), null, 'a link is never a data: address');
  assert.equal(safeUrl('data:image/png;base64,AAAA', { image: true }), 'data:image/png;base64,AAAA');
  assert.equal(safeUrl('data:text/html;base64,AAAA', { image: true }), null);
});

test('droppedAttribute: handlers and foreign addresses go, the rest stays', () => {
  assert.equal(droppedAttribute('onload', 'x', 'svg'), true);
  assert.equal(droppedAttribute('ONERROR', 'x', 'image'), true);
  assert.equal(droppedAttribute('xlink:href', '#g1-2', 'use'), false);
  assert.equal(droppedAttribute('href', 'javascript:alert(1)', 'a'), true);
  assert.equal(droppedAttribute('href', 'data:image/png;base64,AA', 'image'), false);
  assert.equal(droppedAttribute('href', 'data:image/png;base64,AA', 'use'), true);
  assert.equal(droppedAttribute('href', null, 'a'), true, 'an address that could not be decoded');
  assert.equal(droppedAttribute('fill', 'red', 'path'), false);
});

const runs = (s: string) => /<script|foreignobject|\son[a-z]+\s*=|[\s/]on[a-z]+=|javascript|&colon;/i.test(s);

test('cleanSvgMarkup: what SVG writers write comes back byte for byte', () => {
  const svg = "<defs><path id='g1-49' d='M1 2L3 4Z'/><clipPath id='cp0'><path d='M0 0H9V9H0Z'/></clipPath></defs>"
    + "<g clip-path='url(#cp0)'><use x='1' y='2' xlink:href='#g1-49'/><path d='M0 0L1 1' stroke='#f00' fill='none'/></g>"
    + "<image width='4' height='3' href='data:image/png;base64,iVBORw0KGgo='/><text x='1'>a &lt; b &amp; c</text>";
  assert.equal(cleanSvgMarkup(svg), svg);
  // MuPDF's: double quotes, glyphs with their text, masks, images with line breaks in their data
  const mu = '<defs>\n<g id="font_1_97">\n<mask id="mask_2">\n<image id="image_3" width="8" height="8" xlink:href="data:image/png;base64,\niVBORw0KGgo="/>\n</mask>\n'
    + '<rect x="0" y="0" width="8" height="8" transform="matrix(.125,0,0,-.125,0,1)" mask="url(#mask_2)"/>\n</g>\n</defs>\n'
    + '<use data-text="&#x03a9;" xlink:href="#font_1_97" transform="matrix(16,0,0,-16,20,80)" fill="#ff0000"/>';
  assert.equal(cleanSvgMarkup(mu), mu);
});

test('cleanSvgMarkup: scripts, HTML islands, handlers and javascript: addresses go', () => {
  const cases: [string, string][] = [
    ["<g><script>alert(1)</script><path d='M0 0'/></g>", "<g><path d='M0 0'/></g>"],
    ["<SCRIPT xlink:href='x.js'/><path/>", '<path/>'],
    ["<foreignObject><div><img src=x onerror=alert(1)></div></foreignObject><rect/>", '<rect/>'],
    ["<image href='x' onerror='alert(1)'/>", "<image href='x'/>"],
    ['<image href=x onerror=alert(1)>', '<image href=x>'],
    ['<svg/onload=alert(1)>', '<svg>'],
    ["<a href='javascript:alert(1)'><text>t</text></a>", '<a><text>t</text></a>'],
    ["<a href='&#106;avascript:alert(1)'>t</a>", '<a>t</a>'],
    ["<a href='javascript&colon;alert(1)'>t</a>", '<a>t</a>'],
    ["<a xlink:href=' JAVA\tSCRIPT:alert(1)'>t</a>", '<a>t</a>'],
    ["<set attributeName='href' to='javascript:alert(1)'/><g/>", '<g/>'],
    ["<animate attributeName='xlink:href' values='javascript:alert(1)'></animate>x", 'x'],
    ["<animate attributeName='opacity' values='0;1' dur='1s'/>", "<animate attributeName='opacity' values='0;1' dur='1s'/>"],
    ['<!--><img src=x onerror=alert(1)>-->', '<img src=x>-->'],
    ['<!-- a --><path/>', '<path/>'],
    ['<<!-- -->script>alert(1)</script>', '&lt;script>alert(1)'],
    ["<style><!--</style><img src=x onerror=alert(1)>--><path/>", '<style><path/>'],
    ['<path d="M0 0"', ''],
    ['<img src=x/onerror=alert(1)>', '<img src=x/onerror=alert(1)>'],
  ];
  for (const [given, want] of cases) assert.equal(cleanSvgMarkup(given), want, given);
  for (const [given] of cases) {
    const out = cleanSvgMarkup(given);
    if (!/^<img src=x\/onerror/.test(out)) assert.equal(runs(out), false, `${given} -> ${out}`);
  }
});

test('rewritePictureSvg: a raw SVG special that would run is taken out where the picture is made', () => {
  const svg = "<svg version='1.1' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'>"
    + "<g id='x'><path d='M0 0' fill='#000'/></g><image href='x' onerror='window.__ran=1'/>"
    + "<a href='javascript:window.__ran=1'><text>t</text></a><script>window.__ran=1</script></svg>";
  const pic = rewritePictureSvg(svg, 'p1-');
  assert.equal(runs(pic.svg), false, pic.svg);
  assert.match(pic.svg, /<g id='p1-x'>/, 'the rest is rewritten as before');
  assert.match(pic.svg, /<a><text>t<\/text><\/a>/);
});
