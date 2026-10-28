// SPDX-License-Identifier: AGPL-3.0-or-later
// The build pipeline: LaTeX in, the bytes a page embeds out, and the fonts
// the page serves. Framework-agnostic – integrations (Hugo, a plain page, …)
// drive it and it knows nothing of them.
//
//     const pipe = new Pipeline({ buildRoot: 'build', fontsDir: 'site/fonts' });
//     const bytes = await pipe.compile('$e^{i\\pi}+1=0$', { kind: 'snippet' });
//     await pipe.finishFonts();          // after every block
//     pipe.fontMap();                    // original font file → served file
//
// A capture backend (backend/: LuaTeX by default) turns LaTeX into node
// lists; everything after is shared. One snippet → one build/<key>/
// directory holding the backend's run (LuaTeX's: its driver and its log),
// output.json and nodelist.pb, so the artefacts are there to inspect when
// something looks wrong (and an integration can skip an unchanged snippet).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, join, relative, resolve } from 'node:path';
import { forEachNode, readSerializerOutput, writeSerializerOutput, type SerializerOutput } from './nodes.ts';
import { encodeDocument } from './encode.ts';
import * as DM from './display-model.ts';
import { dropUnreferencedParagraphs, stripUnsupportedNodes, batchParts } from './transforms.ts';
import { attachMathML, readMathmlFile, speaker } from './mathml.ts';
import { convertPictures, includedPictureFiles } from './pictures.ts';
import { figureSources } from './figures.ts';
import { Fonts, fontNeeds } from './fonts/fonts.ts';
import { consoleLog, type Log } from '../shared/log.ts';
import { g6 } from '../shared/numbers.ts';
import { normaliseGlyphAddressing, normaliseLegacyFontAddressing } from './fonts/addressing.ts';
import { kpsewhich } from './fonts/type1.ts';
import { FontFiles, compositeTexts, resolveVirtualFonts } from './fonts/vf.ts';
import { protoText } from './schema.ts';
import { BackendUnavailable, BuildError, MissingCapability, TexError } from './errors.ts';
import { texErrorKey, texErrorWarning } from './warnings.ts';
import { documentNeeds, supports, unmetNeeds, capabilityInfo } from './backend/capabilities.ts';
import { createBackend, selectedBackendId } from './backend/registry.ts';
import type { CaptureBackend, CaptureResult, Diagnostic, PictureSource } from './backend/types.ts';
import type { DocumentKind, DocumentMetadataOption } from './driver.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));             // src/
// The LuaTeX backend's files and the driver's names: tools and integrations
// import them from here.
export { DEFAULT_SERIALIZER, MATHML_LUA } from './backend/luatex.ts';
export { DEFAULT_PREAMBLE, type DocumentKind, type DocumentMetadataOption } from './driver.ts';

/** At most this many passes when the caller gives no number: a run stops as
 *  soon as what TeX reads back settles (lualatex.ts), so a snippet without
 *  references takes one. revtex sets its table of contents' number column
 *  from the pass before, so three. */
export const MAX_PASSES = 3;

/** Display samples are taken at an additive step, not 2× or 3×: the fits stay
 *  well-conditioned without nearing TeX's \maxdimen. */
export const DISPLAY_SAMPLE_STEP_SP = 128 * 65536;
export const TEX_MAX_DIMEN_SP = 1073741823;

// ── Documents and keys ──────────────────────────────────────────────────────

/** A stable 16-hex key for a (content, preamble) pair; integrations name each
 *  block's artefacts by it. (The Hugo shortcode computes the same.) */
export function contentKey(content: string, preamble = ''): string {
  let normalised = content.trim();
  if (preamble) normalised = `${preamble}\n===REFLOWTEX-PREAMBLE-BOUNDARY===\n${normalised}`;
  return createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, 16);
}

/** A 16-hex hash of what turns a snippet into its bundle besides the snippet
 *  itself: the capture code, the serializer, the LaTeX packages, the schema and
 *  this pipeline's own code. A build made with other versions of these is
 *  stale however unchanged its snippet is – an integration that skips
 *  unchanged snippets records this beside the content key and compares both.
 *  A backend other than LuaTeX is part of the hash (LuaTeX's is the hash
 *  as it was before there were backends). */
