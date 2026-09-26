// SPDX-License-Identifier: AGPL-3.0-or-later
// MathML for every formula a reader meets.
//
// src/extract/mathml.lua records luamml's conversion of each of TeX's math
// lists (output.json `mathml`: {tree, display?}, numbered from 1), the number
// on each inline formula's begin-math node (`mathml`), the display number on
// each display item (`display_no`) and, where luamml met a box it cannot read,
// a placeholder {name: 'mglyph', box: k} and the same k on the box node
// (`mathml_box`). This pass turns that into one MathML string per formula:
//
//   * an inline formula: on its begin-math node; one inside another (a
//     formula in \text) is part of the outer one and carries none;
//   * a display: on its item; an amsmath alignment has no math list of its
//     own – its rows are display items sharing a number – so its first row
//     carries one table for all of them, and the formulas in its cells none.
//
// A box luamml could not read is read here from the node tree: an alignment
// (cases, a matrix, array) becomes a table built from the formulas typeset in
// its cells, an empty box (the strut in \big) nothing. Then what a speech
// engine would read as noise is cleaned up. What is left of the capture's
// bookkeeping (`mathml` table, `mathml_box`, `display_no`) is removed.
import { contentItems, forEachNode, walkNodes, type ContentItem, type SerializerOutput, type TexNode } from './nodes.ts';

export interface MathElement {
  name: string;
  attrs?: Record<string, string>;
  children?: MathNode[];
  /** a box luamml could not read: the number on its node's `mathml_box` */
  box?: number;
}
export type MathNode = string | MathElement;
interface Formula { tree: MathElement; display?: number }

const NS = 'http://www.w3.org/1998/Math/MathML';
const HL_ALIGNMENT_ROW = 4, HL_CELL = 5;

// ── Serialisation ───────────────────────────────────────────────────────────

