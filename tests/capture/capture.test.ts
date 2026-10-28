// SPDX-License-Identifier: AGPL-3.0-or-later
// The capture tests (README.md): small documents compiled by the pipeline,
// and what the serializer (src/extract/serializer.lua) recorded of them
// checked in output.json – a glyph's colour, where a link points, what
// reaches the content stream at all, which neither the render tests nor the
// web tests look at. TeX only, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PREAMBLE, Pipeline, contentKey, type CompileOptions } from '../../src/pipeline/pipeline.ts';
import { a11yLayer, type LayerDocument } from '../../src/pipeline/a11y.ts';
import { Log } from '../../src/shared/log.ts';
import { messageType } from '../../src/pipeline/schema.ts';
import { TexError } from '../../src/pipeline/errors.ts';

type Node = { type: string; char?: number; font?: number; color?: string; link?: number; stream?: number; mathml?: unknown;
              width?: number; height?: number; depth?: number; kern?: number; subtype?: number;
              children?: Node[]; replace?: Node[]; pre?: Node[]; post?: Node[] };
type Item = { kind: string; para?: number; box?: Node; mathml?: unknown; amount?: number;
              display_used_above?: number; display_used_below?: number; display_below?: number;
              display_after_blank?: boolean };
type Output = { fonts: Record<string, unknown>; paragraphs: { nodes: Node[] }[]; content: Item[];
                links: { label?: string; url?: string }[]; anchors: string[]; slots: unknown[];
                source_width: number; display_model?: boolean };

// Nothing is fetched while tests run: the image's lualatex wrapper installs
// no missing package (docker/lualatex-autoinstall.sh); what the tests need is
// in docker/test-packages.txt. (REFLOWTEX_NO_AUTOINSTALL=0 lets it, to find
// what a new fixture needs.)
process.env.REFLOWTEX_NO_AUTOINSTALL ??= '1';

const root = mkdtempSync(join(tmpdir(), 'reflowtex-capture-'));
const pipeLog = new Log('pipeline');
const pipe = new Pipeline({ buildRoot: join(root, 'build'), fontsDir: join(root, 'fonts'), log: pipeLog });

/** The setup a test's snippet is set in: the default one with the test's
 *  own lines after it – after its \DocumentMetadata line, which LaTeX wants
 *  before the class, when it starts with one. */
function setup(lines: string): string {
  const meta = /^\\DocumentMetadata\{[^{}]*\}\n?/.exec(lines)?.[0] ?? '';
  return [meta.trim(), DEFAULT_PREAMBLE, lines.slice(meta.length)].filter(Boolean).join('\n');
}

/** A snippet's output.json, as the pipeline leaves it; compiled once per run.
 *  LuaTeX reports an error inside a callback as a warning and goes on without
 *  what the callback would have captured: that fails here. */
