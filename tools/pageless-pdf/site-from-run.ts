#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// A viewer page from a pageless build's own extraction.
//
//     node tools/pageless-pdf/site-from-run.ts <build dir> <site dir> [--extra-script FILE]…
//                                              [--title T] [--single-width] [--passes N]
//
// For a comparison, the page and the strip must come from one run. This takes
// the output.json pageless.ts left beside pageless.pdf, models its displays
// and runs the pipeline's transforms, fonts and encoding on it, and writes a
// vanilla page. Each --extra-script is copied beside it and loaded after the
// viewer (files it loads in turn are copied by hand).
//
// The display model is the pipeline's (pipeline.ts, sampleDisplays), anchored
// on the strip's own run: that run is the first sample, and the same input.tex
// is compiled again with \reflowtexWidthExtra raised, in samples/<k>/ under the
// build dir (the .aux copied, so references resolve). When the model is
// anchored at the strip's run, displays render at the strip's width exactly as
// the strip and reflow at other widths. --single-width skips it: displays then
// render as captured, fixed at the strip's width.
import { parseArgs } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline, sampleDisplays, type Sample } from '../../src/pipeline/pipeline.ts';
import { runLuaLatex } from '../../src/pipeline/lualatex.ts';
import { readSerializerOutput, writeSerializerOutput, type SerializerOutput } from '../../src/pipeline/nodes.ts';
import { encodeDocument } from '../../src/pipeline/encode.ts';
import { blockHtml, installViewer } from '../../src/pipeline/site.ts';
import { renderPage } from '../../integrations/vanilla/page.ts';

const LATEX_DIR = fileURLToPath(new URL('../../src/latex', import.meta.url));
// the files TeX reads back – references, contents, lists, bibliography
const READ_BACK = ['serializer.lua', 'input.aux', 'input.toc', 'input.lof', 'input.lot', 'input.bbl'];

export interface SiteFromRunOptions { extraScripts?: string[]; title?: string; singleWidth?: boolean; passes?: number; log?: (s: string) => void }

export async function siteFromRun(build: string, site: string, o: SiteFromRunOptions = {}): Promise<string> {
  const log = o.log ?? (s => console.log(s));
  build = resolve(build); site = resolve(site);
  let data = readSerializerOutput(readFileSync(join(build, 'output.json'), 'utf8'));
  if (!o.singleWidth) {
    const src = readFileSync(join(build, 'input.tex'), 'utf8');
    const m = /\\reflowtexWidthExtra=(\d+)sp/.exec(src);
    if (!m) throw new Error('input.tex has no \\reflowtexWidthExtra assignment: not a build of this template');
    const baseExtra = Number(m[1]);
    const texinputs = [LATEX_DIR];
    if (existsSync(join(build, 'source-dir.txt'))) texinputs.unshift(readFileSync(join(build, 'source-dir.txt'), 'utf8').trim());
    // The document with \reflowtexWidthExtra raised by extraSp, compiled in
    // samples/<name>/; reused when the same input was compiled before.
    const compileAt = async (extraSp: number, name: string): Promise<Sample> => {
      const d = join(build, 'samples', name);
      mkdirSync(join(d, 'pics'), { recursive: true });
      const tex = src.replace(m[0], () => `\\reflowtexWidthExtra=${baseExtra + extraSp}sp`);
      const fresh = existsSync(join(d, 'input.tex')) && readFileSync(join(d, 'input.tex'), 'utf8') === tex && existsSync(join(d, 'output.json'));
      if (!fresh) {
        writeFileSync(join(d, 'input.tex'), tex);
        for (const f of READ_BACK) if (existsSync(join(build, f))) copyFileSync(join(build, f), join(d, f));
        await runLuaLatex(d, { texinputs, passes: o.passes ?? 1, settle: false, block: `sample ${name}` });
      }
      return { data: readSerializerOutput(readFileSync(join(d, 'output.json'), 'utf8')), dir: d };
    };
    let k = 0;
    const modelled = await sampleDisplays({ data, dir: build }, {
      at: extraSp => compileAt(extraSp, String(++k)),
      probe: extraSp => compileAt(extraSp, `w${extraSp}`).then(s => s.data, () => null),
      label: basename(build), log,
    });
    if (modelled.dir !== build) log(`  warning: the display model is anchored at a wider run than the strip's (${modelled.dir})`);
    data = modelled.data;
  }

  // The pipeline's stages on a copy, in site-build/run/ beside the run's own
  // PDF (its pictures) and pageless.json.
  const pipe = new Pipeline({ buildRoot: join(build, 'site-build'), fontsDir: join(site, 'fonts'), log });
  const work = join(build, 'site-build', 'run');
  mkdirSync(join(work, 'pics'), { recursive: true });
  for (const f of ['input.pdf', 'pageless.json']) if (existsSync(join(build, f))) copyFileSync(join(build, f), join(work, f));
  if (existsSync(join(build, 'pics'))) for (const p of readdirSync(join(build, 'pics'))) copyFileSync(join(build, 'pics', p), join(work, 'pics', p));
  data = structuredClone(data) as SerializerOutput;
  await pipe.transform(data, work, { block: 'run' });
  writeFileSync(join(work, 'output.json'), writeSerializerOutput(data));
  const bytes = encodeDocument(data);
  pipe.adopt('run', data);
  await pipe.finishFonts();
  log(`  bundle ${bytes.length} bytes`);

  installViewer(site, { log });
  for (const e of o.extraScripts ?? []) copyFileSync(e, join(site, basename(e)));
  // A replay of TeX: its breaks always, an overfull line included (the
  // viewer's default gives way to a looser line when TeX's would overflow).
  writeFileSync(join(site, 'index.html'), renderPage({
    title: o.title ?? 'pageless run — Reflow TeX', blocks: [blockHtml(bytes, { 'data-tex-final-pass': 'strict' })],
    fontMap: pipe.fontMap(), sourceUrl: 'https://github.com/radek-p/reflowtex', fontsBase: 'fonts/',
    extraScripts: (o.extraScripts ?? []).map(e => basename(e)),
  }));
  return join(site, 'index.html');
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'extra-script': { type: 'string', multiple: true, default: [] }, title: { type: 'string' },
      'single-width': { type: 'boolean', default: false }, passes: { type: 'string', default: '1' },
    },
  });
  if (positionals.length !== 2) { console.error('usage: site-from-run.ts <build dir> <site dir> [--extra-script F]… [--title T] [--single-width] [--passes N]'); process.exit(2); }
  try {
    console.log(`site: ${await siteFromRun(positionals[0], positionals[1], { extraScripts: v['extra-script'], title: v.title, singleWidth: v['single-width'], passes: Number(v.passes) })}`);
  } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(1); }
}
