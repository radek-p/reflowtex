// SPDX-License-Identifier: AGPL-3.0-or-later
// The LuaTeX backend: the document set in src/extract/template.tex, compiled
// by lualatex (lualatex.ts), its node lists written by serializer.lua as
// output.json.
//
// A job's first capture runs in the document's own directory; each later
// one (a wider display sample, a probe) in a directory of its own – a copy
// of the document's, so it reads back the same .aux/.toc/.bbl – and several
// run at once. Each keeps its own PDF, which its pictures come from.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSerializerOutput } from '../nodes.ts';
import { readMathmlFile } from '../mathml.ts';
import { runLuaLatex } from '../lualatex.ts';
import { DOCCLASS_RE, splitDocument, takeMetadata, withInputClass } from '../document.ts';
import type { Capabilities } from './capabilities.ts';
import type { Availability, BackendOptions, BackendRuntime, CaptureBackend, CaptureDocument, CaptureJob, CaptureResult, CaptureRun, Diagnostic } from './types.ts';

const SRC = fileURLToPath(new URL('../..', import.meta.url));          // src/
export const DEFAULT_TEMPLATE = join(SRC, 'extract/template.tex');
export const DEFAULT_SERIALIZER = join(SRC, 'extract/serializer.lua');
/** MathML capture (src/extract/mathml.lua): the serializer loads it when it
 *  lies next to it. */
export const MATHML_LUA = join(SRC, 'extract/mathml.lua');
/** the companion package */
export const LATEX_DIR = join(SRC, 'latex');

export const PREAMBLE_MARK = '%%PREAMBLE%%';
export const CONTENT_MARK = '%%CONTENT%%';
export const WIDTH_EXTRA_MARK = '%%WIDTH-EXTRA-SP%%';
/** Where the author's \\DocumentMetadata goes: the template's first line, as
 *  LaTeX wants it before \\documentclass. An author who enables tagging and
 *  luamml there (\\DocumentMetadata{tagging=on}, and
 *  \\tagpdfsetup{math/mathml/luamml/load=true} for classic fonts) gets LaTeX's
 *  MathML for every formula (src/pipeline/mathml.ts reads it); a document
 *  without it gets none. */
export const METADATA_MARK = '%%DOCUMENT-METADATA%%';
export const TEMPLATE_CLASS_RE = /^\\documentclass\b[^\n]*$/m;

/** What LuaTeX does, checked by the conformance suite (tests/backends). */
export const LUATEX_CAPABILITIES: Capabilities = {
  multiPass: true,
  widthResampling: true,
  opentypeFonts: true,
  classicFonts: true,
  protrusion: true,
  fontExpansion: true,
  pictures: true,
  companion: true,
  batchParts: true,
  tagging: true,
  mathml: true,
  shellEscape: true,
};

/** The template filled with a document: a function of the width increment.
 *  A complete document's class replaces the template's, its preamble becomes
 *  the preamble (the caller's, if any, follows), its body the content; the
 *  author's \DocumentMetadata goes to the template's top. The class line may
 *  be in a file the document inputs, from `dirs`, its own directories
 *  (withInputClass). Anything else is a snippet, set as the template's
 *  content: what TeX makes of it is TeX's to say. */
export function fillTemplate(template: string, content: string, preamble: string, dirs: string[] = []): (widthExtraSp: number) => string {
  let metadata = '';
  content = withInputClass(content, dirs);
  const doc = splitDocument(content);
  if (doc) {
    // (the document's own, else the caller's preamble's)
    metadata = takeMetadata(content.slice(0, DOCCLASS_RE.exec(content)!.index))[0];
    const [callers, rest] = takeMetadata(preamble);
    preamble = rest;
    metadata ||= callers;
    const [classLine, docPreamble, body] = doc;
    let replaced = false;
    template = template.replace(TEMPLATE_CLASS_RE, () => { replaced = true; return classLine; });
    preamble = (replaced ? '' : `${classLine}\n`) + docPreamble + (preamble ? `\n${preamble}` : '');
    content = body;
  } else {
    [metadata, preamble] = takeMetadata(preamble);
    // A preamble may bring its own class (a book's chapters: \documentclass{book}).
    const m = DOCCLASS_RE.exec(preamble);
    if (m) {
      let replaced = false;
      template = template.replace(TEMPLATE_CLASS_RE, () => { replaced = true; return m[0].trim(); });
      if (replaced) preamble = preamble.slice(0, m.index) + preamble.slice(m.index + m[0].length);
    }
  }
  return (widthExtraSp: number) => template
    .replaceAll(PREAMBLE_MARK, () => preamble).replaceAll(CONTENT_MARK, () => content)
    .replaceAll(WIDTH_EXTRA_MARK, () => String(widthExtraSp))
    .replaceAll(METADATA_MARK, () => metadata);
}

