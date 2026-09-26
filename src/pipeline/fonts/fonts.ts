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
//    served for it, or the page would silently draw blanks.
//
// All output is byte-reproducible, so an unchanged font keeps its hash.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { forEachNode, type SerializerOutput } from '../nodes.ts';
import { FontError } from '../errors.ts';
import { readSfnt, writeSfnt, parseCmap, buildCmap, parseName, nameString, setNameString, buildName, numGlyphs, codepointsToGlyphs } from './sfnt.ts';
import { subsetFont } from './subset.ts';
import { convertType1, kpsewhich, MODIFIED_TAG } from './type1.ts';

const hash8 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 8);
const splitExt = (f: string): [string, string] => { const m = /^(.*?)(\.[^.]*)?$/.exec(f)!; return [m[1], m[2] ?? '']; };

/** Write via a temporary file and a rename, readable by others: a half-written
 *  font is never visible, and the files are served by another user. */
function writeAtomic(dst: string, bytes: Uint8Array): void {
  const tmp = `${dst}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  chmodSync(tmp, 0o644);
  renameSync(tmp, dst);
}

export type Requirements = Map<string, Map<number, number | null>>;

export class Fonts {
  readonly outputDir: string;
  readonly localDir: string | null;
  /** original file name → served file name, after patch() and subset() */
  served = new Map<string, string>();
  private cmaps = new Map<string, Map<number, number> | null>();
  private converted = new Map<string, { served: string; addressing: Map<number, number> } | null>();

  constructor(outputDir: string, localDir: string | null = null) {
    this.outputDir = outputDir;
    this.localDir = localDir;
  }

  /** Make sure every named font file is in the output directory. */
  provision(filenames: Iterable<string>, log: (s: string) => void = console.log): void {
    mkdirSync(this.outputDir, { recursive: true });
    for (const name of [...filenames].sort()) {
      if (!name || name === 'unknown') continue;
      const dst = join(this.outputDir, name);
      if (existsSync(dst)) continue;
      if (this.localDir && existsSync(join(this.localDir, name))) {
        writeAtomic(dst, readFileSync(join(this.localDir, name)));
        log(`  font-provision: ${name} ← ${join(this.localDir, name)}`);
        continue;
      }
      // A converted face named by blocks restored from a cache: convert it
      // again. The conversion is reproducible, so the same TeX installation
      // gives the same name; a different name means it changed under the
      // cached blocks.
      const m = new RegExp(`^(.+)\\.${MODIFIED_TAG}-[0-9a-f]{8}\\.otf$`).exec(name);
      if (m) {
        const got = this.legacyOtf(m[1]);
        if (got?.served === name) { log(`  font-provision: ${name} ← converted again from ${m[1]}.pfb`); continue; }
        throw new FontError(`font ${name} is referenced by compiled blocks, but converting ${m[1]} now gives ` +
          `${got?.served ?? 'nothing'}; the TeX installation changed – rebuild with --force`);
      }
      const src = kpsewhich(name);
      if (!src) { log(`  font-provision: WARNING – ${name} not found via kpsewhich; the browser will fall back to a system font`); continue; }
      writeAtomic(dst, readFileSync(src));
      log(`  font-provision: ${name} ← ${src}`);
    }
  }

  /** A classic Type 1 face (by TeX name) converted to a served OTF, with its
   *  slot → code point addressing; null when it has no convertible outline. */
  legacyOtf(name: string): { served: string; addressing: Map<number, number> } | null {
    if (!this.converted.has(name)) this.converted.set(name, convertType1(name, this.outputDir));
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

  /** Add the missing cmap entries; fills `served`. BMP code points go into
   *  the first format-4 subtable, others into the (3,10) format-12 one. */
  patch(requirements: Requirements, log: (s: string) => void = console.log): void {
    this.served = new Map();
    if (!requirements.size) return;
    this.provision(requirements.keys(), log);
    // Renamed fonts of earlier builds go (the current set is made again below),
    // except this build's converted faces: they are written while blocks
    // compile and named, hashed, in the requirements.
    const keep = new Set([...requirements.keys()].filter(n => n.includes(`.${MODIFIED_TAG}-`)));
    for (const f of readdirSync(this.outputDir)) if (f.includes(`.${MODIFIED_TAG}-`) && !keep.has(f)) rmSync(join(this.outputDir, f));
    for (const [filename, want] of requirements) {
      const path = join(this.outputDir, filename);
      if (!existsSync(path)) { this.served.set(filename, filename); continue; }
      const font = readSfnt(readFileSync(path));
      const subs = parseCmap(font.tables.get('cmap')!);
      const existing = new Set<number>();
      for (const s of subs) for (const c of s.map.keys()) existing.add(c);
      const missing = [...want].filter(([c]) => !existing.has(c)).sort((a, b) => a[0] - b[0]);
      if (!missing.length) { this.served.set(filename, filename); log(`  font-patch: ${filename} already complete`); continue; }
      const f12 = subs.find(s => s.format === 12 && s.platformID === 3 && s.encodingID === 10);
      const nonBmp = missing.filter(([c]) => c >= 0x10000).length;
      if (nonBmp && !f12) {
        this.served.set(filename, filename);
        log(`  font-patch: ${filename} has no format-12 cmap – cannot add ${nonBmp} non-BMP entries, skipping`);
        continue;
      }
      const f4 = subs.find(s => s.format === 4);
      const glyphs = numGlyphs(font);
      let added = 0;
      for (const [c, g] of missing) {
        const table = c >= 0x10000 ? f12 : f4;
        if (!table || g === null) continue;
        if (g >= glyphs) { log(`  font-patch: ${filename} glyph index ${g} out of range – skipping U+${c.toString(16).toUpperCase().padStart(5, '0')}`); continue; }
        table.shared.map.set(c, g);
        table.shared.dirty = true;
        added++;
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

  /** Cut every font this pipeline wrote (renamed) down to the code points the
   *  blocks draw; `whole` names fonts to leave whole all the same – those a
   *  \webtext slot sets text in, where a page may set any text. */
  async subset(drawn: Map<string, Set<number>>, whole: Set<string> = new Set(), log: (s: string) => void = console.log): Promise<void> {
    const tagged = new RegExp(`(\\.${MODIFIED_TAG}-[0-9a-f]{8})+$`);
    for (const filename of [...drawn.keys()].sort()) {
      const cps = drawn.get(filename)!;
      const served = this.served.get(filename) ?? filename;
      if (!served.includes(`.${MODIFIED_TAG}-`) || !cps.size) continue;
      if (whole.has(filename)) { log(`  font-subset: ${served} kept whole (a \\webtext slot sets text in it)`); continue; }
      const src = join(this.outputDir, served);
      if (!existsSync(src)) continue;
      const before = readFileSync(src);
      const bytes = await subsetFont(before, cps);
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
   *  file served for it. */
  verify(requirements: Map<string, Iterable<number>>): void {
    const problems: string[] = [];
    for (const [filename, cps] of requirements) {
      const want = [...cps];
      if (!want.length) continue;
      const served = this.served.get(filename) ?? filename;
      const path = join(this.outputDir, served);
      if (!existsSync(path)) { problems.push(`${filename}: not provisioned (nothing to serve)`); continue; }
      const have = codepointsToGlyphs(readSfnt(readFileSync(path)));
      const missing = want.filter(c => !have.has(c)).sort((a, b) => a - b);
      if (missing.length) {
        const sample = missing.slice(0, 5).map(c => `U+${c.toString(16).toUpperCase().padStart(5, '0')}`).join(', ');
        problems.push(`${filename} (served as ${served}): ${missing.length} referenced codepoint(s) missing from its cmap: ${sample}` +
          (missing.length > 5 ? ` … (+${missing.length - 5})` : ''));
      }
    }
    if (problems.length) throw new FontError(`served fonts cannot draw every glyph the blocks reference – the page would render blanks:\n  ${problems.join('\n  ')}`);
  }
}

// ── What the blocks need ────────────────────────────────────────────────────

/** file name → {code point → glyph index}: every glyph LuaTeX set, by the
 *  code point it is reached by – what every served font must address. */
export function glyphRequirements(docs: Iterable<SerializerOutput>): Requirements {
  const reqs: Requirements = new Map();
  for (const d of docs) {
    const files = new Map([...d.fonts].map(([id, f]) => [id, f.filename]));
    for (const f of files.values()) if (!reqs.has(f)) reqs.set(f, new Map());
    forEachNode(d, n => {
      if (n.type !== 'glyph') return;
      const f = files.get(String(n.font ?? ''));
      if (f && n.char !== undefined && n.gindex !== undefined && n.gindex !== null) reqs.get(f)!.set(n.char, n.gindex as number);
    });
  }
  return reqs;
}

/** The code points the viewer draws from each font, and the fonts a \webtext
 *  slot sets text in. */
export function drawnCodepoints(docs: Iterable<SerializerOutput>): { drawn: Map<string, Set<number>>; slotFonts: Set<string> } {
  const drawn = new Map<string, Set<number>>(), slotFonts = new Set<string>();
  for (const d of docs) {
    const files = new Map([...d.fonts].map(([id, f]) => [Number(id), f.filename]));
    forEachNode(d, n => {
      if (n.type !== 'glyph' || n.font === undefined || n.font === null) return;
      const f = files.get(Number(n.font));
      if (!f) return;
      if (!drawn.has(f)) drawn.set(f, new Set());
      drawn.get(f)!.add(n.char ?? 0);
      if (n.slot) slotFonts.add(f);
    });
  }
  return { drawn, slotFonts };
}