export function toolchainHash(src = SRC, backend = 'luatex'): string {
  const h = createHash('sha256');
  if (backend !== 'luatex') h.update(`backend\0${backend}\0`);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tex|sty|lua|ts|proto)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) h.update(relative(src, p)).update('\0').update(readFileSync(p)).update('\0');
    }
  };
  for (const d of ['extract', 'latex', 'schema', 'pipeline']) if (existsSync(join(src, d))) walk(join(src, d));
  return h.digest('hex').slice(0, 16);
}

/** The files a block read besides its source (its figures), each with a
 *  16-hex hash of its bytes, by path. The content key is the block's text
 *  alone, so an integration that skips an unchanged block records these
 *  beside it and compiles it again when filesUnchanged says otherwise. */
export function fileHashes(files: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...files].sort()) out[f] = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16);
  return out;
}

/** Whether every file recorded by fileHashes is still there with the same
 *  bytes (true when none were recorded). */
export function filesUnchanged(recorded: Record<string, string> | undefined): boolean {
  for (const [f, hash] of Object.entries(recorded ?? {})) {
    if (!existsSync(f) || fileHashes([f])[f] !== hash) return false;
  }
  return true;
}

// ── The pipeline ────────────────────────────────────────────────────────────

export interface PipelineOptions {
  buildRoot: string;
  /** where served fonts are written */
  fontsDir: string;
  /** a site's own font files, found before TeX Live's (and copied next to
   *  the driver, so fontspec finds them by bare file name) */
  localFontsDir?: string | null;
  /** where TeX also looks for what a document reads (figures, \input files)
   *  before its own tree: a document is compiled away from its directory */
  searchDirs?: string[];
  /** the capture backend: an id (backend/registry.ts: 'luatex', …) or a
   *  backend object; default: REFLOWTEX_BACKEND, else 'luatex' */
  backend?: string | CaptureBackend;
  /** the capture code the driver loads (the LuaTeX backend's) */
  serializer?: string;
  /** record MathML for every formula (default on; needs TeX Live's luamml) */
  mathml?: boolean;
  /** a document needing a capability the backend lacks: 'error' (default)
   *  stops the build where the result would be wrong or incomplete; 'warn'
   *  builds it, saying what is missing */
  missingCapabilities?: 'error' | 'warn';
  /** an error TeX carries on past (nonstopmode, as plain lualatex does):
   *  'warn' (default) builds the block as TeX set it and logs a warning
   *  (tex-error) for each distinct error, which the block's data carries to
   *  the page's log too; 'error' stops the block's build at the first
   *  (TexError). TeX stopping (no output) always stops it. */
  texErrors?: 'error' | 'warn';
  /** where the build's messages go (default: consoleLog, the console) */
  log?: Log;
}

export interface CompileOptions {
  /** what the text is: a complete document, compiled as it is, or a snippet,
   *  set in `preamble` (docs/documents.md). Required: the text is never
   *  read to decide. */
  kind: DocumentKind;
  /** a snippet's setup – class, packages, macros (none: driver.ts
   *  DEFAULT_PREAMBLE) – or, for a document, more preamble read at the end
   *  of the document's own */
  preamble?: string;
  key?: string;
  /** at most this many TeX passes (default MAX_PASSES; fewer once what TeX
   *  reads back settles) */
  passes?: number;
  /** the caller's \DocumentMetadata keys: the document's own wins, unless
   *  `force` (driver.ts) */
  documentMetadata?: DocumentMetadataOption;
  /** TeX's job name (\jobname); default 'input' */
  jobname?: string;
  /** how the caller knows the snippet (a file, a page and line): messages only */
  name?: string;
}