/** The warnings in a LaTeX log: `LaTeX Warning: …`, `Package x Warning: …`,
 *  `Class x Warning: …`, with their continuation lines and the input line
 *  they name. */
export function logDiagnostics(log: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = log.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(LaTeX|Package (\S+)|Class (\S+)) Warning: (.*)$/.exec(lines[i]);
    if (!m) continue;
    let message = m[4].trim();
    // continuation lines: a package's or class's begin "(name)", LaTeX's
    // own are indented
    const prefix = m[2] ?? m[3];
    const cont = prefix ? new RegExp(`^\\(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*(.*)$`) : /^\s+(\S.*)$/;
    for (let j = i + 1; j < lines.length; j++) {
      const c = cont.exec(lines[j]);
      if (!c) break;
      message += ` ${c[1].trim()}`;
      i = j;
    }
    const line = /on input line (\d+)\.?/.exec(message);
    out.push({ severity: 'warning', message: message.replace(/\s+/g, ' ').trim(), ...(line ? { line: Number(line[1]) } : {}) });
  }
  return out;
}

export class LuaTeXBackend implements CaptureBackend {
  readonly id = 'luatex';
  readonly name = 'LuaTeX (lualatex from TeX Live)';
  readonly runtime: BackendRuntime = { kind: 'process', concurrent: true, firstRunAlone: true };
  readonly capabilities: Capabilities = LUATEX_CAPABILITIES;
  readonly template: string;
  readonly serializer: string;
  private readonly shellEscape?: boolean;

  constructor(o: BackendOptions = {}) {
    this.template = o.template ?? DEFAULT_TEMPLATE;
    this.serializer = o.serializer ?? DEFAULT_SERIALIZER;
    this.shellEscape = o.shellEscape;
  }

  availability(): Availability { return { ok: true }; }

  async open(doc: CaptureDocument): Promise<CaptureJob> {
    const { dir } = doc;
    mkdirSync(join(dir, 'pics'), { recursive: true });      // PGF externalisation's conventional prefix
    const input = fillTemplate(readFileSync(this.template, 'utf8'), doc.content, doc.preamble, doc.searchDirs);
    // Always refreshed: a stale serializer would silently lack newer features.
    copyFileSync(this.serializer, join(dir, 'serializer.lua'));
    if (doc.mathml) copyFileSync(MATHML_LUA, join(dir, 'mathml.lua'));
    else rmSync(join(dir, 'mathml.lua'), { force: true });
    for (const otf of doc.localFonts) {
      const dst = join(dir, basename(otf));
      if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(otf).mtimeMs) copyFileSync(otf, dst);
    }
    const texinputs = [LATEX_DIR, ...doc.searchDirs];
    let sampleSeq = 0;
    const sampleDir = () => {
      const d = join(dir, 'samples', String(++sampleSeq));
      rmSync(d, { recursive: true, force: true });
      mkdirSync(d, { recursive: true });
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isFile() && !['input.pdf', 'input.log', 'output.json', 'nodelist.pb'].includes(f)) cpSync(p, join(d, f));
      }
      return d;
    };
    rmSync(join(dir, 'samples'), { recursive: true, force: true });
    // EPS figures converted once, for every run of the job (lualatex.ts)
    const figureCache = doc.figureCache ?? join(dir, 'converted-figures-cache');
    let runs = 0;
    return {
      capture: async (run: CaptureRun): Promise<CaptureResult> => {
        const d = runs++ === 0 ? dir : sampleDir();
        writeFileSync(join(d, 'input.tex'), input(run.widthExtraSp));
        const data = readSerializerOutput(await runLuaLatex(d, {
          texinputs, passes: run.passes, block: doc.label, shellEscape: this.shellEscape, figureCache, log: doc.log,
        }));
        const log = join(d, 'input.log');
        return { data, dir: d, mathml: readMathmlFile(d), diagnostics: existsSync(log) ? logDiagnostics(readFileSync(log, 'utf8')) : [] };
      },
    };
  }
}
