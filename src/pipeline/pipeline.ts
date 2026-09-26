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
// One snippet → one build/<key>/ directory holding input.tex, the LuaTeX run,
// output.json and nodelist.pb, so the artefacts are there to inspect when
// something looks wrong (and an integration can skip an unchanged snippet).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, join, relative, resolve } from 'node:path';
import { readSerializerOutput, writeSerializerOutput, type SerializerOutput } from './nodes.ts';
import { encodeDocument } from './encode.ts';
import { runLuaLatex } from './lualatex.ts';
import * as DM from './display-model.ts';
import { dropUnreferencedParagraphs, stripUnsupportedNodes, batchParts } from './transforms.ts';
import { attachMathML } from './mathml.ts';
import { convertPictures } from './pictures.ts';
import { Fonts, glyphRequirements, drawnCodepoints } from './fonts/fonts.ts';
import { normaliseGlyphAddressing, normaliseLegacyFontAddressing } from './fonts/addressing.ts';
import { protoText } from './schema.ts';
import { BuildError } from './errors.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));             // src/
export const DEFAULT_TEMPLATE = join(SRC, 'extract/template.tex');
export const DEFAULT_SERIALIZER = join(SRC, 'extract/serializer.lua');
/** MathML capture (src/extract/mathml.lua): the serializer loads it when it
 *  lies next to it. */
export const MATHML_LUA = join(SRC, 'extract/mathml.lua');
const LATEX_DIR = join(SRC, 'latex');                                  // the companion package

export const PREAMBLE_MARK = '%%PREAMBLE%%';
export const CONTENT_MARK = '%%CONTENT%%';
export const WIDTH_EXTRA_MARK = '%%WIDTH-EXTRA-SP%%';
/** Display samples are taken at an additive step, not 2× or 3×: the fits stay
 *  well-conditioned without nearing TeX's \maxdimen. */
export const DISPLAY_SAMPLE_STEP_SP = 128 * 65536;
export const TEX_MAX_DIMEN_SP = 1073741823;

// ── Documents and keys ──────────────────────────────────────────────────────

const DOCCLASS_RE = /^[ \t]*\\documentclass\b[^\n]*$/m;
const BEGIN_DOC_RE = /^[ \t]*\\begin\{document\}[^\n]*\n?/m;
const END_DOC_RE = /^[ \t]*\\end\{document\}/m;
export const TEMPLATE_CLASS_RE = /^\\documentclass\b[^\n]*$/m;

/** [class line, preamble, body] of a complete LaTeX document, or null for a
 *  snippet. Anything before the class line (comments, \RequirePackage) is
 *  dropped, anything after \end{document} ignored, as LaTeX ignores it. */
export function splitDocument(tex: string): [string, string, string] | null {
  const c = DOCCLASS_RE.exec(tex), b = BEGIN_DOC_RE.exec(tex), e = END_DOC_RE.exec(tex);
  if (!(c && b && e && c.index < b.index && b.index < e.index)) return null;
  return [c[0].trim(), tex.slice(c.index + c[0].length, b.index), tex.slice(b.index + b[0].length, e.index)];
}

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
 *  unchanged snippets records this beside the content key and compares both. */
export function toolchainHash(src = SRC): string {
  const h = createHash('sha256');
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
  template?: string;
  serializer?: string;
  /** record MathML for every formula (default on; needs TeX Live's luamml) */
  mathml?: boolean;
  log?: (line: string) => void;
}

export interface CompileOptions {
  key?: string;
  /** at most this many LuaTeX passes (cross-references need two or three) */
  passes?: number;
  /** how the caller knows the snippet (a file, a page and line): messages only */
  name?: string;
}

export class Pipeline {
  readonly buildRoot: string;
  readonly fonts: Fonts;
  private readonly searchDirs: string[];
  private readonly template: string;
  private readonly serializer: string;
  private readonly mathml: boolean;
  private readonly localFonts: string[];
  private readonly log: (line: string) => void;
  /** every block compiled or declared current (useCached), by key: what the
   *  served fonts must cover */
  private readonly blocks = new Map<string, SerializerOutput>();