export class Pipeline {
  readonly buildRoot: string;
  readonly fonts: Fonts;
  /** the TeX tree's virtual fonts and metrics (fonts/vf.ts) */
  private readonly fontFiles = new FontFiles(name => { const p = kpsewhich(name); return p ? readFileSync(p) : null; });
  /** the capture backend: what it is and can do (backend.capabilities) */
  readonly backend: CaptureBackend;
  private readonly searchDirs: string[];
  private readonly missingCapabilities: 'error' | 'warn';
  private readonly texErrors: 'error' | 'warn';
  /** the warnings of each block's last compilation, by key */
  readonly diagnostics = new Map<string, Diagnostic[]>();
  private readonly mathml: boolean;
  private readonly localFonts: string[];
  private readonly log: Log;
  /** every block compiled or declared current (useCached), by key: what the
   *  served fonts must cover */
  private readonly blocks = new Map<string, SerializerOutput>();
  /** the files each block compiled here read besides its source, by key
   *  (fileHashes): a batch's parts each have the whole batch's */
  readonly inputs = new Map<string, Record<string, string>>();

  constructor(o: PipelineOptions) {
    this.buildRoot = resolve(o.buildRoot);
    this.searchDirs = (o.searchDirs ?? []).map(d => resolve(d));
    this.backend = typeof o.backend === 'object' ? o.backend
      : createBackend(selectedBackendId({ flag: o.backend }), { serializer: o.serializer });
    const a = this.backend.availability();
    if (!a.ok) throw new BackendUnavailable(a.reason);
    this.missingCapabilities = o.missingCapabilities ?? 'error';
    this.texErrors = o.texErrors ?? 'warn';
    this.mathml = o.mathml ?? true;
    this.log = o.log ?? consoleLog();
    const local = o.localFontsDir ? resolve(o.localFontsDir) : null;
    this.fonts = new Fonts(resolve(o.fontsDir), local, join(this.buildRoot, 'metafont'));
    this.localFonts = local && existsSync(local) ? readdirSync(local).filter(f => f.endsWith('.otf')).sort().map(f => join(local, f)) : [];
  }

  /** The .proto text a page embeds once (the viewer parses it). */
  schemaText(): string { return protoText(); }

  /** Compile one document or snippet (o.kind): the bytes a page embeds. */
  async compile(content: string, o: CompileOptions): Promise<Uint8Array> {
    const { data, dir, key } = await this.compileData(content, o);
    const bytes = encodeDocument(data, { pipelineOnly: this.backend.pipelineOnly });
    writeFileSync(join(dir, 'nodelist.pb'), bytes);
    this.blocks.set(key, data);
    return bytes;
  }

