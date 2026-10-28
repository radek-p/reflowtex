// SPDX-License-Identifier: AGPL-3.0-or-later
// The one place the pipeline runs TeX.
//
// Shell escape is off, deliberately. Nothing in the pipeline needs it, and
// what it compiles is LaTeX the caller did not necessarily write: a corpus
// of papers, Markdown a site generator walks, submitted content. With shell
// escape on, a \write18 or a \directlua{os.execute(…)} anywhere runs
// commands as the build user. `-no-shell-escape` is passed explicitly: TeX
// Live's default is `restricted`, which still runs a whitelist of helpers
// with arguments the document chooses. That makes compiling untrusted LaTeX
// less unsafe, not safe: TeX Live ships `openin_any = a`, so a document can
// read any file the build user can and typeset it – into a page. Compile
// untrusted input in a container without network access (docs/security.md).
// A caller that needs shell escape (minted over snippets it wrote itself)
// sets REFLOWTEX_SHELL_ESCAPE=1 (or the backend option shellEscape),
// asserting every snippet is trusted.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { TexError } from './errors.ts';

export interface LuaLatexOptions {
  /** directories searched before TeX's own tree (TEXINPUTS), after the
   *  run's own directory */
  texinputs: string[];
  /** at most this many runs; fewer once what TeX reads back settles
   *  (unless `settle` is false: then exactly this many) */
  passes: number;
  settle?: boolean;
  /** the file TeX compiles, in the run's directory (default input.tex) */
  main?: string;
  /** TeX's job name, which names everything it writes (default: the main
   *  file's name) */
  jobname?: string;
  /** the file a successful run leaves (default: the serializer's output.json) */
  expect?: string;
  /** called after each run with its log */
  onPass?: (pass: number, log: string) => void;
  /** how the block is named in messages */
  block?: string;
  /** shell escape on (the caller asserts the document is trusted); default:
   *  REFLOWTEX_SHELL_ESCAPE=1 */
  shellEscape?: boolean;
}

interface Run { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }

