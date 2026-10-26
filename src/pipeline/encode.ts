// SPDX-License-Identifier: AGPL-3.0-or-later
// The serializer's output, after the transforms, as a protobuf Document
// (src/schema/latex.proto). Descriptor-driven: a key is encoded when the
// schema has a field of that name, so the .proto stays the single source of
// truth for what the wire format carries; proto2 presence is kept by setting
// only the keys the data has. A key the schema has no field for is an error,
// unless it is one the pipeline keeps for itself (PIPELINE_ONLY): data the
// wire format cannot carry is never dropped without a word.
import protobuf from 'protobufjs';
import { messageType } from './schema.ts';
import { walkNodes, contentItems, type SerializerOutput, type TexNode } from './nodes.ts';
import { faceToWire } from '../shared/font-face.ts';
import { SchemaMismatch } from './errors.ts';
import { missingCharWarnings } from './warnings.ts';

export { SchemaMismatch };

/** Omitted when 0: the renderer treats absent and 0 alike for these. */
const OMIT_IF_ZERO = new Set(['stretch_order', 'shrink_order', 'subtype', 'shift', 'glue_sign', 'glue_order']);
/** Carried by the pipeline, not by the wire format, by message: what the
 *  capture and the passes record for their own use. A node's glyph index
 *  (font provisioning), a picture's source (file, page, generated: the
 *  conversion to SVG), a glyph's source position (src: an editor's, from a
 *  backend that records it); a paragraph's place in the capture (index) and
 *  its band (a display inside it takes it). */
const PIPELINE_ONLY: Record<string, ReadonlySet<string>> = {
  Node: new Set(['gindex', 'file', 'page', 'generated', 'src']),
  Paragraph: new Set(['index', 'band_indent', 'band_width']),
};
const NONE: ReadonlySet<string> = new Set();

// ── Glyph metrics ───────────────────────────────────────────────────────────
// A glyph's width/height/depth are interned into Document.glyph_metrics (the
// same box repeats across thousands of glyphs) and the glyph refers to its
// entry by a 1-based index. Indices are assigned in walk order – paragraphs,
// then the main flow's items (each followed by its wide form), then each
// stream's – which is part of what makes an encoding reproducible.
function internGlyphMetrics(data: SerializerOutput) {
  const table: { width: number; height: number; depth: number }[] = [];
  const seen = new Map<string, number>();
  const index = new Map<TexNode, number>();
  const visit = (n: TexNode) => {
    if (n.type !== 'glyph') return;
    const w = (n.width as number) || 0, h = (n.height as number) || 0, d = (n.depth as number) || 0;
    const key = `${w},${h},${d}`;
    let i = seen.get(key);
    if (i === undefined) { table.push({ width: w, height: h, depth: d }); i = table.length; seen.set(key, i); }
    index.set(n, i);
  };
  for (const p of data.paragraphs) walkNodes(p.nodes, visit);
  for (const item of contentItems(data)) if (item.box) walkNodes([item.box], visit);
  return { table, index };
}

// A small set of commands that stand for text, for outline titles.
const TEXT_COMMANDS: Record<string, string> = {
  ldots: '…', dots: '…', TeX: 'TeX', LaTeX: 'LaTeX', AmS: 'AMS',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  infty: '∞', times: '×', le: '≤', ge: '≥', to: '→', S: '§',
};

/** Plain text from a title as TeX source (detokenized): known symbol commands
 *  become their character, other commands are dropped (their braced argument
 *  kept), and braces, $ and ties go. Good enough for a table of contents; the
 *  typeset heading is what the reader sees in the text. */
export function texToText(s: string): string {
  s = s.replaceAll('---', '—').replaceAll('--', '–').replaceAll('~', ' ');
  s = s.replaceAll('``', '“').replaceAll("''", '”').replaceAll('`', '‘').replaceAll("'", '’');
  s = s.replace(/\\([A-Za-z]+)\s*/g, (_, c: string) => TEXT_COMMANDS[c] ?? '');
  s = s.replace(/\\(.)/gs, '$1');
  s = s.replaceAll('{', '').replaceAll('}', '').replaceAll('$', '');
  return s.replace(/\s+/g, ' ').trim();
}

// Keep the keys the message type has, minus the rules above; recurse into
// message fields. A key it has no field for is refused, but for the
// pipeline's own. Enum names are checked here: fromObject would ignore an
// unknown one, and a node type the schema lacks means the transforms did not
// run (or the schema is behind the serializer).
function prune(type: protobuf.Type, d: Record<string, unknown>, metrics: Map<TexNode, number>, path: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const glyph = type.name === 'Node' && d.type === 'glyph';
  const own = PIPELINE_ONLY[type.name] ?? NONE;
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || own.has(k)) continue;
    if (glyph && (k === 'width' || k === 'height' || k === 'depth')) continue;
    const f = type.fields[k];
    if (!f) throw new SchemaMismatch(`${path}.${k}: latex.proto's ${type.name} has no field ${k}, so the page would not get it`);
    if (OMIT_IF_ZERO.has(k) && v === 0) continue;
    f.resolve();
    const rt = f.resolvedType;
    if (rt instanceof protobuf.Type) {
      out[k] = f.repeated ? (v as Record<string, unknown>[]).map((x, i) => prune(rt, x, metrics, `${path}.${k}[${i}]`))
                          : prune(rt, v as Record<string, unknown>, metrics, `${path}.${k}`);
    } else if (rt instanceof protobuf.Enum) {
      if (typeof v === 'string' && !(v in rt.values))
        throw new SchemaMismatch(`${path}.${k}: "${v}" is not a ${rt.name} in latex.proto`);
      out[k] = v;
    } else out[k] = v;
  }
  if (glyph && metrics.has(d as TexNode)) out.metrics = metrics.get(d as TexNode);
  return out;
}

/** The Document message's fields from the transformed data. */
export function documentObject(data: SerializerOutput): Record<string, unknown> {
  const { table, index } = internGlyphMetrics(data);
  const doc: Record<string, unknown> = {
    fonts: [...data.fonts].map(([id, f]) => {
      const { face, ...rest } = f;
      if (face.kind === 'tfm') throw new SchemaMismatch(`font ${f.name} has no face: the classic fonts were not given theirs (the transforms did not run)`);
      return { ...rest, id: Number(id), ...faceToWire(face) };
    }),
    paragraphs: data.paragraphs,
    content: data.content,
    pictures: data.pictures ?? [],
    streams: data.streams,
    outline: ((data.outline as Record<string, unknown>[]) ?? []).map(e => ({
      ...e, title: texToText(String(e.title ?? '')), number: texToText(String(e.number ?? '')),
    })),
    source_width: data.source_width,
    display_model: data.display_model,
    links: data.links ?? [],
    anchors: data.anchors ?? [],
    slots: data.slots ?? [],
    marks: data.marks ?? [],
    // the build's warnings, and one per character TeX could not set
    warnings: [...(data.warnings ?? []), ...missingCharWarnings(data.missing_chars ?? [])],
    glyph_metrics: table,
  };
  return prune(messageType('Document'), doc, index, 'document');
}

/** Encode: output.json (transformed) → the bytes a page embeds. */
export function encodeDocument(data: SerializerOutput): Uint8Array {
  const Document = messageType('Document');
  return Document.encode(Document.fromObject(documentObject(data))).finish();
}
