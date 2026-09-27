// SPDX-License-Identifier: AGPL-3.0-or-later
// MathML for every formula a reader meets – LaTeX's, as LaTeX writes it.
//
// With tagging on and luamml loaded (the template's \DocumentMetadata and
// \tagpdfsetup{math/mathml/luamml/load=true}), LaTeX converts each formula
// with luamml – amsmath alignments, cases and matrices as tables, with their
// intents (:system-of-equations, :pause-medium, :equation-label) – and writes
// every top-level formula to <jobname>-luamml-mathml.html: a <div> each,
// headed \mml N, its source, its hash, then its <math>. src/extract/mathml.lua
// notes each formula's N: on an inline formula's begin-math node (`mathml`),
// and against each display's number (output.json `mathml`: {n, display}).
//
// This pass puts each formula's <math> where its number is, unchanged:
//
//   * an inline formula: on its begin-math node (one inside another – a
//     formula in \text – is part of the outer one and has no entry);
//   * a display: on its item; an amsmath alignment's rows are display items
//     sharing a number, and the first carries the table for all of them.
//
// What LaTeX gives is what the reader gets: nothing is converted, completed
// or cleaned up here. Given a speaker (MathML → words; the pipeline's is
// Speech Rule Engine's ClearSpeak, see speaker()), each <math> also carries
// its spoken form as alttext: VoiceOver's "read all" skips a formula without
// one, and a reader who chose spoken formulas hears the words.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentItems, forEachNode, walkNodes, type ContentItem, type SerializerOutput, type TexNode } from './nodes.ts';

/** LaTeX's MathML file in a build directory (the job is `input`). */
export const mathmlFile = (dir: string) => join(dir, 'input-luamml-mathml.html');

/** The file's formulas: \mml N → its <math>, as written. */
export function parseMathmlFile(html: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const div of html.split(/<div>/).slice(1)) {
    const n = /<h2>\\mml\s+(\d+)<\/h2>/.exec(div);
    const start = div.indexOf('<math');
    const end = div.lastIndexOf('</math>');
    if (!n || start < 0 || end < start) continue;
    out.set(Number(n[1]), div.slice(start, end + '</math>'.length));
  }
  return out;
}

/** The formulas LaTeX wrote in build directory `dir`, if it wrote any. */
export function readMathmlFile(dir: string): Map<number, string> {
  const f = mathmlFile(dir);
  return existsSync(f) ? parseMathmlFile(readFileSync(f, 'utf8')) : new Map();
}

export interface AttachOptions {
  speak?: (mathml: string) => string;
  /** LaTeX's formulas (readMathmlFile); none: no MathML */
  formulas?: Map<number, string>;
}

/** The pipeline's speaker: Speech Rule Engine (ClearSpeak, English), set up
 *  once. Null when it cannot be loaded (no alttext then). */
let speakerPromise: Promise<((mathml: string) => string) | null> | null = null;
export function speaker(): Promise<((mathml: string) => string) | null> {
  speakerPromise ??= (async () => {
    try {
      const mod = await import('speech-rule-engine');
      const sre = ((mod as { default?: unknown }).default ?? mod) as {
        setupEngine(o: object): Promise<void>; engineReady(): Promise<void>; toSpeech(x: string): string };
      await sre.setupEngine({ domain: 'clearspeak', modality: 'speech', locale: 'en' });
      await sre.engineReady();
      return (xml: string) => { try { return sre.toSpeech(xml); } catch { return ''; } };
    } catch { return null; }
  })();
  return speakerPromise;
}

const isBegin = (n: TexNode) => n.type === 'math' && n.subtype === 0;
const isEnd = (n: TexNode) => n.type === 'math' && n.subtype === 1;
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Index just past the end-math node closing the formula begun at nodes[i]. */
function formulaEnd(nodes: TexNode[], i: number): number {
  let depth = 0;
  for (let j = i; j < nodes.length; j++) {
    if (isBegin(nodes[j])) depth++;
    else if (isEnd(nodes[j]) && --depth === 0) return j + 1;
  }
  return nodes.length;
}

/** Each formula's MathML where its number is; the numbers removed. Returns
 *  how many formulas have MathML. */
export function attachMathML(data: SerializerOutput, { speak, formulas = new Map() }: AttachOptions = {}): number {
  const withWords = (xml: string): string => {
    const words = speak ? speak(xml).trim() : '';
    return words ? xml.replace(/^<math\b/, `<math alttext="${escapeAttr(words)}"`) : xml;
  };
  let count = 0;

  // Inline formulas: every begin-math node not inside another formula.
  const inline = (nodes: TexNode[]) => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (isBegin(n)) {
        const end = formulaEnd(nodes, i);
        const xml = typeof n.mathml === 'number' ? formulas.get(n.mathml) : undefined;
        walkNodes(nodes.slice(i + 1, end), m => { delete m.mathml; });
        if (xml !== undefined) { n.mathml = withWords(xml); count++; } else delete n.mathml;
        i = end - 1;
      } else if (n.children) inline(n.children);
    }
  };
  for (const p of data.paragraphs) inline(p.nodes ?? []);

  // Displays, list by list (the main flow's, each stream's): an alignment's
  // rows share a display number, and the first carries its table.
  const byDisplay = new Map<number, number>();
  for (const f of (data.mathml as { n: number; display: number }[] | undefined) ?? []) byDisplay.set(f.display, f.n);
  const displays = (items: ContentItem[]) => {
    const done = new Set<number>();
    for (const it of items) {
      if (it.kind !== 'display' || it.display_no === undefined) continue;
      const no = it.display_no as number;
      if (done.has(no)) continue;
      done.add(no);
      const n = byDisplay.get(no);
      const xml = n === undefined ? undefined : formulas.get(n);
      if (xml !== undefined) { it.mathml = withWords(xml); count++; }
    }
  };
  displays(data.content);
  for (const s of data.streams) displays(s.content ?? []);

  // The capture's bookkeeping: gone.
  for (const it of contentItems(data)) { delete it.display_no; if (it.display_wide) delete it.display_wide.display_no; }
  forEachNode(data, n => { if (!isBegin(n) || typeof n.mathml !== 'string') delete n.mathml; });
  delete data.mathml;
  return count;
}
