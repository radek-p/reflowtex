#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// A LaTeX document as a pageless PDF: one page as tall as the document.
//
//     node tools/pageless-pdf/pageless.ts <document.tex> [-o DIR] [--template T] [--passes N]
//                                         [--margin 36pt] [--width-extra 0pt]
//
// The document is compiled as the pipeline compiles it – inside the extraction
// template, with the serializer capturing the galley – plus two lines:
// pageless_pdf.lua loaded after the serializer, and a hook at the end of the
// document that ships the captured galley as a few very tall pages. Those are
// then stacked into one (stack.ts), pageless.pdf: the document with no page
// breaks, every box and every glue where TeX put them – the reference the
// browser's rendering is compared with at the same width.
//
// The run also leaves the serializer's output.json beside the PDF, so the PDF
// and a page built from that output.json (site-from-run.ts) describe the same
// compilation. Unlike the pipeline, this compiles once, at the document's own
// width (plus --width-extra).
//
// A complete document fills the template as the pipeline fills it: its
// \documentclass line replaces the template's, its preamble and body go in the
// template's slots; a template without a class line (examples/testmath's) takes
// the class line as part of the preamble.
//
// Outputs in DIR (default pageless/<document stem>/): pageless.pdf,
// pageless.json (chunk pages and pictures, sp), output.json, and the run's
// input.tex, input.log and input.pdf. Shell escape is off unless
// REFLOWTEX_SHELL_ESCAPE=1, as in the pipeline.
import { parseArgs } from 'node:util';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_MARK, PREAMBLE_MARK, WIDTH_EXTRA_MARK, TEMPLATE_CLASS_RE, DEFAULT_TEMPLATE, DEFAULT_SERIALIZER, splitDocument } from '../../src/pipeline/pipeline.ts';
import { runLuaLatex } from '../../src/pipeline/lualatex.ts';
import { stack } from './stack.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LATEX_DIR = resolve(HERE, '../../src/latex');

/** The template with the shipper loaded and the end-of-document hook. */
export function instrument(template: string, margin: string): string {
  const serializerLine = '\\directlua{dofile("serializer.lua")}';
  if (!template.includes(serializerLine)) throw new Error('template does not load serializer.lua');
  template = template.replace(serializerLine, () => `${serializerLine}\n\\directlua{dofile("pageless_pdf.lua")}`);
  const hook = '\\AddToHook{enddocument/afterlastpage}{%\n'
    + `  \\pdfvariable horigin=${margin} \\pdfvariable vorigin=0pt\n`
    + `  \\directlua{Pageless.ship{margin = tex.sp("${margin}")}}}\n`;
  // the line that begins the document – not a mention in a comment above it
  const at = [...template.matchAll(/^\\begin\{document\}/gm)].pop();
  if (!at) throw new Error('template has no \\begin{document} line');
  return template.slice(0, at.index) + hook + template.slice(at.index);
}

export function fill(template: string, document: string, widthExtraSp: number): string {
  const doc = splitDocument(document);
  if (!doc) throw new Error('not a complete document (\\documentclass … \\begin{document} … \\end{document})');
  let [classLine, preamble, body] = doc;
  let replaced = false;
  template = template.replace(TEMPLATE_CLASS_RE, () => { replaced = true; return classLine; });
  if (!replaced) preamble = classLine + preamble;
  return template.replaceAll(PREAMBLE_MARK, () => preamble).replaceAll(CONTENT_MARK, () => body)
    .replaceAll(WIDTH_EXTRA_MARK, () => String(widthExtraSp));
}

/** A TeX dimension (pt, bp, mm, cm, in, pc) in sp. */
export function dimenSp(s: string): number {
  const m = /^\s*(-?[0-9.]+)\s*(pt|bp|mm|cm|in|pc)?\s*$/.exec(s);
  if (!m) throw new Error(`bad dimension: ${s}`);
  const per: Record<string, number> = { pt: 1, bp: 72.27 / 72, mm: 72.27 / 25.4, cm: 72.27 / 2.54, in: 72.27, pc: 12 };
  return Math.round(Number(m[1]) * per[m[2] ?? 'pt'] * 65536);
}

export interface PagelessOptions { out: string; template?: string; passes?: number; margin?: string; widthExtra?: string; log?: (s: string) => void }

/** Compile `document` to out/pageless.pdf. */
export async function pageless(document: string, o: PagelessOptions): Promise<string> {
  const log = o.log ?? (s => console.log(s));
  const out = resolve(o.out);
  mkdirSync(join(out, 'pics'), { recursive: true });
  const template = instrument(readFileSync(o.template ?? DEFAULT_TEMPLATE, 'utf8'), o.margin ?? '36pt');
  writeFileSync(join(out, 'input.tex'), fill(template, readFileSync(document, 'utf8'), dimenSp(o.widthExtra ?? '0pt')));
  copyFileSync(DEFAULT_SERIALIZER, join(out, 'serializer.lua'));
  copyFileSync(join(HERE, 'pageless_pdf.lua'), join(out, 'pageless_pdf.lua'));
  for (const stale of ['input.aux', 'pageless.json', 'input.pdf', 'output.json', 'pageless.pdf']) rmSync(join(out, stale), { force: true });
  // the document's own files (\input, graphics) resolve beside it; noted for
  // site-from-run.ts, which compiles the document again
  const srcDir = dirname(resolve(document));
  writeFileSync(join(out, 'source-dir.txt'), `${srcDir}\n`);
  await runLuaLatex(out, {
    texinputs: [srcDir, LATEX_DIR], passes: o.passes ?? 2, settle: false, expect: 'input.pdf', block: basename(document),
    onPass: (n, text) => {
      const shipped = text.split('\n').filter(l => l.startsWith('pageless: '));
      log(`  pass ${n}: ${shipped.pop() ?? 'no pageless line in the log'}`);
    },
  });
  if (!existsSync(join(out, 'pageless.json'))) throw new Error('the run wrote no pageless.json');
  const r = await stack(join(out, 'input.pdf'), JSON.parse(readFileSync(join(out, 'pageless.json'), 'utf8')), join(out, 'pageless.pdf'));
  log(`  pageless.pdf: 1 page, ${r.width.toFixed(3)} x ${r.height.toFixed(3)} bp, ${r.chunks} chunk(s), ${r.pictures} picture(s)`);
  return join(out, 'pageless.pdf');
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' }, template: { type: 'string' }, passes: { type: 'string', default: '2' },
      margin: { type: 'string', default: '36pt' }, 'width-extra': { type: 'string', default: '0pt' },
    },
  });
  if (positionals.length !== 1) {
    console.error('usage: pageless.ts <document.tex> [-o DIR] [--template T] [--passes N] [--margin 36pt] [--width-extra 0pt]');
    process.exit(2);
  }
  const doc = positionals[0];
  try {
    const pdf = await pageless(doc, { out: v.out ?? join('pageless', basename(doc).replace(/\.[^.]*$/, '')), template: v.template,
      passes: Number(v.passes), margin: v.margin, widthExtra: v['width-extra'] });
    console.log(`pageless: ${pdf}`);
  } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(1); }
}
