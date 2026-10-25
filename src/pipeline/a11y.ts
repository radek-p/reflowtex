// SPDX-License-Identifier: AGPL-3.0-or-later
// A block's accessible layer: what the drawn block says, in reading order, as
// HTML a screen reader reads – paragraphs as <p> with MathML where a formula
// stands, displays as block MathML. The page puts it right after the block,
// hidden only visually, and hides the drawing (glyph by glyph, no words, no
// structure) from assistive technology.
//
// It is built at build time from the encoded document, so it is in the page
// before the viewer runs: a reader, find-in-page or a search engine does not
// wait for the viewer, which paints a block only once it is scrolled to.
// (Its formulas are put in place by a short script right after it, as soon
// as it is parsed – or, without scripts, are there as markup: shippedMath.)
//
// Text and formulas, and every stream – a box (theorem, proof, note, a
// custom kind), a hint, an accordion's panes, a footnote, a side note – in
// reading order: a box where it stands, a footnote or an aside as a note
// after the paragraph that refers to it. Headings, lists, tables, links and
// a language are not in it yet.
import { messageType } from './schema.ts';
import { glyphText } from '../shared/glyph-text.ts';

const HL_ALIGNMENT = 4;   // an amsmath alignment row

type LayerNode = { type?: string; char?: number; width?: number; stretch?: number; mathml?: string; subtype?: number;
                   children?: LayerNode[]; replace?: LayerNode[]; stream?: number; aside?: number; actual_text?: string };
type LayerItem = { kind?: string; para?: number; box?: LayerNode; mathml?: string; stream?: number; [field: string]: unknown };
type LayerStream = { kind?: string; content?: LayerItem[]; text?: string };
export interface LayerDocument { paragraphs: { nodes?: LayerNode[] }[]; content: LayerItem[]; streams?: LayerStream[] }

/** Visually hidden, still read (display:none or visibility:hidden would hide
 *  it from screen readers too). */
const HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%)';

/** A formula's MathML as the page ships it: as LaTeX wrote it, inside a
 *  <noscript data-mathml>, and put in place whole by the script after the
 *  layer (INSERT_MATH).
 *
 *  A browser parses a page as it arrives and may lay out what it has so far
 *  at any moment. Shipped as markup, a formula stood in the page half parsed
 *  whenever the HTML arrived or was parsed in pieces – an <mfrac> with its
 *  numerator and not yet its denominator – and Firefox, laying that out,
 *  reported "Invalid markup: Incorrect number of children for <mfrac/> tag"
 *  (it did on a slow test machine). With scripts on, a <noscript>'s content
 *  is plain text, nothing laid out; the script parses each formula off the
 *  page (a <template>'s fragment) and inserts it complete, in one step.
 *  Without scripts, the <noscript>'s content is the MathML itself, read as
 *  before. (MathML holding "</noscript" could not be shipped so, and is
 *  shipped as markup.) */
export function shippedMath(mathml: string): string {
  return /<\/noscript/i.test(mathml) ? mathml : `<noscript data-mathml>${mathml}</noscript>`;
}

/** Right after a layer: its formulas (shippedMath) put in place, each whole
 *  and in one step, as soon as the layer is parsed – before the viewer
 *  runs, so a reader has them at once; then it removes itself, so the layer
 *  follows its block directly again. (The viewer does the same for a layer
 *  this did not run for: a page that forbids inline scripts, or HTML
 *  inserted by a script, whose scripts do not run.) Kept in step with
 *  insertShippedMath (src/viewer/src/runtime/a11y-math.ts). */
export const INSERT_MATH = '<script>(s=>{for(const n of s.previousElementSibling.querySelectorAll("noscript[data-mathml]"))' +
  '{const t=document.createElement("template");t.innerHTML=n.textContent;n.replaceWith(t.content)}s.remove()})(document.currentScript)</script>';

/** One element's HTML (the layer, or another page part holding formulas made with shippedMath), followed by
 *  INSERT_MATH when it holds any: its formulas then go in place whole as soon as it is parsed. */
export function withMathInserted(html: string): string {
  return html + (html.includes('<noscript data-mathml>') ? INSERT_MATH : '');
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
 *  without (a footnote mark is a \textsuperscript) as its text. `refs`
 *  collects the streams they refer to – a footnote mark's body, an aside's
 *  box – in order, once each. */
function nodesHtml(nodes: LayerNode[], refs: number[] = []): string {
  let out = '';
  const ref = (k?: number) => { if (k && !refs.includes(k)) refs.push(k); };
  const visit = (list: LayerNode[]) => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.type === 'math' && (n.subtype ?? 0) === 0 && n.mathml) {
        out += shippedMath(n.mathml);
        i = formulaEnd(list, i) - 1;
      } else if (n.type === 'glyph' && n.char !== undefined) { out += escapeText(glyphText(n.char)); ref(n.stream); }
      // a space, or a glue that only stretches: a contents entry's number is
      // in a box filled out by \hfil, and "1Entries" would be read as one word
      else if (n.type === 'glue' && ((n.width ?? 0) > 0 || (n.stretch ?? 0) > 0)) out += ' ';
      else if (n.type === 'disc') visit(n.replace ?? []);
      else {
        ref(n.aside);
        // a box that says what it stands for (a virtual font's é) is read so
        if (n.actual_text !== undefined) out += escapeText(n.actual_text);
        else if (n.children) visit(n.children);
      }
    }
  };
  visit(nodes);
  return out.replace(/ {2,}/g, ' ').trim();
}

