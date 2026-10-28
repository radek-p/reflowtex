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
//  - <site>/corpus-blocks/<id>.json: the paper's block as the measured page
//    has it, for the website's page of the paper to embed as its latex
//    shortcode embeds a block: its data (nodelist_b64), its accessible layer
//    (a11y_html), the attributes the measured block has (attrs), and its font
//    map (font_map: original file → served file, relative to the site's
//    fonts/; the files are in static/corpus/assets/fonts/), to be merged into
//    that page's #latex-font-map. Outside static/: what is published is the
//    page that embeds it;
//  - <site>/static/corpus/<id>/outline.json: the paper's outline (its
//    sections and the like, each with the id of its anchor on the page), as
//    the viewer announces it (reflowtex:outline);
//  - <site>/static/corpus/<id>/measured/: the page that was measured
//    (page.ts adds its header and contents), which the comparison shows; its
//    scripts and fonts are shared by all papers in
//    <site>/static/corpus/assets/ where they are the same file, and the
//    embedded blocks take their fonts from there too;
//  - <site>/static/corpus/<id>/index.html: a link on to the paper's page on
//    the site (docs/showcase/papers/<id>/);
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
import { messageType } from '../../src/pipeline/schema.ts';
import { a11yLayerFromBytes } from '../../src/pipeline/a11y.ts';

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
/** The paper's page on the site (the website's docs page for it). */
export const pageLink = (id: string): string => `docs/showcase/papers/${id}/`;

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
    page: displayed ? pageLink(p.id) : null, compare: displayed ? compareLink(p.id) : null,
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
  const out = join(site, 'static', 'corpus'), assets = join(out, 'assets'), embeds = join(site, 'corpus-blocks');
  rmSync(out, { recursive: true, force: true });
  rmSync(embeds, { recursive: true, force: true });
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
      try { copyPaper(p, e, src.build, join(out, p.id), assets, embeds); }
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
      dir: `${p.id}/data`, ...(ok ? { page: `${p.id}/measured`, lines: true, gz: true } : {}) });
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

/** The outline the viewer announces for a block (init.ts): its entries, each with its anchor's id. */
export interface OutlineEntry { kind: string; env: string; level: number; number: string; title: string; id: string | null }
export function outlineOf(bytes: Uint8Array): OutlineEntry[] {
  const Document = messageType('Document');
  const doc = Document.toObject(Document.decode(bytes), { enums: String, defaults: false }) as
    { outline?: { kind?: string; env?: string; level?: number; number?: string; title?: string; anchor?: number }[]; anchors?: string[] };
  return (doc.outline ?? []).map(e => ({ kind: e.kind ?? '', env: e.env ?? '', level: e.level ?? 0, number: e.number ?? '', title: e.title ?? '',
    id: (doc.anchors ?? [])[(e.anchor ?? 0) - 1] ?? null }));
}

/** The block of a page (site.ts's blockHtml: one div, its data inline), and the page's font map. */
export function blockOf(page: string): { block: string; bytes: Uint8Array; fonts: Record<string, string> } {
  const blocks = page.match(/<div class="latex-block"[^>]*><\/div>/g) ?? [];
  if (blocks.length !== 1) throw new Error(`the measured page has ${blocks.length} blocks, not one`);
  const b64 = /data-nodelist-b64="([^"]*)"/.exec(blocks[0])?.[1];
  if (!b64) throw new Error('the block has no data');
  const map = /<script id="latex-font-map"[^>]*>([^<]*)<\/script>/.exec(page)?.[1];
  return { block: blocks[0], bytes: new Uint8Array(Buffer.from(b64, 'base64')), fonts: map ? JSON.parse(map) as Record<string, string> : {} };
}

/** Whether a block's displays follow the reader's width: a document with a display carries the display model
 *  (pipeline.ts, sampleDisplays), or its displays stay as captured, set for the width TeX compiled them at. */
export function reflowsDisplays(bytes: Uint8Array): boolean {
  type Item = { kind?: string };
  const Document = messageType('Document');
  const doc = Document.toObject(Document.decode(bytes), { enums: String, defaults: false }) as
    { content?: Item[]; streams?: { content?: Item[] }[]; display_model?: boolean };
  const items = [...doc.content ?? [], ...(doc.streams ?? []).flatMap(st => st.content ?? [])];
  return Boolean(doc.display_model) || !items.some(it => it.kind === 'display');
}

/** What a page of the site embeds for a paper (website/corpus-blocks/<id>.json): the block's data and accessible
 *  layer as prebuild's data/latex_blocks/<key>.json has them, the attributes of the measured block (the
 *  shortcode puts them on it), and its fonts, by served path relative to the site's fonts/ folder. */
export function blockJson(block: string, bytes: Uint8Array, fonts: Record<string, string>, fontsFromSiteFonts: string): Record<string, unknown> {
  const attrs: Record<string, string> = {};
  for (const m of block.matchAll(/ (data-[a-z0-9-]+)="([^"]*)"/g)) if (m[1] !== 'data-nodelist-b64') attrs[m[1]] = m[2];
  return { nodelist_b64: Buffer.from(bytes).toString('base64'), a11y_html: a11yLayerFromBytes(bytes), attrs,
    font_map: Object.fromEntries(Object.entries(fonts).map(([k, v]) => [k, `${fontsFromSiteFonts}${v}`])) };
}

/** The paper's files: the block to embed, outline, measured page, links on, and the comparison. */
function copyPaper(p: Paper, e: CorpusPaper, build: string, dir: string, assets: string, blocks: string): void {
  const site = join(build, 'site');
  for (const f of ['pageless.pdf', 'vector/vector.json', 'vector/lines.json']) if (!existsSync(join(build, f))) throw new Error(`no ${f} in ${build}`);
  if (!existsSync(join(site, 'index.html'))) throw new Error(`no site/index.html in ${build}`);
  const measured = readFileSync(join(site, 'index.html'), 'utf8');
  const { block, bytes, fonts } = blockOf(measured);
  // the site shows the paper at other widths than its own
  if (!reflowsDisplays(bytes)) throw new Error(`the block in ${site} has displays but no display model: they would not follow the width`);
  // the page's scripts and fonts: shared when every one of them is the same as the shared copy (or there is none yet)
  const own = filesUnder(site).filter(f => f === 'latex-viewer.js' || f === 'protobuf.min.js' || f.startsWith('fonts/'));
  const shared = own.every(f => !existsSync(join(assets, f)) || sameFile(join(site, f), join(assets, f)));
  const page = join(dir, 'measured');
  mkdirSync(page, { recursive: true });
  for (const f of own) {
    const to = join(shared ? assets : page, f);
    if (shared && existsSync(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(site, f), to);
  }
  writeFileSync(join(page, 'index.html'), paperPage(measured, {
    title: p.title, authors: p.authors, venue: p.venue, year: p.year, field: p.field, licence: p.licence, licence_url: p.licence_url,
    attribution: p.attribution, original_page: p.original_page, original_url: p.original_url, source_url: p.source.url,
    compare: `../../../${compareLink(p.id)}`, home: '../../../', measured: measuredText(e), assets: shared ? '../../assets/' : '' }));
  mkdirSync(blocks, { recursive: true });
  writeFileSync(join(blocks, `${p.id}.json`), JSON.stringify(blockJson(block, bytes, fonts, shared ? '../corpus/assets/fonts/' : `../corpus/${p.id}/measured/fonts/`)));
  writeFileSync(join(dir, 'outline.json'), JSON.stringify(outlineOf(bytes), null, 1));
  writeFileSync(join(dir, 'index.html'), redirectPage(`../../${pageLink(p.id)}`, p.title));
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
