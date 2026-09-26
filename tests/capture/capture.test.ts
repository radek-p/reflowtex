// SPDX-License-Identifier: AGPL-3.0-or-later
// The capture tests (README.md): small documents compiled by the pipeline,
// and what the serializer (src/extract/serializer.lua) recorded of them
// checked in output.json – a glyph's colour, where a link points, what
// reaches the content stream at all, which neither the render tests nor the
// web tests look at. TeX only, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pipeline, contentKey } from '../../src/pipeline/pipeline.ts';

type Node = { type: string; char?: number; color?: string; link?: number; stream?: number; mathml?: unknown;
              width?: number; children?: Node[]; replace?: Node[]; pre?: Node[]; post?: Node[] };
type Item = { kind: string; para?: number; box?: Node; mathml?: unknown };
type Output = { fonts: Record<string, unknown>; paragraphs: { nodes: Node[] }[]; content: Item[];
                links: { label?: string; url?: string }[]; anchors: string[]; slots: unknown[];
                source_width: number };

const root = mkdtempSync(join(tmpdir(), 'reflowtex-capture-'));
const pipe = new Pipeline({ buildRoot: join(root, 'build'), fontsDir: join(root, 'fonts'), log: () => {} });

/** A snippet's output.json, as the pipeline leaves it; compiled once per run.
 *  LuaTeX reports an error inside a callback as a warning and goes on without
 *  what the callback would have captured: that fails here. */
async function capture(body: string, preamble = '', passes = 1): Promise<Output> {
  const key = contentKey(body, preamble);
  const dir = join(pipe.buildRoot, key);
  if (!existsSync(join(dir, 'output.json'))) await pipe.compile(body, preamble, { key, passes, name: key });
  const log = readFileSync(join(dir, 'input.log'), 'utf8');
  const errors = log.split('\n').filter(l => (l.includes('error:') && l.includes('filter')) || l.includes('serializer.lua:'));
  assert.deepEqual(errors, [], 'Lua errors in the serializer');
  return JSON.parse(readFileSync(join(dir, 'output.json'), 'utf8'));
}

/** Every node, depth first, in document order (all child lists). */
function* walk(nodes: Node[] | undefined): Generator<Node> {
  for (const n of nodes ?? []) {
    yield n;
    for (const k of ['children', 'pre', 'post', 'replace'] as const) yield* walk(n[k]);
  }
}

/** The nodes as the text reads unbroken: a discretionary's replacement, not
 *  its pre- and post-break parts (the hyphen). */
function* textNodes(nodes: Node[] | undefined): Generator<Node> {
  for (const n of nodes ?? []) {
    yield n;
    yield* textNodes(n.children);
    yield* textNodes(n.replace);
  }
}

/** [text, value of `field`] for each run of consecutive glyphs sharing it. */
function glyphRuns(nodes: Node[], field: 'color' | 'link'): [string, unknown][] {
  const runs: [string, unknown][] = [];
  for (const n of textNodes(nodes)) {
    if (n.type !== 'glyph') continue;
    const ch = String.fromCodePoint(n.char!), v = n[field];
    if (runs.length && runs[runs.length - 1][1] === v) runs[runs.length - 1][0] += ch;
    else runs.push([ch, v]);
  }
  return runs;
}

const paragraphRuns = (d: Output, field: 'color' | 'link') => d.paragraphs.map(p => glyphRuns(p.nodes, field));
const linkedRuns = (d: Output) => paragraphRuns(d, 'link').flat()
  .filter(([, l]) => l).map(([t, l]) => [t, d.links[(l as number) - 1]] as const);
const glyphText = (nodes: Node[]) => [...textNodes(nodes)].filter(n => n.type === 'glyph').map(n => String.fromCodePoint(n.char!)).join('');

const COLOUR = '\\usepackage{xcolor}\n\\usepackage{transparent}';
const HYPER = '\\usepackage{hyperref}';

// ── output.json's shapes ────────────────────────────────────────────────────

test('id-keyed tables are lists, fonts a map', async () => {
  const d = await capture('See~\\ref{s}. \\section{One}\\label{s} Text.', '', 2);
  assert.ok(d.fonts && typeof d.fonts === 'object' && !Array.isArray(d.fonts) && Object.keys(d.fonts).length);
  for (const name of ['links', 'anchors', 'slots'] as const) assert.ok(Array.isArray(d[name]), name);
  assert.ok(d.links.some(l => l.label === 's'));
  assert.ok(d.anchors.includes('s'));
});

// ── colour ──────────────────────────────────────────────────────────────────

