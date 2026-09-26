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
// sets REFLOWTEX_SHELL_ESCAPE=1, asserting every snippet is trusted.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { TexError } from './errors.ts';

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
}

function lualatex(cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const shellEscape = process.env.REFLOWTEX_SHELL_ESCAPE === '1' ? '-shell-escape' : '-no-shell-escape';
  return new Promise((resolve, reject) => {
    const p = spawn('lualatex', [shellEscape, '-interaction=nonstopmode', 'input.tex'], { cwd, env });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    p.on('error', reject);
    p.on('close', code => resolve({ code, stdout, stderr }));
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
 *  later mistakes it for a block's. */
export async function runLuaLatex(dir: string, opts: LuaLatexOptions): Promise<string> {
  const env = { ...process.env, TEXINPUTS: [...opts.texinputs, process.env.TEXINPUTS ?? ''].join(delimiter) };
  const outputJson = join(dir, 'output.json');
  rmSync(outputJson, { force: true });
  let before = readBack(dir);
  let result: Awaited<ReturnType<typeof lualatex>> | null = null;
  const log = join(dir, 'input.log');
  const expect = join(dir, opts.expect ?? 'output.json');
  for (let n = 0; n < Math.max(1, opts.passes); n++) {
    result = await lualatex(dir, env);
    opts.onPass?.(n + 1, existsSync(log) ? readFileSync(log, 'utf8') : '');
    const after = readBack(dir);
    if (opts.settle !== false && n > 0 && after === before) break;
    before = after;
  }
  if (!existsSync(expect)) {
    let detail = (existsSync(log) ? readFileSync(log, 'utf8') : result!.stdout).slice(-3000);
    // stderr is where a lualatex wrapper says what it tried (the container's
    // lazy package install)
    if (result!.stderr.trim()) detail += `\n--- stderr ---\n${result!.stderr.slice(-2000)}`;
    throw new TexError(`lualatex failed:\n${detail}`, opts.block);
  }
  const errors = readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith('! '));
  if (errors.length) {
    rmSync(outputJson, { force: true });
    throw new TexError(`lualatex reported ${errors.length} error(s) (nonstopmode continued, so the node list would be ` +
      `silently wrong):\n${[...new Set(errors)].slice(0, 10).map(e => `  ${e}`).join('\n')}\n  see ${log}`, opts.block);
  }
  return existsSync(outputJson) ? readFileSync(outputJson, 'utf8') : '';
}