  /** Compile several snippets as ONE document – a book's chapters published
   *  on separate pages, say – and return one blob per part: numbering,
   *  counters, macros defined along the way and cross-references come out as
   *  in the whole. The parts are snippets, joined with \reflowtexbatchpart
   *  (src/extract/reflowtex-capture.tex) and set in `o.preamble`,
   *  which makes what follows a stream without opening a group; the finished
   *  document is cut into one document per part (transforms.ts, batchParts),
   *  each also written to build/<part key>/ like a block of its own. */
  async compileBatch(parts: { key: string; content: string; name?: string }[], o: Omit<CompileOptions, 'kind'> = {}): Promise<Map<string, Uint8Array>> {
    const joined = parts.map((p, i) => `\\reflowtexbatchpart{${i + 1}}\n${p.content}`).join('\n');
    const key = o.key ?? contentKey(joined, o.preamble ?? '');
    const { data, label } = await this.compileData(joined, { ...o, kind: 'snippet', key, batch: true });
    this.blocks.set(key, data);
    const split = batchParts(data);
    if (split.length !== parts.length) throw new BuildError(`expected ${parts.length} part(s), found ${split.length}`, label);
    const out = new Map<string, Uint8Array>();
    parts.forEach((p, i) => {
      const dir = join(this.buildRoot, p.key);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'output.json'), writeSerializerOutput(split[i]));
      const bytes = encodeDocument(split[i], { pipelineOnly: this.backend.pipelineOnly });
      writeFileSync(join(dir, 'nodelist.pb'), bytes);
      this.blocks.set(p.key, split[i]);
      this.inputs.set(p.key, this.inputs.get(key) ?? {});
      out.set(p.key, bytes);
    });
    return out;
  }

  /** Compile many snippets, `jobs` at a time. Returns what compiled and what
   *  failed (by key) – the caller decides whether a failure stops the build. */
  async compileMany(snippets: ({ content: string } & CompileOptions & { key: string })[],
                    jobs = 1): Promise<{ results: Map<string, Uint8Array>; failures: Map<string, Error> }> {
    const results = new Map<string, Uint8Array>(), failures = new Map<string, Error>();
    const one = async (s: (typeof snippets)[number]) => {
      try { const { content, ...o } = s; results.set(s.key, await this.compile(content, o)); }
      catch (e) { failures.set(s.key, e as Error); }
    };
    const queue = [...snippets];
    // One block first, alone, when the backend says so: on a cold cache (LuaTeX:
    // luaotfload's) every run would rebuild it at once and race.
    if (jobs > 1 && queue.length && this.backend.runtime.firstRunAlone) await one(queue.shift()!);
    await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, queue.length)) }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) await one(s);
    }));
    return { results, failures };
  }

  /** Declare a block compiled by an earlier build as current (an integration
   *  skipping an unchanged snippet): its fonts are served too. */
  useCached(key: string): void {
    const p = join(this.buildRoot, key, 'output.json');
    if (!existsSync(p)) throw new BuildError(`no compiled output for ${key} (${p})`);
    this.blocks.set(key, readSerializerOutput(readFileSync(p, 'utf8')));
  }

  /** Patch, subset and verify the served fonts for every block compiled or
   *  declared current. Call once, after all blocks. */
  async finishFonts({ subset = true } = {}): Promise<void> {
    const needs = fontNeeds(this.blocks.values());
    this.fonts.prune(needs.files.keys());
    this.fonts.patch(needs.files, this.log);
    if (subset) await this.fonts.subset(needs.files, this.log);
    // every code point the blocks reach a font by must be in the file served
    for (const w of this.fonts.verify(needs)) this.log.warn('font-without-face', `  fonts: warning: ${w}`);
  }

  /** original font file → served file, after finishFonts(). The viewer loads
   *  a font by its original name and fetches it from the served one. */
  fontMap(): Record<string, string> { return Object.fromEntries(this.fonts.served); }

  // ── One document ──────────────────────────────────────────────────────────

  private async compileData(content: string, o: CompileOptions & { batch?: boolean }): Promise<{ data: SerializerOutput; dir: string; key: string; label: string }> {
    const preamble = o.preamble ?? '';
    const key = o.key ?? contentKey(content, preamble);
    const label = o.name ? `${o.name} (${key})` : key;
    const { kind } = o;
    if (kind !== 'document' && kind !== 'snippet')
      throw new BuildError(`the option kind is required: 'document' (a complete LaTeX file) or 'snippet' (set in the preamble); got ${JSON.stringify(kind)}`, label);
    const dir = join(this.buildRoot, key);
    mkdirSync(dir, { recursive: true });
    const caps = this.backend.capabilities;
    const passes = o.passes ?? MAX_PASSES;

    // What the document needs of the backend, asked of its descriptor.
    for (const n of unmetNeeds(documentNeeds(content, preamble, { passes: o.passes, batch: o.batch }), caps)) {
      const msg = `backend ${this.backend.id} lacks ${n.capability}, which this document needs: ${n.reason}`;
      if (capabilityInfo(n.capability).whenMissing === 'error' && this.missingCapabilities === 'error')
        throw new MissingCapability(`${msg} (missingCapabilities: 'warn' builds it anyway)`, label);
      this.log.warn('missing-capability', `  ${label}: warning: ${msg}`, { block: label, backend: this.backend.id, capability: n.capability });
    }

    const job = await this.backend.open({
      kind, content, preamble, documentMetadata: o.documentMetadata, jobname: o.jobname, dir, label, searchDirs: this.searchDirs, localFonts: this.localFonts, mathml: this.mathml,
      texErrors: this.texErrors, figureCache: join(this.buildRoot, 'converted-figures-cache'), log: this.log,
    });
    try {
      // The document at its own width, then (sampleDisplays) at wider ones if it
      // has displays to model – unless the backend modelled them itself.
      const first = await job.capture({ widthExtraSp: 0, passes: supports(caps, 'multiPass') ? passes : 1 });
      // The errors TeX carried on past at the document's own width: the
      // author's, as plain lualatex reports them.
      const texErrors = first.diagnostics.filter(d => d.severity === 'error');
      if (texErrors.length && this.texErrors === 'error') {
        throw new TexError(`backend ${this.backend.id} reported ${texErrors.length} error(s) (nonstopmode continued, so the node list would be ` +
          `silently wrong):\n${texErrors.slice(0, 10).map(e => `  ! ${e.message}`).join('\n')}`, label, `! ${texErrors[0].message}`);
      }
      for (const e of texErrors) {
        const w = texErrorWarning(e);
        this.log.warn('tex-error', `  ${label}: warning: ${w.message}`, { block: label, ...w.details });
      }
      // A wider width the author never compiles at: an error TeX reports
      // there and not at the document's own width means TeX failed at that
      // width (sampling then treats it as any compilation that failed).
      const known = new Set(texErrors.map(texErrorKey));
      const atWidth = async (extraSp: number): Promise<CaptureResult> => {
        const r = await job.capture({ widthExtraSp: extraSp, passes: 1 });
        const fresh = r.diagnostics.filter(d => d.severity === 'error' && !known.has(texErrorKey(d)));
        if (fresh.length) {
          throw new TexError(`TeX reported ${fresh.length} error(s) with the text ${g6(extraSp / 65536)} pt wider that it does not at the ` +
            `document's own width:\n${fresh.slice(0, 10).map(e => `  ! ${e.message}`).join('\n')}\n  see ${r.dir}`, label, `! ${fresh[0].message}`);
        }
        return r;
      };
      let final: CaptureResult = first;
      if (supports(caps, 'singlePassDisplays') && first.data.display_model) final = first;
      else if (supports(caps, 'widthResampling')) {
        final = await sampleDisplays(first, {
          at: atWidth,
          probe: async extraSp => (await atWidth(extraSp)).data,
          label, log: this.log,
        });
      } else if (DM.wantsModel(first.data)) {
        this.log.warn('display-widths-unsupported', `  ${label}: warning: backend ${this.backend.id} cannot compile at other widths; displays stay at the document's width`,
          { block: label, backend: this.backend.id });
      }
      this.diagnostics.set(key, final === first ? first.diagnostics : [...texErrors, ...final.diagnostics.filter(d => d.severity !== 'error')]);

      const data = final.data;
      // the page's log gets them too, with the block's other warnings
      if (texErrors.length) data.warnings = [...(data.warnings ?? []), ...texErrors.map(texErrorWarning)];
      // a converted figure's PDF stands for the figure: its bytes are what changes
      const converted = figureSources(final.dir);
      this.inputs.set(key, fileHashes(includedPictureFiles(data).map(f => converted.get(resolve(f)) ?? f).filter(f => existsSync(f))));
      await this.transform(data, final.dir, {
        block: label, docTag: key.replace(/[^0-9A-Za-z]/g, '').slice(0, 8), formulas: final.mathml, pictures: final.pictures,
      });
      writeFileSync(join(dir, 'output.json'), writeSerializerOutput(data));
      return { data, dir, key, label };
    } finally {
      await job.close?.();
    }
  }

  /** The passes between the capture and the encoder, in their order: MathML
   *  strings from what the capture recorded (first: it reads formula numbers
   *  and boxes the later passes may drop), forget unreferenced paragraphs,
   *  pictures to SVG (from the backend's picture source, else `dir`'s PDF),
   *  strip what the wire format does not model, resolve glyphs of virtual
   *  fonts to the fonts their packets draw, give classic fonts their faces
   *  (first: a converted face is a real file, which the glyph addressing and
   *  provisioning that follow then see), the text of a virtual font's
   *  accented letters (its pieces are in Unicode now, and an accent not yet
   *  moved to the private-use area), address glyphs. `formulas` is
   *  LaTeX's MathML as captured (default: read from `dir`). Changes `data`. */
  async transform(data: SerializerOutput, dir: string,
                  o: { block?: string; docTag?: string; formulas?: Map<number, string>; pictures?: PictureSource } = {}): Promise<void> {
    const nMathml = attachMathML(data, { speak: (await speaker()) ?? undefined, formulas: o.formulas ?? readMathmlFile(dir) });
    const nDropped = dropUnreferencedParagraphs(data);
    const nPictures = await convertPictures(data, dir, o.block, o.docTag, o.pictures);
    const nStripped = stripUnsupportedNodes(data);
    const nVirtual = resolveVirtualFonts(data.fonts, visit => forEachNode(data, visit), this.fontFiles);
    const nLegacy = normaliseLegacyFontAddressing(data, this.fonts);
    compositeTexts(visit => forEachNode(data, visit));
    const nRewritten = normaliseGlyphAddressing(data, this.fonts, this.log);
    const bits = [
      nDropped && `dropped ${nDropped} unreferenced paragraph(s)`, nStripped && `stripped ${nStripped} node(s)`,
      nRewritten && `rewrote ${nRewritten} glyph(s) to PUA`, nVirtual && `${nVirtual} glyph(s) of virtual fonts resolved`, nLegacy && `converted legacy fonts, ${nLegacy} glyph(s) to PUA`,
      nPictures && `converted ${nPictures} picture(s)`, nMathml && `MathML for ${nMathml} formula(s)`,
    ].filter(Boolean);
    const block = o.block ?? basename(dir);
    if (bits.length) this.log.info('block-transformed', `  ${block}: ${bits.join(', ')}`, { block });
  }

  /** Declare a document compiled elsewhere (already transformed) as one of
   *  this pipeline's blocks: finishFonts() serves its fonts too. */
  adopt(key: string, data: SerializerOutput): void { this.blocks.set(key, data); }
}