test('transparency does not reset the colour', async () => {
  // `transparent` keeps its own colour stack; its push is not a colour. (It
  // emits nothing until its resources come back through the .aux.)
  const d = await capture('A {\\color{red} rrr {\\transparent{0.5} hhh} sss} kkk.', COLOUR, 2);
  assert.deepEqual(paragraphRuns(d, 'color'), [[['A', undefined], ['rrrhhhsss', '#ff0000'], ['kkk.', undefined]]]);
});

test('colour set between paragraphs', async () => {
  const d = await capture([
    '\\color{blue}', 'Vvv.', '',
    '\\color{black}', 'Bbb.', '',
    '\\begin{minipage}{5cm}\\color{red} Mmm.\\end{minipage} Aaa.', '',
    '\\begin{center}\\color{teal}', 'Ccc.', '\\end{center}', 'Ppp.',
  ].join('\n'), COLOUR);
  assert.deepEqual(paragraphRuns(d, 'color'), [
    [['Vvv.', '#0000ff']],
    [['Bbb.', undefined]],
    [['Mmm.', '#ff0000'], ['Aaa.', undefined]],
    [['Ccc.', '#008080']],
    [['Ppp.', undefined]],
  ]);
});

test('a box used twice keeps its colour', async () => {
  // LIPIcs sets its author icons once and uses them again: every copy of a
  // box carries its colour changes with it.
  const d = await capture('\\newsavebox\\icon\\sbox\\icon{\\textcolor{gray}{X}}\nA \\usebox\\icon{} and \\usebox\\icon{} b.', COLOUR);
  assert.deepEqual(paragraphRuns(d, 'color'), [
    [['A', undefined], ['X', '#808080'], ['and', undefined], ['X', '#808080'], ['b.', undefined]]]);
});

// ── nothing dropped ─────────────────────────────────────────────────────────

test('a rule and a box in vertical mode are kept', async () => {
  const d = await capture(['Before.', '\\hrule', 'After.', '', '\\hbox{Boxed words.}', '',
                           '\\noindent\\rule{\\textwidth}{0.4pt}', '', 'End.'].join('\n'));
  assert.deepEqual(d.content.filter(it => it.kind !== 'vspace').map(it => it.kind),
                   ['paragraph', 'display', 'paragraph', 'display', 'paragraph', 'paragraph']);
  const displays = d.content.filter(it => it.kind === 'display');
  const rule = displays[0].box!.children![0].children![0];     // the \hrule, as wide as the text
  assert.equal(rule.type, 'rule');
  assert.equal(rule.width, d.source_width);
  assert.equal(glyphText(displays[1].box!.children!), 'Boxedwords.');   // the \hbox, with its words
  // the paragraph that holds only a rule (in the \hbox \rule sets) is kept
  assert.ok(d.paragraphs.some(p => [...walk(p.nodes)].some(n => n.type === 'rule')));
});

test('an empty box in vertical mode adds nothing', async () => {
  const d = await capture('A.\n\n\\hbox{}\n\nB.');
  assert.deepEqual(d.content.filter(it => it.kind !== 'vspace').map(it => it.kind), ['paragraph', 'paragraph']);
});

test('multicols text is not kept twice', async () => {
  // multicol's output routine puts the balanced columns back on the main
  // list as one box, after their lines went past as ordinary lines.
  const d = await capture('\\begin{multicols}{2}Alpha beta gamma delta. Epsilon zeta eta theta.\\end{multicols}',
                          '\\usepackage{multicol}');
  const inParagraphs = d.content.filter(it => it.kind === 'paragraph')
    .map(it => glyphText(d.paragraphs[it.para! - 1].nodes)).join('');
  const inBoxes = d.content.filter(it => it.kind === 'display').map(it => glyphText([it.box!])).join('');
  assert.equal((inParagraphs + inBoxes).split('Alpha').length - 1, 1);
});

test('rotated text is captured', async () => {
  const d = await capture('Before \\rotatebox{30}{turned} after.', '\\usepackage{graphicx}');
  assert.deepEqual(paragraphRuns(d, 'link'), [[['Beforeturnedafter.', undefined]]]);
  assert.ok(d.paragraphs.some(p => [...walk(p.nodes)].some(n => n.type === 'transform')));
});

// ── links hyperref makes ────────────────────────────────────────────────────

