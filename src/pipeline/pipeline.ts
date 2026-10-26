// SPDX-License-Identifier: AGPL-3.0-or-later
// The build pipeline: LaTeX in, the bytes a page embeds out, and the fonts
// the page serves. Framework-agnostic – integrations (Hugo, a plain page, …)
// drive it and it knows nothing of them.
//
//     const pipe = new Pipeline({ buildRoot: 'build', fontsDir: 'site/fonts' });
//     const bytes = await pipe.compile('$e^{i\\pi}+1=0$');
//     await pipe.finishFonts();          // after every block
//     pipe.fontMap();                    // original font file → served file
//
// A capture backend (backend/: LuaTeX by default) turns LaTeX into node
// lists; everything after is shared. One snippet → one build/<key>/
// directory holding the backend's run (LuaTeX's: input.tex and its log),
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
import { Fonts, fontNeeds } from './fonts/fonts.ts';
import { normaliseGlyphAddressing, normaliseLegacyFontAddressing } from './fonts/addressing.ts';
import { kpsewhich } from './fonts/type1.ts';
import { FontFiles, compositeTexts, resolveVirtualFonts } from './fonts/vf.ts';
import { protoText } from './schema.ts';
import { BackendUnavailable, BuildError, MissingCapability } from './errors.ts';
import { documentNeeds, supports, unmetNeeds, capabilityInfo } from './backend/capabilities.ts';
import { createBackend, selectedBackendId } from './backend/registry.ts';
import type { CaptureBackend, CaptureResult, Diagnostic, PictureSource } from './backend/types.ts';
import { DEFAULT_TEMPLATE, WIDTH_EXTRA_MARK } from './backend/luatex.ts';
import { splitDocument } from './document.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));             // src/
// The LuaTeX template's names and the document's parts, where they were
// before backends: tools and integrations import them from here.
export { DEFAULT_TEMPLATE, DEFAULT_SERIALIZER, MATHML_LUA, PREAMBLE_MARK, CONTENT_MARK, WIDTH_EXTRA_MARK, METADATA_MARK, TEMPLATE_CLASS_RE } from './backend/luatex.ts';
export { takeMetadata, splitDocument } from './document.ts';

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
 *  itself: the template, the serializer, the LaTeX packages, the schema and
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
   *  input.tex, so fontspec finds them by bare file name) */
  localFontsDir?: string | null;
  /** where TeX also looks for what a document reads (figures, \input files)
   *  before its own tree: a document is compiled away from its directory */
  searchDirs?: string[];
  /** the capture backend: an id (backend/registry.ts: 'luatex', …) or a
   *  backend object; default: REFLOWTEX_BACKEND, else 'luatex' */
  backend?: string | CaptureBackend;
  /** the LaTeX template (the LuaTeX backend's, when it is chosen by id) */
  template?: string;
  /** the capture code the template loads (the LuaTeX backend's) */
  serializer?: string;
  /** record MathML for every formula (default on; needs TeX Live's luamml) */
  mathml?: boolean;
  /** a document needing a capability the backend lacks: 'error' (default)
   *  stops the build where the result would be wrong or incomplete; 'warn'
   *  builds it, saying what is missing */
  missingCapabilities?: 'error' | 'warn';
  log?: (line: string) => void;
}

export interface CompileOptions {
  key?: string;
  /** at most this many TeX passes (cross-references need two or three) */
  passes?: number;
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
  private readonly template: string;
  private readonly missingCapabilities: 'error' | 'warn';
  /** the warnings of each block's last compilation, by key */
  readonly diagnostics = new Map<string, Diagnostic[]>();
  private readonly mathml: boolean;
  private readonly localFonts: string[];
  private readonly log: (line: string) => void;
  /** every block compiled or declared current (useCached), by key: what the
   *  served fonts must cover */
  private readonly blocks = new Map<string, SerializerOutput>();
  /** the files each block compiled here read besides its source, by key
   *  (fileHashes): a batch's parts each have the whole batch's */
  readonly inputs = new Map<string, Record<string, string>>();

  constructor(o: PipelineOptions) {
    this.buildRoot = resolve(o.buildRoot);
    this.searchDirs = (o.searchDirs ?? []).map(d => resolve(d));
    this.template = o.template ?? DEFAULT_TEMPLATE;
    this.backend = typeof o.backend === 'object' ? o.backend
      : createBackend(selectedBackendId({ flag: o.backend }), { template: o.template, serializer: o.serializer });
    const a = this.backend.availability();
    if (!a.ok) throw new BackendUnavailable(a.reason);
    this.missingCapabilities = o.missingCapabilities ?? 'error';
    this.mathml = o.mathml ?? true;
    this.log = o.log ?? (s => console.log(s));
    const local = o.localFontsDir ? resolve(o.localFontsDir) : null;
    this.fonts = new Fonts(resolve(o.fontsDir), local, join(this.buildRoot, 'metafont'));
    this.localFonts = local && existsSync(local) ? readdirSync(local).filter(f => f.endsWith('.otf')).sort().map(f => join(local, f)) : [];
  }

