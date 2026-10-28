#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// A LaTeX document as a pageless PDF: one page as tall as the document.
//
//     node tools/pageless-pdf/pageless.ts <document.tex> [-o DIR] [--passes N] [--margin 36pt]
//                                         [--width-extra 0pt] [--tex-pictures]
//                                         [--snippet [--preamble P.tex]] [--preamble P.tex]
//                                         [--document-metadata KEYS [--force-metadata]]
//                                         [--fail-on-tex-error]
//
// The document is compiled as the pipeline compiles it – through the driver
// (src/pipeline/driver.ts), which reads the capture code and then the file
// as it is, under its own name (\jobname) – plus two lines: pageless_pdf.lua
// loaded after the serializer, and a hook at the end of the document that
// ships the captured galley as a few very tall pages. Those are then stacked
// into one (stack.ts), pageless.pdf: the document with no page breaks, every
// box and every glue where TeX put them – the reference the browser's
// rendering is compared with at the same width.
//
// The run also leaves the serializer's output.json beside the PDF, so the PDF
// and a page built from that output.json (site-from-run.ts) describe the same
// compilation. Unlike the pipeline, this compiles once, at the document's own
// width (plus --width-extra).
//
// A .tex file is a complete document. --snippet sets it as a snippet in
// --preamble's setup (without one, the pipeline's DEFAULT_PREAMBLE); for a
// document, --preamble is read at the end of the document's own preamble.
// --document-metadata gives \DocumentMetadata keys: the document's own wins, unless
// --force-metadata.
//
// Outputs in DIR (default pageless/<document stem>/): pageless.pdf,
// pageless.json (chunk pages and pictures, sp), output.json, and the run's
// driver, log and PDF (<stem>.log, <stem>.pdf). Shell escape is off unless
// REFLOWTEX_SHELL_ESCAPE=1, as in the pipeline.
//
// As in the pipeline, an error TeX carries on past (nonstopmode) is a
// warning line naming it, and the strip is what TeX made of the document;
// --fail-on-tex-error stops at it instead. TeX stopping always stops it.
//
// --tex-pictures leaves TikZ pictures to TeX: the capture is undone at
// \begin{document}, so each picture is drawn in the galley by PGF, not
// shipped to a private page and stacked back. The strip is then a reference
// the capture had no part in – what the browser's pictures, labels and all,
// are to match. The run's output.json is not the pipeline's (it has no picture
// nodes); build the page from an ordinary run.
import { parseArgs } from 'node:util';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SERIALIZER } from '../../src/pipeline/pipeline.ts';
import { applicableMetadata } from '../../src/pipeline/backend/luatex.ts';
import {
  CALLER_PREAMBLE_FILE, CAPTURE_FILES, DOCUMENT_FILE, DRIVER_FILE, checkJobname, driverTex, snippetDocument,
  type DocumentKind, type DocumentMetadataOption,
} from '../../src/pipeline/driver.ts';
import { runLuaLatex, type TexErrorPolicy } from '../../src/pipeline/lualatex.ts';
import { texErrorWarning } from '../../src/pipeline/warnings.ts';
import { Log } from '../../src/shared/log.ts';
import { stack } from './stack.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LATEX_DIR = resolve(HERE, '../../src/latex');
/** Where a run notes the job's name, for site-from-run.ts. */
export const JOBNAME_FILE = 'jobname.txt';

/** The driver's extra lines (driver.ts): the shipper loaded after the
 *  serializer, and the end-of-document hook; unless `capture`, TikZ's own
 *  \tikzpicture back, and nicematrix's environments drawn by TeX in the
 *  galley too, once the capture has wrapped them at \begin{document}. */
export function driverExtra(margin: string, capture = true): string {
  const restore = capture ? '' : '\\AddToHook{begindocument/before}{%\n'
    + '  \\let\\tikzpicture\\reflowtexOrigTikzpicture \\let\\endtikzpicture\\reflowtexOrigEndtikzpicture\n'
    + '  \\let\\reflowtexCaptureEnvBegin\\relax \\let\\reflowtexCaptureEnvEnd\\relax}\n';
  return '\\directlua{dofile("pageless_pdf.lua")}\n' + restore + '\\AddToHook{enddocument/afterlastpage}{%\n'
    + `  \\directlua{Pageless.ship{margin = tex.sp("${margin}")}}}\n`;
}

/** A TeX dimension (pt, bp, mm, cm, in, pc) in sp. */
export function dimenSp(s: string): number {
  const m = /^\s*(-?[0-9.]+)\s*(pt|bp|mm|cm|in|pc)?\s*$/.exec(s);
  if (!m) throw new Error(`bad dimension: ${s}`);
  const per: Record<string, number> = { pt: 1, bp: 72.27 / 72, mm: 72.27 / 25.4, cm: 72.27 / 2.54, in: 72.27, pc: 12 };
  return Math.round(Number(m[1]) * per[m[2] ?? 'pt'] * 65536);
}

