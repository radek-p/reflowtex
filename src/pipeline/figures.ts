// SPDX-License-Identifier: AGPL-3.0-or-later
// EPS and PostScript figures, converted to PDF before TeX runs.
//
// LuaTeX includes PDF, PNG and JPEG files, not PostScript. LaTeX's own route
// for an EPS figure is epstopdf-base, which TeX Live's graphics.cfg loads for
// every LuaTeX document: \includegraphics{figs/x.eps}, or {figs/x} found as
// figs/x.eps, includes figs/x-eps-converted-to.pdf, which epstopdf makes first
// by running repstopdf – when shell escape lets TeX run it. The pipeline runs
// TeX with shell escape off (lualatex.ts), and keeps it off for this: Lua is
// no way round, since LuaTeX's os.execute and io.popen obey the same switch.
// So the pipeline converts every .eps and .ps file the document can reach
// before TeX runs, with the program LaTeX would have called – TeX Live's
// repstopdf, which runs Ghostscript with -dSAFER and sizes the page by the
// figure's %%BoundingBox, as LaTeX users get it – and puts each PDF where
// epstopdf then looks for it. epstopdf finds it up to date and includes it:
// nothing in LaTeX is redefined, and TeX runs no program.
//
// Where. The document's files are in its directories (TEXINPUTS), where a
// figure at figs/x.eps is reached by that name, through \graphicspath, or as
// ./figs/x.eps through \input@path (the template sets it from TEXINPUTS). Each
// run gets a directory of its own, converted-figures/, first on TEXINPUTS,
// holding every such figure under its name (a link to it) and its PDF beside
// it under epstopdf's name: whichever way graphicx finds the figure, it finds
// it there first, and epstopdf's PDF beside it.
//
// A document that changes epstopdf's settings (\epstopdfsetup{outdir=…}, a
// suffix of its own) or declares its own rule for .ps asks for other names.
// epstopdf names each in the log (Source file, Output file); after a pass, the
// PDF is put at each name asked for in vain (requestedFigures), and TeX runs
// again.
//
// A figure that does not convert is a warning (figure-convert-failed, naming
// the file and the reason), and its PDF is missing: TeX reports the missing
// file where the document includes it, as for any figure that is not there.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import type { Log } from '../shared/log.ts';

/** What the pipeline converts: PostScript, encapsulated or not. */
export const CONVERTIBLE = /\.(eps|ps)$/i;
/** The directory of a run that holds the figures and their PDFs. */
export const FIGURES_DIR = 'converted-figures';
/** Where a run records each PDF it put in place and the figure it came from. */
export const SOURCES_FILE = 'converted-figures.json';
/** The program that converts: TeX Live's epstopdf in its restricted mode,
 *  the one LaTeX runs under restricted shell escape. */
export const CONVERTER = 'repstopdf';
/** How long one figure may take (ms): REFLOWTEX_FIGURE_TIMEOUT (seconds), else 120 s. */
const TIMEOUT_MS = (Number(process.env.REFLOWTEX_FIGURE_TIMEOUT) || 120) * 1000;
/** How deep below a document's directory figures are looked for. */
const MAX_DEPTH = 8;

/** A figure the document can reach: its name relative to one of the
 *  document's directories (with / between parts), and the file. */
export interface ConvertibleFigure { name: string; file: string }

/** Every .eps and .ps file under `dirs`, by its name relative to the first
 *  directory holding it (a figure two directories hold under the same name is
 *  the first one's, as TEXINPUTS finds it). Hidden entries are passed over,
 *  links to directories are not followed, and `skip` (the run's own
 *  directories, when they lie inside one of `dirs`) is not entered. Sorted by
 *  name. */
export function findConvertibleFigures(dirs: readonly string[], skip: readonly string[] = []): ConvertibleFigure[] {
  const skipped = new Set(skip.map(d => resolve(d)));
  const found = new Map<string, string>();
  const walk = (dir: string, prefix: string, depth: number) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name), name = prefix + e.name;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !skipped.has(p)) walk(p, `${name}/`, depth + 1);
      } else if (CONVERTIBLE.test(e.name) && !found.has(name)) {
        try { if (statSync(p).isFile()) found.set(name, p); } catch { /* a broken link */ }
      }
    }
  };
  for (const d of dirs) {
    const dir = resolve(d);
    if (!skipped.has(dir)) walk(dir, '', 0);
  }
  return [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, file]) => ({ name, file }));
}

/** epstopdf-base's name for a figure's PDF with its default settings
 *  (\ETE@GenerateName: the name without its extension, then the suffix
 *  -\SourceExt-converted-to, then .pdf): figs/x.eps → figs/x-eps-converted-to.pdf. */
export function convertedName(name: string): string {
  const m = /^(.*)\.([^./]+)$/.exec(name);
  if (!m) throw new Error(`no extension: ${name}`);
  return `${m[1]}-${m[2]}-converted-to.pdf`;
}

