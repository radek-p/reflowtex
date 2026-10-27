// SPDX-License-Identifier: AGPL-3.0-or-later
// The render tests' machinery: build a case, serve it, compare it.
//
// A case at a width is three steps, each a tool in tools/pageless-pdf:
//  1. pageless.ts compiles the document to a pageless PDF – one page as tall
//     as the document, every glyph where TeX put it – at the document's own
//     width plus `extra` pt;
//  2. site-from-run.ts builds a viewer page from the run at the document's own
//     width (once per case: every width is shown by the same page);
//  3. vector-compare.ts opens the page in Chromium with its column pinned to
//     the PDF's width and matches each glyph the viewer drew with the PDF's.
//
// A case with `against_plain` is also compiled as its author would compile it,
// with plain lualatex in a copy of its directory, shell escape restricted as
// TeX Live has it by default, and the strip at its own width is checked against that
// PDF (againstPlain): the pipeline's compile must typeset the document as
// LaTeX does, or the browser would be measured against the wrong reference.
//
// A case with `tex_pictures` has its PDFs drawn with TeX's own TikZ pictures,
// and its page built from a run of its own (build/<case>/site-run/), made as
// the pipeline makes it: pictures captured.
//
// Builds go to tests/render/build/<case>/ (ignored by git).
import { appendFileSync, copyFileSync, cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageless } from '../../tools/pageless-pdf/pageless.ts';
import { siteFromRun } from '../../tools/pageless-pdf/site-from-run.ts';
import { traceStrip, vectorCompare } from '../../tools/pageless-pdf/vector-compare.ts';
import { runLuaLatex } from '../../src/pipeline/lualatex.ts';
import { serveDirectory } from '../../tools/lib/static-server.ts';
import { cases as settings, defaults, type CaseSettings } from './cases.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../..');
export const BUILD = join(HERE, 'build');

export interface Case extends CaseSettings {
  name: string; file: string; widths: number[]; tolerance: number; passes: number;
  /** the target every case is to meet (defaults.tolerance) */
  target: number;
}

/** Every case with its settings: cases/*.tex, and cases.ts's entries. */
export function allCases(): Map<string, Case> {
  const names = new Set([...readdirSync(join(HERE, 'cases')).filter(f => f.endsWith('.tex')).map(f => f.slice(0, -4)).sort(), ...Object.keys(settings)]);
  return new Map([...names].map(name => {
    const s = settings[name] ?? {};
    return [name, { ...defaults, ...s, name, target: defaults.tolerance,
      file: s.file ? join(REPO, s.file) : join(HERE, 'cases', `${name}.tex`),
      plain_file: s.plain_file ? join(REPO, s.plain_file) : undefined,
      template: s.template ? join(REPO, s.template) : undefined } as Case];
  }));
}

export const buildDir = (c: Case, extra: number) => join(BUILD, c.name, extra ? `w${extra > 0 ? '+' : ''}${extra}` : 'w0');

/** A tool's lines, into a log file beside what it built. */
// Nothing is fetched while tests run: the image's lualatex wrapper installs
// no missing package (docker/lualatex-autoinstall.sh); what the tests need is
// in docker/test-packages.txt. (REFLOWTEX_NO_AUTOINSTALL=0 lets it, to find
// what a new fixture needs.)
process.env.REFLOWTEX_NO_AUTOINSTALL ??= '1';

const logTo = (file: string) => { writeFileSync(file, ''); return (s: string) => appendFileSync(file, `${s}\n`); };

async function pagelessRun(c: Case, extra: number, out = buildDir(c, extra), texPictures = c.tex_pictures): Promise<string> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await pageless(c.file, { out, passes: c.passes, widthExtra: `${extra}pt`, template: c.template, texPictures, log: logTo(join(out, 'pageless.log')) });
  return out;
}