export interface PagelessOptions {
  out: string; passes?: number; margin?: string; widthExtra?: string;
  /** what the file is (default: a complete document) */
  kind?: DocumentKind;
  /** a snippet's setup, or more preamble for a document (TeX text) */
  preamble?: string;
  /** \DocumentMetadata keys of the caller's (driver.ts) */
  documentMetadata?: DocumentMetadataOption;
  /** TikZ pictures drawn by TeX in the galley, not captured (--tex-pictures) */
  texPictures?: boolean;
  /** an error TeX carries on past: a warning line (default 'warn'), or the
   *  run fails ('error') */
  texErrors?: TexErrorPolicy;
  log?: (s: string) => void;
}

/** Compile `document` to out/pageless.pdf. */
export async function pageless(document: string, o: PagelessOptions): Promise<string> {
  const log = o.log ?? (s => console.log(s));
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  // the document's own files (\input, graphics) resolve beside it; noted for
  // site-from-run.ts, which compiles the document again
  const srcDir = dirname(resolve(document));
  const jobname = checkJobname(basename(document).replace(/\.tex$/, ''));
  const widthExtraSp = dimenSp(o.widthExtra ?? '0pt');
  const preamble = o.preamble?.trim() ?? '';
  // a document as it is, by its own path; a snippet set in its preamble beside the driver
  let file = resolve(document);
  if (o.kind === 'snippet') {
    file = DOCUMENT_FILE;
    writeFileSync(join(out, DOCUMENT_FILE), snippetDocument(readFileSync(document, 'utf8'), preamble));
  }
  const callerPreamble = o.kind !== 'snippet' && preamble ? CALLER_PREAMBLE_FILE : undefined;
  if (callerPreamble) writeFileSync(join(out, callerPreamble), `${preamble}\n`);
  for (const f of CAPTURE_FILES) copyFileSync(f, join(out, basename(f)));
  copyFileSync(DEFAULT_SERIALIZER, join(out, 'serializer.lua'));
  copyFileSync(join(HERE, 'pageless_pdf.lua'), join(out, 'pageless_pdf.lua'));
  for (const stale of [`${jobname}.aux`, 'pageless.json', `${jobname}.pdf`, 'output.json', 'pageless.pdf']) rmSync(join(out, stale), { force: true });
  writeFileSync(join(out, 'source-dir.txt'), `${srcDir}\n`);
  writeFileSync(join(out, JOBNAME_FILE), `${jobname}\n`);
  const texinputs = [srcDir, LATEX_DIR];
  const metadata = await applicableMetadata(out, file, o.documentMetadata, { texinputs });
  writeFileSync(join(out, DRIVER_FILE), driverTex({ document: file, widthExtraSp, callerPreamble, metadata, extra: driverExtra(o.margin ?? '36pt', !o.texPictures) }));
  const run = await runLuaLatex(out, {
    texinputs, passes: o.passes ?? 2, settle: false, main: DRIVER_FILE, jobname, expect: `${jobname}.pdf`, block: basename(document),
    texErrors: o.texErrors, log: new Log('pipeline', [r => log(r.message)]),
    onPass: (n, text) => {
      const shipped = text.split('\n').filter(l => l.startsWith('pageless: '));
      log(`  pass ${n}: ${shipped.pop() ?? 'no pageless line in the log'}`);
    },
  });
  for (const e of run.errors) log(`  warning: ${texErrorWarning({ ...e, pass: run.passes }).message}`);
  if (!existsSync(join(out, 'pageless.json'))) throw new Error('the run wrote no pageless.json');
  const r = await stack(join(out, `${jobname}.pdf`), JSON.parse(readFileSync(join(out, 'pageless.json'), 'utf8')), join(out, 'pageless.pdf'));
  log(`  pageless.pdf: 1 page, ${r.width.toFixed(3)} x ${r.height.toFixed(3)} bp, ${r.chunks} chunk(s), ${r.pictures} picture(s)`);
  return join(out, 'pageless.pdf');
}

if (import.meta.main) {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' }, passes: { type: 'string', default: '2' },
      margin: { type: 'string', default: '36pt' }, 'width-extra': { type: 'string', default: '0pt' },
      'tex-pictures': { type: 'boolean', default: false },
      snippet: { type: 'boolean', default: false }, preamble: { type: 'string' },
      'document-metadata': { type: 'string' }, 'force-metadata': { type: 'boolean', default: false },
      'fail-on-tex-error': { type: 'boolean', default: false },
    },
  });
  if (positionals.length !== 1) {
    console.error('usage: pageless.ts <document.tex> [-o DIR] [--passes N] [--margin 36pt] [--width-extra 0pt] [--tex-pictures]\n'
      + '                   [--snippet] [--preamble P.tex] [--document-metadata KEYS [--force-metadata]] [--fail-on-tex-error]');
    process.exit(2);
  }
  const doc = positionals[0];
  try {
    const pdf = await pageless(doc, { out: v.out ?? join('pageless', basename(doc).replace(/\.[^.]*$/, '')),
      passes: Number(v.passes), margin: v.margin, widthExtra: v['width-extra'], texPictures: v['tex-pictures'],
      texErrors: v['fail-on-tex-error'] ? 'error' : 'warn',
      kind: v.snippet ? 'snippet' : 'document', ...(v.preamble ? { preamble: readFileSync(v.preamble, 'utf8') } : {}),
      ...(v['document-metadata'] ? { documentMetadata: { keys: v['document-metadata'], force: v['force-metadata'] } } : {}) });
    console.log(`pageless: ${pdf}`);
  } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(1); }
}
