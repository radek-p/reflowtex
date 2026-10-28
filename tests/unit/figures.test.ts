// SPDX-License-Identifier: AGPL-3.0-or-later
// EPS and PostScript figures, converted to PDF before TeX runs (figures.ts):
// which files a document can reach and the names epstopdf asks for them by,
// what epstopdf's log says it asked for, and – where lualatex and repstopdf
// are installed – a run that includes them with shell escape off, not even
// restricted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertedName, convertFigure, figureSources, findConvertibleFigures, requestedFigures, FIGURES_DIR } from '../../src/pipeline/figures.ts';
import { runLuaLatex } from '../../src/pipeline/lualatex.ts';
import { Pipeline } from '../../src/pipeline/pipeline.ts';
import { TexError } from '../../src/pipeline/errors.ts';
import { Log } from '../../src/shared/log.ts';

const has = (cmd: string, arg = '--version') => { try { execFileSync(cmd, [arg], { stdio: 'ignore' }); return true; } catch { return false; } };
const tools = has('lualatex') && has('repstopdf', '--help') ? false : 'lualatex or repstopdf (TeX Live\'s epstopdf, with Ghostscript) not installed';
const converter = has('repstopdf', '--help') ? false : 'repstopdf (TeX Live\'s epstopdf, with Ghostscript) not installed';

/** A hand-written EPS: a frame and a label, its %%HiResBoundingBox inside its
 *  %%BoundingBox. */