  constructor(o: PipelineOptions) {
    this.buildRoot = resolve(o.buildRoot);
    this.searchDirs = (o.searchDirs ?? []).map(d => resolve(d));
    this.template = o.template ?? DEFAULT_TEMPLATE;
    this.serializer = o.serializer ?? DEFAULT_SERIALIZER;
    this.mathml = o.mathml ?? true;
    this.log = o.log ?? (s => console.log(s));
    const local = o.localFontsDir ? resolve(o.localFontsDir) : null;
    this.fonts = new Fonts(resolve(o.fontsDir), local);
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
    const { data, label } = await this.compileData(joined, preamble, { ...o, key });
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
    // One block first, alone: on a cold luaotfload cache every run would
    // rebuild the cache at once and race.
    if (jobs > 1 && queue.length) await one(queue.shift()!);
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
    const docs = [...this.blocks.values()];
    const reqs = glyphRequirements(docs);
    const { drawn, slotFonts } = drawnCodepoints(docs);
    this.fonts.patch(reqs, this.log);
    if (subset) await this.fonts.subset(drawn, slotFonts, this.log);
    // every code point the blocks reach a font by must be in the file served
    for (const [file, cps] of drawn) {
      const r = reqs.get(file) ?? new Map<number, number | null>();
      for (const c of cps) if (!r.has(c)) r.set(c, null);
      reqs.set(file, r);
    }
    this.fonts.verify(new Map([...reqs].map(([f, m]) => [f, m.keys()])));
  }

  /** original font file → served file, after finishFonts(). The viewer loads
   *  a font by its original name and fetches it from the served one. */
  fontMap(): Record<string, string> { return Object.fromEntries(this.fonts.served); }

  // ── One document ──────────────────────────────────────────────────────────

  private async compileData(content: string, preamble: string, o: CompileOptions): Promise<{ data: SerializerOutput; dir: string; key: string; label: string }> {
    const key = o.key ?? contentKey(content, preamble);
    const label = o.name ? `${o.name} (${key})` : key;
    const dir = join(this.buildRoot, key);
    mkdirSync(join(dir, 'pics'), { recursive: true });      // PGF externalisation's conventional prefix

    let template = readFileSync(this.template, 'utf8');
    // A complete document: its class replaces the template's, its preamble
    // becomes the preamble (the caller's, if any, follows), its body the content.
    const doc = splitDocument(content);
    if (doc) {
      const [classLine, docPreamble, body] = doc;
      let replaced = false;
      template = template.replace(TEMPLATE_CLASS_RE, () => { replaced = true; return classLine; });
      preamble = (replaced ? '' : `${classLine}\n`) + docPreamble + (preamble ? `\n${preamble}` : '');
      content = body;
    } else {
      // A preamble may bring its own class (a book's chapters: \documentclass{book}).
      const m = DOCCLASS_RE.exec(preamble);
      if (m) {
        let replaced = false;
        template = template.replace(TEMPLATE_CLASS_RE, () => { replaced = true; return m[0].trim(); });
        if (replaced) preamble = preamble.slice(0, m.index) + preamble.slice(m.index + m[0].length);
      }
    }
    const input = (widthExtraSp: number) => template
      .replaceAll(PREAMBLE_MARK, () => preamble).replaceAll(CONTENT_MARK, () => content)
      .replaceAll(WIDTH_EXTRA_MARK, () => String(widthExtraSp));

    // Always refreshed: a stale serializer would silently lack newer features.
    copyFileSync(this.serializer, join(dir, 'serializer.lua'));
    if (this.mathml) copyFileSync(MATHML_LUA, join(dir, 'mathml.lua'));
    else rmSync(join(dir, 'mathml.lua'), { force: true });
    for (const otf of this.localFonts) {
      const dst = join(dir, basename(otf));
      if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(otf).mtimeMs) copyFileSync(otf, dst);
    }
    const texinputs = [LATEX_DIR, ...this.searchDirs];

