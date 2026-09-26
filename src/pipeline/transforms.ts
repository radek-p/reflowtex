// SPDX-License-Identifier: AGPL-3.0-or-later
// The document-level passes between the serializer and the encoder that need
// no fonts: forgetting paragraphs nothing refers to, dropping node types the
// wire format does not model, and cutting a batch into its parts. (Pictures
// are pictures.ts's; glyph addressing is the fonts' business.)
import { walk } from '../shared/tree.ts';
import { contentItems, itemNodes, filterNodes, type ContentItem, type SerializerOutput, type TexNode } from './nodes.ts';

// ── Unreferenced paragraphs ─────────────────────────────────────────────────
// Every paragraph LuaTeX breaks is captured, including ones that never reach
// the flow: amsmath's empty paragraph after an alignment, and the test
// paragraphs a package sets in a box while probing a font (microtype breaks
// one or two per font it configures). Items refer to paragraphs by index, so
// the survivors are renumbered.

export function dropUnreferencedParagraphs(data: SerializerOutput): number {
  const paragraphs = data.paragraphs;
  const used = new Set<number>();
  for (const item of contentItems(data)) if (item.para !== undefined) used.add(Math.trunc(item.para));
  if (used.size === paragraphs.length) return 0;
  const keep = [...used].filter(i => i >= 1 && i <= paragraphs.length).sort((a, b) => a - b);
  const renumber = new Map(keep.map((old, k) => [old, k + 1]));
  data.paragraphs = keep.map(i => paragraphs[i - 1]);
  for (const item of contentItems(data)) if (item.para !== undefined) item.para = renumber.get(Math.trunc(item.para));
  return paragraphs.length - keep.length;
}

// ── Unsupported nodes ───────────────────────────────────────────────────────
// Node types latex.proto can encode. Anything else (the whatsits xcolor's
// colour stack leaves, local_par markers) is zero-width, means nothing to the
// renderer, and goes before encoding.

export const SUPPORTED_NODE_TYPES = new Set(['glyph', 'glue', 'kern', 'rule', 'hlist', 'vlist',
  'disc', 'penalty', 'math', 'picture', 'transform']);

/** Remove unsupported nodes (with whatever they held); returns how many. */
export function stripUnsupportedNodes(data: SerializerOutput): number {
  let stripped = 0;
  const keep = (n: TexNode) => {
    if (SUPPORTED_NODE_TYPES.has(n.type)) return true;
    stripped++;
    return false;
  };
  for (const p of data.paragraphs) p.nodes = filterNodes(p.nodes ?? [], keep);
  for (const item of contentItems(data)) if (item.box) item.box.children = filterNodes(item.box.children ?? [], keep);
  return stripped;
}

// ── Batch parts ─────────────────────────────────────────────────────────────
// A batch (several snippets – a book's chapters – compiled as one document) is
// one document whose top-level flow is a run of "batch-part" streams. Each
// part becomes a document of its own: the part's content as the main flow,
// over copies of the shared tables pruned to what the part uses – the streams
// (footnotes, boxes, panes) it reaches, paragraphs, pictures and anchors.
// Pruning the anchors matters beyond size: a page registers every anchor of
// its blocks as a label found on that page, so a part must not claim labels
// another part defines.

function partDocument(data: SerializerOutput, content: ContentItem[]): SerializerOutput {
  const d: SerializerOutput = structuredClone({ ...data, content });
  const streams = d.streams;

  // The streams the part reaches: items of kind stream, and nodes that point
  // at one (a footnote marker), transitively.
  const keep = new Set<number>();
  const todo: ContentItem[][] = [d.content];
  while (todo.length) {
    for (const it of todo.pop()!) {
      const refs: number[] = it.kind === 'stream' && it.stream ? [it.stream] : [];
      // …and the marks asides leave where they stood (Node.aside).
      walk(itemNodes(d, it), n => {
        if (n.stream) refs.push(n.stream as number);
        if (n.aside) refs.push(n.aside as number);
      });
      for (const sid of refs) {
        if (!keep.has(sid) && sid >= 1 && sid <= streams.length) {
          keep.add(sid);
          todo.push(streams[sid - 1].content ?? []);
        }
      }
    }
  }
  const order = [...keep].sort((a, b) => a - b);
  const remap = new Map(order.map((old, k) => [old, k + 1]));
  const touched = new Set<TexNode>();            // a paragraph's nodes are reached once per item using it
  for (const items of [d.content, ...order.map(i => streams[i - 1].content ?? [])]) {
    for (const it of items) {
      if (it.kind === 'stream' && it.stream !== undefined && remap.has(it.stream)) it.stream = remap.get(it.stream);
      walk(itemNodes(d, it), n => {
        if (touched.has(n)) return;
        touched.add(n);
        if (remap.has(n.stream as number)) n.stream = remap.get(n.stream as number);
        if (remap.has(n.aside as number)) n.aside = remap.get(n.aside as number);
      });
    }
  }
  d.streams = order.map(i => streams[i - 1]);
  dropUnreferencedParagraphs(d);

  // Pictures and anchors the part uses, renumbered.
  const usedPics = new Set<number>(), usedAnchors = new Set<number>();
  const items = [...contentItems(d)];
  for (const it of items) {
    if (it.kind === 'anchorpoint' && it.anchor) usedAnchors.add(it.anchor);
    walk(itemNodes(d, it), n => {
      if (n.picture && n.type === 'picture') usedPics.add(n.picture as number);
      if (n.anchor) usedAnchors.add(n.anchor as number);
    });
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  const pmap = new Map(sorted(usedPics).map((old, k) => [old, k + 1]));
  const amap = new Map(sorted(usedAnchors).map((old, k) => [old, k + 1]));
  const seen = new Set<TexNode>();
  for (const it of items) {
    if (it.kind === 'anchorpoint' && it.anchor !== undefined && amap.has(it.anchor)) it.anchor = amap.get(it.anchor);
    walk(itemNodes(d, it), n => {
      if (seen.has(n)) return;
      seen.add(n);
      if (n.type === 'picture' && pmap.has(n.picture as number)) n.picture = pmap.get(n.picture as number);
      if (amap.has(n.anchor as number)) n.anchor = amap.get(n.anchor as number);
    });
  }
  const pictures = d.pictures as unknown[] | undefined;
  if (pictures?.length) d.pictures = sorted(usedPics).map(i => pictures[i - 1]);
  const anchors = (d.anchors as unknown[] | undefined) ?? [];
  d.anchors = sorted(usedAnchors).filter(i => i >= 1 && i <= anchors.length).map(i => anchors[i - 1]);
  d.outline = ((d.outline as Record<string, unknown>[] | undefined) ?? [])
    .filter(e => amap.has(e.anchor as number)).map(e => ({ ...e, anchor: amap.get(e.anchor as number) }));
  return d;
}

/** The documents of a batch's parts, in part order. */
export function batchParts(data: SerializerOutput): SerializerOutput[] {
  const parts: [number, ContentItem[]][] = [];
  for (const it of data.content) {
    if (it.kind === 'stream' && it.stream !== undefined && it.stream >= 1 && it.stream <= data.streams.length) {
      const s = data.streams[it.stream - 1];
      if (s.kind === 'batch-part') {
        const n = Number((s.attrs ?? []).find(a => a.key === 'part')?.value ?? 0);
        parts.push([n, s.content ?? []]);
      }
    }
  }
  return parts.sort((a, b) => a[0] - b[0]).map(([, content]) => partDocument(data, content));
}
