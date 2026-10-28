#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The corpus's results, for the website.
//
//     node tools/corpus/report.ts [--results corpus/results] [--site website] [--commit SHA]
//     node tools/corpus/report.ts --from runs.json [--site website] [--commit SHA]
//
// Reads each paper's metrics.json and build (run.ts writes them to
// <results>/<id>/: metrics.json, build/), and writes
//
//  - <site>/data/corpus.json: every paper of the manifest with its scores, or
//    why it is stopped, and the totals (the data the website's showcase and
//    accuracy sections are built from);
//  - <site>/static/corpus/<id>/: the paper's page (page.ts), the page that
//    was measured with its header and contents; its scripts and fonts are
//    shared by all papers in <site>/static/corpus/assets/ where they are the
//    same file;
//  - <site>/static/corpus/report.json and <id>/data/: the comparison, as the
//    render report reads it, as its batch "Paper corpus" (the report lists
//    every batch it finds: tests/render/report/site.ts). Its larger files
//    are gzipped (the report unpacks them), and the TeX side's drawing
//    (strip.svg) is made here from the pageless PDF;
//  - <site>/static/corpus/<id>/compare/: a link on to that comparison.
//
// --from takes the results from elsewhere: a JSON object mapping a paper's
// id to { "metrics": <metrics.json>, "build": <its build folder> }, for
// results made by another harness with the same scores.
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadManifest, REPO, type Manifest, type Paper } from './manifest.ts';
import { paperPage, redirectPage } from './page.ts';
import { stripSvg } from '../pageless-pdf/vector-compare.ts';

/** What report.ts reads of a paper's metrics.json (run.ts). */
export interface Metrics {
  failed_at?: string | null; error?: string | null;
  hsize_pt?: number; tolerance?: number;
  worst_pt?: { glyph: number; rule: number | null };
  problems_at_testmath_ceilings?: string[];
  finished?: string;
  scores?: {
    placement: { share: number; tex_glyphs: number; tex_glyphs_in_unmatched_lines: number };
    vertical: { jumps: number; max_abs_pt: number };
    absolute: { share: number };
  };
}

/** One paper in website/data/corpus.json. */
export interface CorpusPaper {
  id: string; title: string; authors: string[]; year: number; venue: string; domain: string; field: string; class: string;
  packages: string[]; licence: string; licence_url: string; attribution: string;
  source_url: string; original_url: string; original_page: string;
  published?: Paper['published']; arxiv?: string; bibliography: Paper['bibliography'];
  status: 'displayed' | 'stopped'; reason?: string; patched?: string;
  placement: number | null; absolute: number | null; jumps: number | null; max_jump_pt: number | null; glyphs: number | null;
  /** TeX's glyphs in lines the browser has no partner for */
  lost_glyphs: number | null;
  at_goal: boolean;
  page: string | null; compare: string | null;
}
export interface CorpusData {
  generated: string; commit: string; texlive: string; tolerance_pt: number; goal: Manifest['goal'];
  totals: { papers: number; displayed: number; at_goal: number; mean_placement: number | null; jumps: number };
  papers: CorpusPaper[];
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
export const compareLink = (id: string): string => `render-tests/?batch=corpus#${encodeURIComponent(id)}`;

/** A paper's entry from its metrics (null: not run). */
export function paperEntry(p: Paper, m: Metrics | null, goal: Manifest['goal'], patchNote: string | null): CorpusPaper {
  const s = m?.scores;
  const reason = !p.supported ? p.reason!
    : !m ? 'not run'
    : !s ? `stopped at the ${m.failed_at ?? 'unknown'} stage${m.error ? `: ${m.error.split('\n')[0].slice(0, 300)}` : ''}`
    : undefined;
  const displayed = !reason && !!s;
  const placement = displayed ? r5(s!.placement.share) : null, jumps = displayed ? s!.vertical.jumps : null;
  return {
    id: p.id, title: p.title, authors: p.authors, year: p.year, venue: p.venue, domain: p.domain, field: p.field, class: p.class,
    packages: p.packages, licence: p.licence, licence_url: p.licence_url, attribution: p.attribution,
    source_url: p.source.url, original_url: p.original_url, original_page: p.original_page,
    ...(p.published ? { published: p.published } : {}), ...(p.arxiv ? { arxiv: p.arxiv } : {}), bibliography: p.bibliography,
    status: displayed ? 'displayed' : 'stopped', ...(reason ? { reason } : {}), ...(patchNote ? { patched: patchNote } : {}),
    placement, absolute: displayed ? r5(s!.absolute.share) : null, jumps, max_jump_pt: displayed ? s!.vertical.max_abs_pt : null,
    glyphs: displayed ? s!.placement.tex_glyphs : null, lost_glyphs: displayed ? s!.placement.tex_glyphs_in_unmatched_lines : null,
    at_goal: displayed && placement! >= goal.placement && jumps! <= goal.jumps,
    page: displayed ? `corpus/${p.id}/` : null, compare: displayed ? compareLink(p.id) : null,
  };
}

export function totals(papers: CorpusPaper[]): CorpusData['totals'] {
  const shown = papers.filter(p => p.status === 'displayed');
  return { papers: papers.length, displayed: shown.length, at_goal: papers.filter(p => p.at_goal).length,
    mean_placement: shown.length ? r5(shown.reduce((a, p) => a + p.placement!, 0) / shown.length) : null,
    jumps: shown.reduce((a, p) => a + p.jumps!, 0) };
}

/** A share as a percentage to two places; never 100.00 % unless it is all. */
export const pc = (x: number): string => `${(100 * (x < 1 ? Math.min(0.9999, Math.round(x * 1e4) / 1e4) : 1)).toFixed(2)} %`;
export const measuredText = (e: CorpusPaper): string =>
  `placement ${pc(e.placement!)}, ${e.jumps ? `${e.jumps} vertical jump${e.jumps > 1 ? 's' : ''}` : 'no vertical jump'}`;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile())
    .map(e => relative(dir, join(e.parentPath, e.name)).split(sep).join('/')).sort();
}
const sameFile = (a: string, b: string) => statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));

