// SPDX-License-Identifier: AGPL-3.0-or-later
// The font files a site serves. The browser gets the same OTF files LuaTeX
// typeset with, so for every font a block references:
//
//  * provision – copy the file into the output directory, from a site's own
//    fonts directory first, else from the TeX installation (kpsewhich); a
//    converted Type 1 face is converted again when missing (type1.ts);
//  * patch – LuaTeX reaches some glyphs by code points the font's cmap does
//    not map (GSUB variants, unencoded glyphs, and the private-use rewrites of
//    addressing.ts). Those entries are added. A font actually modified is
//    served under a renamed, content-hashed file name (NAME.reflowtex-HASH.otf),
//    so it never passes for the upstream original (which font licences often
//    require of a modified version) and a changed patch busts the cache;
//  * subset – a font this pipeline wrote is then cut down to the characters
//    the blocks draw: it is this site's own file. An unmodified font is served
//    whole, the same file on every site, which a browser caches once;
//  * verify – every code point a block reaches a font by must be in the file
//    served for it, or the page would silently draw blanks. A font with no
//    face at all (no producer could give it one: addressing.ts) is not
//    refused: its glyphs are drawn as boxes of the size TeX gave them, with
//    their text, and the build says so – this is the one place that decides.
//
// Which of these a font goes through is its face's kind (src/shared/font-face.ts),
// recorded on the font by addressing.ts; a file's name says nothing of it.
// All output is byte-reproducible, so an unchanged font keeps its hash.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { forEachNode, type PipelineFace, type SerializerOutput } from '../nodes.ts';
import { FontError } from '../errors.ts';
import { type FileFace } from '../../shared/font-face.ts';
import { unreachable } from '../../shared/unreachable.ts';
import { format12, readSfnt, writeSfnt, parseCmap, buildCmap, parseName, nameString, setNameString, buildName, numGlyphs, codepointsToGlyphs } from './sfnt.ts';
import { subsetFont } from './subset.ts';
import { convertType1, kpsewhich, MODIFIED_TAG } from './type1.ts';
import { convertMetafont } from './metafont.ts';
import { GLYPH_INDEX_PUA } from '../../shared/glyph-text.ts';

const hash8 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 8);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitExt = (f: string): [string, string] => { const m = /^(.*?)(\.[^.]*)?$/.exec(f)!; return [m[1], m[2] ?? '']; };
const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(5, '0')}`;

/** Write via a temporary file and a rename, readable by others: a half-written
 *  font is never visible, and the files are served by another user. */
function writeAtomic(dst: string, bytes: Uint8Array): void {
  const tmp = `${dst}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  chmodSync(tmp, 0o644);
  renameSync(tmp, dst);
}

/** A face made for a classic font, and its glyphs' slot → code point. */
export interface ProducedFace { face: FileFace; addressing: Map<number, number> }

/** What makes a face for a classic font (TeX name), in the order tried: its
 *  Type 1 outlines converted (type1.ts), else METAFONT's bitmaps of it as
 *  outlines (metafont.ts). A font none can give one is drawn as boxes. */
const PRODUCERS: ((name: string, outDir: string, workDir: string) => ProducedFace | { reason: string })[] = [
  (name, outDir) => {
    const r = convertType1(name, outDir);
    return 'reason' in r ? r : { face: { kind: 'type1', file: r.served }, addressing: r.addressing };
  },
  (name, outDir, workDir) => {
    const r = convertMetafont(name, outDir, workDir);
    return 'reason' in r ? r : { face: { kind: 'bitmap', file: r.served }, addressing: r.addressing };
  },
];

/** What the blocks need of one font file (by its original name): its face,
 *  the TeX name it stands for, every code point a block reaches it by with
 *  the glyph index LuaTeX set (null: not known), and whether a \webtext slot
 *  sets text in it (a page may then set any text: it is kept whole). */
export interface FileNeeds { name: string; face: FileFace; reached: Map<number, number | null>; slot: boolean }
/** What the blocks need of the served fonts: the files, and the fonts with
 *  no face (by TeX name: why, and how many glyphs the blocks set in it). */
export interface FontNeeds { files: Map<string, FileNeeds>; boxes: Map<string, { reason: string; glyphs: number }> }

export class Fonts {
  readonly outputDir: string;
  readonly localDir: string | null;
  /** original file name → served file name, after patch() and subset() */
  served = new Map<string, string>();
  private cmaps = new Map<string, Map<number, number> | null>();
  private converted = new Map<string, ProducedFace | { reason: string }>();

  /** where faces are made from other files (METAFONT's bitmaps), not served */
  readonly workDir: string;

  constructor(outputDir: string, localDir: string | null = null, workDir: string | null = null) {
    this.workDir = workDir ?? join(tmpdir(), 'reflowtex-fonts-work');
    this.outputDir = outputDir;
    this.localDir = localDir;
  }