const LINKED = [
  '\\section{Intro}\\label{sec:intro}',
  'See \\cite{knuth}, section~\\ref{sec:intro}, \\hyperref[sec:two]{the second}',
  'and \\hyperlink{tgt}{a target}.\\footnote{A note.}',
  '\\section{Two}\\label{sec:two}',
  '\\hypertarget{tgt}{Here} it is.',
  '\\begin{thebibliography}{9}',
  '\\bibitem{knuth} D. Knuth. The TeXbook.',
  '\\end{thebibliography}',
].join('\n');

test('hyperref links are captured', async () => {
  const runs = linkedRuns(await capture(LINKED, HYPER, 2));
  assert.deepEqual(runs.filter(([t]) => ['1', 'thesecond', 'atarget'].includes(t)), [
    ['1', { label: 'cite.knuth' }],          // \cite
    ['1', { label: 'sec:intro' }],           // \ref (template.tex)
    ['thesecond', { label: 'sec:two' }],     // \hyperref[label]{…}
    ['atarget', { label: 'tgt' }],           // \hyperlink
  ]);
});

test('hyperref destinations become anchors only where needed', async () => {
  const d = await capture(LINKED, HYPER, 2);
  assert.ok(d.anchors.includes('cite.knuth') && d.anchors.includes('tgt'));
  // a destination the .aux names by an author's label is that label's, once
  assert.equal(d.anchors.filter(a => a === 'sec:two').length, 1);
  assert.ok(!d.anchors.includes('section.2'));
  // nothing links to these
  assert.ok(!d.anchors.includes('Doc-Start') && !d.anchors.includes('section.1'));
  // every link to a label has somewhere to go
  for (const l of d.links) if (l.label) assert.ok(d.anchors.includes(l.label), l.label);
});

test('a footnote mark is not a link', async () => {
  const d = await capture(LINKED, HYPER, 2);
  for (const p of d.paragraphs)
    for (const n of walk(p.nodes)) if (n.type === 'glyph' && n.stream !== undefined) assert.ok(!n.link);
});

test('links to pages and to nowhere are left as text', async () => {
  const d = await capture([
    'Go to \\hyperlink{page.1}{the first page} or \\hyperlink{nowhere}{nowhere},',
    'or \\hyperlink{here}{here}. \\hypertarget{here}{Here.}',
  ].join('\n'), HYPER, 2);
  assert.deepEqual(linkedRuns(d).map(([, l]) => l), [{ label: 'here' }]);
});

// ── The companion package (reflowtex.sty) ────────────────────────────────────

type Attrs = { key: string; value: string }[];
type Stream = { kind: string; attrs: Attrs; text?: string };
const attrsOf = (a: Attrs) => Object.fromEntries(a.map(x => [x.key, x.value]));
const pkg = '\\usepackage{reflowtex}';

test('a widget records its parameters; the first form none', async () => {
  const out: any = await capture('A \\webwidget[tone=warm, default=x]{badge} and \\webwidget{lean:foo} here.', pkg);
  assert.deepEqual(out.slots.map((s: any) => [s.kind, s.name, attrsOf(s.attrs ?? [])]),
    [['widget', 'badge', { tone: 'warm' }], ['widget', 'lean:foo', {}]]);
});

test('an empty parameter list is a list', async () => {
  // Lua writes an unmarked empty table as it guesses; the attrs are a list.
  const out: any = await capture('\\begin{webstream}{plain}Text.\\end{webstream}', pkg);
  assert.ok(Array.isArray(out.streams[0].attrs), JSON.stringify(out.streams[0].attrs));
});

test('a part names its owner', async () => {
  const out: any = await capture('Some \\webwidget{popover}\\webpart{label}{more} text.\n\n'
    + '\\begin{webstream}{box}\\webpart{summary}{In short.}\n\nLong.\\end{webstream}', pkg);
  const parts = (out.streams as Stream[]).filter(s => attrsOf(s.attrs)['rtx-part'])
    .map(s => [s.kind, attrsOf(s.attrs)['rtx-part'], attrsOf(s.attrs)['rtx-owner']]);
  const box = (out.streams as Stream[]).findIndex(s => s.kind === 'box') + 1;
  assert.deepEqual(parts, [['label', 'label', 'w1'], ['summary', 'summary', `s${box}`]]);
});

test('marks: ids and classes, nested', async () => {
  const out: any = await capture('\\webid{first}{Ab} \\webclass{hot}{c\\webid{inner}{d}}.', pkg);
  // (the classes joined by one space, with none before the first)
  assert.deepEqual(out.marks, [{ id: 'first', classes: '' }, { id: '', classes: 'hot' }, { id: 'inner', classes: 'hot' }]);
  const glyphs = [...walk(out.paragraphs[0].nodes)].filter((n: any) => n.type === 'glyph')
    .map((n: any) => [String.fromCodePoint(n.char), n.mark ?? 0]);
  assert.deepEqual(glyphs.slice(0, 4), [['A', 1], ['b', 1], ['c', 2], ['d', 3]]);
});