/** What the report reads of vector.json, and no more. */
function slimVector(v: Record<string, unknown>): Record<string, unknown> {
  const keep = ['hsize_pt', 'margin_pt', 'window_pt', 'glyphs', 'matched', 'viewer_unmatched', 'strip_unmatched', 'rules', 'rules_missing', 'error'];
  return Object.fromEntries(keep.filter(k => k in v).map(k => [k, v[k]]));
}

interface Source { metrics: string; build: string }

if (import.meta.main) {
  const { values: o } = parseArgs({ options: {
    results: { type: 'string', default: join(REPO, 'corpus', 'results') }, site: { type: 'string', default: join(REPO, 'website') },
    from: { type: 'string' }, commit: { type: 'string' }, manifest: { type: 'string' } } });
  const manifest = loadManifest(o.manifest);
  const site = resolve(o.site!);
  const from = o.from ? JSON.parse(readFileSync(o.from, 'utf8')) as Record<string, Source> : null;
  const where = (id: string): Source => from?.[id] ?? { metrics: join(o.results!, id, 'metrics.json'), build: join(o.results!, id, 'build') };
  const commit = o.commit ?? execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const out = join(site, 'static', 'corpus'), assets = join(out, 'assets');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(assets, { recursive: true });

  const papers: CorpusPaper[] = [], results: Record<string, unknown>[] = [];
  for (const p of manifest.papers) {
    const src = where(p.id);
    const m = p.supported && existsSync(src.metrics) ? JSON.parse(readFileSync(src.metrics, 'utf8')) as Metrics : null;
    const patchNote = p.patch ? readFileSync(join(REPO, 'corpus', p.patch), 'utf8').split('\n').filter(l => l.startsWith('#'))
      .map(l => l.replace(/^#\s?/, '')).join(' ').trim() : null;
    let e = paperEntry(p, m, manifest.goal, patchNote);
    const at = m?.finished ?? (m ? statSync(src.metrics).mtime.toISOString() : new Date(0).toISOString());
    if (e.status === 'displayed') {
      try { copyPaper(p, e, src.build, join(out, p.id), assets); }
      catch (err) { e = { ...paperEntry(p, { failed_at: 'report', error: (err as Error).message }, manifest.goal, patchNote) }; }
    }
    papers.push(e);
    const ok = e.status === 'displayed';
    results.push({ id: p.id, case: p.id, label: `${p.title} (${p.id})`, extra: 0,
      status: !ok ? 'error' : e.at_goal ? 'pass' : 'fail',
      problems: ok ? [`placement ${pc(e.placement!)} of ${e.glyphs} glyphs, ${e.jumps} vertical jump${e.jumps === 1 ? '' : 's'}`, ...(m?.problems_at_testmath_ceilings ?? [])]
        : [e.reason ?? 'stopped'],
      at, tolerance: manifest.tolerance_pt, target: manifest.tolerance_pt,
      ...(ok && m?.worst_pt ? { worst: [m.worst_pt.glyph, m.worst_pt.rule] } : {}), ...(ok && m?.hsize_pt ? { hsize_pt: m.hsize_pt } : {}),
      dir: `${p.id}/data`, ...(ok ? { page: p.id, lines: true, gz: true } : {}) });
    console.log(`${p.id}: ${ok ? measuredText(e) : e.reason}`);
  }
  const data: CorpusData = { generated: new Date().toISOString(), commit, texlive: manifest.texlive, tolerance_pt: manifest.tolerance_pt,
    goal: manifest.goal, totals: totals(papers), papers };
  mkdirSync(join(site, 'data'), { recursive: true });
  writeFileSync(join(site, 'data', 'corpus.json'), `${JSON.stringify(data, null, 1)}\n`);
  writeFileSync(join(out, 'report.json'), JSON.stringify({ batch: { id: 'corpus', label: 'Paper corpus', order: 2 }, results }, null, 1));
  const t = data.totals;
  console.log(`corpus: ${t.displayed} of ${t.papers} displayed, ${t.at_goal} at the goal, mean placement ${t.mean_placement === null ? '–' : pc(t.mean_placement)}, ${t.jumps} vertical jumps`);
}

/** The paper's page and its comparison's files, into dir. */
function copyPaper(p: Paper, e: CorpusPaper, build: string, dir: string, assets: string): void {
  const site = join(build, 'site');
  for (const f of ['pageless.pdf', 'vector/vector.json', 'vector/lines.json']) if (!existsSync(join(build, f))) throw new Error(`no ${f} in ${build}`);
  if (!existsSync(join(site, 'index.html'))) throw new Error(`no site/index.html in ${build}`);
  // the page's scripts and fonts: shared when every one of them is the same as the shared copy (or there is none yet)
  const own = filesUnder(site).filter(f => f === 'latex-viewer.js' || f === 'protobuf.min.js' || f.startsWith('fonts/'));
  const shared = own.every(f => !existsSync(join(assets, f)) || sameFile(join(site, f), join(assets, f)));
  mkdirSync(dir, { recursive: true });
  for (const f of own) {
    const to = join(shared ? assets : dir, f);
    if (shared && existsSync(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(site, f), to);
  }
  writeFileSync(join(dir, 'index.html'), paperPage(readFileSync(join(site, 'index.html'), 'utf8'), {
    title: p.title, authors: p.authors, venue: p.venue, year: p.year, field: p.field, licence: p.licence, licence_url: p.licence_url,
    attribution: p.attribution, original_page: p.original_page, original_url: p.original_url, source_url: p.source.url,
    compare: `../../${compareLink(p.id)}`, home: '../../', measured: measuredText(e), assets: shared ? '../assets/' : '' }));
  mkdirSync(join(dir, 'compare'), { recursive: true });
  writeFileSync(join(dir, 'compare', 'index.html'), redirectPage(`../../../${compareLink(p.id)}`, `${p.title}: compared with TeX`));
  // the comparison, as the render report reads it
  const data = join(dir, 'data');
  mkdirSync(join(data, 'vector'), { recursive: true });
  copyFileSync(join(build, 'pageless.pdf'), join(data, 'pageless.pdf'));
  const v = JSON.parse(readFileSync(join(build, 'vector', 'vector.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(data, 'vector', 'vector.json.gz'), gzipSync(JSON.stringify(slimVector(v)), { level: 9 }));
  writeFileSync(join(data, 'vector', 'lines.json.gz'), gzipSync(readFileSync(join(build, 'vector', 'lines.json')), { level: 9 }));
  writeFileSync(join(data, 'vector', 'strip.svg.gz'), gzipSync(stripSvg(join(build, 'pageless.pdf')), { level: 9 }));
}
