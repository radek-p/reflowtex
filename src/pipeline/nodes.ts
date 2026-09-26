// SPDX-License-Identifier: AGPL-3.0-or-later
// The serializer's output (output.json) as the pipeline holds it, and the one
// walk over it. Every pass that visits nodes – encoding, glyph addressing,
// pictures, fonts, batch splitting – goes through here, so a node's child
// lists are named in exactly one place (see the notes on `leader` and
// `display_wide` below, each of which a pass once forgot).

/** A node of TeX's finished node list, as serializer.lua writes it. */
export interface TexNode {
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

/** A node's child lists, in the order every walk takes them. */
export const CHILD_LISTS = ['children', 'pre', 'post', 'replace', 'nobreak'] as const;

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

/** Every node of `nodes` and below, depth first: a node, then its child lists
 *  in CHILD_LISTS order, then its leader. */
export function walkNodes(nodes: TexNode[] | undefined, visit: (n: TexNode) => void): void {
  for (const n of nodes ?? []) {
    if (!n || typeof n !== 'object') continue;
    visit(n);
    for (const key of CHILD_LISTS) if (n[key]) walkNodes(n[key], visit);
    if (n.leader) walkNodes([n.leader], visit);
  }
}

/** `nodes` without the nodes `keep` rejects, at every depth; a leader that is
 *  rejected is removed from its glue. Lists are rebuilt in place. */
export function filterNodes(nodes: TexNode[], keep: (n: TexNode) => boolean): TexNode[] {
  const out: TexNode[] = [];
  for (const n of nodes) {
    if (!keep(n)) continue;
    for (const key of CHILD_LISTS) if (n[key]) n[key] = filterNodes(n[key], keep);
    if (n.leader) {
      const [leader] = filterNodes([n.leader], keep);
      if (leader) n.leader = leader; else delete n.leader;
    }
    out.push(n);
  }
  return out;
}

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
