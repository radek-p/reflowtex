// SPDX-License-Identifier: AGPL-3.0-or-later
// The file lualatex compiles: a driver that reads reflowtex's capture code
// (src/extract/reflowtex-capture.tex) and then the document, unchanged.
//
// Nothing of the document is read or taken apart: TeX itself finds the
// class – behind a conditional, in a file the document inputs – follows the
// inputs and expands the conditionals. What reflowtex needs installs itself
// through LaTeX's hooks (after the class, when graphics is loaded, at
// \begin{document}) and the serializer's callbacks.
//
// The caller says what it gives: a document (a complete LaTeX file), or a
// snippet, which is set in a document made of the caller's preamble (class,
// packages, macros) and the snippet as its body (snippetDocument).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));          // src/

/** What the caller gives the pipeline: a complete document, or a snippet
 *  to be set in the caller's preamble. The text is never read to decide. */
export type DocumentKind = 'document' | 'snippet';

/** The capture code the driver reads, before the document and at its
 *  \begin{document}; the backend copies both beside the driver. */
export const CAPTURE_EARLY = 'reflowtex-capture.tex';
export const CAPTURE_LATE = 'reflowtex-capture-late.tex';
export const CAPTURE_FILES = [CAPTURE_EARLY, CAPTURE_LATE].map(f => join(SRC, 'extract', f));

/** The driver's file name: TeX's job takes the document's name (-jobname). */
export const DRIVER_FILE = 'reflowtex-driver.tex';
/** Where a document given as text is written, beside the driver. */
export const DOCUMENT_FILE = 'reflowtex-document.tex';
/** Where the caller's preamble is written for a complete document. */
export const CALLER_PREAMBLE_FILE = 'reflowtex-caller-preamble.tex';
/** The job name when the caller gives none. */
export const DEFAULT_JOBNAME = 'input';

/** The setup a snippet is set in when the caller gives no preamble.
 *  Integrations are expected to pass their own. */
export const DEFAULT_PREAMBLE = [
  '\\documentclass{article}',
  '\\usepackage{mathtools}',
  '\\usepackage{amssymb}',
  '\\usepackage{tikz}',
].join('\n');

/** The caller's \DocumentMetadata keys. By default the document's own
 *  \DocumentMetadata wins, and the caller's applies only to a document that
 *  has none (the backend asks TeX first: metadataProbeTex). With `force`
 *  the caller's applies, and the document's own is ignored with a warning
 *  in the log. */
export interface DocumentMetadataOption {
  keys: string;
  force?: boolean;
}

/** Characters a file name in the driver may hold: TeX reads it as it is. */
const SAFE_NAME_RE = /^[A-Za-z0-9_.\/+-]+$/;
/** The same for a job name (no directory). */
const SAFE_JOBNAME_RE = /^[A-Za-z0-9_.+-]+$/;

function checkName(f: string, re = SAFE_NAME_RE): string {
  if (!re.test(f)) throw new Error(`the driver cannot read ${JSON.stringify(f)}: a file name with only letters, digits and _ . + - (and / in a path)`);
  return f;
}

/** A job name TeX can take as it is: `name`'s, or an error. */
export function checkJobname(name: string): string { return checkName(name, SAFE_JOBNAME_RE); }

/** The primitive \input (LaTeX's \@@input): the file is read as TeX reads a
 *  main file, without LaTeX's file hooks – \CurrentFile stays empty, as in
 *  the document's own run. */
const inputPrimitive = (f: string) => `\\csname @@input\\endcsname{${checkName(f)}}`;

/** \DocumentMetadata{keys} issued by the driver; under `force`, the
 *  document's own then only leaves a warning naming its keys. This is the
 *  one command reflowtex redefines for the document, and only when forced. */
export function metadataTex(m: DocumentMetadataOption): string {
  let depth = 0;
  for (const c of m.keys) if ((depth += c === '{' ? 1 : c === '}' ? -1 : 0) < 0) break;
  if (depth !== 0) throw new Error(`unbalanced braces in the document metadata: ${m.keys}`);
  const lines = [`\\DocumentMetadata{${m.keys}}`];
  if (m.force) {
    lines.push(`\\protected\\long\\def\\DocumentMetadata#1{\\PackageWarningNoLine{reflowtex}{The document's \\string\\DocumentMetadata\\space is ignored,\\MessageBreak the caller's is forced. Ignored keys:\\MessageBreak \\detokenize{#1}}}`);
  }
  return lines.join('\n');
}

export interface DriverOptions {
  /** the document's file: a name beside the driver, or an absolute path */
  document: string;
  /** the width increment (sp) */
  widthExtraSp: number;
  /** \DocumentMetadata the driver issues first (the backend decides whether
   *  it applies: DocumentMetadataOption) */
  metadata?: DocumentMetadataOption;
  /** a file beside the driver holding the caller's preamble, read at the
   *  end of the document's own (a complete document only) */
  callerPreamble?: string;
  /** more TeX, read after the capture code and before the document (a
   *  tool's own hooks) */
  extra?: string;
}

/** The driver's text. */
export function driverTex(o: DriverOptions): string {
  return [
    '% reflowtex driver: the capture code, then the document as it is.',
    ...(o.metadata ? [metadataTex(o.metadata)] : []),
    `\\input{${CAPTURE_EARLY}}`,
    `\\reflowtexWidthExtra=${Math.round(o.widthExtraSp)}sp\\relax`,
    // read as the document's own code (top-level), in this order: the
    // caller's preamble, then the capture's late part
    ...(o.callerPreamble ? [`\\AddToHook{begindocument/before}{\\input{${checkName(o.callerPreamble)}}}`] : []),
    `\\AddToHook{begindocument/before}{\\input{${CAPTURE_LATE}}}`,
    ...(o.extra ? [o.extra.replace(/\n$/, '')] : []),
    inputPrimitive(o.document),
    '',
  ].join('\n');
}

/** Where the metadata probe writes its answer: 1 when the document set
 *  \DocumentMetadata before its class, 0 when not. */
export const METADATA_PROBE_FILE = 'reflowtex-metadata-probe.txt';

/** A driver that runs the document up to its class and stops: by then the
 *  document's own \DocumentMetadata, if any, has run, which the kernel's
 *  \IfDocumentMetadataTF tells. The document's text is not read. */
export function metadataProbeTex(document: string): string {
  return [
    '% reflowtex: has the document its own \\DocumentMetadata? Asked of the kernel when the class begins.',
    `\\AddToHook{class/before}{\\directlua{local f = assert(io.open("${METADATA_PROBE_FILE}", "w")) f:write("\\IfDocumentMetadataTF{1}{0}") f:close() os.exit(0)}}`,
    inputPrimitive(document),
    '',
  ].join('\n');
}

/** A snippet set in a document: the caller's preamble (or, without one,
 *  DEFAULT_PREAMBLE) and the snippet as the body. */
export function snippetDocument(content: string, preamble: string): string {
  return [preamble.trim() ? preamble.replace(/\n$/, '') : DEFAULT_PREAMBLE, '\\begin{document}', content, '\\end{document}', ''].join('\n');
}