const sites = new Map<string, Promise<string>>();
/** The viewer page of a case, from its run at its own width (built once). */
function site(c: Case): Promise<string> {
  if (!sites.has(c.name)) sites.set(c.name, (async () => {
    const base = c.tex_pictures ? join(BUILD, c.name, 'site-run') : buildDir(c, 0);
    // Always compiled afresh (once per session, by the map above): a run kept
    // from an earlier session was made by whatever template and serializer
    // were current then, and the page would test those.
    await pagelessRun(c, 0, base, false);
    const out = join(base, 'site');
    rmSync(out, { recursive: true, force: true });
    await siteFromRun(base, out, { log: logTo(join(base, 'site.log')) });
    return out;
  })());
  return sites.get(c.name)!;
}

export interface Vector {
  hsize_pt: number; window_pt: number;
  glyphs: { strip: number; viewer: number; matched: number };
  matched: { y: number; text: string; dx: number; dy: number }[];
  rules: { y: number; off?: number; dx?: number; dy?: number; unmatched?: boolean }[];
  rules_missing: { y: number }[];
}

/** The PDF at this width against the case's page: vector.json, with strip.png and
 *  viewer.png beside it for the report (report/). `page` is the page's folder,
 *  relative to build/. */
export async function compare(c: Case, extra: number, urlRoot: string): Promise<{ v: Vector; page: string }> {
  const dir = await site(c);
  const strip = extra || c.tex_pictures ? await pagelessRun(c, extra) : buildDir(c, 0);
  const page = relative(BUILD, dir).split(sep).join('/');
  const v = await vectorCompare(strip, `${urlRoot}/${page}/index.html`, { out: join(strip, 'vector'), lineTol: c.tolerance, images: true, log: logTo(join(strip, 'compare.log')) }) as unknown as Vector;
  return { v, page };
}

/** How far (pt) a glyph of the strip may be from plain lualatex's: what the two
 *  PDFs can tell apart. Down, positions are written to a thousandth of a bp
 *  or finer; across, a glyph in a line is placed to a thousandth of an em (0.01 pt
 *  in 10 pt type), from a margin that differs between the two. */
export const PLAIN_TOLERANCE = { across: 0.025, down: 0.002 };

export interface PlainCheck {
  /** glyphs in the strip, and on plain lualatex's page */
  glyphs: { strip: number; plain: number };
  /** the largest offsets (pt), and the first glyph past PLAIN_TOLERANCE */
  worst: { across: number; down: number }; first?: { index: number; x: number; y: number; dx: number; dy: number };
}

/** The strip at the case's own width against plain lualatex's PDF of the same
 *  document (build/<case>/plain/input.pdf), glyph by glyph in the order TeX
 *  shipped them, each relative to the first: where the page has a glyph, the
 *  strip must have it at the same distance from the first one (plain lualatex
 *  compiles the case's `plain_file` instead, when it has one). On one page TeX
 *  sets every line as on the galley, so the document must fit on one, with
 *  nothing the page adds or the strip leaves out – no page number
 *  (\pagestyle{empty}), footnotes or floats. */
export async function againstPlain(c: Case): Promise<PlainCheck> {
  await site(c);
  const strip = c.tex_pictures ? await pagelessRun(c, 0) : buildDir(c, 0);
  const out = join(BUILD, c.name, 'plain');
  rmSync(out, { recursive: true, force: true });
  // as its author compiles it: in its directory (a copy), with TeX Live's
  // default shell escape, restricted – epstopdf converts an EPS figure there
  cpSync(dirname(c.file), out, { recursive: true });
  copyFileSync(c.plain_file ?? c.file, join(out, 'input.tex'));
  await runLuaLatex(out, { texinputs: [dirname(c.file)], passes: c.passes, expect: 'input.pdf', block: c.name, shellEscape: 'restricted' });
  const s = traceStrip(join(strip, 'pageless.pdf')).glyphs, p = traceStrip(join(out, 'input.pdf')).glyphs;
  const r: PlainCheck = { glyphs: { strip: s.length, plain: p.length }, worst: { across: 0, down: 0 } };
  for (let i = 0; i < Math.min(s.length, p.length); i++) {
    const dx = (s[i][0] - s[0][0]) - (p[i][0] - p[0][0]), dy = (s[i][1] - s[0][1]) - (p[i][1] - p[0][1]);
    r.worst.across = Math.max(r.worst.across, Math.abs(dx));
    r.worst.down = Math.max(r.worst.down, Math.abs(dy));
    if ((Math.abs(dx) > PLAIN_TOLERANCE.across || Math.abs(dy) > PLAIN_TOLERANCE.down) && !r.first)
      r.first = { index: i, x: s[i][0], y: s[i][1], dx, dy };
  }
  return r;
}