const EPS = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 12 20 132 68
%%HiResBoundingBox: 12.4 20.3 131.6 67.8
%%EndComments
0 0 1 setrgbcolor newpath 14 22 moveto 116 0 rlineto 0 44 rlineto -116 0 rlineto closepath stroke
/Times-Roman findfont 14 scalefont setfont 22 40 moveto (EPS: x + y) show
showpage
%%EOF
`;
/** An EPS Ghostscript stops on. */
const BROKEN = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n%%EndComments\nno-such-operator\nshowpage\n';

const tmp = (what: string) => mkdtempSync(join(tmpdir(), `rtx-figures-${what}-`));
const write = (p: string, text: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); };

test('the figures a document can reach: every .eps and .ps under its directories, by the name graphicx asks for', () => {
  const root = tmp('find');
  try {
    const a = join(root, 'a'), b = join(root, 'b');
    for (const f of ['x.eps', 'figs/y.EPS', 'figs/deeper/z.ps', 'figs/pic.pdf', '.hidden/h.eps', 'figs/.h.eps', 'build/run.eps']) write(join(a, f), EPS);
    for (const f of ['x.eps', 'w.eps']) write(join(b, f), EPS);
    symlinkSync(join(a, 'figs'), join(b, 'linked'));        // a link to a directory is not followed
    const found = findConvertibleFigures([a, b], [join(a, 'build')]);
    assert.deepEqual(found.map(f => f.name), ['figs/deeper/z.ps', 'figs/y.EPS', 'w.eps', 'x.eps']);
    assert.equal(found.find(f => f.name === 'x.eps')!.file, join(a, 'x.eps'), 'a name two directories hold is the first one\'s');
    assert.deepEqual(findConvertibleFigures([join(root, 'none')]), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the PDF\'s name: epstopdf-base\'s, the name without its extension, -<extension>-converted-to.pdf', () => {
  assert.equal(convertedName('x.eps'), 'x-eps-converted-to.pdf');
  assert.equal(convertedName('figs/y.EPS'), 'figs/y-EPS-converted-to.pdf');
  assert.equal(convertedName('a.b/c.d.ps'), 'a.b/c.d-ps-converted-to.pdf');
});

test('what epstopdf asked for, from its log: lines TeX broke at 79 bytes joined', () => {
  const long = 'figures/a-figure-with-a-name-long-enough-to-be-broken-across-two-lines';
  const wrap = (s: string) => s.match(/.{1,79}/g)!.join('\n');
  const log = [
    'Package epstopdf Info: Source file: <x.eps>',
    '(epstopdf)                    date: 2026-10-28 10:00:00',
    '(epstopdf)                    size: 274 bytes',
    '(epstopdf)             Output file: <x-eps-converted-to.pdf>',
    '(epstopdf)             Command: <repstopdf --outfile=x-eps-converted-to.pdf x.eps>',
    '(epstopdf)             \\includegraphics on input line 4.',
    'Package epstopdf Info: Output file is already uptodate.',
    wrap(`Package epstopdf Info: Source file: <${long}.eps>`),
    wrap(`(epstopdf)             Output file: <./conv/${long.slice(8)}-eps-converted-to.pdf>`),
    '(epstopdf)             \\includegraphics on input line 5.',
    'Package epstopdf Info: Source file: <no-output.eps>',
    'Something else.',
  ].join('\n');
  assert.deepEqual(requestedFigures(log), [
    { source: 'x.eps', output: 'x-eps-converted-to.pdf' },
    { source: `${long}.eps`, output: `./conv/${long.slice(8)}-eps-converted-to.pdf` },
  ]);
});

test('a converted figure\'s page is its %%BoundingBox, as epstopdf makes it; a broken one says why', { skip: converter }, async () => {
  const root = tmp('convert');
  try {
    write(join(root, 'f.eps'), EPS);
    write(join(root, 'bad.eps'), BROKEN);
    const first = await convertFigure(join(root, 'f.eps'), join(root, 'cache'));
    assert.equal(first.converted, true);
    const again = await convertFigure(join(root, 'f.eps'), join(root, 'cache'));
    assert.deepEqual(again, { pdf: first.pdf, converted: false }, 'converted once, by its bytes');
    const mupdf = await import('mupdf');
    const page = mupdf.Document.openDocument(readFileSync(first.pdf), 'application/pdf').loadPage(0);
    assert.deepEqual(page.getBounds(), [0, 0, 120, 48]);
    await assert.rejects(convertFigure(join(root, 'bad.eps'), join(root, 'cache')), /repstopdf (failed|wrote no PDF)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a run that converts figures has shell escape off, not even restricted: TeX runs no program', { skip: tools }, async () => {
  const root = tmp('shell');
  try {
    const src = join(root, 'src'), run = join(root, 'run'), control = join(root, 'control');
    write(join(src, 'figure.eps'), EPS);
    write(join(src, 'figs', 'inner.eps'), EPS);
    // repstopdf is on TeX Live's restricted whitelist: with shell escape
    // restricted, this runs it (the control run shows it does)
    const probe = ['\\directlua{texio.write_nl("shell escape: " .. status.shell_escape)}',
      '\\ShellEscape{repstopdf --outfile=ran.pdf probe.eps}'];
    for (const d of [run, control]) write(join(d, 'probe.eps'), EPS);
    write(join(control, 'input.tex'), ['\\documentclass{article}', '\\usepackage{shellesc}', '\\begin{document}', ...probe, 'Text.', '\\end{document}', ''].join('\n'));
    await runLuaLatex(control, { texinputs: [], passes: 1, expect: 'input.pdf', block: 'control', shellEscape: 'restricted' });
    assert.match(readFileSync(join(control, 'input.log'), 'utf8'), /^shell escape: 2$/m, 'restricted is 2');
    assert.ok(existsSync(join(control, 'ran.pdf')), 'restricted shell escape runs repstopdf');
    write(join(run, 'input.tex'), [
      '\\documentclass{article}', '\\usepackage{graphicx}', '\\usepackage{shellesc}', '\\begin{document}', ...probe,
      '\\includegraphics{figure.eps} \\includegraphics{figure} \\includegraphics{figs/inner}', '\\end{document}', ''].join('\n'));
    const log = new Log('pipeline');
    await runLuaLatex(run, { texinputs: [src], passes: 1, expect: 'input.pdf', block: 'shell', log });
    const tex = readFileSync(join(run, 'input.log'), 'utf8');
    assert.match(tex, /^shell escape: 0$/m, 'status.shell_escape is 0: off');
    assert.equal(existsSync(join(run, 'ran.pdf')), false, 'the whitelisted converter did not run');
    assert.match(tex, /Package epstopdf Info: Output file is already uptodate/);
    assert.ok(existsSync(join(run, FIGURES_DIR, 'figs', 'inner-eps-converted-to.pdf')));
    assert.deepEqual([...figureSources(run).values()].sort(), [join(src, 'figs', 'inner.eps'), join(src, 'figure.eps')]);
    assert.deepEqual(log.records().map(r => r.code), ['figures-converted']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('epstopdf\'s own settings (outdir): the PDF put where it asks, and TeX run again', { skip: tools }, async () => {
  const root = tmp('outdir');
  try {
    const src = join(root, 'src'), run = join(root, 'run');
    write(join(src, 'figs', 'figure.eps'), EPS);
    write(join(run, 'input.tex'), ['\\documentclass{article}', '\\usepackage{graphicx}', '\\usepackage{epstopdf}',
      '\\epstopdfsetup{outdir=./converted/}', '\\begin{document}', '\\includegraphics{figs/figure}', '\\end{document}', ''].join('\n'));
    await runLuaLatex(run, { texinputs: [src], passes: 1, expect: 'input.pdf', block: 'outdir', log: new Log('pipeline') });
    assert.ok(existsSync(join(run, 'converted', 'figure-eps-converted-to.pdf')));
    assert.equal(figureSources(run).get(join(run, 'converted', 'figure-eps-converted-to.pdf')), join(src, 'figs', 'figure.eps'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a figure that does not convert: a warning naming it and why, and TeX\'s error for the missing PDF', { skip: tools }, async () => {
  const root = tmp('failed');
  try {
    const src = join(root, 'src'), run = join(root, 'run');
    write(join(src, 'bad.eps'), BROKEN);
    write(join(run, 'input.tex'), '\\documentclass{article}\\usepackage{graphicx}\\begin{document}\\includegraphics{bad}\\end{document}\n');
    const log = new Log('pipeline');
    // TeX carries on past a missing figure: its error is the run's, as for any figure that is not there
    const r = await runLuaLatex(run, { texinputs: [src], passes: 1, expect: 'input.pdf', block: 'failed', log });
    assert.ok(r.errors.some(e => /File `bad-eps-converted-to\.pdf' not found/.test(e.message)), r.errors.map(e => e.message).join('\n'));
    // and stops the build where the caller asks for that
    await assert.rejects(runLuaLatex(run, { texinputs: [src], passes: 1, expect: 'input.pdf', block: 'failed', log, texErrors: 'error' }),
      (e: Error) => e instanceof TexError && /File `bad-eps-converted-to\.pdf' not found/.test(e.message));
    const w = log.records().filter(r => r.code === 'figure-convert-failed');
    assert.equal(w.length, 1);
    assert.equal(w[0].level, 'warning');
    assert.equal(w[0].details.file, join(src, 'bad.eps'));
    assert.match(w[0].details.reason, /repstopdf/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('through the pipeline: the figure drawn, by any name graphicx finds it under, and the EPS, not its PDF, recorded as what the block read', { skip: tools }, async () => {
  const root = tmp('pipeline');
  try {
    const src = join(root, 'src');
    write(join(src, 'figure.eps'), EPS);
    const pipe = new Pipeline({ buildRoot: join(root, 'build'), fontsDir: join(root, 'fonts'), searchDirs: [src], mathml: false, log: new Log('pipeline') });
    // ./figure: not along TEXINPUTS, but through \\input@path (the template)
    await pipe.compile('A figure: \\includegraphics{figure.eps}, \\includegraphics[width=30pt]{figure} and \\includegraphics[width=20pt]{./figure}.', { kind: 'snippet', key: 'eps' });
    assert.deepEqual(Object.keys(pipe.inputs.get('eps')!), [join(src, 'figure.eps')]);
    const data = JSON.parse(readFileSync(join(root, 'build', 'eps', 'output.json'), 'utf8')) as { pictures: { svg: string }[] };
    assert.ok(data.pictures.length >= 1);
    for (const p of data.pictures) assert.match(p.svg, /data-text/, 'its label drawn as text');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