  /** The .proto text a page embeds once (the viewer parses it). */
  schemaText(): string { return protoText(); }

  /** Compile one snippet: the bytes a page embeds. */
  async compile(content: string, preamble = '', o: CompileOptions = {}): Promise<Uint8Array> {
    const { data, dir, key } = await this.compileData(content, preamble, o);
    const bytes = encodeDocument(data);
    writeFileSync(join(dir, 'nodelist.pb'), bytes);
    this.blocks.set(key, data);
    return bytes;
  }

  /** Compile several snippets as ONE document – a book's chapters published
   *  on separate pages, say – and return one blob per part: numbering,
   *  counters, macros defined along the way and cross-references come out as
   *  in the whole. The parts are joined with \reflowtexbatchpart (template.tex),
   *  which makes what follows a stream without opening a group; the finished
   *  document is cut into one document per part (transforms.ts, batchParts),
   *  each also written to build/<part key>/ like a block of its own. */
  async compileBatch(parts: { key: string; content: string; name?: string }[], preamble = '', o: CompileOptions = {}): Promise<Map<string, Uint8Array>> {
    const joined = parts.map((p, i) => `\\reflowtexbatchpart{${i + 1}}\n${p.content}`).join('\n');
    for (const p of parts) {
      if (splitDocument(p.content))
        throw new BuildError(`part ${p.key} is a complete document; a batch is made of parts, and a named preamble holds the setup`, o.name ?? o.key);
    }
    const key = o.key ?? contentKey(joined, preamble);
    const { data, label } = await this.compileData(joined, preamble, { ...o, key, batch: true });
    this.blocks.set(key, data);
    const split = batchParts(data);
    if (split.length !== parts.length) throw new BuildError(`expected ${parts.length} part(s), found ${split.length}`, label);
    const out = new Map<string, Uint8Array>();
    parts.forEach((p, i) => {
      const dir = join(this.buildRoot, p.key);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'output.json'), writeSerializerOutput(split[i]));
      const bytes = encodeDocument(split[i]);
      writeFileSync(join(dir, 'nodelist.pb'), bytes);
      this.blocks.set(p.key, split[i]);
      this.inputs.set(p.key, this.inputs.get(key) ?? {});
      out.set(p.key, bytes);
    });
    return out;
  }

  /** Compile many snippets, `jobs` at a time. Returns what compiled and what
   *  failed (by key) – the caller decides whether a failure stops the build. */
  async compileMany(snippets: { key: string; content: string; preamble?: string; name?: string; passes?: number }[],
                    jobs = 1): Promise<{ results: Map<string, Uint8Array>; failures: Map<string, Error> }> {
    const results = new Map<string, Uint8Array>(), failures = new Map<string, Error>();
    const one = async (s: (typeof snippets)[number]) => {
      try { results.set(s.key, await this.compile(s.content, s.preamble ?? '', { key: s.key, name: s.name, passes: s.passes })); }
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
    for (const w of this.fonts.verify(needs)) this.log(`  fonts: warning: ${w}`);
  }

  /** original font file → served file, after finishFonts(). The viewer loads
   *  a font by its original name and fetches it from the served one. */
  fontMap(): Record<string, string> { return Object.fromEntries(this.fonts.served); }

  // ── One document ──────────────────────────────────────────────────────────

  private async compileData(content: string, preamble: string, o: CompileOptions & { batch?: boolean }): Promise<{ data: SerializerOutput; dir: string; key: string; label: string }> {
    const key = o.key ?? contentKey(content, preamble);
    const label = o.name ? `${o.name} (${key})` : key;
    const dir = join(this.buildRoot, key);
    mkdirSync(dir, { recursive: true });
    const caps = this.backend.capabilities;
    const passes = o.passes ?? 1;

    // What the document needs of the backend, asked of its descriptor.
    for (const n of unmetNeeds(documentNeeds(content, preamble, { passes, batch: o.batch }), caps)) {
      const msg = `backend ${this.backend.id} lacks ${n.capability}, which this document needs: ${n.reason}`;
      if (capabilityInfo(n.capability).whenMissing === 'error' && this.missingCapabilities === 'error')
        throw new MissingCapability(`${msg} (missingCapabilities: 'warn' builds it anyway)`, label);
      this.log(`  ${label}: warning: ${msg}`);
    }

    const job = await this.backend.open({
      content, preamble, dir, label, searchDirs: this.searchDirs, localFonts: this.localFonts, mathml: this.mathml,
    });
    try {
      // The document at its own width, then (sampleDisplays) at wider ones if it
      // has displays to model – unless the backend modelled them itself.
      const first = await job.capture({ widthExtraSp: 0, passes: supports(caps, 'multiPass') ? passes : 1 });
      let final: CaptureResult = first;
      if (supports(caps, 'singlePassDisplays') && first.data.display_model) final = first;
      else if (supports(caps, 'widthResampling')) {
        final = await sampleDisplays(first, {
          at: extraSp => job.capture({ widthExtraSp: extraSp, passes: 1 }),
          probe: async extraSp => (await job.capture({ widthExtraSp: extraSp, passes: 1 })).data,
          label, log: this.log, template: this.template,
        });
      } else if (DM.wantsModel(first.data)) {
        this.log(`  ${label}: warning: backend ${this.backend.id} cannot compile at other widths; displays stay at the document's width`);
      }
      this.diagnostics.set(key, final.diagnostics);

      const data = final.data;
      this.inputs.set(key, fileHashes(includedPictureFiles(data, final.dir).filter(f => existsSync(f))));
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
    if (bits.length) this.log(`  ${o.block ?? basename(dir)}: ${bits.join(', ')}`);
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

export interface Sample { data: SerializerOutput; dir: string }

export interface SamplingOptions<S extends Sample = Sample> {
  /** compile at the document's width + extraSp (a sample) */
  at(extraSp: number): Promise<S>;
  /** compile at the document's width + extraSp to find where a display
   *  changes regime (display-model.ts, wideVariants) */
  probe(extraSp: number): Promise<SerializerOutput | null>;
  label: string;
  log: (line: string) => void;
  /** named in the message when a template reports no width */
  template?: string;
}

/** The document of record with its display model: `first` (the document at
 *  its own width) with rates attached, or a wider sample's when the model
 *  had to be anchored elsewhere; whatever else a sample carries comes with it. */
export async function sampleDisplays<S extends Sample>(first: S, o: SamplingOptions<S>): Promise<S> {
  if (!DM.wantsModel(first.data)) return first;
  const { label } = o;
  const ahead: Promise<S>[] = [o.at(DISPLAY_SAMPLE_STEP_SP), o.at(2 * DISPLAY_SAMPLE_STEP_SP)];
  let next = 3;
  let samples: S[] = [];
  for (let s: S = first; ; s = await ahead.shift()!) {
    if (s !== first && !DM.wantsModel(s.data)) return s;
    const w = Number(s.data.source_width ?? 0);
    if (w <= 0) throw new BuildError(`display-bearing template ${o.template ?? ''} did not report a positive source width ` +
      `(is ${WIDTH_EXTRA_MARK} and the Serializer.note_source_width hook missing?)`, label);
    if (samples.length && w <= Number(samples[samples.length - 1].data.source_width))
      throw new BuildError(`display sample width did not increase: ${samples[samples.length - 1].data.source_width}, ${w}`, label);
    samples.push(s);
    if (samples.length >= 3) {
      const [a, b, c] = samples.slice(-3);
      const [ok, reason] = DM.checkSamples(a.data, b.data, c.data);
      if (ok) {
        const widths = [a, b, c].map(x => DM.pyG(Number(x.data.source_width) / 65536)).join(', ');
        if (a === first) {
          o.log(`  ${label}: display model stable at ${widths} pt`);
          return { ...a, data: DM.attachModel(a.data, b.data, c.data) };
        }
        // The document's own width fell outside the affine law; it is still the
        // width the page must match exactly. Displays set another way there get
        // the wider regime as a second form, from the width TeX switches at –
        // found by compiling in between.
        const [data] = DM.anchorModel(first.data, b.data, c.data);
        const x0 = Number(first.data.source_width);
        const [nWide, nProbes] = await DM.wideVariants(data, b.data, c.data, async wd => o.probe(wd - x0));
        o.log(`  ${label}: display model stable at ${widths} pt, anchored at the document's ${DM.pyG(x0 / 65536)} pt` +
          (nWide ? `; ${nWide} display(s) set another way there get a wide form (${nProbes} more compilation(s) to find where)` : ''));
        return { ...first, data };
      }
      o.log(`  ${label}: rejected display sample at ${DM.pyG(Number(a.data.source_width) / 65536)} pt: ${reason}`);
      samples = samples.slice(-2);
    }
    if (w + DISPLAY_SAMPLE_STEP_SP >= TEX_MAX_DIMEN_SP) throw new BuildError('no stable affine display topology before \\maxdimen', label);
    if (!ahead.length) ahead.push(o.at(next++ * DISPLAY_SAMPLE_STEP_SP));
  }
}