// ── Display geometry ────────────────────────────────────────────────────────
// A display-bearing document is compiled at additive widths W, W + 128 pt, …
// in a sliding window of three samples: a topology change or a non-affine
// field rejects only the smallest width, and sampling moves up. Samples are
// taken in order and each is looked at before the next is needed, but the
// first two wider ones are compiled at once. A text-only document compiles
// once.
//
// TeX may fail at a width the author never used (a package's arithmetic
// overflowing at a wide measure) where the document itself compiles. A
// compilation at another width that TeX fails – a sample, or a probe for the
// width a display changes form at – is taken instead at the widest width that
// compiles between the last width that did and it, found by bisection to
// RETRY_RESOLUTION_SP: at most log2(gap / 4 pt) more compilations per
// failure – 5 for a sample, whose gap is at most a step (128 pt); a probe's is
// at most half the interval it bisects. Widths TeX failed at are kept,
// so a later failure above them bisects only what is left below the lowest.
// Each replacement is logged. When no width above the widest sample
// compiles, that sample's width is the ceiling (logged): the samples still
// needed are taken below it, each halfway between the two the window holds
// (the window slides up as above it), so the model is measured over the
// widths that compile – and the viewer carries its law on past them, as past
// any widest sample. Sampling ends only when the document's own width is the
// one that compiles, or the two below the ceiling are too close (8 pt) to
// measure a law between: the document keeps its own width's data with no
// display model (its displays stay at the document's width), with a warning.

