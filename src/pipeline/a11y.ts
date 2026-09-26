// SPDX-License-Identifier: AGPL-3.0-or-later
// A block's accessible layer: what the drawn block says, in reading order, as
// HTML a screen reader reads – paragraphs as <p> with MathML where a formula
// stands, displays as block MathML. The page puts it right after the block,
// hidden only visually, and hides the drawing (glyph by glyph, no words, no
// structure) from assistive technology.
//
// It is built at build time from the encoded document, so it is in the page
// before any script runs: a reader, find-in-page or a search engine does not
// wait for the viewer, which paints a block only once it is scrolled to.
//
// First slice: text and formulas. Headings, lists, tables, links, footnotes,
// asides and a language are not in it yet.
import { messageType } from './schema.ts';

type LayerNode = { type?: string; char?: number; width?: number; mathml?: string; subtype?: number;
                   children?: LayerNode[]; replace?: LayerNode[] };
type LayerItem = { kind?: string; para?: number; box?: LayerNode; mathml?: string; [field: string]: unknown };
export interface LayerDocument { paragraphs: { nodes?: LayerNode[] }[]; content: LayerItem[] }

/** Visually hidden, still read (display:none or visibility:hidden would hide
 *  it from screen readers too). */
const HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%)';

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A glyph's text: private-use code points (glyphs addressed by index,
 *  unencoded variants) say nothing; ligatures read as their letters. */
function glyphText(cp: number): string {
  if ((cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000) return '';
  const ch = String.fromCodePoint(cp);
  return cp >= 0xFB00 && cp <= 0xFB06 ? ch.normalize('NFKC') : ch;
}

/** Index just past the end-math node of the formula begun at nodes[i]. */
function formulaEnd(nodes: LayerNode[], i: number): number {
  let depth = 0;
  for (let j = i; j < nodes.length; j++) {
    const n = nodes[j];
    if (n.type === 'math') depth += (n.subtype ?? 0) === 0 ? 1 : -1;
    if (depth === 0) return j + 1;
  }
  return nodes.length;
}

/** The nodes as HTML: text escaped, a formula with MathML as its MathML, one
 *  without (a footnote mark is a \textsuperscript) as its text. */
function nodesHtml(nodes: LayerNode[]): string {
  let out = '';
  const visit = (list: LayerNode[]) => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.type === 'math' && (n.subtype ?? 0) === 0 && n.mathml) {
        out += n.mathml;
        i = formulaEnd(list, i) - 1;
      } else if (n.type === 'glyph' && n.char !== undefined) out += escapeText(glyphText(n.char));
      else if (n.type === 'glue' && (n.width ?? 0) > 0) out += ' ';
      else if (n.type === 'disc') visit(n.replace ?? []);
      else if (n.children) visit(n.children);
    }
  };
  visit(nodes);
  return out.replace(/ {2,}/g, ' ').trim();
}

/** The layer's HTML for a document. */
export function a11yLayer(doc: LayerDocument): string {
  const parts: string[] = [];
  for (const it of doc.content) {
    if (it.kind === 'paragraph' && it.para) {
      const html = nodesHtml(doc.paragraphs[it.para - 1]?.nodes ?? []);
      if (html) parts.push(`<p>${html}</p>`);
    } else if (it.kind === 'display') {
      if (it.mathml) parts.push(it.mathml);
      else if (it.box) {
        const html = nodesHtml([it.box]);
        if (html) parts.push(`<p>${html}</p>`);
      }
    }
  }
  return `<div class="latex-a11y" style="${HIDDEN}">${parts.join('')}</div>`;
}

/** The layer for an encoded document (what a page embeds). */
export function a11yLayerFromBytes(bytes: Uint8Array): string {
  const Document = messageType('Document');
  const doc = Document.toObject(Document.decode(bytes), { enums: String, defaults: false }) as LayerDocument;
  doc.paragraphs ??= [];
  doc.content ??= [];
  return a11yLayer(doc);
}
