// SPDX-License-Identifier: AGPL-3.0-or-later
// The capture backend interface: what turns LaTeX into the node lists the
// rest of the pipeline works on.
//
// A backend is given a document (the content and preamble as the caller
// wrote them, a working directory, where its files are) and opens a job on
// it; the job captures the document at a width, as many times as the
// pipeline asks (display sampling compiles it again, wider). Each capture
// gives output.json's shape (SerializerOutput: fonts, paragraphs, content,
// streams, …), where the run's files are, LaTeX's MathML where captured,
// optionally a picture source, and diagnostics. From there on – MathML,
// pictures, fonts, encoding – every backend shares the same code.
//
// What a backend can do beyond that is in its Capabilities descriptor
// (capabilities.ts). docs/backends.md describes how a backend plugs in.
import type { SerializerOutput } from '../nodes.ts';
import type { Log } from '../../shared/log.ts';
import type { Capabilities } from './capabilities.ts';
import type { DocumentKind, DocumentMetadataOption } from '../driver.ts';
import type { PipelineOnlyKeys } from '../encode.ts';

export interface CaptureDocument {
  /** what `content` is, as the caller says: a complete document, or a
   *  snippet to be set in `preamble`. The text is never read to decide. */
  kind: DocumentKind;
  /** the document or the snippet */
  content: string;
  /** a snippet's setup – class, packages, macros – or, for a document, more
   *  preamble read at the end of the document's own; may be empty (a
   *  snippet is then set in driver.ts's DEFAULT_PREAMBLE) */
  preamble: string;
  /** the caller's \DocumentMetadata keys (driver.ts: the document's own
   *  wins unless forced) */
  documentMetadata?: DocumentMetadataOption;
  /** TeX's job name (\jobname, and the name of every file the run writes);
   *  default 'input' */
  jobname?: string;
  /** the document's working directory (build/<key>/), created: the backend
   *  keeps its run's files there, for a later look */
  dir: string;
  /** how the caller names the document, in messages */
  label: string;
  /** directories searched for what the document reads (figures, \input
   *  files) before the TeX tree */
  searchDirs: string[];
  /** a site's own OpenType files, found by bare file name */
  localFonts: string[];
  /** capture LaTeX's MathML where the document enables it */
  mathml: boolean;
  /** an error TeX carries on past (nonstopmode): a diagnostic of severity
   *  'error' (default 'warn'), or the capture fails with a TexError
   *  ('error'). TeX stopping always fails it. */
  texErrors?: 'error' | 'warn';
  /** where what the backend makes of the document's files is kept for
   *  other documents (LuaTeX: its EPS figures as PDF); default: in `dir` */
  figureCache?: string;
  /** where the backend's own messages go (a figure it could not convert) */
  log?: Log;
}

export interface CaptureRun {
  /** compile with the text width widened by this much (sp); 0 is the
   *  document's own width. Only a backend with `widthResampling` accepts
   *  anything but 0. */
  widthExtraSp: number;
  /** at most this many passes (a backend with `multiPass` stops earlier once
   *  what TeX reads back settles; without it, only 1 is accepted) */
  passes: number;
}

/** One problem TeX or the backend reported, where known. */
export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** the source file, as TeX named it */
  file?: string;
  /** 1-based line in that file */
  line?: number;
  /** an error: what TeX had read of that line when it came */
  context?: string;
  /** an error: how many times it came at the same place */
  count?: number;
  /** an error: the TeX pass it was reported in (the run's last) */
  pass?: number;
}

/** Where a picture node's drawing comes from: the fields the capture put on
 *  it (file, page, externalized, generated). */
export interface PictureRef {
  file: string;
  page: number;
  externalized: boolean;
  generated: boolean;
}

/** SVG for a picture, as a backend makes it. Without one, the pipeline
 *  converts the PDF page the picture node names, in the run's directory. */
export interface PictureSource {
  /** the picture's SVG document (an <svg> root with a viewBox); its ids and
   *  colours are rewritten by the pipeline */
  svg(ref: PictureRef): Promise<string>;
}

/** A glyph's source position (capabilities glyphSourceLines and
 *  glyphSourceMap), on glyph nodes as the field `src`. */
export interface GlyphSource {
  /** the file TeX read the glyph's text from, by the name the document gives
   *  it (an \input file, a package); '' for the document's own text, whose
   *  lines are counted in CaptureDocument.content as given */
  file: string;
  /** 1-based */
  line: number;
  /** 0-based column, in characters (glyphSourceMap only) */
  column?: number;
  /** how many source characters the glyph stands for (a ligature: more
   *  than one; glyphSourceMap only) */
  length?: number;
}

export interface CaptureResult {
  /** output.json: the node lists, fonts, streams and the rest */
  data: SerializerOutput;
  /** the directory holding this run's files: its PDF (pictures' pages),
   *  its log */
  dir: string;
  /** LaTeX's MathML for each formula, by its number (capability mathml) */
  mathml?: Map<number, string>;
  /** SVG for picture nodes, when the backend makes it itself */
  pictures?: PictureSource;
  /** warnings, and the errors TeX recovered from (severity 'error'), each
   *  once, with its count */
  diagnostics: Diagnostic[];
}

/** One document, opened: captured at the widths the pipeline asks for. */
export interface CaptureJob {
  capture(run: CaptureRun): Promise<CaptureResult>;
  /** frees what the job holds (a process, a snapshot) */
  close?(): Promise<void>;
}

/** How a backend runs. */
export interface BackendRuntime {
  /** `process`: a program run once per capture (lualatex); `service`: a
   *  long-lived process the backend talks to; `wasm`: WebAssembly in this
   *  process or a worker; `none`: nothing runs (a placeholder) */
  kind: 'process' | 'service' | 'wasm' | 'none';
  /** several documents may be captured at once */
  concurrent: boolean;
  /** with several jobs, the first capture runs alone (it fills a cache the
   *  others would otherwise all build at once) */
  firstRunAlone?: boolean;
}

export type Availability = { ok: true } | { ok: false; reason: string };

export interface CaptureBackend {
  /** what selects it: --backend ID, REFLOWTEX_BACKEND=ID */
  readonly id: string;
  /** a name for people */
  readonly name: string;
  readonly runtime: BackendRuntime;
  readonly capabilities: Capabilities;
  /** keys its captures carry for the pipeline's own use that the wire format
   *  does not (by latex.proto message name: Node, Paragraph, ContentItem, …),
   *  left out when the pipeline encodes a block; any other key the schema has
   *  no field for is an error (encode.ts) */
  readonly pipelineOnly?: PipelineOnlyKeys;
  /** whether this build can use it (not whether its tools are installed:
   *  a missing program fails the capture, with a message saying so) */
  availability(): Availability;
  open(doc: CaptureDocument): Promise<CaptureJob>;
  /** frees what the backend holds (a service, a module) */
  dispose?(): Promise<void>;
}

/** What a backend may be configured with; each backend says which it reads. */
export interface BackendOptions {
  /** the capture code the driver loads */
  serializer?: string;
  /** shell escape on: the caller asserts every document is trusted
   *  (capability shellEscape) */
  shellEscape?: boolean;
}
