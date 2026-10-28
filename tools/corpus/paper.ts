#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// One paper of the corpus through every stage, in the container run.ts
// starts (no network, the paper's own folder the only one written to):
//
//     node tools/corpus/paper.ts <paper dir> <id> [--keep-builds]
//
// <paper dir> holds src/, the paper's source as run.ts prepared it (unpacked,
// patched). Stages, each timed and each with its own limit; a failed stage
// stops the ones after it:
//
//   plain    lualatex on the paper as its author builds it (no reflowtex),
//            BibTeX or Biber between the passes when the manifest says so,
//            passes until what TeX reads back settles (at most 4): the
//            bibliography the capture uses, and a check that the paper builds
//   capture  pageless.ts: the paper in reflowtex's template, captured, and its
//            pageless PDF – one page as tall as the paper, every glyph where
//            TeX put it
//   site     site-from-run.ts --single-width: the page, from the same run
//   compare  vector-compare.ts in Chromium, at the paper's own width, glyph
//            by glyph against the pageless PDF; then lines.ts, the scores
//
// Writes metrics.json (the scores, or where it stopped and why), stages.json
// and logs/ in <paper dir>; the builds are in plain/ and build/. Once the paper
// is measured, what nothing reads afterwards is deleted (lean): the display
// model's samples, the pipeline's copies, TeX's intermediates; kept are
// build/{pageless.pdf, pageless.json, vector/, site/} and TeX's logs.
//
// Shell escape is never on, and every lualatex runs under a time limit.
import { parseArgs } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest } from './manifest.ts';
import { lineSummary } from './lines.ts';
import { pageless } from '../pageless-pdf/pageless.ts';
import { siteFromRun } from '../pageless-pdf/site-from-run.ts';
import { vectorCompare } from '../pageless-pdf/vector-compare.ts';
import { serveDirectory } from '../lib/static-server.ts';
import { problems, worst, type Vector } from '../../tests/render/render.ts';
import { cases } from '../../tests/render/cases.ts';

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { 'keep-builds': { type: 'boolean', default: false } } });
const [DIR, id] = positionals;
if (!DIR || !id) { console.error('usage: paper.ts <paper dir> <id> [--keep-builds]'); process.exit(2); }
const manifest = loadManifest();
const paper = manifest.papers.find(p => p.id === id);
if (!paper) { console.error(`paper.ts: ${id} is not in the manifest`); process.exit(2); }
const SRC = join(DIR, 'src'), PLAIN = join(DIR, 'plain'), BUILD = join(DIR, 'build'), LOGS = join(DIR, 'logs');
mkdirSync(LOGS, { recursive: true });
const stem = paper.main.replace(/\.tex$/, '');
const TOL = manifest.tolerance_pt, RULE_TOL = cases.testmath.rule_tolerance ?? TOL;
const LUALATEX_TIMEOUT = Number(process.env.LUALATEX_TIMEOUT ?? 900);
const STAGE_TIMEOUT: Record<string, number> = { plain: 3600, capture: 3600, site: 3600, compare: 1800 };
// never shell escape: the paper is someone else's code
process.env.REFLOWTEX_SHELL_ESCAPE = '0';
process.env.REFLOWTEX_NO_AUTOINSTALL = '1';

// ── lualatex under a time limit: a wrapper first on PATH ───────────────────
const BIN = join(DIR, '.bin'), TIMEOUTS = join(DIR, 'timeouts.log');
const real = execFileSync('sh', ['-c', 'command -v lualatex'], { encoding: 'utf8' }).trim();
mkdirSync(BIN, { recursive: true });
writeFileSync(join(BIN, 'lualatex'), `#!/bin/sh
timeout -k 10 ${LUALATEX_TIMEOUT} ${real} "$@"
s=$?
[ "$s" = 124 ] && echo "lualatex timed out after ${LUALATEX_TIMEOUT} s in $PWD" >> ${TIMEOUTS}
exit $s
`);
chmodSync(join(BIN, 'lualatex'), 0o755);
process.env.PATH = `${BIN}:${process.env.PATH}`;
rmSync(TIMEOUTS, { force: true });
const timeouts = () => (existsSync(TIMEOUTS) ? readFileSync(TIMEOUTS, 'utf8').split('\n').filter(Boolean) : []);