  /** Make sure the file of every font named is in the output directory. */
  provision(fonts: Iterable<{ name: string; face: PipelineFace }>, log: (s: string) => void = console.log): void {
    mkdirSync(this.outputDir, { recursive: true });
    const byFile = new Map<string, { name: string; face: FileFace }>();
    for (const f of fonts) {
      switch (f.face.kind) {
        case 'opentype': case 'type1': case 'bitmap': byFile.set(f.face.file, { name: f.name, face: f.face }); break;
        case 'virtual': case 'boxes': break;
        case 'tfm': throw new FontError(`font ${f.name} has no face yet: the classic fonts were not given theirs (normaliseLegacyFontAddressing)`);
        default: unreachable(f.face, 'font face');
      }
    }
    for (const file of [...byFile.keys()].sort()) {
      const { name, face } = byFile.get(file)!;
      const dst = join(this.outputDir, file);
      if (existsSync(dst)) continue;
      if (this.localDir && existsSync(join(this.localDir, file))) {
        writeAtomic(dst, readFileSync(join(this.localDir, file)));
        log(`  font-provision: ${file} ← ${join(this.localDir, file)}`);
        continue;
      }
      switch (face.kind) {
        case 'type1': case 'bitmap': {
          // A converted face named by blocks restored from a cache: convert it
          // again. The conversion is reproducible, so the same TeX installation
          // gives the same name; a different name means it changed under the
          // cached blocks.
          const got = this.legacyOtf(name);
          if ('face' in got && got.face.file === file) { log(`  font-provision: ${file} ← converted again from ${name}`); continue; }
          throw new FontError(`font ${file} is referenced by compiled blocks, but converting ${name} now gives ` +
            `${'face' in got ? got.face.file : `nothing (${got.reason})`}; the TeX installation changed – rebuild with --force`);
        }
        case 'opentype': {
          const src = kpsewhich(file);
          if (!src) { log(`  font-provision: WARNING – ${file} not found via kpsewhich; the browser will fall back to a system font`); continue; }
          writeAtomic(dst, readFileSync(src));
          log(`  font-provision: ${file} ← ${src}`);
          continue;
        }
        default: unreachable(face, 'font face');
      }
    }
  }

  /** A classic face (by TeX name) as a served OTF, with its slot → code
   *  point addressing, from the first producer that can make one (PRODUCERS);
   *  or why none can, each producer's reason. */
  legacyOtf(name: string): ProducedFace | { reason: string } {
    if (!this.converted.has(name)) {
      const reasons: string[] = [];
      let made: ProducedFace | null = null;
      for (const produce of PRODUCERS) {
        const r = produce(name, this.outputDir, this.workDir);
        if ('reason' in r) reasons.push(r.reason);
        else { made = r; break; }
      }
      this.converted.set(name, made ?? { reason: reasons.join('; ') });
    }
    return this.converted.get(name)!;
  }

  /** code point → glyph id of a provisioned font, or null if it is missing. */
  cmapLookup(filename: string): Map<number, number> | null {
    if (!this.cmaps.has(filename)) {
      const path = join(this.outputDir, filename);
      this.cmaps.set(filename, filename && existsSync(path) ? codepointsToGlyphs(readSfnt(readFileSync(path))) : null);
    }
    return this.cmaps.get(filename)!;
  }

  /** Remove every renamed font file (an earlier build's patch, subset or
   *  conversion) that `used` does not name: what a whole build calls once,
   *  before patch(), so fonts the site no longer uses go. Converted faces the
   *  blocks name are in `used`, hashed, and stay. */
  prune(used: Iterable<string>): void {
    if (!existsSync(this.outputDir)) return;
    const keep = new Set(used);
    for (const f of readdirSync(this.outputDir)) if (f.includes(`.${MODIFIED_TAG}-`) && !keep.has(f)) rmSync(join(this.outputDir, f));
  }