const escapeXml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The element as XML; the root <math> declares the MathML namespace. */
export function toXml(n: MathNode, root = true): string {
  if (typeof n === 'string') return escapeXml(n);
  const attrs = Object.entries(n.attrs ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('') + (root && n.name === 'math' ? ` xmlns="${NS}"` : '');
  const children = n.children ?? [];
  return children.length ? `<${n.name}${attrs}>${children.map(c => toXml(c, false)).join('')}</${n.name}>` : `<${n.name}${attrs}/>`;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/** Elements whose children are positional: an empty child stays, as <mrow/>. */
const ARITY: Record<string, number> = { msub: 2, msup: 2, msubsup: 3, mfrac: 2, mroot: 2, munder: 2, mover: 2, munderover: 3 };
/** Rendering hints no reader needs. */
const DROPPED_ATTRS = new Set(['lspace', 'rspace']);
const isLetter = (s: string) => /^[A-Za-zΑ-ω]$/u.test(s);
const hasAttrs = (e: MathElement) => !!e.attrs && Object.keys(e.attrs).length > 0;
const TOKENS = new Set(['mi', 'mn', 'mo', 'mtext']);

/** What a speech engine would read as noise, removed: zero-width spaces (the
 *  struts of \big), rows of one child or none and rows inside rows,
 *  mathvariant="normal" on what is not a letter ("normal infinity"), a token
 *  element wrapping a whole formula (luamml's reading of \Bigl, or of a box
 *  it could not read) or nothing, text interrupted by a formula
 *  (\text{…$x$…}) split around it, space at the ends of text, spacing
 *  hints. null: nothing is left. */
export function cleanup(n: MathNode): MathNode | null {
  if (typeof n === 'string') return n;
  const e: MathElement = { name: n.name, children: [] };
  for (const [k, v] of Object.entries(n.attrs ?? {})) if (!DROPPED_ATTRS.has(k)) (e.attrs ??= {})[k] = v;
  const arity = ARITY[e.name];
  for (const c of n.children ?? []) {
    const d = cleanup(c);
    if (d !== null) e.children!.push(d);
    else if (arity) e.children!.push({ name: 'mrow', children: [] });
  }
  const kids = e.children!;
  if (e.name === 'mspace' && parseFloat(e.attrs?.width ?? '0') === 0) return null;
  if (TOKENS.has(e.name) && kids.length === 1 && typeof kids[0] !== 'string') return kids[0];
  if (TOKENS.has(e.name) && e.name !== 'mo' && kids.every(k => typeof k === 'string')) {
    // text keeps its inner spaces; at its ends, space (NBSP too) is layout
    const text = (kids as string[]).join('').replace(/\u00A0/g, ' ').trim();
    if (!text) return null;
    e.children = [text];
  }
  if (e.name === 'mtext' && kids.some(c => typeof c !== 'string')) {
    const parts: MathNode[] = [];
    for (const c of kids) {
      if (typeof c !== 'string') { parts.push(c); continue; }
      const last = parts[parts.length - 1];
      if (last && typeof last !== 'string' && last.name === 'mtext' && last.children?.every(x => typeof x === 'string')) last.children!.push(c);
      else parts.push({ name: 'mtext', children: [c] });
    }
    return cleanup({ name: 'mrow', children: parts });
  }
  if (e.name === 'mi' && e.attrs?.mathvariant === 'normal' && !(kids.length === 1 && typeof kids[0] === 'string' && isLetter(kids[0]))) {
    delete e.attrs.mathvariant;
  }
  if (e.attrs && !Object.keys(e.attrs).length) delete e.attrs;
  if (e.name === 'mrow' && !hasAttrs(e)) {
    e.children = kids.flatMap(k => (typeof k !== 'string' && k.name === 'mrow' && !hasAttrs(k) ? k.children ?? [] : [k]));
  }
  if (e.name === 'mrow' && !hasAttrs(e)) {
    const kids = e.children!;
    if (kids.length === 0) return null;
    if (kids.length === 1) return kids[0];
  }
  return e;
}

// ── Attaching ───────────────────────────────────────────────────────────────

const isBegin = (n: TexNode) => n.type === 'math' && n.subtype === 0;
const isEnd = (n: TexNode) => n.type === 'math' && n.subtype === 1;
const cells = (row: TexNode) => (row.children ?? []).filter(c => c.type === 'hlist' && c.subtype === HL_CELL);
const isAlignmentRow = (n: TexNode) => n.type === 'hlist' && cells(n).length > 0;

/** Index just past the end-math node closing the formula begun at nodes[i]. */
function formulaEnd(nodes: TexNode[], i: number): number {
  let depth = 0;
  for (let j = i; j < nodes.length; j++) {
    if (isBegin(nodes[j])) depth++;
    else if (isEnd(nodes[j]) && --depth === 0) return j + 1;
  }
  return nodes.length;
}

export function attachMathML(data: SerializerOutput): number {
  const table = data.mathml as Formula[] | undefined;
  delete data.mathml;
  const boxes = new Map<number, TexNode>();
  forEachNode(data, n => { if (typeof n.mathml_box === 'number') boxes.set(n.mathml_box, n); });
  const formula = (id: unknown): Formula | undefined => (typeof id === 'number' ? table?.[id - 1] : undefined);

  const resolving = new Set<number>();
  /** luamml's tree with its box placeholders read from the node tree. */
  function resolve(n: MathNode): MathNode | null {
    if (typeof n === 'string') return n;
    if (n.box !== undefined) {
      const box = boxes.get(n.box);
      if (!box || resolving.has(n.box)) return null;
      resolving.add(n.box);
      try { return readBox(box); } finally { resolving.delete(n.box); }
    }
    const children: MathNode[] = [];
    for (const c of n.children ?? []) {
      const r = resolve(c);
      if (r !== null) children.push(r);
      else if (ARITY[n.name]) children.push({ name: 'mrow', children: [] });
    }
    return { ...n, children };
  }

  /** What a list of nodes reads as: its formulas, and text between them. */
  function readNodes(nodes: TexNode[]): MathNode[] {
    const out: MathNode[] = [];
    let text = '';
    const flush = () => { if (text.trim()) out.push({ name: 'mtext', children: [text.trim()] }); text = ''; };
    const visit = (list: TexNode[]) => {
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (isBegin(n)) {
          const f = formula(n.mathml);
          if (f) { flush(); const r = resolve(f.tree); if (r !== null) out.push(r); }
          i = formulaEnd(list, i) - 1;
        } else if (n.type === 'glyph' && typeof n.char === 'number') text += String.fromCodePoint(n.char);
        else if (n.type === 'glue' && ((n.width as number | undefined) ?? 0) > 0) text += ' ';
        else if (n.type === 'disc') visit(n.replace ?? []);
        else if (n.children) visit(n.children);
      }
    };
    visit(nodes);
    flush();
    return out;
  }

  const table_ = (rows: TexNode[]): MathElement => ({
    name: 'mtable',
    children: rows.map(r => ({ name: 'mtr', children: cells(r).map(c => ({ name: 'mtd', children: readNodes(c.children ?? []) })) })),
  });

  /** A box luamml saw only as a box: an alignment is a table, anything else
   *  what it holds; an empty box nothing. */
  function readBox(box: TexNode): MathNode | null {
    const kids = box.children ?? [];
    const rows = kids.filter(isAlignmentRow);
    if (rows.length) return table_(rows);
    const content = readNodes(kids);
    if (!content.length) return null;
    return content.length === 1 ? content[0] : { name: 'mrow', children: content };
  }

  /** No MathML: nothing left, or text only (\textsuperscript is
   *  $^{\mbox{…}}$; a footnote mark is one) – the reader meets it as text. */
  const textOnly = (n: MathNode | null): boolean => n === null || typeof n === 'string'
    || n.name === 'mtext' || (n.name !== 'mi' && n.name !== 'mn' && n.name !== 'mo' && (n.children ?? []).every(textOnly));
  const finish = (tree: MathNode | null, display: boolean): string | undefined => {
    const c = tree === null ? null : cleanup(tree);
    if (textOnly(c)) return undefined;
    const children = c === null ? [] : typeof c !== 'string' && c.name === 'mrow' && !hasAttrs(c) ? c.children ?? [] : [c];
    return toXml({ name: 'math', ...(display ? { attrs: { display: 'block' } } : {}), children });
  };

  let count = 0;
  const strip = (nodes: TexNode[]) => walkNodes(nodes, n => { delete n.mathml; delete n.mathml_box; });

  // Inline formulas: every begin-math node not inside another formula.
  const inline = (nodes: TexNode[]) => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (isBegin(n)) {
        const end = formulaEnd(nodes, i);
        const f = formula(n.mathml);
        const xml = f ? finish(resolve(f.tree), false) : undefined;
        strip(nodes.slice(i, end));
        if (xml !== undefined) { n.mathml = xml; count++; }
        i = end - 1;
      } else if (n.children) inline(n.children);
    }
  };
  // Resolution reads cells' formulas through `mathml` ids, so every string is
  // made before any id is stripped.
  const pending: (() => void)[] = [];
  for (const p of data.paragraphs) pending.push(() => inline(p.nodes ?? []));

  // Displays, list by list (the main flow's, each stream's).
  const displays = (items: ContentItem[]) => {
    const byNumber = new Map<number, Formula>();
    for (const f of table ?? []) if (f.display !== undefined) byNumber.set(f.display, f);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== 'display' || !it.box) continue;
      const no = it.display_no as number | undefined;
      const f = no !== undefined ? byNumber.get(no) : undefined;
      let xml: string | undefined;
      let group = [it];
      if (f) xml = finish(resolve(f.tree), true);
      else if (isAlignmentRow(it.box)) {
        for (let j = i + 1; j < items.length && no !== undefined; j++) {
          if (items[j].kind === 'vspace') continue;
          if (items[j].kind !== 'display' || items[j].display_no !== no || !items[j].box || !isAlignmentRow(items[j].box!)) break;
          group.push(items[j]);
        }
        xml = finish(table_(group.map(g => g.box!)), true);
      }
      const last = group[group.length - 1];
      i = items.indexOf(last);
      pending.push(() => {
        for (const g of group) {
          strip([g.box!]);
          if (g.display_wide?.box) strip([g.display_wide.box]);
          delete g.display_no;
          if (g.display_wide) delete g.display_wide.display_no;
        }
        if (xml !== undefined) { it.mathml = xml; count++; }
      });
    }
  };
  if (table) {
    displays(data.content);
    for (const s of data.streams) displays(s.content ?? []);
  }
  for (const run of pending) run();
  // Anything left (a display item with no box, a wide form): bookkeeping only.
  for (const it of contentItems(data)) delete it.display_no;
  forEachNode(data, n => { if (!isBegin(n) || typeof n.mathml !== 'string') delete n.mathml; delete n.mathml_box; });
  return count;
}