/** The conversions epstopdf asked for in a run, as its log names them: each
 *  figure (Source file) and the PDF it is to be included as (Output file), by
 *  the names TeX had for them. TeX breaks a log line at 79 characters
 *  (max_print_line), so a line that long is joined with the next first. */
export function requestedFigures(log: string): { source: string; output: string }[] {
  const lines = log.split('\n');
  let text = '';
  for (const l of lines) text += l.length === 79 ? l : `${l}\n`;
  const out: { source: string; output: string }[] = [];
  const re = /^Package epstopdf Info: Source file: <([^>\n]*)>\n((?:\(epstopdf\)[^\n]*\n)*)/gm;
  for (const m of text.matchAll(re)) {
    const o = /^\(epstopdf\)\s+Output file: <([^>\n]*)>/m.exec(m[2]);
    if (o) out.push({ source: m[1], output: o[1] });
  }
  return out;
}

// ── Converting ──────────────────────────────────────────────────────────────

/** Run `cmd` in `cwd`, killed (with whatever it started) after `ms`; resolves
 *  with its exit and its stderr. */
function run(cmd: string, args: string[], cwd: string, ms: number): Promise<{ code: number | null; timedOut: boolean; stderr: string; error?: Error }> {
  return new Promise(res => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    let stderr = '', timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (p.pid && process.platform !== 'win32') process.kill(-p.pid, 'SIGKILL'); else p.kill('SIGKILL'); } catch { /* gone */ }
    }, ms);
    p.stderr.on('data', d => { stderr += d; });
    p.on('error', error => { clearTimeout(timer); res({ code: null, timedOut, stderr, error }); });
    p.on('close', code => { clearTimeout(timer); res({ code, timedOut, stderr }); });
  });
}

/** The PDF of `file` in `cache`, converted now (`converted`) or before, by
 *  the file's bytes; throws with the reason when it does not convert, and
 *  remembers the reason, so a later run does not try again. The converter is
 *  given names in its own directory: in restricted mode it reads and writes
 *  no other. */
export async function convertFigure(file: string, cache: string, timeoutMs = TIMEOUT_MS): Promise<{ pdf: string; converted: boolean }> {
  const key = createHash('sha256').update(`${CONVERTER}\0`).update(readFileSync(file)).digest('hex').slice(0, 32);
  const pdf = join(cache, `${key}.pdf`), failed = join(cache, `${key}.failed`);
  if (existsSync(pdf)) return { pdf, converted: false };
  if (existsSync(failed)) throw new Error(readFileSync(failed, 'utf8'));
  mkdirSync(cache, { recursive: true });
  const tmp = `${key}-${randomBytes(4).toString('hex')}`;
  copyFileSync(file, join(cache, `${tmp}.eps`));
  try {
    const r = await run(CONVERTER, [`--outfile=${tmp}.pdf`, `${tmp}.eps`], cache, timeoutMs);
    const detail = r.stderr.trim().split('\n').slice(-3).join(' / ').replaceAll(tmp, 'figure');
    let reason = '';
    if (r.error) reason = (r.error as NodeJS.ErrnoException).code === 'ENOENT'
      ? `${CONVERTER} (TeX Live's epstopdf, which runs Ghostscript) is not installed` : r.error.message;
    else if (r.timedOut) reason = `${CONVERTER} took longer than ${Math.round(timeoutMs / 1000)} s`;
    else if (r.code !== 0) reason = `${CONVERTER} failed (exit code ${r.code})${detail ? `: ${detail}` : ''}`;
    else if (!existsSync(join(cache, `${tmp}.pdf`)) || !readFileSync(join(cache, `${tmp}.pdf`)).subarray(0, 5).equals(Buffer.from('%PDF-')))
      reason = `${CONVERTER} wrote no PDF${detail ? `: ${detail}` : ''}`;
    if (reason) {
      // a missing converter is not the figure's fault: not remembered
      if (!r.error) writeFileSync(failed, reason);
      throw new Error(reason);
    }
    renameSync(join(cache, `${tmp}.pdf`), pdf);      // whole, or not at all: runs at once share the cache
    return { pdf, converted: true };
  } finally {
    rmSync(join(cache, `${tmp}.eps`), { force: true });
    rmSync(join(cache, `${tmp}.pdf`), { force: true });
  }
}

// ── A run's figures ─────────────────────────────────────────────────────────

/** Failures already reported to a log: each once, however many runs meet it. */
const reported = new WeakMap<Log, Set<string>>();

export interface FigureOptions {
  /** where converted PDFs are kept, by their figures' bytes, for later runs
   *  (default: <run>/converted-figures-cache) */
  cache?: string;
  log?: Log;
  /** how the document is named in messages */
  block?: string;
}