test('NewWebEnvironment passes its parameters as written', async () => {
  const out: any = await capture('\\begin{warn}[variant=card, --rtx-accent=#c2410c]Careful.\\end{warn}',
    pkg + '\n\\NewWebEnvironment{warn}{warning}{}{}');
  const s = (out.streams as Stream[]).find(s => s.kind === 'warning')!;
  assert.deepEqual(attrsOf(s.attrs), { variant: 'card', '--rtx-accent': '#c2410c' });
});

test('Lean: the parts are marked, decl and url on the widget', async () => {
  const out: any = await capture('\\begin{leanproof}[decl=foo, url=https://example.org/a#b]\n'
    + '\\begin{proof}Trivial.\\end{proof}\n\\begin{leancode}\nexample : 1 = 1 := rfl\n\\end{leancode}\n\\end{leanproof}',
    '\\usepackage{amsthm}\n' + pkg);
  const streams = out.streams as Stream[];
  const lp = streams.find(s => s.kind === 'leanproof')!;
  assert.equal(attrsOf(lp.attrs).decl, 'foo');
  assert.equal(attrsOf(lp.attrs).url, 'https://example.org/a#b');
  const roles = streams.filter(s => attrsOf(s.attrs)['rtx-part']).map(s => attrsOf(s.attrs)['rtx-part']);
  assert.deepEqual(roles.sort(), ['code', 'tex']);
  assert.match(streams.find(s => attrsOf(s.attrs)['rtx-part'] === 'code')!.text!, /example : 1 = 1 := rfl/);
});

// ── MathML ──────────────────────────────────────────────────────────────────
// Every formula a reader meets carries MathML (src/extract/mathml.lua records
// luamml's conversion of TeX's own math lists; src/pipeline/mathml.ts makes
// the strings): the begin-math node of each inline formula, each display
// item – an alignment's first row for all its rows. Typesetting is untouched.

const noMathml = new Pipeline({ buildRoot: join(root, 'build-nomathml'), fontsDir: join(root, 'fonts'), log: () => {}, mathml: false });

/** The same document compiled with the MathML capture switched off. */
async function captureWithoutMathml(body: string, preamble = '', passes = 1): Promise<Output> {
  const key = contentKey(body, preamble);
  const dir = join(noMathml.buildRoot, key);
  if (!existsSync(join(dir, 'output.json'))) await noMathml.compile(body, preamble, { key, passes, name: key });
  return JSON.parse(readFileSync(join(dir, 'output.json'), 'utf8'));
}

const NS = ' xmlns="http://www.w3.org/1998/Math/MathML"';
/** The MathML of each top-level inline formula, paragraph by paragraph. */
const inlineMathml = (d: Output) => d.paragraphs.map(p =>
  [...walk(p.nodes)].filter(n => n.type === 'math' && n.mathml !== undefined).map(n => String(n.mathml).replaceAll(NS, '')));
const displayMathml = (d: Output) => d.content.filter(i => i.kind === 'display').map(i => i.mathml === undefined ? undefined : String(i.mathml).replaceAll(NS, ''));

const FORMULAS = [
  'Inline $x^2+y^2=z^2$, $\\alpha_i \\le \\sum_{k=1}^n k$, $f\\colon \\mathbb{R}\\to\\mathbb{R}$,',
  '$\\Phi_0(z)$ and $x \\in \\text{the set $S$}$ and $\\binom{n}{k}$.',
  '\\[ \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2} \\]',
  '\\begin{equation}\\label{eq:a} a = \\left( \\frac{1}{2} \\right)^{n} \\end{equation}',
  'See \\eqref{eq:a}.',
  '\\begin{align}',
  '  f(x) &= \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases} \\\\',
  '  g(x) &= \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\nonumber',
  '\\end{align}',
  '\\begin{gather*} \\lim_{n\\to\\infty} \\Bigl(1+\\frac1n\\Bigr)^n = e \\end{gather*}',
].join('\n');

/** Drops what MathML adds, for comparing with a build without it. */
function withoutMathml(d: Output): unknown {
  return JSON.parse(JSON.stringify(d, (k, v) => (k === 'mathml' || k === 'mathml_box' || k === 'display_no') ? undefined : v));
}

