// SPDX-License-Identifier: AGPL-3.0-or-later
// Colours drawn exactly: the viewer's colour maps (src/viewer/src/runtime/
// colour-css.ts) set nothing in the theme `default`, so a block with no map draws
// TeX's black as #000000; and the measurement compares colours exactly
// (tools/pageless-pdf/vector-compare.ts, tests/render/render.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ColorSpace } from 'mupdf';
import { problems, type Vector } from '../../tests/render/render.ts';
import { hexOf, pdfColour, sameColour, texColour } from '../../tools/pageless-pdf/vector-compare.ts';
import { colorFill, colorMapCss, mapThemes } from '../../src/viewer/src/runtime/colour-css.ts';

const css = (maps: Parameters<typeof colorMapCss>[0]) => colorMapCss(maps, s => s);

/** The rules of a stylesheet: [selector, declarations]. */
const rules = (css: string): [string, string][] => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => [m[1].trim(), m[2]]);

test('a block with no map: TeX black is #000000, set by no rule outside a theme', () => {
  const sheet = css({});
  assert.equal(colorFill('#000000'), 'var(--latex-color-000000, #000000)');
  const text = rules(sheet).find(([sel]) => sel.includes('svg text'))!;
  assert.match(text[1], /fill: var\(--latex-color-000000, #000000\)/);
  assert.doesNotMatch(sheet, /currentColor/, 'nothing falls back to the page text colour');
  // every rule that sets a colour is a theme's: a class on <html> other than
  // default, or a scoped theme (whose default sets each one to initial)
  for (const [sel, body] of rules(sheet)) {
    if (!/--latex-(color-[0-9a-f]{6}|link-(color|hover-color|active-color|underline)):/.test(body)) continue;
    assert.match(sel, /^:root(\.(?!default\b)[\w-]+ | \[data-latex-theme=)/, sel);
    if (sel.includes('"default"')) assert.doesNotMatch(body, /:\s*(?!initial)[^;\s][^;]*;/, `${sel} sets only initial`);
  }
});

test('the built-in map gives light, dark, sepia and contrast, links included; a page map replaces a theme whole', () => {
  const maps = { site: { colors: { dark: { '#0000ff': '#99ccff' } }, links: { dark: { color: '#ff00ff' } } } };
  const sheet = css(maps);
  const at = (sel: string) => rules(sheet).find(([s]) => s === sel)?.[1] ?? '';
  assert.deepEqual(mapThemes(maps), ['default', 'light', 'dark', 'sepia', 'contrast']);
  assert.match(at(':root.light .latex-block'), /--latex-color-000000: #333333;/);
  assert.match(at(':root.light .latex-block'), /--latex-link-underline: hover;/);
  assert.match(at(':root.dark .latex-block'), /--latex-link-color: #9d9bff;/);
  const site = at(':root.dark .latex-block[data-color-map="site"]');
  assert.match(site, /--latex-color-0000ff: #99ccff;/);
  assert.match(site, /--latex-color-000000: initial;/, "the built-in's dark is replaced, not added to");
  assert.match(site, /--latex-link-color: #ff00ff;/);
  assert.match(at(':root.sepia .latex-block[data-color-map="site"]'), /--latex-color-000000: #453a26;/, "a theme the map leaves out is the built-in's");
});

const vector = (first: Vector['colours']['first']): Vector => ({
  hsize_pt: 345, window_pt: 0.7, glyphs: { strip: 1, viewer: 1, matched: 1 }, matched: [{ y: 0, text: 'a', dx: 0, dy: 0 }],
  rules: [], rules_missing: [], colours: { compared: 1, mismatched: first.length, first },
});

test('a colour other than TeX\'s is a problem', () => {
  assert.deepEqual(problems(vector([]), 0.05), []);
  const found = problems(vector([{ y: 3, x: 1, what: 'a', viewer: '#333333', tex: '#000000' }]), 0.05);
  assert.equal(found.length, 1);
  assert.match(found[0], /1 glyphs or rules in a colour other than TeX's: "a" at y 3 in #333333, not #000000/);
});

test("the PDF's colours: gray and RGB exactly, to the nearest 8-bit value; CMYK as a PDF reader draws it", () => {
  const space = (kind: 'gray' | 'rgb' | 'cmyk' | 'lab') => ({ isGray: () => kind === 'gray', isRGB: () => kind === 'rgb',
    isCMYK: () => kind === 'cmyk' }) as unknown as ColorSpace;
  const hex = (...a: Parameters<typeof pdfColour>) => { const c = texColour(pdfColour(...a)); return c && hexOf(c.rgb); };
  assert.equal(hex(space('gray'), [0], 1), '#000000');
  assert.equal(hex(space('gray'), [0.5], 1), '#808080');
  assert.equal(hex(space('rgb'), [0, 0, 1], 1), '#0000ff');
  assert.equal(pdfColour(space('rgb'), [1, 0, 0], 0.5), null, 'not opaque');
  assert.equal(pdfColour(space('lab'), [50, 0, 0], 1), null);
  // CMYK is colour managed: magenta is not #ff00ff on screen, and white stays white
  const magenta = texColour(pdfColour(space('cmyk'), [0, 1, 0, 0], 1))!;
  assert.notEqual(hexOf(magenta.rgb), '#ff00ff');
  assert.equal(hexOf(texColour(pdfColour(space('cmyk'), [0, 0, 0, 0], 1))!.rgb), '#ffffff');
  // 0.7 is 178.5 of 255: either neighbour is it, nothing further
  assert.ok(sameColour('#b2b2b2', [0.7, 0.7, 0.7]) && sameColour('#b3b3b3', [0.7, 0.7, 0.7]));
  assert.ok(!sameColour('#b4b2b2', [0.7, 0.7, 0.7]));
  assert.ok(!sameColour('#333333', [0, 0, 0]));
});