/** A run's converted figures, in place: `dir` goes first on TEXINPUTS. */
export interface RunFigures {
  dir: string;
  /** Put the PDF at each name epstopdf asked for in `log` and did not find:
   *  how many were put (TeX is to run again when any were). */
  placeRequested(log: string): number;
}

/** Convert the figures `dirs` hold (findConvertibleFigures) and put them in
 *  place for a run in `runDir`: null when there are none. */
export async function prepareFigures(runDir: string, dirs: readonly string[], o: FigureOptions = {}): Promise<RunFigures | null> {
  runDir = resolve(runDir);
  const dir = join(runDir, FIGURES_DIR), cache = resolve(o.cache ?? join(runDir, 'converted-figures-cache'));
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(runDir, SOURCES_FILE), { force: true });
  const figures = findConvertibleFigures(dirs, [runDir, cache]);
  if (!figures.length) return null;

  const pdfs = new Map<string, string>();       // figure file → its PDF
  const failures: { file: string; reason: string }[] = [];
  const files = [...new Set(figures.map(f => f.file))];
  let next = 0, fresh = 0;
  await Promise.all(Array.from({ length: Math.min(files.length, Math.max(1, Math.min(4, availableParallelism()))) }, async () => {
    for (let i = next++; i < files.length; i = next++) {
      try {
        const r = await convertFigure(files[i], cache);
        pdfs.set(files[i], r.pdf);
        if (r.converted) fresh++;
      } catch (e) { failures.push({ file: files[i], reason: (e as Error).message }); }
    }
  }));
  const label = o.block ? `${o.block}: ` : '';
  if (fresh) o.log?.info('figures-converted', `  ${label}converted ${fresh} EPS or PostScript figure(s) to PDF`, { block: o.block ?? '', count: fresh });
  const seen = o.log ? (reported.get(o.log) ?? reported.set(o.log, new Set()).get(o.log)!) : new Set<string>();
  for (const f of failures.sort((a, b) => (a.file < b.file ? -1 : 1))) {
    if (seen.has(`${f.file}\0${f.reason}`)) continue;
    seen.add(`${f.file}\0${f.reason}`);
    o.log?.warn('figure-convert-failed', `  ${label}warning: ${f.file} was not converted to PDF, so the document cannot include it: ${f.reason}`,
      { block: o.block ?? '', file: f.file, reason: f.reason });
  }

  // each figure under its name, its PDF beside it under epstopdf's name
  const sources = new Map<string, string>();     // a PDF put in place → its figure
  const put = (pdf: string, at: string, figure: string) => {
    mkdirSync(dirname(at), { recursive: true });
    copyFileSync(pdf, at);
    sources.set(at, figure);
  };
  for (const f of figures) {
    const at = join(dir, ...f.name.split('/'));
    mkdirSync(dirname(at), { recursive: true });
    try { symlinkSync(f.file, at); } catch { copyFileSync(f.file, at); }
    const pdf = pdfs.get(f.file);
    if (pdf) put(pdf, join(dir, ...convertedName(f.name).split('/')), f.file);
  }
  const record = () => writeFileSync(join(runDir, SOURCES_FILE), `${JSON.stringify(Object.fromEntries(sources), null, 1)}\n`);
  record();

  const byName = new Map(figures.map(f => [f.name, f.file]));
  const inside = (root: string, p: string) => { const r = relative(root, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };
  return {
    dir,
    placeRequested(log: string): number {
      let n = 0;
      for (const { source, output } of requestedFigures(log)) {
        // the figure, by the name TeX found it under: in dir (a name relative
        // to it, or a path into it) or the figure's own path
        const abs = isAbsolute(source);
        const name = abs ? (inside(dir, resolve(source)) ? relative(dir, resolve(source)).split(sep).join('/') : null) : posix.normalize(source);
        const figure = name !== null ? byName.get(name) : files.find(f => f === resolve(source));
        const pdf = figure && pdfs.get(figure);
        if (!pdf) continue;
        // the PDF: a name ./ or ../ starts is the run's directory's; another
        // relative name is found along TEXINPUTS, in dir first; an absolute
        // path only inside the run's own directory
        const at = isAbsolute(output) ? resolve(output) : /^\.\.?\//.test(output) ? resolve(runDir, output) : resolve(dir, output);
        if (!inside(runDir, at) || existsSync(at)) continue;
        put(pdf, at, figure);
        n++;
      }
      if (n) record();
      return n;
    },
  };
}

/** The figures a run converted, by the PDF put in place for each (the files
 *  a picture node names): an empty map for a run that converted none. */
export function figureSources(runDir: string): Map<string, string> {
  const p = join(runDir, SOURCES_FILE);
  if (!existsSync(p)) return new Map();
  try { return new Map(Object.entries(JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>)); } catch { return new Map(); }
}
