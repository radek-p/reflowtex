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
//
// Lua is no way round the switch: LuaTeX's os.execute and io.popen obey it
// ("All command execution disabled" with it off; only the whitelist when
// restricted). What LaTeX would have run a program for itself – epstopdf
// converting an EPS figure – the pipeline does before TeX runs instead
// (figures.ts), when shell escape is off.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { TexError } from './errors.ts';
import { prepareFigures } from './figures.ts';
import { consoleLog, type Log } from '../shared/log.ts';

export interface LuaLatexOptions {
  /** directories searched before TeX's own tree (TEXINPUTS) */
  texinputs: string[];
  /** at most this many runs; fewer once the files TeX reads back settle
   *  (unless `settle` is false: then exactly this many) */
  passes: number;
  settle?: boolean;
  /** the file a successful run leaves (default: the serializer's output.json) */
  expect?: string;
  /** called after each run with its log */
  onPass?: (pass: number, log: string) => void;
  /** how the block is named in messages */
  block?: string;
  /** shell escape on (the caller asserts the document is trusted), or
   *  'restricted' (TeX Live's default: its whitelist, as a LaTeX user's run
   *  has it); default: on with REFLOWTEX_SHELL_ESCAPE=1, else off */
  shellEscape?: boolean | 'restricted';
  /** where the document's EPS figures are kept converted, for later runs
   *  (figures.ts; default: the run's own converted-figures-cache) */
  figureCache?: string;
  /** where conversion messages go (default: consoleLog, the console) */
  log?: Log;
}

type ShellEscape = NonNullable<LuaLatexOptions['shellEscape']>;
const SHELL_ESCAPE_FLAG = (s: ShellEscape) => (s === 'restricted' ? '-shell-restricted' : s ? '-shell-escape' : '-no-shell-escape');

function lualatex(cwd: string, env: NodeJS.ProcessEnv, mode: ShellEscape): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  const shellEscape = SHELL_ESCAPE_FLAG(mode);
  return new Promise((resolve, reject) => {
    const p = spawn('lualatex', [shellEscape, '-interaction=nonstopmode', 'input.tex'], { cwd, env });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    p.on('error', reject);
    p.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/** What TeX reads back from a run: once it is the same after a run as before
 *  it, another pass would change nothing (as latexmk decides). A table of
 *  contents often needs three – revtex measures its section numbers in one
 *  run and sets their column in the next. */
function readBack(dir: string): string {
  return ['aux', 'toc', 'lof', 'lot'].map(ext => join(dir, `input.${ext}`)).filter(existsSync)
    .map(p => readFileSync(p, 'latin1')).join('\u0000');
}

/** Compile dir/input.tex; returns the serializer's output.json text. A TeX
 *  error is fatal even though nonstopmode carried on and produced a node
 *  list: what it produced is a *repaired* document, which still renders and
 *  is simply wrong. The failed run's output.json is removed, so nothing
 *  later mistakes it for a block's; so is each pass's before it starts, so a
 *  pass that is killed (a memory limit) cannot leave the one before's. */
export async function runLuaLatex(dir: string, opts: LuaLatexOptions): Promise<string> {
  const mode = opts.shellEscape ?? process.env.REFLOWTEX_SHELL_ESCAPE === '1';
  // With shell escape off, TeX cannot convert an EPS figure: the pipeline
  // does, first, and the figures' directory goes first on TEXINPUTS. With it
  // on, LaTeX's epstopdf converts as in any LaTeX run.
  const figures = mode === false ? await prepareFigures(dir, opts.texinputs, { cache: opts.figureCache, log: opts.log ?? consoleLog(), block: opts.block }) : null;
  const texinputs = figures ? [figures.dir, ...opts.texinputs] : opts.texinputs;
  const env = { ...process.env, TEXINPUTS: [...texinputs, process.env.TEXINPUTS ?? ''].join(delimiter) };
  const outputJson = join(dir, 'output.json');
  let before = readBack(dir);
  let result: Awaited<ReturnType<typeof lualatex>> | null = null;
  const log = join(dir, 'input.log');
  const expect = join(dir, opts.expect ?? 'output.json');
  let passes = Math.max(1, opts.passes);
  for (let n = 0; n < passes; n++) {
    // LaTeX's MathML (tagging with luamml, src/pipeline/mathml.ts) is written
    // afresh each run – and LaTeX reads the last run's back in, to embed in
    // the PDF, which fails on a character it cannot read (luamml's raw DEL
    // for a classic font's double accent). The PDF here needs none: gone.
    rmSync(join(dir, 'input-luamml-mathml.html'), { force: true });
    rmSync(outputJson, { force: true });
    result = await lualatex(dir, env, mode);
    const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
    opts.onPass?.(n + 1, text);
    const after = readBack(dir);
    // epstopdf asked for a figure's PDF under a name of its settings': it is
    // there now, for another pass
    if (figures?.placeRequested(text)) { passes = Math.max(passes, n + 2); before = after; continue; }
    if (opts.settle !== false && n > 0 && after === before) break;
    before = after;
  }
  if (!existsSync(expect)) {
    let detail = (existsSync(log) ? readFileSync(log, 'utf8') : result!.stdout).slice(-3000);
    // stderr is where a lualatex wrapper says what it tried (the container's
    // lazy package install)
    if (result!.stderr.trim()) detail += `\n--- stderr ---\n${result!.stderr.slice(-2000)}`;
    const status = result!.signal ? `killed by ${result!.signal}` : `exit code ${result!.code}`;
    throw new TexError(`lualatex failed (${status}):\n${detail}`, opts.block);
  }
  const errors = readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith('! '));
  if (errors.length) {
    rmSync(outputJson, { force: true });
    throw new TexError(`lualatex reported ${errors.length} error(s) (nonstopmode continued, so the node list would be ` +
      `silently wrong):\n${[...new Set(errors)].slice(0, 10).map(e => `  ${e}`).join('\n')}\n  see ${log}`, opts.block);
  }
  return existsSync(outputJson) ? readFileSync(outputJson, 'utf8') : '';
}