const RETRY_RESOLUTION_SP = 4 * 65536;

export interface Sample { data: SerializerOutput; dir: string }

export interface SamplingOptions<S extends Sample = Sample> {
  /** compile at the document's width + extraSp (a sample) */
  at(extraSp: number): Promise<S>;
  /** compile at the document's width + extraSp to find where a display
   *  changes form (display-model.ts, anchorModel) */
  probe(extraSp: number): Promise<SerializerOutput>;
  label: string;
  log: Log;
}

/** TeX failed at the document's width + extraSp, and at every width tried
 *  between the last that compiled (+ floorSp) and it. */
class NoWiderWidth extends Error {
  extraSp: number;
  floorSp: number;
  error: TexError;
  constructor(extraSp: number, floorSp: number, error: TexError) {
    super(error.message);
    this.extraSp = extraSp;
    this.floorSp = floorSp;
    this.error = error;
  }
}

const texErrorLine = (e: TexError): string => e.texError ?? e.message.split('\n')[0];

/** The document of record with its display model: `first` (the document at
 *  its own width) with rates attached, or a wider sample's when the model
 *  had to be anchored elsewhere; whatever else a sample carries comes with
 *  it. `first` as it is, unmodelled, when TeX fails at every width above
 *  the document's own, or no law holds below the widths it fails at. */
