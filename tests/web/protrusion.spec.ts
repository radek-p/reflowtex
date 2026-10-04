// SPDX-License-Identifier: AGPL-3.0-or-later
// Margin protrusion (microtype) when the viewer breaks a paragraph again at
// widths other than the PDF's. Every full line of a justified paragraph ends
// where TeX would put it: at the measure, plus the protrusion of its last
// character (its font's \rpcode × quad / 1000, from the bundle's FontInfo
// codes), and starts at the indent less its first character's \lpcode. The
// expected amounts are worked out here from the codes, independently of the
// breaker's own figures, and compared at several widths for:
//   - live text (host.setText): a slot's word ending in a comma or a full stop
//     hangs by that character's code (it carried none: the word is one node
//     with a text, no character, so its font's codes were never looked up;
//     and the bundle recorded codes only for the characters the document had
//     used in that font);
//   - a line with an \hfill that ends inside a citation ("… \hfill [Gaj+20,"):
//     the fill took the line's whole slack and left the comma at the measure,
//     where TeX's line keeps its right margin kern and the comma hangs; and a
//     line whose natural width was over the measure only by what hangs was
//     taken for overfull, its fill given nothing;
//   - punctuation after inline maths, and a theorem's lines (italic text, a
//     bold head), no different from any other;
//   - a centred line (a figure's caption) is centred on what does not
//     protrude.
import { test, expect, type WebPage } from './fixtures.ts';
import { idle } from './web.ts';

// CSS px (the viewer sets 1 pt in 2 px): 280 to 500 pt
const WIDTHS = [560, 620, 680, 740, 800, 860, 920, 1000];
const BLOCK = '.latex-block[data-nodelist-b64]';

interface Line {
  text: string;          // the line's characters (a live word's text as it is)
  last: string;          // its last character, when the line ends in one
  right: number;         // where its last node ends, pt past the measure
  hang: number;          // what TeX hangs there: rpcode × quad / 1000, pt
  left: number;          // where its first node starts, pt from the indent
  lhang: number;         // lpcode × quad / 1000 of its first character, pt
  slot: boolean;         // ends in a word of live text
  fill: boolean;         // holds an infinite fill (\hfill)
  afterMath: boolean;    // its last character follows a math-off node
  kerns: string;         // the breaker's own left and right protrusion (for the report)
  align: string;         // its paragraph's alignment
  lastOfPara: boolean;   // its paragraph's last line (not justified)
}

/** Every line of block `i`. */
const fullLines = (page: WebPage, i: number) => page.evaluate((i: number) => {
  const ins = reflowtex.inspect, el = ins.blocks().filter((b: Element) => b.matches('[data-nodelist-b64]'))[i];
  const st = ins.state(el), cache = st.cache, pt = ins.spToPx * 65536;
  const fonts = new Map<number, any>();
  (st.doc.fonts || []).forEach((f: any, k: number) => fonts.set(f.id ?? k + 1, f));
  // as LuaTeX finds the character at a line's edge (cp_skipable): past
  // penalties, empty glue, font kerns and math nodes without surround
  const skip = (n: any) => n.type === 'penalty' || (n.type === 'glue' && !n.width && !n.stretch && !n.shrink)
    || (n.type === 'kern' && (!n.kern || !n.subtype)) || (n.type === 'math' && !n.surround);
  const code = (n: any, side: 'lp' | 'rp') => {
    if (!n || n.type !== 'glyph') return 0;
    const f = fonts.get(n.font), chars = [...(n.text ?? String.fromCodePoint(n.char))];
    const ch = (side === 'lp' ? chars[0] : chars[chars.length - 1]).codePointAt(0);
    const c = (f?.codes || []).find((x: any) => x.char === ch);
    return c ? Math.round((f.quad * (c[side] || 0)) / 1000) / 65536 : 0;
  };
  const out: Line[] = [];
  cache.layout.laid.forEach((L: any, s: number) => {
    const seg = cache.layoutCtx.segs[s];
    if (!L || L.deferred || !L.lines || !seg?.items) return;
    L.lines.forEach((ln: any, j: number) => {
      const k = L.itemStarts.findLastIndex((x: number) => x <= j);
      const para = seg.items[k].para;
      const lastOfPara = j === (L.itemStarts[k + 1] ?? L.lines.length) - 1;
      const top = new Set(ln.nodes);
      let first: any = null, last: any = null;
      ins.replay(el, s, {
        node(n: any, x: number, _y: number, adv: number) {
          if (!top.has(n)) return;   // (replay draws every line)
          if (!first && !skip(n) && !(n.type === 'glue')) first = { n, x };
          if (n.type !== 'glue' && n.type !== 'penalty' && adv > 0) last = { n, end: x + adv };
        },
      });
      const ns = ln.nodes;
      let e = ns.length - 1;
      while (e >= 0 && skip(ns[e])) e--;
      const edge = ns[e];
      const indent = (para.indent || 0) / 65536;
      const srcW = cache.sourceWidthSp > 0 && para.width > 0 ? Math.max(0, cache.sourceWidthSp - (para.indent || 0) - para.width) / 65536 : 0;
      const measure = st.lastWidth - srcW;
      const text = ns.map((n: any) => n.type === 'glyph' ? (n.text ?? String.fromCodePoint(n.char)) : n.type === 'glue' ? ' ' : '').join('');
      out.push({
        text,
        last: edge?.type === 'glyph' ? [...(edge.text ?? String.fromCodePoint(edge.char))].pop()! : '',
        right: last.end / pt - measure,
        hang: code(edge, 'rp'),
        left: first.x / pt - indent,
        lhang: code(first.n, 'lp'),
        slot: edge?.type === 'glyph' && edge.text !== undefined,
        fill: ns.some((n: any) => n.type === 'glue' && n.stretch_order > 0 && n.stretch > 0),
        afterMath: e > 0 && ns[e - 1].type === 'math',
        align: para.align || 'justify', lastOfPara,
        kerns: `${((ln.leftProtrusion || 0) / 65536).toFixed(2)}/${((ln.rightProtrusion || 0) / 65536).toFixed(2)}`,
      });
    });
  });
  return out;
}, i);