function lualatex(cwd: string, env: NodeJS.ProcessEnv, trusted: boolean, main: string, jobname: string): Promise<Run> {
  const shellEscape = trusted ? '-shell-escape' : '-no-shell-escape';
  return new Promise((resolve, reject) => {
    const p = spawn('lualatex', [shellEscape, '-interaction=nonstopmode', `-jobname=${jobname}`, main], { cwd, env });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    p.on('error', reject);
    p.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/** The files LaTeX writes and reads back in the next run. */
const READ_BACK_EXTS = ['aux', 'toc', 'lof', 'lot'];

/** What TeX reads back from a run: once it is the same after a run as before
 *  it, another pass would change nothing (as latexmk decides). A table of
 *  contents often needs three – revtex measures its section numbers in one
 *  run and sets their column in the next. The lines LaTeX writes to every
 *  .aux, whatever the document (\relax, the page count), are left out, so a
 *  document that reads nothing back settles after one run. */
function readBack(dir: string, jobname: string): string {
  return READ_BACK_EXTS.map(ext => join(dir, `${jobname}.${ext}`)).filter(existsSync)
    .map(p => readFileSync(p, 'latin1').split('\n').filter(l => !/^\\relax\s*$|^\\gdef\s*\\@abspage@last\{\d+\}\s*$/.test(l)).join('\n').trim())
    .join('\u0000').replace(/\u0000+$/, '');
}

/** The run asked for another one itself ("Rerun to get cross-references
 *  right", a package's "Please rerun LaTeX"). */
const RERUN_RE = /\bRerun\b|\bplease rerun\b/i;

/** The environment of a run: TEXINPUTS with the run's own directory first,
 *  then `texinputs`, then TeX's own tree. The run's directory comes first so
 *  that what this job writes and reads back (\jobname.aux) is its own, never
 *  a file of the same name from the document's directory. */
function runEnv(texinputs: string[]): NodeJS.ProcessEnv {
  return { ...process.env, TEXINPUTS: ['.', ...texinputs, process.env.TEXINPUTS ?? ''].join(delimiter) };
}

/** Compile dir/<main> once and return; for a run that stops early on
 *  purpose (a probe that ends at the class). */
export async function runLuaLatexOnce(dir: string, opts: Pick<LuaLatexOptions, 'texinputs' | 'main' | 'jobname' | 'shellEscape'>): Promise<void> {
  const main = opts.main ?? 'input.tex';
  await lualatex(dir, runEnv(opts.texinputs), opts.shellEscape ?? process.env.REFLOWTEX_SHELL_ESCAPE === '1', main, opts.jobname ?? main.replace(/\.tex$/, ''));
}

/** Compile dir/<main>; returns the serializer's output.json text. A TeX
 *  error is fatal even though nonstopmode carried on and produced a node
 *  list: what it produced is a *repaired* document, which still renders and
 *  is simply wrong. The failed run's output.json is removed, so nothing
 *  later mistakes it for a block's; so is each pass's before it starts, so a
 *  pass that is killed (a memory limit) cannot leave the one before's.
 *  Another pass runs when what TeX reads back changed, or when the run
 *  asked for one, up to `passes`. */
export async function runLuaLatex(dir: string, opts: LuaLatexOptions): Promise<string> {
  const main = opts.main ?? 'input.tex';
  const jobname = opts.jobname ?? main.replace(/\.tex$/, '');
  const env = runEnv(opts.texinputs);
  const outputJson = join(dir, 'output.json');
  // what this job reads back is in its own directory from the first run on
  for (const ext of READ_BACK_EXTS) if (!existsSync(join(dir, `${jobname}.${ext}`))) writeFileSync(join(dir, `${jobname}.${ext}`), '');
  let before = readBack(dir, jobname);
  let result: Run | null = null;
  const log = join(dir, `${jobname}.log`);
  const expect = join(dir, opts.expect ?? 'output.json');
  for (let n = 0; n < Math.max(1, opts.passes); n++) {
    // LaTeX's MathML (tagging with luamml, src/pipeline/mathml.ts) is written
    // afresh each run – and LaTeX reads the last run's back in, to embed in
    // the PDF, which fails on a character it cannot read (luamml's raw DEL
    // for a classic font's double accent). The PDF here needs none: gone.
    rmSync(join(dir, `${jobname}-luamml-mathml.html`), { force: true });
    rmSync(outputJson, { force: true });
    result = await lualatex(dir, env, opts.shellEscape ?? process.env.REFLOWTEX_SHELL_ESCAPE === '1', main, jobname);
    const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
    opts.onPass?.(n + 1, text);
    const after = readBack(dir, jobname);
    if (opts.settle !== false && after === before && !RERUN_RE.test(text)) break;
    before = after;
  }
  const texLog = existsSync(log) ? readFileSync(log, 'utf8') : result!.stdout;
  const errors = texLog.split('\n').filter(l => l.startsWith('! '));
  if (!existsSync(expect)) {
    let detail = texLog.slice(-3000);
    // stderr is where a lualatex wrapper says what it tried (the container's
    // lazy package install)
    if (result!.stderr.trim()) detail += `\n--- stderr ---\n${result!.stderr.slice(-2000)}`;
    const status = result!.signal ? `killed by ${result!.signal}` : `exit code ${result!.code}`;
    throw new TexError(`lualatex failed (${status}):\n${detail}`, opts.block, errors[0]);
  }
  if (errors.length) {
    rmSync(outputJson, { force: true });
    throw new TexError(`lualatex reported ${errors.length} error(s) (nonstopmode continued, so the node list would be ` +
      `silently wrong):\n${[...new Set(errors)].slice(0, 10).map(e => `  ${e}`).join('\n')}\n  see ${log}`, opts.block, errors[0]);
  }
  return existsSync(outputJson) ? readFileSync(outputJson, 'utf8') : '';
}