export async function sampleDisplays<S extends Sample>(first: S, o: SamplingOptions<S>): Promise<S> {
  if (!DM.wantsModel(first.data)) return first;
  const { label, log } = o;
  const x0 = Number(first.data.source_width);
  const pt = (extraSp: number) => g6((x0 + extraSp) / 65536);
  // Each compilation as it settles, holding nothing of its output; also what
  // keeps one that fails after sampling has ended from going unhandled.
  const settled: Promise<void>[] = [];
  const run = <T>(p: Promise<T>): Promise<T> => { settled.push(p.then(() => {}, () => {})); return p; };
  const sampler: SamplingOptions<S> = { ...o, at: x => run(o.at(x)), probe: x => run(o.probe(x)) };
  const failed: number[] = [];      // the extra widths TeX failed at
  /** What `pending` (compile(extraSp)) gives, or when TeX fails, the widest
   *  width in (floorSp, extraSp) that compiles, with its extra width. */
  const orBelow = async <T>(what: string, compile: (extraSp: number) => Promise<T>, extraSp: number, pending: Promise<T>,
                            floorSp: number): Promise<[number, T]> => {
    try { return [extraSp, await pending]; } catch (e) {
      if (!(e instanceof TexError)) throw e;
      failed.push(extraSp);
      let lo = floorSp, hi = Math.min(extraSp, ...failed.filter(x => x > floorSp));
      let best: T | undefined;
      while (hi - lo > RETRY_RESOLUTION_SP) {
        const mid = Math.floor((lo + hi) / 2);
        try { best = await compile(mid); lo = mid; } catch (e2) {
          if (!(e2 instanceof TexError)) throw e2;
          failed.push(mid);
          hi = mid;
        }
      }
      if (best === undefined) throw new NoWiderWidth(extraSp, floorSp, e);
      const error = texErrorLine(e);
      log.warn('display-sample-replaced', `  ${label}: warning: TeX failed at ${pt(extraSp)} pt (${error}); the ${what} is taken at ` +
        `${pt(lo)} pt instead, the widest that compiles below it`, { block: label, failed: pt(extraSp), error, used: pt(lo) });
      return [lo, best];
    }
  };
  const at = (extraSp: number, floorSp: number, pending: Promise<S>) => orBelow('sample', sampler.at, extraSp, pending, floorSp);
  const probe = async (extraSp: number, floorSp: number) =>
    (await orBelow('probe', sampler.probe, extraSp, sampler.probe(extraSp), floorSp))[1];
  try {
    return await modelDisplays(first, sampler, at, probe);
  } catch (e) {
    if (!(e instanceof NoWiderWidth)) throw e;
    const error = texErrorLine(e.error);
    log.warn('display-sample-failed', `  ${label}: warning: TeX failed at ${pt(e.extraSp)} pt (${error}) and at every width tried ` +
      `above ${pt(e.floorSp)} pt; no display model, displays stay at the document's width`,
      { block: label, failed: pt(e.extraSp), error, compiled: pt(e.floorSp) });
    return first;
  } finally {
    await Promise.all(settled);    // no compilation outlives the sampling
  }
}

/** sampleDisplays' search. `at(extraSp, floorSp, pending)` is the sample at
 *  extraSp (`pending`: o.at(extraSp)) or the one replacing it above floorSp,
 *  with its extra width; `probe` the same for a probe. */