/** build/ over HTTP on a free port, for the run. */
export function serve(): Promise<{ url: string; server: Server }> {
  mkdirSync(BUILD, { recursive: true });
  return serveDirectory(BUILD);
}

/** The largest offset (pt, across or down) of a matched glyph, and of a
 *  matched rule – the farthest one of its corners is from TeX's (null when the
 *  browser drew no rules). */
export function worst(v: Vector): [number, number | null] {
  // (a loop, not Math.max(...list): a long document has more glyphs than the stack has room for arguments)
  const g = v.matched.reduce((w, m) => Math.max(w, Math.abs(m.dx), Math.abs(m.dy)), 0);
  const rs = v.rules.filter(r => r.off !== undefined).map(r => r.off!);
  return [g, rs.length ? rs.reduce((w, x) => Math.max(w, x), -Infinity) : null];
}

const f3 = (x: number) => x.toFixed(3);
const signed = (x: number) => `${x >= 0 ? '+' : ''}${f3(x)}`;

/** What is wrong in a comparison, in words; empty when it passes. */
export function problems(v: Vector, tolerance: number, ruleTolerance?: number, rulesMissing = 0): string[] {
  const out: string[] = [];
  const g = v.glyphs;
  if (!g.strip) out.push('the PDF has no glyphs');
  if (g.viewer !== g.strip) out.push(`the browser drew ${g.viewer} glyphs, TeX ${g.strip}`);
  if (g.matched !== g.viewer) out.push(`${g.viewer - g.matched} of the browser's glyphs have no glyph in the PDF within ${v.window_pt} pt`);
  const off = [...v.matched].sort((a, b) => Math.max(Math.abs(b.dx), Math.abs(b.dy)) - Math.max(Math.abs(a.dx), Math.abs(a.dy)))
    .filter(m => Math.max(Math.abs(m.dx), Math.abs(m.dy)) > tolerance);
  if (off.length) out.push(`${off.length} glyphs off by more than ${tolerance} pt: ` +
    off.slice(0, 5).map(m => `${JSON.stringify(m.text)} at y ${m.y} off by (${signed(m.dx)}, ${signed(m.dy)})`).join(', '));
  const unmatched = v.rules.filter(r => r.unmatched);
  if (unmatched.length) out.push(`${unmatched.length} rules drawn by the browser are not in the PDF`);
  if (v.rules_missing.length > rulesMissing)
    out.push(`${v.rules_missing.length} rules in the PDF the browser did not draw (${rulesMissing} allowed): ` +
      v.rules_missing.slice(0, 5).map(r => `at y ${r.y}`).join(', '));
  const rt = ruleTolerance ?? tolerance;
  const rulesOff = v.rules.filter(r => r.off !== undefined && r.off > rt).sort((a, b) => b.off! - a.off!);
  if (rulesOff.length) out.push(`${rulesOff.length} rules off by more than ${rt} pt: ` +
    rulesOff.slice(0, 5).map(r => `at y ${r.y} (corners ${f3(r.off!)} off; centre ${signed(r.dx!)}, ${signed(r.dy!)})`).join(', '));
  return out;
}
