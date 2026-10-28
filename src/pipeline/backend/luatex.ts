// SPDX-License-Identifier: AGPL-3.0-or-later
// The LuaTeX backend: the document compiled by lualatex (lualatex.ts) as it
// is, through a driver (driver.ts) that reads the capture code first; its
// node lists written by serializer.lua as output.json.
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
import { runLuaLatex, runLuaLatexOnce } from '../lualatex.ts';
import {
  CALLER_PREAMBLE_FILE, CAPTURE_FILES, DEFAULT_JOBNAME, DOCUMENT_FILE, DRIVER_FILE, METADATA_PROBE_FILE,
  checkJobname, driverTex, metadataProbeTex, snippetDocument, type DocumentMetadataOption,
} from '../driver.ts';
import type { Capabilities } from './capabilities.ts';
import type { Availability, BackendOptions, BackendRuntime, CaptureBackend, CaptureDocument, CaptureJob, CaptureResult, CaptureRun, Diagnostic } from './types.ts';

const SRC = fileURLToPath(new URL('../..', import.meta.url));          // src/
export const DEFAULT_SERIALIZER = join(SRC, 'extract/serializer.lua');
/** MathML capture (src/extract/mathml.lua): the serializer loads it when it
 *  lies next to it. */
export const MATHML_LUA = join(SRC, 'extract/mathml.lua');
/** the companion package */
export const LATEX_DIR = join(SRC, 'latex');

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

/** The caller's \DocumentMetadata, if it applies to the document in `dir`
 *  (driver.ts): always under `force`; otherwise only when the document sets
 *  none itself, which TeX is asked (metadataProbeTex) – the document is run
 *  up to its class, and the kernel says. */
export async function applicableMetadata(dir: string, document: string, m: DocumentMetadataOption | undefined,
                                         run: { texinputs: string[]; shellEscape?: boolean }): Promise<DocumentMetadataOption | undefined> {
  if (!m || m.force) return m;
  const probe = 'reflowtex-metadata-probe.tex';
  writeFileSync(join(dir, probe), metadataProbeTex(document));
  rmSync(join(dir, METADATA_PROBE_FILE), { force: true });
  await runLuaLatexOnce(dir, { ...run, main: probe, jobname: 'reflowtex-metadata-probe' });
  const answer = existsSync(join(dir, METADATA_PROBE_FILE)) ? readFileSync(join(dir, METADATA_PROBE_FILE), 'utf8').trim() : '';
  // no answer: the document never reached a class; TeX will say why in the run itself
  return answer === '0' ? m : undefined;
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

/** The document's file in `dir`: a document as it is, a snippet set in the
 *  caller's preamble (snippetDocument); the caller's preamble for a document
 *  beside it; the capture code copied there. */
function writeDocument(doc: CaptureDocument): { callerPreamble?: string } {
  writeFileSync(join(doc.dir, DOCUMENT_FILE), doc.kind === 'document' ? doc.content : snippetDocument(doc.content, doc.preamble));
  const callerPreamble = doc.kind === 'document' ? doc.preamble.trim() : '';
  if (callerPreamble) writeFileSync(join(doc.dir, CALLER_PREAMBLE_FILE), `${callerPreamble}\n`);
  else rmSync(join(doc.dir, CALLER_PREAMBLE_FILE), { force: true });
  for (const f of CAPTURE_FILES) copyFileSync(f, join(doc.dir, basename(f)));
  return callerPreamble ? { callerPreamble: CALLER_PREAMBLE_FILE } : {};
}

export class LuaTeXBackend implements CaptureBackend {
  readonly id = 'luatex';
  readonly name = 'LuaTeX (lualatex from TeX Live)';
  readonly runtime: BackendRuntime = { kind: 'process', concurrent: true, firstRunAlone: true };
  readonly capabilities: Capabilities = LUATEX_CAPABILITIES;
  readonly serializer: string;
  private readonly shellEscape?: boolean;

  constructor(o: BackendOptions = {}) {
    this.serializer = o.serializer ?? DEFAULT_SERIALIZER;
    this.shellEscape = o.shellEscape;
  }

  availability(): Availability { return { ok: true }; }

  async open(doc: CaptureDocument): Promise<CaptureJob> {
    const { dir } = doc;
    const jobname = checkJobname(doc.jobname ?? DEFAULT_JOBNAME);
    mkdirSync(join(dir, 'pics'), { recursive: true });      // PGF externalisation's conventional prefix
    const { callerPreamble } = writeDocument(doc);
    // Always refreshed: a stale serializer would silently lack newer features.
    copyFileSync(this.serializer, join(dir, 'serializer.lua'));
    if (doc.mathml) copyFileSync(MATHML_LUA, join(dir, 'mathml.lua'));
    else rmSync(join(dir, 'mathml.lua'), { force: true });
    for (const otf of doc.localFonts) {
      const dst = join(dir, basename(otf));
      if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(otf).mtimeMs) copyFileSync(otf, dst);
    }
    const texinputs = [LATEX_DIR, ...doc.searchDirs];
    const metadata = await applicableMetadata(dir, DOCUMENT_FILE, doc.documentMetadata, { texinputs, shellEscape: this.shellEscape });
    const input = (widthExtraSp: number) => driverTex({ document: DOCUMENT_FILE, widthExtraSp, callerPreamble, metadata });
    const own = new Set([`${jobname}.pdf`, `${jobname}.log`, 'output.json', 'nodelist.pb']);
    let sampleSeq = 0;
    const sampleDir = () => {
      const d = join(dir, 'samples', String(++sampleSeq));
      rmSync(d, { recursive: true, force: true });
      mkdirSync(d, { recursive: true });
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isFile() && !own.has(f)) cpSync(p, join(d, f));
      }
      return d;
    };
    rmSync(join(dir, 'samples'), { recursive: true, force: true });
    let runs = 0;
    return {
      capture: async (run: CaptureRun): Promise<CaptureResult> => {
        const d = runs++ === 0 ? dir : sampleDir();
        writeFileSync(join(d, DRIVER_FILE), input(run.widthExtraSp));
        const r = await runLuaLatex(d, { texinputs, passes: run.passes, main: DRIVER_FILE, jobname, block: doc.label, shellEscape: this.shellEscape, texErrors: doc.texErrors });
        const data = readSerializerOutput(r.output);
        const errors: Diagnostic[] = r.errors.map(e => ({ severity: 'error', ...e, pass: r.passes }));
        return { data, dir: d, mathml: readMathmlFile(d, jobname), diagnostics: [...errors, ...(existsSync(r.log) ? logDiagnostics(readFileSync(r.log, 'utf8')) : [])] };
      },
    };
  }
}