// ── stages ─────────────────────────────────────────────────────────────────
interface Stage { stage: string; ok: boolean; seconds: number; error?: string }
const stages: Stage[] = [];
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const stamp = () => new Date().toISOString().slice(11, 19);
const saveStages = () => writeFileSync(join(DIR, 'stages.json'), JSON.stringify({ id, finished: new Date().toISOString(), stages }, null, 1));
function logger(name: string): (s: string) => void {
  const file = join(LOGS, `${name}.log`);
  writeFileSync(file, '');
  return s => writeFileSync(file, `${stamp()} ${s}\n`, { flag: 'a' });
}
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = performance.now();
  console.log(`${stamp()} ${id}: ${name} …`);
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`stage timed out after ${STAGE_TIMEOUT[name]} s`)), STAGE_TIMEOUT[name] * 1000); });
  try {
    const r = await Promise.race([fn(), limit]);
    stages.push({ stage: name, ok: true, seconds: round((performance.now() - t0) / 1000, 1) });
    console.log(`${stamp()} ${id}: ${name} ok (${stages.at(-1)!.seconds} s)`);
    return r;
  } catch (e) {
    const err = e as Error;
    stages.push({ stage: name, ok: false, seconds: round((performance.now() - t0) / 1000, 1), error: `${err.name}: ${err.message}`.slice(0, 6000) });
    console.log(`${stamp()} ${id}: ${name} FAILED: ${err.message.split('\n')[0]}`);
    return null;
  } finally { clearTimeout(timer); saveStages(); }
}