async function capture(body: string, preamble = '', passes = 1): Promise<Output> {
  const key = contentKey(body, preamble);
  const dir = join(pipe.buildRoot, key);
  if (!existsSync(join(dir, 'output.json'))) await pipe.compile(body, { kind: 'snippet', preamble: setup(preamble), key, passes, name: key });
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

// \\[len], and \vspace or \smallskip inside a paragraph, put their space in a
// \vadjust: TeX sets it beside the line the node lands in, so the paragraph
// carries it, and the space between items does not have it a second time.
test('a \\vadjust is kept in its paragraph, with its height and what it draws', async () => {
  const d = await capture(['First line.\\\\[4pt]', 'Second\\vadjust pre{\\vskip 5pt} line\\smallskip{} and',
                           'a box\\vadjust{\\kern2pt\\hbox{Boxed.}} below, and nothing\\vadjust{}.', '', 'Next paragraph.'].join('\n'));
  const pt = 65536;
  const adjusts = d.paragraphs[0].nodes.filter(n => n.type === 'adjust');
  assert.deepEqual(adjusts.map(n => [n.subtype ?? 0, n.height]), [[0, 4 * pt], [1, 5 * pt], [0, 3 * pt], [0, adjusts[3].height], [0, 0]]);
  const [kern, box] = adjusts[3].children!;
  assert.equal(kern.kern, 2 * pt);
  assert.equal(glyphText([box]), 'Boxed.');
  assert.equal(adjusts[3].height, 2 * pt + box.height! + box.depth!);
  assert.ok([0, 1, 2, 4].every(i => !adjusts[i].children), 'space alone has no list');
  // nothing of it between the two paragraphs: no box, and only \parskip
  assert.deepEqual(d.content.filter(it => it.kind !== 'vspace').map(it => it.kind), ['paragraph', 'paragraph']);
  assert.deepEqual(d.content.filter(it => it.kind === 'vspace').map(it => it.amount ?? 0).filter(a => a !== 0), []);
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

// Every float in the source is in the content stream, where it is written,
// with its caption: none goes out on a page of its own, and none waits for
// room further on. Floats of the kernel's \@float in any form, and of the
// packages that define float types through it.
test('every float is in the content stream where it is written, with its caption', async () => {
  const floats: [env: string, opt: string, preamble: string][] = [
    ['figure', '[p]', ''], ['table', '[h]', ''], ['figure', '[b]', ''], ['figure*', '', ''], ['table*', '[p]', ''],
    // a type the class or the document makes with the kernel's \@float
    ['listing', '[p]', '\\makeatletter\\newcounter{listing}\\def\\fps@listing{tbp}\\def\\ftype@listing{8}'
      + '\\def\\ext@listing{lol}\\def\\fnum@listing{Listing \\thelisting}'
      + '\\newenvironment{listing}{\\@float{listing}}{\\end@float}\\makeatother'],
  ];
  if (kpsewhich('float.sty')) floats.push(['program', '', '\\usepackage{float}\\newfloat{program}{tbp}{lop}'], ['table', '[H]', '']);
  if (kpsewhich('algorithm.sty')) floats.push(['algorithm', '', '\\usepackage{algorithm}']);
  if (kpsewhich('newfloat.sty')) floats.push(['scheme', '[p]', '\\usepackage{newfloat}\\DeclareFloatingEnvironment[placement=p]{scheme}']);
  const preamble = [...new Set(floats.map(f => f[2]).filter(Boolean))].join('\n');
  const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo'];
  const body = floats.map(([env, opt], k) =>
    `Before${words[k]} text.\n\\begin{${env}}${opt}Body${words[k]}\\caption{Caption${words[k]}}\\end{${env}}`).join('\n\n')
    + '\n\nThe end.';
  const d = await capture(body, preamble, 2);
  const text = d.content.map(it => it.kind === 'paragraph' ? glyphText(d.paragraphs[it.para! - 1].nodes)
                                   : it.kind === 'display' ? glyphText([it.box!]) : '').join(' ');
  const once = (s: string) => text.split(s).length === 2;
  // each once, its body and caption between the text before it and the next
  const found = floats.map((_, k) => words[k]).filter((w, k) => {
    const next = k + 1 < floats.length ? `Before${words[k + 1]}` : 'Theend.';
    const [b, x, c, n] = [`Before${w}`, `Body${w}`, `Caption${w}`, next].map(s => text.indexOf(s));
    return once(`Body${w}`) && once(`Caption${w}`) && b < x && b < c && x < n && c < n;
  });
  assert.deepEqual(found, floats.map((_, k) => words[k]), `floats in the source: ${floats.length}, in place in the output: ${found.length}; the stream: ${text}`);
});

// The galley the serializer copies (Serializer.flow_head(): what it walks, and
// what the strip ships), one line per top-level node: its type, its subtype or
// penalty, whether it is an empty box, and whether it is a \label's anchor.
const FLOW_DUMP = join(root, 'flow-dump.lua');
writeFileSync(FLOW_DUMP, `local f = io.open("flow.txt", "w")
for n in node.traverse(Serializer.flow_head()) do
  local t = node.type(n.id)
  local empty = (t == "hlist" or t == "vlist") and n.head == nil and n.width == 0 and n.height == 0 and n.depth == 0
  f:write(t, " ", tostring(t == "penalty" and n.penalty or n.subtype), " ", empty and "empty" or "-", " ",
          node.get_attribute(n, 910) and "anchor" or "-", "\\n")
end
f:close()
`);
async function flowOf(body: string, preamble: string): Promise<string[]> {
  preamble += `\n\\AddToHook{enddocument/afterlastpage}{\\directlua{dofile("${FLOW_DUMP}")}}`;
  await capture(body, preamble);
  return readFileSync(join(pipe.buildRoot, contentKey(body, preamble), 'flow.txt'), 'utf8').trim().split('\n');
}

test('forced page breaks leave nothing of the paging in the galley', async () => {
  // what paging made around a break: the breaks, LaTeX's empty marker boxes
  // before requests to its output routine, a blank page's \hbox{}, \vfil, and
  // the \topskip glue an output routine gives back (a float's, multicol's)
  const flow = await flowOf([
    'Alpha gyp.\n\n\\label{a}\\newpage Bravo gyp.',
    '\\begin{herefloat}\\rule{1cm}{1cm}\\end{herefloat}',
    'Charlie gyp.\\clearpage Delta gyp.\\cleardoublepage Echo gyp.\\null\\newpage Foxtrot gyp.',
    '\\begin{multicols}{2}Golf gyp.\n\n\\columnbreak Hotel gyp.\\end{multicols}',
    '\\noindent\\begin{minipage}{5cm}India gyp.\\newpage Juliett.\\end{minipage}',
  ].join('\n\n'), '\\usepackage{multicol}\n\\makeatletter\n\\newenvironment{herefloat}{\\@float{figure}[h]}{\\end@float}\n\\makeatother');
  assert.deepEqual(flow.filter(l => l.startsWith('glue 10 ')), [], 'topskip glue');
  assert.deepEqual(flow.filter(l => l.startsWith('penalty ') && Number(l.split(' ')[1]) <= -10000), [], 'forced breaks');
  // a \label's anchor is the document's, empty or not
  assert.deepEqual(flow.filter(l => l.includes(' empty ')), ['hlist 2 empty anchor']);
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
    ['1', { label: 'sec:intro' }],           // \ref (the capture code)
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

test('marks: \\webspan refuses a key it does not know: TeX\'s error, a warning of the block\'s', async () => {
  const body = '\\webspan[colour=red]{x}.';
  await capture(body, pkg);
  const key = contentKey(body, pkg);
  const errors = pipeLog.records().filter(r => r.code === 'tex-error' && r.details.block === `${key} (${key})`);
  assert.equal(errors.length, 1, errors.map(r => r.message).join('\n'));
  assert.match(errors[0].details.error, /^! Package reflowtex Error: \\webspan: unknown key `colour'/);
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

// An aside's text is set as LaTeX sets a \marginpar: with the paragraph
// settings restored. Under \raggedright, \\ ends the paragraph, and a second
// \\ after it is "There's no line here to end"; in the aside it breaks lines.
test('an aside restores the paragraph settings: \\\\ \\\\ under \\raggedright is no error', async () => {
  const body = '\\raggedright Some text\\marginpar{One\\\\ \\\\ Two} more text.';
  const d = await capture(body);
  const key = contentKey(body, '');
  const errors = pipeLog.records().filter(r => r.code === 'tex-error' && r.details.block === `${key} (${key})`);
  assert.deepEqual(errors.map(r => r.details.error), []);
  const aside = (d as unknown as { streams: { kind: string; content?: Item[] }[] }).streams.find(s => s.kind === 'marginpar');
  const paras = (aside?.content ?? []).filter(i => i.kind === 'paragraph').map(i => glyphText(d.paragraphs[i.para! - 1].nodes));
  assert.deepEqual(paras, ['OneTwo'], 'one paragraph, its lines broken by \\\\');
});

// ── Classic fonts ───────────────────────────────────────────────────────────
// A Type 1 face is converted for the browser (src/pipeline/fonts/type1.ts)
// and its glyphs readdressed; what each glyph then draws is checked in the
// converted file.

import opentype, { type Font } from 'opentype.js';
import { kpsewhich } from '../../src/pipeline/fonts/type1.ts';
import { faceFile, type TexFontFace } from '../../src/shared/font-face.ts';
/** [face, glyph name the served file draws] for each glyph of the paragraphs. */
function drawnGlyphNames(d: Output): [string, string][] {
  const fonts = d.fonts as Record<string, { name: string; face: TexFontFace }>;
  const parsed = new Map<string, Font>();
  const out: [string, string][] = [];
  for (const n of walk(d.paragraphs.flatMap(p => p.nodes))) {
    if (n.type !== 'glyph') continue;
    const f = fonts[String(n.font)];
    const file = faceFile(f.face);
    assert.ok(file, `${f.name} is drawn from a file: ${JSON.stringify(f.face)}`);
    if (!parsed.has(file)) {
      const buf = readFileSync(join(root, 'fonts', file));
      parsed.set(file, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    }
    out.push([f.name, parsed.get(file)!.charToGlyph(String.fromCodePoint(n.char!)).name ?? '']);
  }
  return out;
}

test('Latin Modern maths (lmodern) draws the glyphs TeX set', async () => {
  const d = await capture('Let $\\alpha+\\sum_i x_i \\leq \\infty$.', '\\usepackage{lmodern}');
  const maths = drawnGlyphNames(d).filter(([face]) => /^lm(mi|sy|ex)/.test(face));
  assert.deepEqual(maths, [['lmmi10', 'alpha'], ['lmex10', 'summationtext'], ['lmmi7', 'i'], ['lmmi10', 'x'],
                           ['lmmi7', 'i'], ['lmsy10', 'lessequal'], ['lmsy10', 'infinity']]);
});

// A virtual font (src/pipeline/fonts/vf.ts) has no outline: each glyph is
// drawn from the fonts its packet names, an accented letter from its pieces.
test('a virtual font (ae: T1 over Computer Modern) draws its packets\' glyphs', async () => {
  const d = await capture('Caf\\\'e, na\\"ive.', '\\usepackage[T1]{fontenc}\n\\usepackage{ae}');
  assert.deepEqual(drawnGlyphNames(d).map(([face, g]) => `${face}:${g}`).join(' '),
    'cmr10:C cmr10:a cmr10:f cmr10:acute cmr10:e cmr10:comma cmr10:n cmr10:a cmr10:dieresis cmr10:dotlessi cmr10:v cmr10:e cmr10:period');
});

// Its accented letters, drawn as a letter and an accent, read as the letter
// they are: in the accessible layer (what a reader and find-in-page get).
test('a virtual font\'s accented letters read as one character each (ae: é, ï, ç)', async () => {
  const d = await capture('Caf\\\'e, na\\"ive, fa\\c{c}ade.', '\\usepackage[T1]{fontenc}\n\\usepackage{ae}');
  const texts = [...walk(d.paragraphs.flatMap(p => p.nodes))].map(n => (n as { actual_text?: string }).actual_text).filter(Boolean);
  assert.deepEqual(texts, ['é', 'ï', 'ç']);
  assert.match(a11yLayer(d as unknown as LayerDocument), /Café, naïve, façade\./);
});

// A classic maths font's symbols (cmsy's prime, ∀, ∈, ≤, ∞) were private-use
// codes, read as nothing: "f′" read as "f", and a tag's prime was lost.
test('a classic maths font\'s symbols read as their characters: f′, ∀x∈A, x≤∞, a tag (1′)', async () => {
  const d = await capture([
    'Let $f\'$ be given, and $\\forall x \\in A$, $x \\leq \\infty$.',
    '\\begin{equation}a\\label{eq:b}\\end{equation}',
    '\\begin{equation}b\\tag{\\ref{eq:b}$\'$}\\end{equation}',
  ].join('\n'), '\\usepackage{amsmath}', 2);
  assert.match(glyphText(d.paragraphs[0].nodes), /^Letf′begiven,and∀x∈A,x≤∞\./);
  const displays = d.content.filter(i => i.kind === 'display').map(i => glyphText([i.box!]));
  assert.deepEqual(displays, ['a(1)', 'b(1′)']);
  assert.match(a11yLayer(d as unknown as LayerDocument), /Let f′ be given, and ∀x ∈ A, x ≤ ∞\./);
});

// An equation number with no room beside its formula: TeX sets it on a line of
// its own, below the formula (§1205) or, on the left, above it (§1203), in
// place of the display skip there. No skip is recorded on that side; one
// whose number fits beside its formula has both.
test('a display whose number TeX set on its own line has no display skip on that side', async () => {
  const d = await capture([
    'Text.\\begin{equation}\\hbox to\\dimexpr\\linewidth-10pt\\relax{}\\end{equation}',
    'Text.\\begin{equation}\\hbox to.5\\linewidth{}\\end{equation}',
    'Text.$$\\hbox to\\dimexpr\\linewidth-10pt\\relax{}\\leqno(3)$$',
    'Text.', '',
    '\\[ x \\]',
    'Text.',
  ].join('\n'));
  const displays = d.content.filter(i => i.kind === 'display');
  // each formula, and each number on its own line (a fixed box): below the
  // first, above the third; then a display that opens a paragraph
  assert.equal(displays.length, 6);
  const [below, , fits, , above, opening] = displays;
  assert.notEqual(below.display_used_above, undefined, 'the above skip');
  assert.equal(below.display_used_below, undefined, 'no below skip');
  assert.notEqual(fits.display_used_above, undefined, 'the above skip');
  assert.notEqual(fits.display_used_below, undefined, 'the below skip');
  assert.equal(above.display_used_above, undefined, 'no above skip');
  assert.notEqual(above.display_used_below, undefined, 'the below skip');
  // the glue above a formula comes from the number above it, the glue above
  // a display that opens a paragraph from the paragraph's empty line
  assert.equal(above.display_after_blank, undefined);
  assert.equal(opening.display_after_blank, true);
});

// newtx is in the CI image (docker/test-packages.txt); elsewhere, run where it is installed.
const NO_NEWTX = !kpsewhich('newtxmath.sty') && 'newtx is not installed';
test('newtx maths (virtual fonts over Type 1 faces) draws the glyphs TeX set', { skip: NO_NEWTX }, async () => {
  const d = await capture('Let $\\alpha+\\sum_i x_i \\leq \\infty, a=12$.', '\\usepackage{newtxtext,newtxmath}');
  const maths = drawnGlyphNames(d).filter(([face]) => !face.startsWith('TeXGyreTermesX')).map(([face, g]) => `${face}:${g}`);
  assert.deepEqual(maths.join(' '), 'NewTXMI:u1D6FC txsys:plus txexs:summationtext.1 NewTXMI7:u1D456 NewTXMI:u1D465 NewTXMI7:u1D456 ' +
    'txsys:lessequal txsys:infinity NewTXMI:comma NewTXMI:u1D44E txmiaX:equal ntx-Regular-tlf-ot1r:one ntx-Regular-tlf-ot1r:two');
});

// A font with only a METAFONT source (bbm, \mathbbm): drawn from METAFONT's
// bitmaps, its letters the double-struck ones Unicode has (they were boxes).
// bbm is in the CI image (docker/test-packages.txt); elsewhere, run where it
// is installed.
const NO_BBM = !kpsewhich('bbm10.mf') && 'bbm is not installed';
test('a METAFONT-only font (bbm) is drawn from its bitmaps, as double-struck letters', { skip: NO_BBM }, async () => {
  const d = await capture('$\\mathbbm{R}^n, \\mathbbm{1}_A, \\mathbbmss{N}$', '\\usepackage{bbm}');
  const fonts = d.fonts as Record<string, { name: string; face: TexFontFace }>;
  const bbm = Object.values(fonts).filter(f => f.name.startsWith('bbm'));
  assert.ok(bbm.length >= 2, JSON.stringify(bbm));
  for (const f of bbm) assert.equal(f.face.kind, 'bitmap', `${f.name}: ${JSON.stringify(f.face)}`);
  const chars = [...walk(d.paragraphs.flatMap(p => p.nodes))].filter(n => n.type === 'glyph' && fonts[String(n.font)].name.startsWith('bbm'))
    .map(n => String.fromCodePoint(n.char!)).join('');
  assert.equal(chars, 'ℝ𝟙ℕ');
  assert.deepEqual(drawnGlyphNames(d).filter(([face]) => face.startsWith('bbm')).map(([, g]) => g), ['g82', 'g49', 'g78']);
});

// A character the font lacks ("Missing character" in TeX's log) is drawn by
// nothing in TeX's PDF; luaotfload sets the OpenType font's .notdef after it.
// Both become empty boxes of their size, and the block's warnings list the
// characters, by font, with a few words around them. They used to be kept as
// glyphs: the converted T1 font drew its own ł, and the page was refused for
// the rest.
test('a character the font lacks is drawn by nothing, and the block lists it', async () => {
  const body = 'Pawe\u0142 and Cherno\uFB00, then {\\fontencoding{TU}\\selectfont a frame \u2554\u2550\u2557 here}.';
  const preamble = '\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}';
  const d = await capture(body, preamble) as Output & { missing_chars: { font: string; char: number; count: number; where: string[] }[] };
  const nodes = [...walk(d.paragraphs.flatMap(p => p.nodes))];
  const missing = [0x142, 0xFB00, 0x2554, 0x2550, 0x2557];
  assert.deepEqual(nodes.filter(n => n.type === 'glyph' && (missing.includes(n.char!) || (n as { gindex?: number }).gindex === 0)), [],
    'no glyph for them, nor a .notdef');
  // each a box holding a rule of size 0 (it stops the search for a protruding character)
  const boxes = nodes.filter(n => n.type === 'hlist' && n.children?.length === 1 && n.children[0].type === 'rule' && !n.children[0].width);
  // ł and ﬀ: 0 wide; each box-drawing character: 0, then its .notdef
  assert.deepEqual(boxes.map(b => b.width! > 0), [false, false, false, true, false, true, false, true]);
  // nor in the text layer (copy, search, screen readers): TeX's PDF has none
  // of them (a .notdef copies from it as U+FFFD, which says nothing)
  const text = a11yLayer(d as unknown as LayerDocument);
  assert.match(text, /Pawe and Cherno, then a frame +here\./);
  assert.doesNotMatch(text, /[\u0142\uFB00\u2550-\u2557\uFFFD]/);
  assert.deepEqual(d.missing_chars.map(m => [m.font, m.char, m.count, m.where[0]]), [
    ['ec-lmr10', 0x142, 1, 'Pawe\u0142 and Cherno, then a frame'],
    ['ec-lmr10', 0xFB00, 1, 'Pawe and Cherno\uFB00, then a frame here.'],
    ['LMRoman10-Regular', 0x2554, 1, 'and Cherno, then a frame \u2554 here.'],
    ['LMRoman10-Regular', 0x2550, 1, 'and Cherno, then a frame \u2550 here.'],
    ['LMRoman10-Regular', 0x2557, 1, 'and Cherno, then a frame \u2557 here.'],
  ]);
  // the block's data, as the page gets it
  const pb = readFileSync(join(pipe.buildRoot, contentKey(body, preamble), 'nodelist.pb'));
  const doc = messageType('Document').toObject(messageType('Document').decode(pb)) as { warnings: Record<string, unknown>[] };
  assert.deepEqual(doc.warnings[0], {
    level: 'warning', code: 'missing-char', message: 'There is no \u0142 (U+0142) in font ec-lmr10',
    details: { font: 'ec-lmr10', char: '\u0142', codepoint: 'U+0142', count: '1', where: 'Pawe\u0142 and Cherno, then a frame' },
  });
  assert.deepEqual(doc.warnings.map(w => (w.details as Record<string, string>).codepoint), ['U+0142', 'U+FB00', 'U+2554', 'U+2550', 'U+2557']);
});

// ── MathML ──────────────────────────────────────────────────────────────────
// LaTeX's, as LaTeX writes it. An author who enables tagging and luamml –
// \DocumentMetadata{tagging=on}, and \tagpdfsetup{math/mathml/luamml/load=true}
// for classic fonts (LaTeX loads it itself with unicode-math) – gets every
// formula's MathML: LaTeX writes it (<jobname>-luamml-mathml.html),
// src/extract/mathml.lua notes which formula is which, src/pipeline/mathml.ts
// puts each on its begin-math node or display item, unchanged. The preamble's
// \DocumentMetadata comes before the class (setup, above). A document
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

const noMathml = new Pipeline({ buildRoot: join(root, 'build-nomathml'), fontsDir: join(root, 'fonts'), log: new Log('pipeline'), mathml: false });

/** The same document compiled with the MathML capture switched off. */
async function captureWithoutMathml(body: string, preamble = '', passes = 1): Promise<Output> {
  const key = contentKey(body, preamble);
  const dir = join(noMathml.buildRoot, key);
  if (!existsSync(join(dir, 'output.json'))) await noMathml.compile(body, { kind: 'snippet', preamble: setup(preamble), key, passes, name: key });
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

// ── Theorem notes ───────────────────────────────────────────────────────────
// The template wraps the theorem head (\@begintheorem) to note the theorem in
// the outline, and passes the note on. A note holding a `]` – a cite with its
// own optional argument, as in real papers – is braced by the author; it must
// reach the head braced still, and print as LaTeX prints it.

const NOTES = [
  '\\begin{proposition}[{\\cite[p.~3]{knuth}}]', 'Cited.', '\\end{proposition}',
  '\\begin{proposition}[A plain note]', 'Plain.', '\\end{proposition}',
  '\\begin{proposition}[]', 'Empty.', '\\end{proposition}',
  '\\begin{proposition}', 'None.', '\\end{proposition}',
  '\\begin{proposition}[{a]b}]', 'Bracket.', '\\end{proposition}',
  '\\begin{thebibliography}{9}', '\\bibitem{knuth} D. Knuth. The TeXbook.', '\\end{thebibliography}',
].join('\n');
const THEOREM = '\\newtheorem{proposition}{Proposition}';
/** Each theorem's first paragraph, as its glyphs read (spaces are glue). */
const theoremHeads = (d: Output) => d.paragraphs.map(p => glyphText(p.nodes)).filter(t => t.startsWith('Proposition'));
// (what lualatex prints for the same document without the capture code)
const AMS_HEADS = ['Proposition1([1,p.3]).Cited.', 'Proposition2(Aplainnote).Plain.', 'Proposition3.Empty.',
                   'Proposition4.None.', 'Proposition5(a]b).Bracket.'];

test('theorem notes: a cite with an optional argument, amsthm', async () => {
  const d = await capture(NOTES, `\\usepackage{amsthm}\n${THEOREM}`, 2);
  assert.deepEqual(theoremHeads(d), AMS_HEADS);
});

test('theorem notes: a cite with an optional argument, amsthm and natbib', async () => {
  const d = await capture(NOTES, `\\usepackage[numbers]{natbib}\n\\usepackage{amsthm}\n${THEOREM}`, 2);
  assert.deepEqual(theoremHeads(d), AMS_HEADS);
});

test('theorem notes: a cite with an optional argument, LaTeX\'s own theorems', async () => {
  const d = await capture(NOTES, THEOREM, 2);
  assert.deepEqual(theoremHeads(d), ['Proposition1([1,p.3])Cited.', 'Proposition2(Aplainnote)Plain.',
    'Proposition3()Empty.', 'Proposition4None.', 'Proposition5(a]b)Bracket.']);
});

// ── Writes inside a captured picture ────────────────────────────────────────
// A picture is shipped on a page of its own, outside LaTeX's output routine,
// and the \writes inside it run then. They must be written as at a page's
// shipout, with \protect left unexpanded: an \addcontentsline in a TikZ node,
// or in a tcolorbox (drawn as a TikZ picture: thmtools' list of theorems for
// a theorem in a box, as in real papers), expanded \contentsline instead and
// wrote TikZ's internals into the .aux.

const ENTRY = '\\@writefile{toc}{\\contentsline {section}{An entry}{1}{}\\protected@file@percent }';
/** The .aux of a snippet compiled once, by capture(). */
const auxOf = (body: string, preamble: string) => readFileSync(join(pipe.buildRoot, contentKey(body, preamble), 'input.aux'), 'latin1');

test('an \\addcontentsline in a TikZ node is written as LaTeX writes it', async () => {
  const body = 'Text before.\n\\begin{tikzpicture}\\node {Inside the node.\\addcontentsline{toc}{section}{An entry}};\\end{tikzpicture}\nText after.';
  await capture(body);
  const aux = auxOf(body, '');
  assert.ok(aux.split('\n').includes(ENTRY), aux);
  assert.ok(!aux.includes('\0'));
});

const NO_TCOLORBOX = !kpsewhich('tcolorbox.sty') && 'tcolorbox is not installed';
test('an \\addcontentsline in a tcolorbox is written as LaTeX writes it', { skip: NO_TCOLORBOX }, async () => {
  const body = 'Text before.\n\\begin{tcolorbox}\nInside the box.\\addcontentsline{toc}{section}{An entry}\n\\end{tcolorbox}\nText after.';
  const preamble = '\\usepackage{tcolorbox}';
  await capture(body, preamble);
  const aux = auxOf(body, preamble);
  assert.ok(aux.split('\n').includes(ENTRY), aux);
  assert.ok(!aux.includes('\0'));
});

// ── A display TeX fails at a wider measure only ─────────────────────────────
// The display model compiles the document again at wider measures. A package
// may fail at one of them (its arithmetic overflowing at a width the author
// never used) where the document itself compiles: that sample is taken at the
// widest width below it that compiles, and the log names the width that
// failed, TeX's error and the width used.

test('a display TeX fails above a width only: the sample is taken below it, with a warning', async () => {
  const preamble = '\\newdimen\\owntextwidth\n\\AtBeginDocument{\\global\\owntextwidth=\\textwidth}';
  const body = 'Text before.\n\\[ \\ifdim\\textwidth>\\dimexpr\\owntextwidth+200pt\\relax \\errmessage{Too wide}\\fi x = 1 \\]\nText after.';
  const d = await capture(body, preamble);
  assert.equal(d.content.filter(it => it.kind === 'display').length, 1);
  assert.equal(d.display_model, true, 'the displays are modelled');
  const key = contentKey(body, preamble);
  const own = d.source_width / 65536;
  const mine = pipeLog.records().filter(r => r.details.block === `${key} (${key})`);
  // +256 pt fails; (128, 256) pt bisected to 4 pt: 192, 224, 208, 200, 204
  assert.deepEqual(mine.filter(r => r.level === 'warning').map(r => [r.code, r.details.failed, r.details.error, r.details.used]),
    [['display-sample-replaced', String(own + 256), '! Too wide.', String(own + 200)]]);
  assert.deepEqual(mine.filter(r => r.code === 'display-model-stable').map(r => r.details.widths), [`${own}, ${own + 128}, ${own + 200}`]);
});

// ── A paragraph's shape ─────────────────────────────────────────────────────
// \parshape and \hangindent give a paragraph's lines their own bands. Each is
// recorded from its first line on, up to TeX's last special line, then one
// for every line after; a display takes the band of its own line.

test('a paragraph shaped by \\hangindent or \\parshape records the band of each line', async () => {
  const pt = 65536;
  const body = [
    'Plain text, one band for every line.',
    '',
    '\\hangindent=20pt \\hangafter=2 Two lines full, then hung.',
    '',
    '\\hangindent=-60pt \\hangafter=-6 Six lines short of the right edge, as beside a figure:',
    '\\[ x = y \\]',
    'and after the display, on line five: two more lines short, then full.',
    '',
    '\\parshape 3 0pt 300pt 10pt 280pt 20pt 260pt \\leftskip=3pt \\rightskip=4pt Three pairs.',
    '',
    '\\begin{itemize}\\item An item: one pair, every line the same.\\end{itemize}',
  ].join('\n');
  const d = await capture(body);
  const h = d.source_width;
  type Para = { indent?: number; width?: number; shape?: { indent?: number; width?: number }[] };
  const paras = d.content.filter(i => i.kind === 'paragraph').map(i => d.paragraphs[i.para! - 1] as Para);
  const bands = (p: Para) => p.shape?.map(b => [b.indent ?? 0, b.width ?? 0]);
  const hung = [0, h - 60 * pt];
  assert.equal(paras.length, 6);
  assert.equal(bands(paras[0]), undefined);
  assert.deepEqual([paras[0].indent ?? 0, paras[0].width], [0, h]);
  assert.deepEqual(bands(paras[1]), [[0, h], [0, h], [20 * pt, h - 20 * pt]]);
  assert.deepEqual(bands(paras[2]), [hung, hung, hung, hung, hung, hung, [0, h]]);
  // resumed after the display at line 5: one line before it, then its three
  assert.deepEqual(bands(paras[3]), [hung, hung, [0, h]]);
  assert.deepEqual(bands(paras[4]), [[3 * pt, 293 * pt], [13 * pt, 273 * pt], [23 * pt, 253 * pt]]);
  assert.deepEqual([paras[4].indent, paras[4].width], [3 * pt, 293 * pt]);
  // a list item: its one pair, as indent and width
  assert.equal(paras[5].shape, undefined);
  assert.ok(paras[5].indent! > 0 && paras[5].width! < h);
  // the display, on line 3 of the hung paragraph (TeX82 §1149)
  const display = d.content.find(i => i.kind === 'display') as Item & { display_width?: number; display_indent?: number };
  assert.deepEqual([display.display_indent, display.display_width], hung);
  // the block's data, as the page gets it
  const pb = readFileSync(join(pipe.buildRoot, contentKey(body, ''), 'nodelist.pb'));
  const doc = messageType('Document').toObject(messageType('Document').decode(pb)) as { paragraphs: Para[] };
  assert.deepEqual(doc.paragraphs.map(bands).filter(Boolean), paras.map(bands).filter(Boolean));
});

// ── What the caller gives: a document or a snippet, and its metadata ────────
// The caller says which (kind); the text is never read to decide. A snippet
// is set in the caller's preamble, or in DEFAULT_PREAMBLE without one. The
// caller's \DocumentMetadata applies to a document that sets none; the
// document's own wins, unless the caller forces its own (then the document's
// is ignored, with a warning in the log). Which metadata won is read from
// the document's properties (\GetDocumentProperties{document/lang}).
const kinds = new Pipeline({ buildRoot: join(root, 'build-kinds'), fontsDir: join(root, 'fonts'), log: new Log('pipeline') });
/** The text of what the pipeline made of `content`, and its warnings. */
async function compiled(content: string, preamble: string, o: Omit<CompileOptions, 'key' | 'preamble'>): Promise<{ text: string; warnings: string[] }> {
  const key = contentKey(`${o.kind}\n${JSON.stringify(o.documentMetadata ?? null)}\n${content}`, preamble);
  await kinds.compile(content, { ...o, preamble, key });
  const d: Output = JSON.parse(readFileSync(join(kinds.buildRoot, key, 'output.json'), 'utf8'));
  return { text: d.paragraphs.map(p => glyphText(p.nodes)).join(' '), warnings: (kinds.diagnostics.get(key) ?? []).map(w => w.message) };
}
const LANG = 'Lang:~\\GetDocumentProperties{document/lang}.';
const doc = (meta: string) => `${meta}\\documentclass{article}\n\\begin{document}\n${LANG}\n\\end{document}\n`;

test('a document, compiled as it is, with the caller\'s preamble read at the end of its own', async () => {
  const r = await compiled('\\documentclass{book}\n\\begin{document}\n\\chaptername, \\mine.\n\\end{document}\n', '\\newcommand\\mine{mine}', { kind: 'document' });
  assert.equal(r.text, 'Chapter,mine.');
});

test('a snippet in the caller\'s preamble, and in the default one without it', async () => {
  assert.equal((await compiled('\\chaptername.', '\\documentclass{book}', { kind: 'snippet' })).text, 'Chapter.');
  // DEFAULT_PREAMBLE: article with mathtools (\coloneqq)
  assert.match((await compiled('$a\\coloneqq b$ \\refname.', '', { kind: 'snippet' })).text, /References\.$/);
});

test('text with a class line passed as a snippet is a snippet: set in the preamble, and TeX says the rest', async () => {
  const r = await compiled('\\documentclass{book}\nBody.', '', { kind: 'snippet' });
  assert.match(r.text, /Body\.$/);
  assert.ok(r.warnings.some(w => /^LaTeX Error: Can be used only in preamble\./.test(w)), r.warnings.join('\n'));
});

test('the caller\'s metadata: applied to a document without its own', async () => {
  assert.equal((await compiled(doc(''), '', { kind: 'document', documentMetadata: { keys: 'lang=de' } })).text, 'Lang:de.');
});

test('the caller\'s metadata: the document\'s own kept', async () => {
  const r = await compiled(doc('\\DocumentMetadata{lang=en}\n'), '', { kind: 'document', documentMetadata: { keys: 'lang=de' } });
  assert.equal(r.text, 'Lang:en.');
  assert.ok(!r.warnings.some(w => /reflowtex/.test(w) || /is ignored/.test(w)), r.warnings.join('\n'));
});

test('the caller\'s metadata, forced: applied, and the document\'s own ignored with a warning naming its keys', async () => {
  const r = await compiled(doc('\\DocumentMetadata{lang=en}\n'), '', { kind: 'document', documentMetadata: { keys: 'lang=de', force: true } });
  assert.equal(r.text, 'Lang:de.');
  assert.ok(r.warnings.some(w => /DocumentMetadata is ignored, the caller's is forced\. Ignored keys: lang=en\.?$/.test(w)), r.warnings.join('\n'));
});

test('the caller\'s metadata applies to a snippet', async () => {
  assert.equal((await compiled(LANG, '', { kind: 'snippet', documentMetadata: { keys: 'lang=de' } })).text, 'Lang:de.');
});

// ── TeX errors ──────────────────────────────────────────────────────────────
// The build stops only where lualatex gives the author nothing (TeX stopped,
// no output). An error TeX carries on past leaves what plain lualatex leaves:
// the block is built as TeX set it, and the error is a warning, in the
// build's log and in the block's data; texErrors: 'error' fails it instead.

test('an undefined control sequence in the body: the block is built, and the warning names it', async () => {
  const body = 'Before \\undefinedmacro after.';
  const d = await capture(body) as Output & { warnings?: { code: string; message: string }[] };
  assert.equal(d.paragraphs.map(p => glyphText(p.nodes)).join(' '), 'Beforeafter.');
  const key = contentKey(body, '');
  const mine = pipeLog.records().filter(r => r.code === 'tex-error' && r.details.block === `${key} (${key})`);
  // the snippet is set in DEFAULT_PREAMBLE (4 lines) after \\begin{document}: line 6
  assert.deepEqual(mine.map(r => [r.level, r.details.error, r.details.file, r.details.line, r.details.context, r.details.count]),
    [['warning', '! Undefined control sequence.', './reflowtex-document.tex', '6', 'Before \\undefinedmacro', '1']]);
  assert.match(mine[0].message, /: warning: TeX error: Undefined control sequence\. \(\.\/reflowtex-document\.tex:6: Before \\undefinedmacro\)$/);
  assert.deepEqual(d.warnings?.filter(w => w.code === 'tex-error').map(w => w.message), [mine[0].message.replace(/^.*: warning: /, '')],
    'the block\'s data carries it to the page\'s log');
});

test('texErrors: \'error\': the same error fails the block, with TeX\'s error line', async () => {
  const strict = new Pipeline({ buildRoot: join(root, 'build-strict'), fontsDir: join(root, 'fonts'), log: new Log('pipeline'), texErrors: 'error' });
  await assert.rejects(strict.compile('Before \\undefinedmacro after.', { kind: 'snippet', key: 'strict' }), (e: Error) => e instanceof TexError &&
    /^strict: lualatex reported 1 error\(s\) \(nonstopmode continued, so the node list would be silently wrong\):\n  ! Undefined control sequence\./.test(e.message));
});

test('a missing class: TeX stops, and so does the build (TexError)', async () => {
  await assert.rejects(compiled('\\documentclass{nosuchclass}\n\\begin{document}\nText.\n\\end{document}\n', '', { kind: 'document' }),
    (e: Error) => e instanceof TexError && /lualatex failed \(exit code 1, ! Emergency stop\.\)/.test(e.message) &&
      /File `nosuchclass\.cls' not found/.test(e.message));
});