async function at(page: WebPage, i: number, w: number) {
  await page.locator(BLOCK).nth(i).evaluate((b: HTMLElement, w: number) => { b.style.maxWidth = 'none'; b.style.width = `${w}px`; }, w);
  await idle(page);
  return fullLines(page, i);
}

/** Every full line of a justified paragraph at every width (a paragraph's
 *  last line is not justified): none off its margins by more than 0.05 pt. */
async function check(page: WebPage, i: number) {
  const all: (Line & { w: number })[] = [];
  for (const w of WIDTHS) for (const l of await at(page, i, w)) if (l.align === 'justify' && !l.lastOfPara) all.push({ ...l, w });
  const off = all.filter(l => Math.abs(l.right - l.hang) > 0.05 || Math.abs(l.left + l.lhang) > 0.05)
    .map(l => `${l.w}px «…${l.text.slice(-28)}» ends ${l.right.toFixed(2)} pt past the measure, TeX ${l.hang.toFixed(2)}; starts ${l.left.toFixed(2)}, TeX ${(-l.lhang).toFixed(2)} (breaker ${l.kerns})`);
  expect(off, off.join('\n')).toEqual([]);
  return all;
}

test('live text: a word ending in a comma or a full stop hangs by its code', async ({ openPage }) => {
  const page = await openPage('protrusion');
  await page.evaluate(() => reflowtex.host.setText('cite', '[Gaj+20, Thm.\u00A01.4]'));
  await idle(page);
  const all = await check(page, 0);
  const hung = all.filter(l => l.slot && /[,.]/.test(l.last));
  expect(hung.length, 'no line ended in the live text\'s comma or full stop').toBeGreaterThanOrEqual(2);
  for (const l of hung) expect(l.hang, `the font has no code for «${l.last}»`).toBeGreaterThan(0.5);
});

test('live text: the codes come with the font, used in the document or not', async ({ openPage }) => {
  // "!" and "?" appear nowhere in the document's own text: the bundle
  // recorded codes only for the characters a font was used for, but a page
  // may give a slot any text in its font (src/extract/serializer.lua)
  const page = await openPage('protrusion');
  const codes = await page.evaluate(() => {
    const st = reflowtex.inspect.state(reflowtex.inspect.blocks()[0]);
    const g = st.doc.paragraphs.flatMap((p: any) => p.nodes).find((n: any) => n.slot && n.type === 'glyph');
    const f = st.doc.fonts.find((f: any, k: number) => (f.id ?? k + 1) === g.font);
    return [33, 63].map(c => (f.codes || []).find((x: any) => x.char === c)?.rp ?? 0);
  });
  expect(codes[0], 'no \\rpcode for "!" in the slot\'s font').toBeGreaterThan(0);
  expect(codes[1], 'no \\rpcode for "?" in the slot\'s font').toBeGreaterThan(0);
  await page.evaluate(() => reflowtex.host.setText('cite', 'one! two? three!'));
  await idle(page);
  const all = await check(page, 0);
  expect(all.filter(l => l.slot && /[!?]/.test(l.last) && l.hang > 0.1).length).toBeGreaterThanOrEqual(1);
});

test('a line filled by \\hfill keeps its right margin kern', async ({ openPage }) => {
  const page = await openPage('protrusion');
  const all = await check(page, 1);
  expect(all.filter(l => l.fill && l.last === ',' && l.hang > 0.5).length,
    'no filled line ended in a citation\'s comma').toBeGreaterThanOrEqual(1);
});

test('punctuation after inline maths hangs', async ({ openPage }) => {
  const page = await openPage('protrusion');
  const all = await check(page, 2);
  expect(all.filter(l => l.afterMath && /[,.]/.test(l.last)).length,
    'no line ended in punctuation right after maths').toBeGreaterThanOrEqual(1);
});

test('a theorem\'s lines end at the margin', async ({ openPage }) => {
  const page = await openPage('protrusion');
  const all = await check(page, 3);
  expect(all.length).toBeGreaterThan(20);
  expect(all.filter(l => l.hang > 0.5).length, 'no theorem line ended in punctuation that hangs').toBeGreaterThanOrEqual(1);
});

test('a centred line is centred on what does not protrude', async ({ openPage }) => {
  // TeX packs a centred line with its margin kerns: the space left and right
  // of the line, less its protruding characters, is the same. (A figure's
  // caption is a centred paragraph: src/extract/template.tex.)
  const page = await openPage('protrusion');
  const all: (Line & { w: number })[] = [];
  for (const w of WIDTHS) for (const l of await at(page, 4, w)) if (l.align === 'center' && l.text.length > 20) all.push({ ...l, w });
  expect(all.length).toBeGreaterThan(8);
  const off = all.filter(l => Math.abs((l.left + l.lhang) - (l.hang - l.right)) > 0.05)
    .map(l => `${l.w}px «…${l.text.slice(-28)}» ${(l.left + l.lhang).toFixed(2)} pt on the left, ${(l.hang - l.right).toFixed(2)} on the right (breaker ${l.kerns})`);
  expect(off, off.join('\n')).toEqual([]);
  expect(all.filter(l => l.hang > 0.5).length, 'no centred line ended in punctuation that hangs').toBeGreaterThanOrEqual(1);
});