test('MathML: typesetting is untouched', async () => {
  const [a, b] = await Promise.all([capture(FORMULAS, '', 2), captureWithoutMathml(FORMULAS, '', 2)]);
  assert.deepEqual(withoutMathml(a), withoutMathml(b));
});

test('MathML: every inline formula, and nothing nested twice', async () => {
  const d = await capture(FORMULAS, '', 2);
  const [first] = inlineMathml(d);
  const see = d.paragraphs.find(p => glyphText(p.nodes).startsWith('See'))!;
  assert.equal(first.length, 6);
  assert.equal(first[0], '<math><msup><mi>𝑥</mi><mn>2</mn></msup><mo>+</mo><msup><mi>𝑦</mi><mn>2</mn></msup><mo>=</mo><msup><mi>𝑧</mi><mn>2</mn></msup></math>');
  assert.match(first[2], /<mi mathvariant="normal">ℝ<\/mi>|<mi>ℝ<\/mi>/, '\\mathbb in the classic fonts');
  assert.match(first[3], /<mi mathvariant="normal">Φ<\/mi>/, 'upright Greek from OT1');
  assert.doesNotMatch(first[4], /<math>.*<math>/, 'the formula inside \\text is part of the outer one');
  assert.match(first[4], /<mtext>the set<\/mtext>.*<mi>𝑆<\/mi>/);
  assert.match(first[5], /<mfrac linethickness="0"><mi>𝑛<\/mi><mi>𝑘<\/mi><\/mfrac>/);
  assert.deepEqual(inlineMathml({ ...d, paragraphs: [see] }), [[]], '\\eqref is text');
  for (const m of d.paragraphs.flatMap(p => inlineMathml({ ...d, paragraphs: [p] }).flat()))
    assert.doesNotMatch(m, /mglyph|�|[-]/, m);
});

test('MathML: displays, and an alignment read as one table', async () => {
  const d = await capture(FORMULAS, '', 2);
  const [integral, equation, align1, align2, gather] = displayMathml(d);
  assert.match(integral!, /^<math display="block"><msubsup><mo>∫<\/mo><mn>0<\/mn><mi>∞<\/mi><\/msubsup>.*<mfrac><msqrt><mi>𝜋<\/mi><\/msqrt><mn>2<\/mn><\/mfrac><\/math>$/);
  assert.match(equation!, /^<math display="block">.*<mfrac><mn>1<\/mn><mn>2<\/mn><\/mfrac>/);
  assert.match(align1!, /^<math display="block"><mtable><mtr>.*<mtable>.*otherwise.*<\/mtr><mtr>.*<mi>𝑔<\/mi>.*<mtable>.*<\/mtr><\/mtable><\/math>$/,
    'rows of align, with cases and pmatrix as tables inside');
  assert.match(align1!, /<mtext>\(2\)<\/mtext>/, 'the equation number (the equation above is 1)');
  assert.equal(align2, undefined, 'the second row is read with the first');
  assert.match(gather!, /<munder><mi>lim<\/mi>/);
  for (const m of [integral, equation, align1, gather]) assert.doesNotMatch(m!, /mglyph|�|<math[^>]*>.*<math/);
});

test('MathML: formulas in footnotes', async () => {
  const d = await capture('Text.\\footnote{With $a+b$ inside.}');
  const all = d.paragraphs.flatMap(p => inlineMathml({ ...d, paragraphs: [p] }).flat());
  assert.deepEqual(all, ['<math><mi>𝑎</mi><mo>+</mo><mi>𝑏</mi></math>']);
});

test('MathML: unicode-math', async () => {
  const pre = '\\usepackage{unicode-math}';
  const d = await capture('Roots $\\sqrt[3]{x}$ and $\\mathbb{R}$ and $\\underbrace{a+b}_{2}$.', pre);
  const [ms] = inlineMathml(d);
  assert.equal(ms[0], '<math><mroot><mi>𝑥</mi><mn>3</mn></mroot></math>');
  assert.match(ms[1], /ℝ/);
  assert.match(ms[2], /<munder>.*⏟.*<mn>2<\/mn><\/munder>/);
  const [a, b] = await Promise.all([capture('Roots $\\sqrt[3]{x}$ and $\\mathbb{R}$ and $\\underbrace{a+b}_{2}$.', pre),
    captureWithoutMathml('Roots $\\sqrt[3]{x}$ and $\\mathbb{R}$ and $\\underbrace{a+b}_{2}$.', pre)]);
  assert.deepEqual(withoutMathml(a), withoutMathml(b));
});
