// SPDX-License-Identifier: AGPL-3.0-or-later
// The serializer's output (output.json) as the pipeline holds it, and the
// document-level walks over it. Walking a node tree is src/shared/tree.ts's
// job (the one walk the whole project uses); this module adds what is
// particular to a document: which lists hold nodes – paragraphs, and the
// boxes of content items, a display's wide form included – and the reading
// and writing of output.json.
import { walk, filterTree, type TreeNode } from '../shared/tree.ts';

/** A node of TeX's finished node list, as serializer.lua writes it. */
export interface TexNode extends TreeNode {
  type: string;
  children?: TexNode[];
  pre?: TexNode[];
  post?: TexNode[];
  replace?: TexNode[];
  nobreak?: TexNode[];
  /** Leader glue carries one box, which TeX tiles across the glue's set width
   *  (extensible arrows are built this way). It is a node like any other – it
   *  holds glyphs to address and fonts to provision – but it hangs off the glue
   *  rather than sitting in a child list. */
  leader?: TexNode;
  char?: number;
  font?: number | string;
  [field: string]: unknown;
}

export interface ContentItem {
  kind: string;
  para?: number;
  box?: TexNode;
  stream?: number;
  anchor?: number;
  /** A display TeX set another way at the document's width carries the wider
   *  regime as a second item; it is drawn too, so every walk visits it. */
  display_wide?: ContentItem;
  [field: string]: unknown;
}

export interface Paragraph { nodes: TexNode[]; [field: string]: unknown }

export interface Stream {
  kind: string;
  content: ContentItem[];
  attrs?: { key: string; value: string }[];
  text?: string;
  [field: string]: unknown;
}

export interface FontInfo {
  name: string;
  size_sp: number;
  filename: string;
  [field: string]: unknown;
}

/** output.json. `fonts` is keyed by LuaTeX font id; the order of the map is
 *  the order of Document.fonts on the wire, so it is kept as written. */
export interface SerializerOutput {
  fonts: Map<string, FontInfo>;
  paragraphs: Paragraph[];
  content: ContentItem[];
  streams: Stream[];
  [field: string]: unknown;
}

// ── Reading and writing output.json ─────────────────────────────────────────
// JSON.parse puts integer-like keys first, in numeric order, whatever order the
// text has; the font map's order matters, so its keys are read as strings. And
// serializer.lua's JSON writer cannot tell an empty map from an empty array: a
// block with no glyphs writes "fonts": [].

export function readSerializerOutput(text: string): SerializerOutput {
  const data = JSON.parse(text.replace(/"(\d+)":/g, '"#$1":'), (key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const entries = Object.entries(value).map(([k, v]) => [k.startsWith('#') ? k.slice(1) : k, v] as const);
    return key === 'fonts' ? new Map(entries) : Object.fromEntries(entries);
  });
  if (!(data.fonts instanceof Map)) data.fonts = new Map();
  data.paragraphs ??= [];
  data.content ??= [];
  data.streams ??= [];
  return data as SerializerOutput;
}

/** The inverse, for the build directory's output.json artefact. A Map is
 *  written entry by entry: through an object its integer keys would be
 *  reordered again. */
export function writeSerializerOutput(data: SerializerOutput): string {
  const write = (v: unknown): string => {
    if (v instanceof Map) return `{${[...v].map(([k, x]) => `${JSON.stringify(String(k))}:${write(x)}`).join(',')}}`;
    if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : write(x))).join(',')}]`;
    if (v && typeof v === 'object')
      return `{${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}:${write(x)}`).join(',')}}`;
    return JSON.stringify(v);
  };
  return write(data);
}

// ── Walking ─────────────────────────────────────────────────────────────────

/** Every node of `nodes` and below (tree.ts's walk, for a document's nodes). */
export const walkNodes = (nodes: TexNode[] | undefined, visit: (n: TexNode) => void | boolean): void => walk(nodes, visit);

/** `nodes` without what `keep` rejects, at every depth (tree.ts's filterTree). */
export const filterNodes = (nodes: TexNode[], keep: (n: TexNode) => boolean): TexNode[] => filterTree(nodes, keep);

/** Every content item: the main flow's, then each stream's (streams nest by
 *  reference, so one pass over the table reaches every item once), each
 *  followed by its display's wide form when it has one. */
export function* contentItems(data: SerializerOutput): Generator<ContentItem> {
  function* withWide(items: ContentItem[]) {
    for (const item of items) {
      yield item;
      if (item.display_wide) yield item.display_wide;
    }
  }
  yield* withWide(data.content);
  for (const s of data.streams) yield* withWide(s.content ?? []);
}

/** The nodes an item draws: a paragraph's (by reference), a display's box. */
export function itemNodes(data: SerializerOutput, item: ContentItem): TexNode[] {
  if (item.kind === 'paragraph' && item.para !== undefined && item.para >= 1 && item.para <= data.paragraphs.length)
    return data.paragraphs[item.para - 1].nodes ?? [];
  return item.box ? [item.box] : [];
}

/** Every node of the document, once: the paragraphs' nodes, then the boxes of
 *  the content items (displays, wide forms included). */
export function forEachNode(data: SerializerOutput, visit: (n: TexNode) => void): void {
  for (const p of data.paragraphs) walkNodes(p.nodes, visit);
  for (const item of contentItems(data)) if (item.box) walkNodes([item.box], visit);
}