  /** Add the missing cmap entries; fills `served` for the fonts given. BMP
   *  code points go into the first format-4 subtable, others into the (3,10)
   *  format-12 one. The earlier renamed versions of the fonts patched go (each
   *  is made again from its original); files of other fonts are left as they
   *  are, so a caller may patch a few fonts at a time (the browser engine
   *  does, as blocks bring new code points).
   *
   *  `whole`: a font that needs any entry gets every glyph's private-use one
   *  (GLYPH_INDEX_PUA + glyph index, the only code points addressing.ts adds), so
   *  its patched file is the same whatever the blocks drew: one original
   *  gives one patched file, one name, for every document and every round,
   *  and it is never patched again for a later block. A font that needs
   *  nothing stays the original. */
  patch(files: Map<string, FileNeeds>, log: (s: string) => void = console.log, { whole = false }: { whole?: boolean } = {}): void {
    this.served = new Map();
    if (!files.size) return;
    this.provision(files.values(), log);
    const required = new Set(files.keys());
    const present = readdirSync(this.outputDir);
    for (const filename of required) {
      const [stem, ext] = splitExt(filename);
      const earlier = new RegExp(`^${escapeRe(stem)}(\\.${MODIFIED_TAG}-[0-9a-f]{8})+${escapeRe(ext)}$`);
      for (const f of present) if (earlier.test(f) && !required.has(f)) rmSync(join(this.outputDir, f), { force: true });
    }
    for (const [filename, needs] of files) {
      const path = join(this.outputDir, filename);
      if (!existsSync(path)) { this.served.set(filename, filename); continue; }
      const font = readSfnt(readFileSync(path));
      const subs = parseCmap(font.tables.get('cmap')!);
      const existing = new Set<number>();
      for (const s of subs) for (const c of s.map.keys()) existing.add(c);
      let missing = [...needs.reached].filter(([c, g]) => g !== null && !existing.has(c)).sort((a, b) => a[0] - b[0]);
      if (!missing.length) { this.served.set(filename, filename); log(`  font-patch: ${filename} already complete`); continue; }
      if (whole) {
        const all = new Map<number, number | null>(missing);
        for (let g = 0, n = numGlyphs(font); g < n; g++) if (!existing.has(GLYPH_INDEX_PUA + g)) all.set(GLYPH_INDEX_PUA + g, g);
        missing = [...all].sort((a, b) => a[0] - b[0]);
      }
      // A non-BMP entry (a private-use rewrite: GLYPH_INDEX_PUA + glyph index) needs
      // a (3,10) format-12 subtable; a font without one (Latin Modern's and
      // STIX Two's text faces) gets one, holding its Unicode map too, since a
      // browser that finds it reads it instead of the format-4 one. Every
      // entry goes into it; a BMP one into the format-4 subtable as well.
      const f4 = subs.find(s => s.format === 4);
      const f12 = missing.some(([c]) => c >= 0x10000) ? format12(subs)
        : subs.find(s => s.format === 12 && s.platformID === 3 && s.encodingID === 10);
      const glyphs = numGlyphs(font);
      let added = 0;
      for (const [c, g] of missing) {
        if (g === null) continue;
        if (g >= glyphs) { log(`  font-patch: ${filename} glyph index ${g} out of range – skipping ${hex(c)}`); continue; }
        const tables = c >= 0x10000 ? [f12] : [f4, f12];
        for (const table of tables) if (table) { table.shared.map.set(c, g); table.shared.dirty = true; }
        if (tables.some(Boolean)) added++;
      }
      if (!added) { this.served.set(filename, filename); log(`  font-patch: ${filename} already complete`); continue; }
      font.tables.set('cmap', buildCmap(subs));
      // the file's own names say it is modified too (the @font-face family the
      // browser uses is set separately: this is for honesty, not rendering)
      const names = parseName(font.tables.get('name')!);
      for (const r of names) {
        const s = nameString(r);
        if (s === null) continue;
        if (r.nameID === 1 || r.nameID === 4 || r.nameID === 16) setNameString(r, `${s} (ReflowTeX patched)`);
        else if (r.nameID === 6) setNameString(r, `${s}-ReflowTeXPatched`);
      }
      font.tables.set('name', buildName(names));
      const bytes = writeSfnt(font);
      const [stem, ext] = splitExt(filename);
      const served = `${stem}.${MODIFIED_TAG}-${hash8(bytes)}${ext}`;
      writeAtomic(join(this.outputDir, served), bytes);
      rmSync(path);                                          // not served under the original's name
      this.served.set(filename, served);
      log(`  font-patch: ${filename} → ${served} (${added} entr${added === 1 ? 'y' : 'ies'} added, renamed)`);
    }
  }

