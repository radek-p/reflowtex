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
// Builds go to tests/render/build/<case>/ (ignored by git).
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageless } from '../../tools/pageless-pdf/pageless.ts';
import { siteFromRun } from '../../tools/pageless-pdf/site-from-run.ts';
import { vectorCompare } from '../../tools/pageless-pdf/vector-compare.ts';
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
      template: s.template ? join(REPO, s.template) : undefined } as Case];
  }));
}

export const buildDir = (c: Case, extra: number) => join(BUILD, c.name, extra ? `w${extra > 0 ? '+' : ''}${extra}` : 'w0');

/** A tool's lines, into a log file beside what it built. */
const logTo = (file: string) => { writeFileSync(file, ''); return (s: string) => appendFileSync(file, `${s}\n`); };

async function pagelessRun(c: Case, extra: number): Promise<string> {
  const out = buildDir(c, extra);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await pageless(c.file, { out, passes: c.passes, widthExtra: `${extra}pt`, template: c.template, log: logTo(join(out, 'pageless.log')) });
  return out;
}

const sites = new Map<string, Promise<string>>();
/** The viewer page of a case, from its run at its own width (built once). */
function site(c: Case): Promise<string> {
  if (!sites.has(c.name)) sites.set(c.name, (async () => {
    const base = buildDir(c, 0);
    if (!existsSync(join(base, 'pageless.pdf'))) await pagelessRun(c, 0);
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

/** The PDF at this width against the case's page: vector.json. */
export async function compare(c: Case, extra: number, urlRoot: string): Promise<Vector> {
  const page = await site(c);
  const strip = extra ? await pagelessRun(c, extra) : buildDir(c, 0);
  const rel = relative(BUILD, page).split(sep).join('/');
  return await vectorCompare(strip, `${urlRoot}/${rel}/index.html`, { out: join(strip, 'vector'), lineTol: c.tolerance, log: logTo(join(strip, 'compare.log')) }) as unknown as Vector;
}

/** build/ over HTTP on a free port, for the run. */
export function serve(): Promise<{ url: string; server: Server }> {
  mkdirSync(BUILD, { recursive: true });
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.otf': 'font/otf', '.svg': 'image/svg+xml' };
  const server = createServer((req, res) => {
    let file = normalize(join(BUILD, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
    if (!file.startsWith(BUILD)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => {
    const a = server.address() as { port: number };
    ok({ url: `http://127.0.0.1:${a.port}`, server });
  }));
}

/** The largest offset (pt, across or down) of a matched glyph, and of a
 *  matched rule – the farthest one of its corners is from TeX's (null when the
 *  browser drew no rules). */
export function worst(v: Vector): [number, number | null] {
  const g = Math.max(0, ...v.matched.map(m => Math.max(Math.abs(m.dx), Math.abs(m.dy))));
  const rs = v.rules.filter(r => r.off !== undefined).map(r => r.off!);
  return [g, rs.length ? Math.max(...rs) : null];
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