    const run = async (sampleDir: string, widthExtraSp: number, passes: number): Promise<SerializerOutput> => {
      writeFileSync(join(sampleDir, 'input.tex'), input(widthExtraSp));
      return readSerializerOutput(await runLuaLatex(sampleDir, { texinputs, passes, block: label }));
    };
    // A wider sample (or a probe) runs in a directory of its own – a copy of
    // the document's, so it reads back the same .aux/.toc/.bbl – and several
    // run at once. Each keeps its own PDF, which its pictures come from.
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

    // The document at its own width, then (sampleDisplays) at wider ones if it
    // has displays to model.
    const first: Sample = { data: await run(dir, 0, o.passes ?? 1), dir };
    const final = await sampleDisplays(first, {
      at: async extraSp => { const d = sampleDir(); return { data: await run(d, extraSp, 1), dir: d }; },
      probe: async extraSp => run(sampleDir(), extraSp, 1),
      label, log: this.log, template: this.template,
    });

    const data = final.data;
    await this.transform(data, final.dir, { block: label, docTag: key.replace(/[^0-9A-Za-z]/g, '').slice(0, 8) });
    writeFileSync(join(dir, 'output.json'), writeSerializerOutput(data));
    return { data, dir, key, label };
  }

  /** The passes between the serializer and the encoder, in their order: MathML
   *  strings from what the capture recorded (first: it reads formula numbers
   *  and boxes the later passes may drop), forget unreferenced paragraphs, pictures to SVG (from `dir`'s PDF), strip what the
   *  wire format does not model, convert classic fonts (first: it gives
   *  'unknown' fonts real files, which the glyph addressing and provisioning
   *  that follow then see), address glyphs. Changes `data`. */
  async transform(data: SerializerOutput, dir: string, o: { block?: string; docTag?: string } = {}): Promise<void> {
    const nMathml = attachMathML(data);
    const nDropped = dropUnreferencedParagraphs(data);
    const nPictures = await convertPictures(data, dir, o.block, o.docTag);
    const nStripped = stripUnsupportedNodes(data);
    const nLegacy = normaliseLegacyFontAddressing(data, this.fonts);
    const nRewritten = normaliseGlyphAddressing(data, this.fonts, this.log);
    const bits = [
      nDropped && `dropped ${nDropped} unreferenced paragraph(s)`, nStripped && `stripped ${nStripped} node(s)`,
      nRewritten && `rewrote ${nRewritten} glyph(s) to PUA`, nLegacy && `converted legacy fonts, ${nLegacy} glyph(s) to PUA`,
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

export interface SamplingOptions {
  /** compile at the document's width + extraSp (a sample) */
  at(extraSp: number): Promise<Sample>;
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
 *  had to be anchored elsewhere. */
export async function sampleDisplays(first: Sample, o: SamplingOptions): Promise<Sample> {
  if (!DM.wantsModel(first.data)) return first;
  const { label } = o;
  const ahead: Promise<Sample>[] = [o.at(DISPLAY_SAMPLE_STEP_SP), o.at(2 * DISPLAY_SAMPLE_STEP_SP)];
  let next = 3;
  let samples: Sample[] = [];
  for (let s: Sample = first; ; s = await ahead.shift()!) {
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
          return { data: DM.attachModel(a.data, b.data, c.data), dir: a.dir };
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
        return { data, dir: first.dir };
      }
      o.log(`  ${label}: rejected display sample at ${DM.pyG(Number(a.data.source_width) / 65536)} pt: ${reason}`);
      samples = samples.slice(-2);
    }
    if (w + DISPLAY_SAMPLE_STEP_SP >= TEX_MAX_DIMEN_SP) throw new BuildError('no stable affine display topology before \\maxdimen', label);
    if (!ahead.length) ahead.push(o.at(next++ * DISPLAY_SAMPLE_STEP_SP));
  }
}