// ── plain lualatex ─────────────────────────────────────────────────────────
function run(cmd: string, args: string[], cwd: string, logName: string): Promise<number | null> {
  return new Promise(resolve => {
    // stdin closed: a paper that switches to \errorstopmode stops at its next error instead of waiting for an answer
    const p = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('error', e => { writeFileSync(join(LOGS, logName), `${cmd}: ${e.message}\n`); resolve(-1); });
    p.on('close', code => { writeFileSync(join(LOGS, logName), out); resolve(code); });
  });
}
interface Pass { pass: string; code: number | null; errors: string[]; pages: number | null; rerun: boolean }
function readLog(file: string): Omit<Pass, 'pass' | 'code'> {
  const t = existsSync(file) ? readFileSync(file, 'latin1') : '';
  return { errors: [...new Set(t.split('\n').filter(l => l.startsWith('! ')))].slice(0, 20),
    pages: Number(/Output written on .*?\((\d+) pages?/.exec(t)?.[1] ?? NaN) || null,
    rerun: /Rerun to get|rerun LaTeX|Please rerun|Label\(s\) may have changed/i.test(t) };
}
async function plain(): Promise<Pass[]> {
  rmSync(PLAIN, { recursive: true, force: true });
  cpSync(SRC, PLAIN, { recursive: true });
  const passes: Pass[] = [];
  const latex = async (n: number) => {
    const code = await run('lualatex', ['-no-shell-escape', '-interaction=nonstopmode', paper!.main], PLAIN, `plain-pass${n}.out`);
    passes.push({ pass: `lualatex ${n}`, code, ...readLog(join(PLAIN, `${stem}.log`)) });
  };
  const readBack = () => ['aux', 'toc', 'lof', 'lot', 'bbl'].map(e => join(PLAIN, `${stem}.${e}`)).filter(existsSync).map(p => readFileSync(p, 'latin1')).join('\0');
  await latex(1);
  const tool = paper!.bibliography;
  if (tool === 'biber' && existsSync(join(PLAIN, `${stem}.bcf`))) passes.push({ pass: 'biber', code: await run('biber', [stem], PLAIN, 'plain-biber.out'), errors: [], pages: null, rerun: false });
  else if (tool === 'bibtex' && existsSync(join(PLAIN, `${stem}.aux`)) && /\\bibdata\{/.test(readFileSync(join(PLAIN, `${stem}.aux`), 'latin1')))
    passes.push({ pass: 'bibtex', code: await run('bibtex', [stem], PLAIN, 'plain-bibtex.out'), errors: [], pages: null, rerun: false });
  for (let n = 2, prev = ''; n <= 4; n++) {
    const before = readBack();
    if (n > 2 && before === prev) break;
    prev = before;
    await latex(n);
    if (readBack() === before && !passes.at(-1)!.rerun) break;
  }
  return passes;
}

// ── reflowtex: capture, site, compare ──────────────────────────────────────
async function capture(): Promise<void> {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  // the paper's bibliography, read as \jobname.bbl
  for (const from of [join(PLAIN, `${stem}.bbl`), join(SRC, `${stem}.bbl`)])
    if (existsSync(from)) { for (const job of ['input', stem]) copyFileSync(from, join(BUILD, `${job}.bbl`)); break; }
  await pageless(join(SRC, paper!.main), { out: BUILD, passes: 3, widthExtra: '0pt', log: logger('capture') });
}
async function site(): Promise<void> {
  rmSync(join(BUILD, 'site'), { recursive: true, force: true });
  await siteFromRun(BUILD, join(BUILD, 'site'), { log: logger('site'), singleWidth: true, title: paper!.title });
}
interface FullVector extends Vector { strip_unmatched: unknown[]; viewer_unmatched: unknown[] }
async function compare(): Promise<FullVector> {
  const { url, server } = await serveDirectory(BUILD);
  try {
    return await vectorCompare(BUILD, `${url}/site/index.html`, { out: join(BUILD, 'vector'), lineTol: TOL, images: false, log: logger('compare') }) as unknown as FullVector;
  } finally { server.close(); }
}

// ── lean: what nothing reads afterwards, deleted ───────────────────────────
const KEEP_BUILD = new Set(['pageless.pdf', 'pageless.json', 'vector', 'site', 'jobname.txt']);
function lean(): number {
  let removed = 0;
  for (const e of readdirSync(BUILD)) if (!KEEP_BUILD.has(e) && !e.endsWith('.log')) { rmSync(join(BUILD, e), { recursive: true, force: true }); removed++; }
  if (existsSync(PLAIN)) for (const e of readdirSync(PLAIN)) if (![`${stem}.pdf`, `${stem}.log`, `${stem}.bbl`].includes(e)) { rmSync(join(PLAIN, e), { recursive: true, force: true }); removed++; }
  return removed;
}

// ── main ───────────────────────────────────────────────────────────────────
const passes = await stage('plain', plain);
if (passes) writeFileSync(join(DIR, 'build-check.json'), JSON.stringify({ id, main: paper.main, passes, timeouts: timeouts() }, null, 1));
const v = passes && (await stage('capture', capture)) !== null && (await stage('site', site)) !== null ? await stage('compare', compare) : null;
const failed = stages.find(s => !s.ok);
let metrics: Record<string, unknown> = { id, failed_at: failed?.stage ?? null, error: failed?.error ?? null };
if (v) {
  const L = lineSummary(BUILD);
  const [g, r] = worst(v);
  metrics = { id, hsize_pt: v.hsize_pt, tolerance: TOL,
    glyphs: { tex: v.glyphs.strip, drawn: v.glyphs.viewer, matched: v.glyphs.matched, missing: v.strip_unmatched.length, extra: v.viewer_unmatched.length },
    worst_pt: { glyph: g, rule: r },
    rules: { tex: v.rules.filter(x => !x.unmatched).length + v.rules_missing.length, drawn: v.rules.length, missing: v.rules_missing.length,
      extra: v.rules.filter(x => x.unmatched).length, beyond_rule_tol: v.rules.filter(x => (x.off ?? 0) > RULE_TOL).length },
    scores: L.scores, lines: L.summary, problems_at_testmath_ceilings: problems(v, TOL, RULE_TOL, 0) };
}
const removed = v && !o['keep-builds'] ? lean() : 0;
writeFileSync(join(DIR, 'metrics.json'), JSON.stringify({ ...metrics, seconds: Object.fromEntries(stages.map(s => [s.stage, s.seconds])),
  timeouts: timeouts(), finished: new Date().toISOString(), lean: removed > 0 }, null, 1));
const s = (metrics.scores as { placement: { share: number }; vertical: { jumps: number } } | undefined);
console.log(`${stamp()} ${id}: ${s ? `placement ${(100 * s.placement.share).toFixed(2)} %, ${s.vertical.jumps} vertical jumps` : `stopped at ${failed?.stage}`}`);
process.exit(0);
