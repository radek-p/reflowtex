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
type Item = { kind: string; para?: number; box?: Node; mathml?: unknown;
              display_used_above?: number; display_used_below?: number; display_below?: number };
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

// \webspan[id=, class=] is the general form; \webid and \webclass are its
// short forms, and all three nest alike. Classes may be given with spaces or
// commas inside braces; an id with a TeX special (_) is taken as written.
test('marks: \\webspan, its short forms, nesting and class lists', async () => {
  const out: any = await capture(
    '\\webspan[id=a, class={one, two}]{Ab} \\webspan[class=x]{c\\webspan[id=b, class={y  z}]{d}\\webid{e}{f}}'
    + ' \\webclass{p q}{h} \\webspan[id=a_1]{i}.', pkg);
  assert.deepEqual(out.marks, [
    { id: 'a', classes: 'one two' }, { id: '', classes: 'x' }, { id: 'b', classes: 'x y z' },
    { id: 'e', classes: 'x' }, { id: '', classes: 'p q' }, { id: 'a_1', classes: '' }]);
});

test('marks: \\webspan refuses a key it does not know', async () => {
  await assert.rejects(capture('\\webspan[colour=red]{x}.', pkg));
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
// LaTeX's, as LaTeX writes it. An author who enables tagging and luamml –
// \DocumentMetadata{tagging=on}, and \tagpdfsetup{math/mathml/luamml/load=true}
// for classic fonts (LaTeX loads it itself with unicode-math) – gets every
// formula's MathML: LaTeX writes it (<jobname>-luamml-mathml.html),
// src/extract/mathml.lua notes which formula is which, src/pipeline/mathml.ts
// puts each on its begin-math node or display item, unchanged. The preamble's
// \DocumentMetadata is moved before the class by the pipeline. A document
// without it gets none. Needs luamml 0.9 (TeX Live 2026).

import { execFileSync } from 'node:child_process';
import { readFileSync as readText } from 'node:fs';
/** luamml's version, as its package declares it (0 when there is none). */
const luammlVersion = (() => {
  try {
    const sty = execFileSync('kpsewhich', ['luamml.sty'], { encoding: 'utf8' }).trim();
    const m = /ProvidesExplPackage\s*\{luamml\}\s*\{[^}]*\}\s*\{(\d+)\.(\d+)/.exec(readText(sty, 'utf8'));
    return m ? Number(m[1]) + Number(m[2]) / 10 : 0;
  } catch { return 0; }
})();
const OLD = luammlVersion < 0.8 && 'luamml older than 0.8 (TeX Live 2025): tagging with it breaks amsmath';
const luamml09 = luammlVersion >= 0.9;
const LUAMML = '\\DocumentMetadata{tagging=on}\n\\tagpdfsetup{math/mathml/luamml/load=true}';

const noMathml = new Pipeline({ buildRoot: join(root, 'build-nomathml'), fontsDir: join(root, 'fonts'), log: () => {}, mathml: false });

/** The same document compiled with the MathML capture switched off. */
async function captureWithoutMathml(body: string, preamble = '', passes = 1): Promise<Output> {
  const key = contentKey(body, preamble);
  const dir = join(noMathml.buildRoot, key);
  if (!existsSync(join(dir, 'output.json'))) await noMathml.compile(body, preamble, { key, passes, name: key });
  return JSON.parse(readFileSync(join(dir, 'output.json'), 'utf8'));
}

const NS = ' xmlns="http://www.w3.org/1998/Math/MathML"';
/** For comparing: without the namespace, the spoken form (checked on its own),
 *  LaTeX's pretty-printing and the spacing attributes. */
const structure = (m: unknown) => String(m).replaceAll(NS, '').replace(/ alttext="[^"]*"/g, '')
  .replace(/ (lspace|rspace)="[^"]*"/g, '').replace(/\s+(?=<)/g, '').replace(/(?<=>)\s+/g, '').replace(/<(\w+) >/g, '<$1>');
/** The MathML of each top-level inline formula, paragraph by paragraph. */
const inlineMathml = (d: Output) => d.paragraphs.map(p =>
  [...walk(p.nodes)].filter(n => n.type === 'math' && n.mathml !== undefined).map(n => structure(n.mathml)));
const displayMathml = (d: Output) => d.content.filter(i => i.kind === 'display').map(i => i.mathml === undefined ? undefined : structure(i.mathml));
const allMathml = (d: Output) => d.paragraphs.flatMap(p => [...walk(p.nodes)].filter(n => n.type === 'math' && n.mathml !== undefined).map(n => String(n.mathml)));

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
  return JSON.parse(JSON.stringify(d, (k, v) => (k === 'mathml' || k === 'display_no') ? undefined : v));
}

test('MathML: none unless the author enables luamml', async () => {
  const d = await capture(FORMULAS, '', 2);
  assert.deepEqual(allMathml(d), []);
  assert.deepEqual(displayMathml(d).filter(Boolean), []);
});

test('MathML: none with tagging but not luamml (classic fonts: LaTeX loads it only with unicode-math)', { skip: OLD }, async () => {
  const d = await capture(FORMULAS, '\\DocumentMetadata{tagging=on}', 2);
  assert.deepEqual(allMathml(d), []);
  assert.deepEqual(displayMathml(d).filter(Boolean), []);
});

// Tagging leaves what a reader gets as it was: the text, links (hyperref), a
// cross-reference, a footnote, colour, displays. (LaTeX builds some things
// differently with it – a heading's line has a penalty and kerns where it had
// glue – which the render tests see if it shows.)
type Anything = { [k: string]: unknown };
const readerView = (d: Output) => ({
  text: d.paragraphs.map(p => glyphText(p.nodes)),
  links: linkedRuns(d).map(([t, l]) => [t, l.url ?? l.label]),
  colours: paragraphRuns(d, 'color'),
  items: d.content.filter(i => i.kind !== 'vspace').map(i => i.kind),
  streams: ((d as unknown as Anything).streams as { kind: string; content?: Item[] }[] ?? [])
    .map(st => [st.kind, (st.content ?? []).map(i => (i.para ? glyphText(d.paragraphs[i.para - 1].nodes) : i.kind))]),
  anchors: d.anchors,
});
const MIXED = [
  '\\section{One}\\label{s:one}',
  'See \\href{https://example.org}{a page}, Section~\\ref{s:one}, and \\textcolor{red}{red}.\\footnote{A note, with $a+b$.}',
  '\\[ x = y \\]',
  'Then \\begin{align} a &= 1 \\\\ b &= 2 \\end{align} and the end.',
].join('\n');
test('tagging, with or without luamml, captures links, footnotes, colours and displays as without', { skip: OLD }, async () => {
  const pre = '\\usepackage{xcolor}\n\\usepackage{hyperref}';
  const [plain, tagged, withLuamml] = await Promise.all([capture(MIXED, pre, 2),
    capture(MIXED, `\\DocumentMetadata{tagging=on}\n${pre}`, 2), capture(MIXED, `${LUAMML}\n${pre}`, 2)]);
  assert.deepEqual(readerView(tagged), readerView(plain));
  assert.deepEqual(readerView(withLuamml), readerView(plain));
  assert.ok(linkedRuns(plain).length >= 2, 'the links are there to compare');
  assert.ok(allMathml(withLuamml).length >= 1 && displayMathml(withLuamml).filter(Boolean).length === 2, 'and the MathML with luamml');
});

test('MathML: typesetting is untouched by the capture', { skip: OLD }, async () => {
  const [a, b] = await Promise.all([capture(FORMULAS, LUAMML, 2), captureWithoutMathml(FORMULAS, LUAMML, 2)]);
  assert.deepEqual(withoutMathml(a), withoutMathml(b));
});

// Tagging typesets the same. After a display LaTeX's tagging code cancels
// TeX's below-display skip and puts it in again (latex-lab-math): the gap's
// glue is made differently – its components, which tools show – but its
// amount, and the skip TeX chose, are the same.
test('MathML: tagging and luamml give the same text and displays', { skip: OLD }, async () => {
  const [a, b] = await Promise.all([capture(FORMULAS, LUAMML, 2), capture(FORMULAS, '', 2)]);
  assert.deepEqual(readerView(a), readerView(b));
  const skips = (d: Output) => d.content.filter(i => i.kind === 'display').map(i => [i.display_used_above, i.display_used_below, i.display_below]);
  assert.deepEqual(skips(a), skips(b), 'the skips TeX chose around each display');
});

test('MathML: every inline formula, as LaTeX gives it', { skip: OLD }, async () => {
  const d = await capture(FORMULAS, LUAMML, 2);
  const [first] = inlineMathml(d);
  const see = d.paragraphs.find(p => glyphText(p.nodes).startsWith('See'))!;
  assert.equal(first.length, 6);
  assert.equal(first[0], '<math><msup><mi>𝑥</mi><mn>2</mn></msup><mo>+</mo><msup><mi>𝑦</mi><mn>2</mn></msup><mo>=</mo><msup><mi>𝑧</mi><mn>2</mn></msup></math>');
  assert.match(first[4], /<mtext>the\sset\s*<math>\s*<mi>𝑆<\/mi>\s*<\/math>\s*<\/mtext>/u, 'a formula in \\text is inside the outer one');
  assert.deepEqual(inlineMathml({ ...d, paragraphs: [see] }), [[]], '\\eqref is text');
});

test('MathML: displays; an alignment one table, with luamml’s intents', { skip: OLD }, async () => {
  const d = await capture(FORMULAS, LUAMML, 2);
  const [integral, equation, align1, align2, gather] = displayMathml(d);
  assert.match(integral!, /^<math display="block"><msubsup><mo>[^<]*<\/mo><mn>0<\/mn><mi[^>]*>∞<\/mi><\/msubsup>/);
  assert.match(equation!, /^<math display="block">.*<mfrac><mn>1<\/mn><mn>2<\/mn><\/mfrac>/);
  assert.match(align1!, /^<math display="block"><mtable[^>]*intent=":system-of-equations"/);
  assert.match(align1!, /<mtd intent=":equation-label"><mtext>\(2\)<\/mtext><\/mtd>/, 'the equation number (the equation above is 1)');
  assert.match(align1!, /otherwise.*<mi>𝑔<\/mi>.*<mtable>/, 'cases and pmatrix as tables inside');
  assert.equal(align2, undefined, 'the second row is read with the first');
  assert.match(gather!, /lim/);
});

// LaTeX reads the last run's MathML file back in (for the PDF); a classic
// font's double accent is a raw DEL in it, which TeX cannot read: a document
// run twice failed. The pipeline starts each run without it.
test('MathML: a document run twice, with what luamml writes as a raw control character', { skip: OLD }, async () => {
  const d = await capture('Let $x$ and \\[ \\Ddot{\\Ddot{D}} \\quad \\Hat{\\Hat{H}} \\]', LUAMML, 2);
  assert.equal(displayMathml(d).filter(Boolean).length, 1);
  assert.equal(allMathml(d).length, 1);
});

// The url package sets a URL in math mode (for its line breaks); LaTeX does
// not count it as a formula and writes no MathML for it. It once got the
// formula before's (its counter still at that one), in place of its text.
test('MathML: a URL (math LaTeX does not count as a formula) has none, and keeps its text', { skip: OLD }, async () => {
  const d = await capture('First $x^2$, then \\url{https://example.org} and $y$.', `${LUAMML}\n\\usepackage{hyperref}`);
  const [ms] = inlineMathml(d);
  assert.deepEqual(ms.map(m => /<mi>(.)<\/mi>/u.exec(m)?.[1]), ['𝑥', '𝑦'], 'x² and y, nothing for the URL');
  assert.match(glyphText(d.paragraphs[0].nodes), /example\.org/);
});

test('MathML: formulas in footnotes', { skip: OLD }, async () => {
  const d = await capture('Text.\\footnote{With $a+b$ inside.}', LUAMML);
  assert.deepEqual(d.paragraphs.flatMap(p => inlineMathml({ ...d, paragraphs: [p] }).flat()), ['<math><mi>𝑎</mi><mo>+</mo><mi>𝑏</mi></math>']);
});

test('MathML: unicode-math', { skip: OLD }, async () => {
  const d = await capture('Roots $\\sqrt[3]{x}$ and $\\mathbb{R}$ and $\\underbrace{a+b}_{2}$.', '\\DocumentMetadata{tagging=on}\n\\usepackage{unicode-math}');
  const [ms] = inlineMathml(d);
  assert.equal(ms[0], '<math><mroot><mi>𝑥</mi><mn>3</mn></mroot></math>');
  assert.match(ms[1], /ℝ/);
  assert.match(ms[2], /<munder>.*⏟.*<mn>2<\/mn><\/munder>/);
});

test('MathML: each formula carries its spoken form (alttext)', { skip: OLD }, async () => {
  const d = await capture(FORMULAS, LUAMML, 2);
  const displays = d.content.filter(i => i.kind === 'display' && i.mathml !== undefined).map(i => String(i.mathml));
  for (const m of [...allMathml(d), ...displays]) assert.match(m, /^<math alttext="[^"]+"/, m.slice(0, 80));
  assert.match(allMathml(d)[0], /alttext="x squared plus y squared equals z squared"/);
});

// Scripts on an accented symbol (\hat k_{ij}): TeX puts them on the accent;
// luamml 0.9 keeps them (0.5 left them out – "k hat" for k̂ᵢⱼ).
test('MathML: scripts on an accented symbol', { skip: !luamml09 && 'luamml older than 0.9 drops them' }, async () => {
  const d = await capture('Let $\\hat k_{ij}=k_{ij}\\hat x_j$.', LUAMML);
  const [ms] = inlineMathml(d);
  assert.match(ms[0], /^<math><msub><mover><mi>𝑘<\/mi><mo[^>]*>\^<\/mo><\/mover><mrow><mi>𝑖<\/mi><mi>𝑗<\/mi><\/mrow><\/msub>/);
});

// With unicode-math, LaTeX gives \not= as "≠", \dots as "…", \Phi as "Φ",
// \int as "∫". With the classic fonts it gives what those fonts are made of
// – a negating slash and "=", three periods – and maps only two of their
// families (oml, oms: upright Greek and big operators are left as codes), and
// a reader hears that: the author's fix is unicode-math. The classic cases are expected to fail (no rewriting of our
// own: the MathML is LaTeX's).
const SYMBOLS = 'Let $j \\not= i$, $i = 1, \\dots, n$, $x \\mapsto ax$, $\\Phi$, $\\int_0^1 x$.';
test('MathML: with unicode-math, \\not= is "≠", \\dots "…", \\mapsto "↦"', { skip: OLD }, async () => {
  const d = await capture(SYMBOLS, '\\DocumentMetadata{tagging=on}\n\\usepackage{unicode-math}');
  const [ms] = inlineMathml(d);
  assert.match(ms[0], /<mo>≠<\/mo>/);
  assert.match(ms[1], /<mo>…<\/mo>/);
  assert.match(ms[2], /<mo[^>]*>↦<\/mo>/);
  assert.match(ms[3], /<mi[^>]*>Φ<\/mi>/);
  assert.match(ms[4], /∫/);
});
test('MathML: with the classic fonts too', { skip: OLD, todo: 'LaTeX gives the classic fonts’ pieces: a slash and "=", three periods; upright Greek and big operators unmapped' }, async () => {
  const d = await capture(SYMBOLS, LUAMML);
  const [ms] = inlineMathml(d);
  assert.match(ms[0], /<mo>≠<\/mo>/);
  assert.match(ms[1], /<mo>…<\/mo>/);
  assert.match(ms[2], /<mo[^>]*>↦<\/mo>/);
  assert.match(ms[3], /<mi[^>]*>Φ<\/mi>/);
  assert.match(ms[4], /∫/);
});
test('MathML: \\dddot is a three-dot accent', { skip: OLD }, async () => {
  const d = await capture('Let $\\dddot Q$ be given.', '\\DocumentMetadata{tagging=on}\n\\usepackage{amsmath}\n\\usepackage{unicode-math}');
  assert.doesNotMatch(allMathml(d)[0], /alttext="[^"]*period/);
});