  /** Cut every font this pipeline wrote – a converted face, a patched one –
   *  down to the code points the blocks draw; but for those a \webtext slot
   *  sets text in, where a page may set any text. */
  async subset(files: Map<string, FileNeeds>, log: (s: string) => void = console.log): Promise<void> {
    const tagged = new RegExp(`(\\.${MODIFIED_TAG}-[0-9a-f]{8})+$`);
    for (const filename of [...files.keys()].sort()) {
      const needs = files.get(filename)!;
      const served = this.served.get(filename) ?? filename;
      let written: boolean;
      switch (needs.face.kind) {
        case 'type1': case 'bitmap': written = true; break;
        case 'opentype': written = served !== filename; break;       // patched
        default: written = unreachable(needs.face, 'font face');
      }
      if (!written || !needs.reached.size) continue;
      if (needs.slot) { log(`  font-subset: ${served} kept whole (a \\webtext slot sets text in it)`); continue; }
      const src = join(this.outputDir, served);
      if (!existsSync(src)) continue;
      const before = readFileSync(src);
      const bytes = await subsetFont(before, new Set(needs.reached.keys()));
      if (!bytes) throw new FontError(`HarfBuzz could not subset ${served}`);
      const [stem, ext] = splitExt(served);
      const name = `${stem.replace(tagged, '')}.${MODIFIED_TAG}-${hash8(bytes)}${ext}`;
      writeAtomic(join(this.outputDir, name), bytes);
      // A patched font is made afresh from its original every build, so its
      // full file goes; a converted one stays: it is what the blocks name.
      if (served !== filename && name !== served) rmSync(src);
      this.served.set(filename, name);
      log(`  font-subset: ${served} → ${name} (${numGlyphs(readSfnt(bytes))} of ${numGlyphs(readSfnt(before))} glyphs, ` +
          `${Math.floor(bytes.length / 1024)} KB of ${Math.floor(before.length / 1024)} KB)`);
    }
  }

  /** Fail if any code point a block reaches a font by is missing from the
   *  file served for it. Returns the warnings: a font drawn as boxes, by its
   *  TeX name and why. */
  verify(needs: FontNeeds): string[] {
    const problems: string[] = [];
    for (const [filename, n] of needs.files) {
      const want = [...n.reached.keys()];
      if (!want.length) continue;
      const served = this.served.get(filename) ?? filename;
      const path = join(this.outputDir, served);
      if (!existsSync(path)) { problems.push(`${filename}: not provisioned (nothing to serve)`); continue; }
      const have = codepointsToGlyphs(readSfnt(readFileSync(path)));
      const missing = want.filter(c => !have.has(c)).sort((a, b) => a - b);
      if (missing.length) {
        const sample = missing.slice(0, 5).map(hex).join(', ');
        problems.push(`${filename} (served as ${served}): ${missing.length} referenced codepoint(s) missing from its cmap: ${sample}` +
          (missing.length > 5 ? ` … (+${missing.length - 5})` : ''));
      }
    }
    if (problems.length) throw new FontError(`served fonts cannot draw every glyph the blocks reference – the page would render blanks:\n  ${problems.join('\n  ')}`);
    return [...needs.boxes].filter(([, b]) => b.glyphs).map(([name, b]) =>
      `font ${name} has no face (${b.reason}): its ${b.glyphs} glyph${b.glyphs === 1 ? '' : 's'} are drawn as boxes of the size TeX gave them, as text all the same`);
  }
}

// ── What the blocks need ────────────────────────────────────────────────────

/** Every glyph LuaTeX set, by the font file it is drawn from and the code
 *  point it is reached by – what every served font must address – and the
 *  fonts that have no file to draw from. */
export function fontNeeds(docs: Iterable<SerializerOutput>): FontNeeds {
  const files = new Map<string, FileNeeds>(), boxes: FontNeeds['boxes'] = new Map();
  for (const d of docs) {
    const byId = new Map<string, FileNeeds>(), boxed = new Map<string, { reason: string; glyphs: number }>();
    for (const [id, f] of d.fonts) {
      switch (f.face.kind) {
        case 'opentype': case 'type1': case 'bitmap': {
          const file = f.face.file;
          if (!files.has(file)) files.set(file, { name: f.name, face: f.face, reached: new Map(), slot: false });
          byId.set(id, files.get(file)!);
          break;
        }
        case 'boxes': case 'virtual':
          // (a virtual font's glyphs are all drawn from the fonts it names
          // (vf.ts): one that is not would be boxes)
          if (!boxes.has(f.name)) boxes.set(f.name, { reason: f.face.kind === 'boxes' ? f.face.reason : 'a virtual font whose glyph was not resolved', glyphs: 0 });
          boxed.set(id, boxes.get(f.name)!);
          break;
        case 'tfm': throw new FontError(`font ${f.name} has no face: the classic fonts were not given theirs (normaliseLegacyFontAddressing)`);
        default: unreachable(f.face, 'font face');
      }
    }
    forEachNode(d, n => {
      if (n.type !== 'glyph' || n.font === undefined || n.font === null) return;
      const box = boxed.get(String(n.font));
      if (box) box.glyphs++;
      const needs = byId.get(String(n.font));
      if (!needs) return;
      const cp = n.char ?? 0, gi = n.gindex as number | null | undefined;
      if (gi !== undefined && gi !== null) needs.reached.set(cp, gi);
      else if (!needs.reached.has(cp)) needs.reached.set(cp, null);
      if (n.slot) needs.slot = true;
    });
  }
  return { files, boxes };
}