async function modelDisplays<S extends Sample>(first: S, o: SamplingOptions<S>,
                                               at: (extraSp: number, floorSp: number, pending: Promise<S>) => Promise<[number, S]>,
                                               probe: (extraSp: number, floorSp: number) => Promise<SerializerOutput>): Promise<S> {
  const { label } = o;
  const widthOf = (x: Sample) => Number(x.data.source_width ?? 0);
  const x0 = widthOf(first);
  const pt = (extraSp: number) => g6((x0 + extraSp) / 65536);
  const ahead: [number, Promise<S>][] = [1, 2].map(k => [k * DISPLAY_SAMPLE_STEP_SP, o.at(k * DISPLAY_SAMPLE_STEP_SP)]);
  let next = 3;
  /** The window: up to three samples by increasing width, with their extra widths. */
  const window: [number, S][] = [];
  /** The widest extra width that compiles, once TeX fails at every one above it. */
  let ceiling: number | null = null;
  for (let entry: [number, S] = [0, first]; ;) {
    const [, s] = entry;
    if (s !== first && !DM.wantsModel(s.data)) return s;
    const w = widthOf(s);
    if (w <= 0) throw new BuildError('a display-bearing document did not report a positive source width ' +
      '(is the capture code\'s Serializer.note_source_width hook missing?)', label);
    // in order: wider than the window, or (below a ceiling) inside it
    const at0 = window.findIndex(([, y]) => widthOf(y) >= w);
    if (at0 >= 0 && (ceiling === null || at0 === 0 || widthOf(window[at0][1]) === w))
      throw new BuildError(`display sample width did not increase: ${window.map(([, y]) => widthOf(y)).join(', ')}, ${w}`, label);
    window.splice(at0 < 0 ? window.length : at0, 0, entry);
    if (window.length === 3) {
      const [a, b, c] = window.map(([, y]) => y);
      const [ok, reason] = DM.checkSamples(a.data, b.data, c.data);
      if (ok) {
        const widths = [a, b, c].map(y => g6(widthOf(y) / 65536)).join(', ');
        if (a === first) {
          o.log.info('display-model-stable', `  ${label}: display model stable at ${widths} pt`, { block: label, widths });
          return { ...a, data: DM.attachModel(a.data, b.data, c.data) };
        }
        // The document's own width fell outside the affine law; it is still the
        // width the page must match exactly. Displays set another way there get
        // the wider regime as a second form, from the width TeX switches at –
        // found by compiling in between.
        const [nWide, nProbes] = await DM.anchorModel(first.data, b.data, c.data, (wd, floor) => probe(wd - x0, floor - x0));
        o.log.info('display-model-stable', `  ${label}: display model stable at ${widths} pt, anchored at the document's ${g6(x0 / 65536)} pt` +
          (nWide ? `; ${nWide} display(s) set another way there get a wide form (${nProbes} more compilation(s) to find where)` : ''),
          { block: label, widths, anchor: g6(x0 / 65536), wide: String(nWide) });
        return first;
      }
      const width = g6(widthOf(a) / 65536);
      o.log.info('display-sample-rejected', `  ${label}: rejected display sample at ${width} pt: ${reason}`, { block: label, width, reason: reason ?? '' });
      window.shift();
    }
    if (ceiling === null) {
      // the next sample up
      if (w + DISPLAY_SAMPLE_STEP_SP >= TEX_MAX_DIMEN_SP) throw new BuildError('no stable affine display topology before \\maxdimen', label);
      if (!ahead.length) ahead.push([next * DISPLAY_SAMPLE_STEP_SP, o.at(next++ * DISPLAY_SAMPLE_STEP_SP)]);
      const [extraSp, pending] = ahead.shift()!;
      const floorSp = window[window.length - 1][0];
      try { entry = await at(extraSp, floorSp, pending); continue; } catch (e) {
        // Nothing above the widest sample compiles: unless that is the
        // document's own width, the samples are taken below it from here on.
        if (!(e instanceof NoWiderWidth) || window.length < 2) throw e;
        ceiling = floorSp;
        const error = texErrorLine(e.error);
        o.log.warn('display-sample-ceiling', `  ${label}: warning: TeX fails above ${pt(ceiling)} pt (at ${pt(e.extraSp)} pt: ${error}); ` +
          `display samples are taken below it, and the model is measured from ${pt(0)} to ${pt(ceiling)} pt`,
          { block: label, ceiling: pt(ceiling), failed: pt(e.extraSp), error });
      }
    }
    // Below the ceiling: a sample halfway between the two in the window, until
    // they are too close to measure a law between.
    const [[lo], [hi]] = window;
    if (hi - lo <= 2 * RETRY_RESOLUTION_SP) {
      o.log.warn('display-sample-failed', `  ${label}: warning: no stable display model below ${pt(hi)} pt, where TeX fails above; ` +
        `no display model, displays stay at the document's width`, { block: label, ceiling: pt(hi) });
      return first;
    }
    const mid = lo + Math.floor((hi - lo) / 2);
    entry = await at(mid, lo, o.at(mid));
  }
}