/** The layer's HTML for a document (and, if it has formulas, INSERT_MATH
 *  after it). Each piece says what it stands for, so
 *  the viewer can lay it over that once drawn (runtime/a11y.ts):
 *  data-para = the paragraph's number, data-item = a display's position in
 *  the content (both 1-based, as the document numbers them), data-stream = a
 *  stream's number (its drawn box). */
export function a11yLayer(doc: LayerDocument): string {
  const inner = itemsHtml(doc, doc.content, true, new Set());
  return withMathInserted(`<div class="latex-a11y" style="${HIDDEN}">${inner}</div>`);
}

/** Content items as the layer's pieces. `top`: the block's own content,
 *  whose displays the viewer places by their position in it; `done` keeps a
 *  stream referred to twice (a footnote mark repeated) from being read twice. */
function itemsHtml(doc: LayerDocument, content: LayerItem[], top: boolean, done: Set<number>): string {
  const parts: string[] = [];
  // the previous display, if nothing but space came after it
  let lastDisplay: LayerItem | null = null;
  content.forEach((it, i) => {
    const prev = lastDisplay;
    if (it.kind !== 'vspace') lastDisplay = it.kind === 'display' ? it : null;
    const item = top ? ` data-item="${i + 1}"` : '';
    if (it.kind === 'paragraph' && it.para) {
      const refs: number[] = [];
      const html = nodesHtml(doc.paragraphs[it.para - 1]?.nodes ?? [], refs);
      if (html) parts.push(`<p data-para="${it.para}">${html}</p>`);
      for (const k of refs) parts.push(noteHtml(doc, k, done));
    } else if (it.kind === 'display') {
      // a row after an alignment's first is read in the first row's table
      if (!it.mathml && it.box?.subtype === HL_ALIGNMENT && prev?.box?.subtype === HL_ALIGNMENT) return;
      if (it.mathml) parts.push(`<div${item}>${shippedMath(it.mathml)}</div>`);
      else if (it.box) {
        const refs: number[] = [];
        const html = nodesHtml([it.box], refs);
        if (html) parts.push(`<p${item}>${html}</p>`);
        for (const k of refs) parts.push(noteHtml(doc, k, done));
      }
    } else if (it.kind === 'stream' && it.stream) parts.push(streamHtml(doc, it.stream, done));
  });
  return parts.join('');
}

/** A stream standing in the flow, where it stands: its content in a group
 *  (a box's heading – "Theorem 1.", "Proof." – is its first words). A hint is
 *  a disclosure, closed: on the page it is blurred until pressed, so that it
 *  is not read by accident, and a reader opens it the same way. Text a
 *  stream carries as text (a Lean declaration's source) is read as code. */
function streamHtml(doc: LayerDocument, k: number, done: Set<number>): string {
  const s = doc.streams?.[k - 1];
  if (!s || done.has(k)) return '';
  done.add(k);
  const kind = escapeText(s.kind ?? '').replace(/"/g, '&quot;');
  const inner = itemsHtml(doc, s.content ?? [], false, done) + (s.text ? `<pre>${escapeText(s.text)}</pre>` : '');
  if (!inner) return '';
  if (s.kind === 'hint') return `<details data-stream="${k}" data-kind="hint"><summary>Hint</summary>${inner}</details>`;
  return `<div role="group" data-stream="${k}" data-kind="${kind}">${inner}</div>`;
}

/** A stream a paragraph refers to – a footnote's body, a side note – read as a
 *  note after the paragraph. */
function noteHtml(doc: LayerDocument, k: number, done: Set<number>): string {
  const s = doc.streams?.[k - 1];
  if (!s || done.has(k)) return '';
  done.add(k);
  const inner = itemsHtml(doc, s.content ?? [], false, done);
  const kind = escapeText(s.kind ?? '').replace(/"/g, '&quot;');
  return inner ? `<div role="note" data-stream="${k}" data-kind="${kind}">${inner}</div>` : '';
}

/** The layer for an encoded document (what a page embeds). */
export function a11yLayerFromBytes(bytes: Uint8Array): string {
  const Document = messageType('Document');
  const doc = Document.toObject(Document.decode(bytes), { enums: String, defaults: false }) as LayerDocument;
  doc.paragraphs ??= [];
  doc.content ??= [];
  doc.streams ??= [];
  return a11yLayer(doc);
}
