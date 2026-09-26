// SPDX-License-Identifier: AGPL-3.0-or-later
// A width-parametric display tree, recovered from three LuaTeX compilations of
// the document at increasing \textwidth.
//
// No amsmath environment or node shape is special-cased: the display trees of
// the samples must have one topology, and every geometric scalar in them must
// be affine across the three widths. The document of record keeps its own
// tree and gains sparse `*_rate` derivatives on the fields that change, and
// `*_floor` marks on the gaps that may close only so far. The viewer evaluates
// them at the reader's width. Every tree walk here is src/shared/tree.ts's.
import { walk1, some, walkParallel, type ChildKey } from '../shared/tree.ts';
import type { ContentItem, SerializerOutput, TexNode, FontInfo } from './nodes.ts';

const NODE_GEOMETRY = ['width', 'height', 'depth', 'stretch', 'shrink', 'kern', 'shift',
  'glue_set', 'surround', 'm_a', 'm_b', 'm_c', 'm_d'] as const;
const RATIO_FIELDS = new Set(['glue_set', 'm_a', 'm_b', 'm_c', 'm_d']);
const ITEM_GEOMETRY = ['display_width', 'display_indent', 'display_shift'] as const;
/** Not part of a node's identity: its geometry, the model's annotations, its
 *  descendants, and how its glue was set (a formula TeX had to shrink at one
 *  measure is set at its natural width at a wider one, the same tree). */
const NOT_IDENTITY = new Set<string>([
  ...NODE_GEOMETRY, ...NODE_GEOMETRY.map(f => `${f}_rate`), ...NODE_GEOMETRY.map(f => `${f}_floor`),
  'children', 'pre', 'post', 'replace', 'nobreak', 'leader', 'glue_sign', 'glue_order',
]);
/** The node types whose named field *is* horizontal space, and the field. */
const GAP_FIELD: Record<string, string> = { glue: 'width', kern: 'kern', math: 'surround' };

type Rec = Record<string, unknown>;
const num = (o: Rec, k: string): number => (o[k] as number | undefined) ?? 0;

// ── Python's formatting, for messages that read the same ────────────────────

/** Python's `format(x, 'g')`. */
export function pyG(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const exp = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(6)))));
  if (exp < -4 || exp >= 6) {
    const [m, e] = x.toExponential(5).split('e');
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    const en = Number(e);
    return `${mant}e${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(2, '0')}`;
  }
  const s = x.toFixed(Math.max(0, 5 - exp));
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Python's repr() of JSON-shaped data. (A float that happens to be integral
 *  prints as an int: JSON cannot tell 1.0 from 1.) */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (typeof v === 'string') {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    const body = v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      .replace(new RegExp(q, 'g'), `\\${q}`);
    return q + body + q;
  }
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (v instanceof Map) return `{${[...v].map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
  return `{${Object.entries(v as Rec).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
}
function pyFloat(x: number): string {
  const s = String(x);
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e < -4 || e >= 16) {
    const [m, ex] = x.toExponential().split('e');
    const en = Number(ex);
    return `${m}e${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(2, '0')}`;
  }
  return s.includes('e') ? x.toFixed(20).replace(/0+$/, '') : s;
}

// ── Items ───────────────────────────────────────────────────────────────────

/** The display items: the main flow's, then each stream's (not their wide
 *  forms – those are the model's output). */
export function displayItems(data: SerializerOutput): ContentItem[] {
  const out = data.content.filter(it => it.kind === 'display');
  for (const s of data.streams) out.push(...(s.content ?? []).filter(it => it.kind === 'display'));
  return out;
}

export const hasDisplays = (data: SerializerOutput): boolean => displayItems(data).length > 0;

// ── Shape and law ───────────────────────────────────────────────────────────

/** Why two trees are not the same tree (identity of every node, the number of
 *  nodes in every list, the presence of every leader), or null. */
export function topologyError(a: TexNode, b: TexNode, path: string): string | null {
  const identity = (n: TexNode) => Object.fromEntries(Object.entries(n).filter(([k]) => !NOT_IDENTITY.has(k)));
  return walkParallel<TexNode>([a, b], {
    node([x, y], p) {
      const sx = identity(x), sy = identity(y);
      if (!sameRecord(sx, sy)) return `${p}: node identity changed (${pyRepr(sx)} != ${pyRepr(sy)})`;
    },
    list(key: ChildKey, [la, lb], p) {
      if (key === 'leader') { if (la.length !== lb.length) return `${p}: presence changed`; }
      else if (la.length !== lb.length) return `${p}: node count changed (${la.length} != ${lb.length})`;
    },
  }, path);
}
function sameRecord(a: Rec, b: Rec): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => k in b && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

const affineResidual = (a: number, b: number, c: number, xa: number, xb: number, xc: number): number =>
  Math.abs(c - (b + (b - a) * (xc - xb) / (xb - xa)));

/** Why three same-shaped trees are not affine in the width – the first field
 *  whose value at xc is not where the line through xa and xb puts it – or null. */
export function affineError(a: TexNode, b: TexNode, c: TexNode, xa: number, xb: number, xc: number, path: string,
                            tolSp = 3, tolRatio = 1e-6): string | null {
  return walkParallel<TexNode>([a, b, c], {
    node([na, nb, nc], p) {
      for (const f of NODE_GEOMETRY) {
        const va = num(na, f), vb = num(nb, f), vc = num(nc, f);
        const err = affineResidual(va, vb, vc, xa, xb, xc);
        const tol = RATIO_FIELDS.has(f) ? tolRatio * Math.max(1.0, Math.abs(va), Math.abs(vb), Math.abs(vc)) : tolSp;
        if (err > tol) return `${p}.${f}: non-affine residual ${pyG(err)} (tolerance ${pyG(tol)})`;
      }
    },
  }, path);
}

const sourceWidth = (d: SerializerOutput): number => Math.trunc(Number(d.source_width ?? 0));

/** Whether three increasing-width samples have one affine topology:
 *  [true, null] or [false, why not]. */
export function checkSamples(a: SerializerOutput, b: SerializerOutput, c: SerializerOutput): [boolean, string | null] {
  const [xa, xb, xc] = [a, b, c].map(sourceWidth);
  if (!(0 < xa && xa < xb && xb < xc)) return [false, `source widths are not strictly increasing: ${xa}, ${xb}, ${xc}`];
  const [da, db, dc] = [a, b, c].map(displayItems);
  if (!(da.length === db.length && db.length === dc.length))
    return [false, `display count changed: ${da.length}, ${db.length}, ${dc.length}`];
  for (let i = 0; i < da.length; i++) {
    const [ia, ib, ic] = [da[i], db[i], dc[i]];
    const err = topologyError(ia.box!, ib.box!, `display[${i}].box`) ?? topologyError(ib.box!, ic.box!, `display[${i}].box`);
    if (err) return [false, err];
    for (const f of ITEM_GEOMETRY) {
      const r = affineResidual(num(ia, f), num(ib, f), num(ic, f), xa, xb, xc);
      if (r > 3) return [false, `display[${i}].${f}: non-affine residual ${pyG(r)}`];
    }
    const e2 = affineError(ia.box!, ib.box!, ic.box!, xa, xb, xc, `display[${i}].box`);
    if (e2) return [false, e2];
  }
  return [true, null];
}

// ── Rates and floors ────────────────────────────────────────────────────────

/** Each field's slope between `previous` and `newest`, written onto `recv`'s
 *  corresponding node (`recv` may be `previous` itself). */
function attachRates(recv: TexNode, previous: TexNode, newest: TexNode, dx: number): void {
  walkParallel<TexNode>([recv, previous, newest], {
    node([r, p, n]) {
      for (const f of NODE_GEOMETRY) {
        const delta = num(n, f) - num(p, f);
        if (delta) r[`${f}_rate`] = delta / dx;
      }
    },
  });
}

/** Mark the gaps that were nonnegative throughout and open with the width:
 *  the viewer may floor them. Only a gap – a glue's set width, a kern, a math
 *  node's surround – is floored; a box's width varies too, but it is however
 *  wide its contents came out, not space. A box whose glue stretches more as
 *  the measure grows (a tabular*'s \extracolsep) is spaced by its glue_set,
 *  which closes at zero: its natural width. */
function markFloors(oldest: TexNode, previous: TexNode, newest: TexNode, dx: number): void {
  walkParallel<TexNode>([oldest, previous, newest], {
    node([o, p, n]) {
      const field = GAP_FIELD[n.type];
      if (field) {
        const va = num(o, field), vb = num(p, field), vc = num(n, field);
        if ((vc - vb) / dx > 0 && va >= 0 && vb >= 0 && vc >= 0) o[`${field}_floor`] = true;
      }
      if ((n.type === 'hlist' || n.type === 'vlist') && n.glue_sign === 1) {
        const [ga, gb, gc] = [o, p, n].map(d => (d.glue_set as number) || 0);
        if ((gc - gb) / dx > 0 && ga >= 0 && gb >= 0 && gc >= 0) o.glue_set_floor = true;
      }
    },
  });
}

function attachItem(first: ContentItem, old: ContentItem, next: ContentItem, dx: number): void {
  for (const f of ITEM_GEOMETRY) {
    const delta = num(next, f) - num(old, f);
    if (delta) first[`${f}_rate`] = delta / dx;
  }
  attachRates(first.box!, old.box!, next.box!, dx);
  markFloors(first.box!, old.box!, next.box!, dx);
  // A natural-width display carries its centring in display_shift; its zero
  // crossing is where the formula itself fills the column.
  const shifts = [first, old, next].map(d => num(d, 'display_shift'));
  if ((shifts[2] - shifts[1]) / dx > 0 && shifts.every(v => v >= 0)) first.display_shift_floor = true;
}

/** Attach the rates once checkSamples succeeds; the **narrowest** sample is
 *  the document of record (the wider ones exist to measure slopes with, and
 *  everything else a compilation holds belongs to the width the document was
 *  written for). */
export function attachModel(oldest: SerializerOutput, previous: SerializerOutput, newest: SerializerOutput): SerializerOutput {
  const dx = sourceWidth(newest) - sourceWidth(previous);
  const [f, o, n] = [oldest, previous, newest].map(displayItems);
  for (let i = 0; i < Math.min(f.length, o.length, n.length); i++) attachItem(f[i], o[i], n[i], dx);
  attachParagraphRates(oldest, previous, newest);
  oldest.display_model = true;
  return oldest;
}

/** attachModel with the document of record fixed to `first`, the sample at
 *  the document's own width, when that sample failed the affine check and the
 *  stable triple was found further up: the slopes of the stable pair go onto
 *  every display whose tree has the same shape at the document's width; one
 *  whose shape differs keeps its geometry (it renders as TeX set it). Returns
 *  the document and the number of displays left fixed. */
export function anchorModel(first: SerializerOutput, previous: SerializerOutput, newest: SerializerOutput): [SerializerOutput, number] {
  const dx = sourceWidth(newest) - sourceWidth(previous);
  const [f, o, n] = [first, previous, newest].map(displayItems);
  let fixed = 0;
  for (let i = 0; i < Math.min(f.length, o.length, n.length); i++) {
    if (topologyError(f[i].box!, o[i].box!, `display[${i}].box`)) { fixed++; continue; }
    attachItem(f[i], o[i], n[i], dx);
  }
  attachParagraphRates(first, previous, newest);
  first.display_model = true;
  return [first, fixed];
}

// ── A display set another way at the document's width ───────────────────────
// Such a display (amsmath moved its tag, or had no room to centre the body)
// gets two forms: its tree at the document's width, and the stable pair's own
// tree with its own rates (display_wide, anchored at display_wide_width), used
// from display_wide_from on – the width where TeX changes regime, found by
// compiling in between.

const WIDE_RESOLUTION_SP = 2 * 65536;           // bisect the switch width to within 2 pt

function displayAgrees(item: ContentItem, prev: ContentItem, next: ContentItem, x: number, xb: number, xc: number): boolean {
  if (topologyError(item.box!, prev.box!, 'box')) return false;
  for (const f of ITEM_GEOMETRY) if (affineResidual(num(item, f), num(prev, f), num(next, f), x, xb, xc) > 3) return false;
  return affineError(item.box!, prev.box!, next.box!, x, xb, xc, 'box') === null;
}

function clearRates(root: TexNode): void {
  walk1(root, n => {
    for (const k of Object.keys(n)) if (k.endsWith('_rate') || k.endsWith('_floor')) delete n[k];
  });
}

/** Font ids of `other`'s compilation → ids in `first`'s table, matched by
 *  file, name and size; a font only `other` loaded is added to `first`. */
function fontRemap(first: SerializerOutput, other: SerializerOutput): Map<string, string> {
  const key = (f: FontInfo) => JSON.stringify([f.filename, f.name, f.size_sp]);
  const byKey = new Map([...first.fonts].map(([id, f]) => [key(f), id] as const));
  const remap = new Map<string, string>();
  for (const [id, f] of other.fonts) {
    const k = key(f);
    if (!byKey.has(k)) {
      const fresh = String(Math.max(0, ...[...first.fonts.keys()].map(Number)) + 1);
      first.fonts.set(fresh, { ...f });
      byKey.set(k, fresh);
    }
    remap.set(id, byKey.get(k)!);
  }
  return remap;
}

/** Give each display of `first` (already anchored by anchorModel) that
 *  disagrees with the stable pair a wide form. `probe(width)` compiles the
 *  document at that \textwidth. Returns [displays given a wide form,
 *  compilations made]. */
export async function wideVariants(first: SerializerOutput, previous: SerializerOutput, newest: SerializerOutput,
                                   probe: (width: number) => Promise<SerializerOutput | null>): Promise<[number, number]> {
  const x0 = sourceWidth(first), xb = sourceWidth(previous), xc = sourceWidth(newest);
  const dx = xc - xb;
  const firsts = displayItems(first), prevs = displayItems(previous), news = displayItems(newest);
  if (!(firsts.length === prevs.length && prevs.length === news.length)) return [0, 0];
  const todo = firsts.map((_, i) => i).filter(i =>
    !displayAgrees(firsts[i], prevs[i], news[i], x0, xb, xc) && !some([prevs[i].box!], n => n.type === 'picture'));
  if (!todo.length) return [0, 0];
  const probes = new Map<number, SerializerOutput | null>();
  const sample = async (w: number) => {
    if (!probes.has(w)) probes.set(w, await probe(w));
    return probes.get(w)!;
  };
  // The switch lies in (lo, hi]: at lo the display is set the narrow way, at
  // hi on the wide law. All displays are bisected together, sharing
  // compilations.
  const lo = new Map(todo.map(i => [i, x0])), hi = new Map(todo.map(i => [i, xb]));
  const loData = new Map<number, ContentItem>();
  for (;;) {
    const open = todo.filter(i => hi.get(i)! - lo.get(i)! > WIDE_RESOLUTION_SP);
    if (!open.length) break;
    const w = Math.floor((lo.get(open[0])! + hi.get(open[0])!) / 2);
    const d = await sample(w);
    const items = d ? displayItems(d) : [];
    for (const i of open) {
      if (!(lo.get(i)! < w && w < hi.get(i)!)) continue;
      if (items.length === firsts.length && displayAgrees(items[i], prevs[i], news[i], w, xb, xc)) hi.set(i, w);
      else {
        lo.set(i, w);
        if (items.length === firsts.length) loData.set(i, items[i]);
      }
    }
  }
  const remap = fontRemap(first, previous);
  for (const i of todo) {
    const item = firsts[i], prevItem = prevs[i], newItem = news[i];
    const wide = structuredClone(prevItem);
    clearRates(wide.box!);
    for (const f of ITEM_GEOMETRY) {
      const delta = num(newItem, f) - num(prevItem, f);
      if (delta) wide[`${f}_rate`] = delta / dx;
    }
    attachRates(wide.box!, prevItem.box!, newItem.box!, dx);
    markFloors(wide.box!, prevItem.box!, newItem.box!, dx);
    walk1(wide.box!, n => {
      if (n.type === 'glyph' && remap.has(String(n.font))) n.font = Number(remap.get(String(n.font)));
    });
    for (const k of ['display_wide', 'display_wide_from', 'display_wide_width']) delete wide[k];
    item.display_wide = wide;
    item.display_wide_width = xb;
    item.display_wide_from = hi.get(i);
    // The narrow form's own law, where a compilation in its regime exists:
    // measured on the narrow side, not borrowed from the wide one.
    const near = loData.get(i);
    if (near !== undefined && !topologyError(item.box!, near.box!, 'box')) {
      const dn = lo.get(i)! - x0;
      clearRates(item.box!);
      for (const f of ITEM_GEOMETRY) {
        delete item[`${f}_rate`];
        const delta = num(near, f) - num(item, f);
        if (delta) item[`${f}_rate`] = delta / dn;
      }
      attachRates(item.box!, item.box!, near.box!, dn);
    }
  }
  return [todo.length, probes.size];
}

// ── Paragraphs: boxes set to the measure ────────────────────────────────────
// A box inside a paragraph can be as wide as the text: a tabular* spread over
// \textwidth, a figure scaled to \linewidth, a rule across the column. Such a
// box is modelled like a display, so it follows the reader's measure. Unlike a
// display, a paragraph that does not fit the law is no reason to reject a
// sample (a \parbox of text re-breaks at every width and never will): it keeps
// the geometry TeX gave it at the document's width.

const WIDE_BOX_SHARE = 0.5;       // a box at least this share of the text width is worth sampling for
// How far off the law a paragraph box may be and still follow it: a picture
// scaled to the measure gets its height from the width in TeX's integer
// arithmetic, some hundreds of sp off a straight line; ratios (glue_set, a
// scaling matrix) graphicx writes with five decimals. Displays keep 3 sp.
const PARAGRAPH_TOL_SP = 4096;
const PARAGRAPH_TOL_RATIO = 1e-4;

/** Whether a paragraph holds a box wide enough to have been set to the
 *  measure – reason enough to compile the document at other widths. */
export function hasWidthBoxes(data: SerializerOutput): boolean {
  const sw = Math.trunc(Number(data.source_width || 0));
  if (sw <= 0) return false;
  return data.paragraphs.some(p => (p.nodes ?? []).some(n =>
    (n.type === 'hlist' || n.type === 'vlist' || n.type === 'picture') && (((n.width as number) || 0) >= WIDE_BOX_SHARE * sw)));
}

export const wantsModel = (data: SerializerOutput): boolean => hasDisplays(data) || hasWidthBoxes(data);

const countRates = (root: TexNode): number => {
  let k = 0;
  walk1(root, n => { k += Object.keys(n).filter(key => key.endsWith('_rate')).length; });
  return k;
};

/** Rates on the nodes of each paragraph of `first` whose tree has one shape at
 *  the three widths and is affine across them. Returns how many paragraphs
 *  changed with the width and were given rates. */
export function attachParagraphRates(first: SerializerOutput, previous: SerializerOutput, newest: SerializerOutput): number {
  const [x0, xb, xc] = [first, previous, newest].map(sourceWidth);
  const [pa, pb, pc] = [first, previous, newest].map(d => d.paragraphs);
  if (!(pa.length === pb.length && pb.length === pc.length) || !(0 < x0 && x0 < xb && xb < xc)) return 0;
  const dx = xc - xb;
  let modelled = 0;
  for (let i = 0; i < pa.length; i++) {
    const [ta, tb, tc] = [pa[i], pb[i], pc[i]].map(p => ({ type: 'hlist', children: p.nodes ?? [] }) as TexNode);
    if (topologyError(ta, tb, 'para') || topologyError(tb, tc, 'para')) continue;
    if (affineError(ta, tb, tc, x0, xb, xc, 'para', PARAGRAPH_TOL_SP, PARAGRAPH_TOL_RATIO)) continue;
    const before = countRates(ta);
    attachRates(ta, tb, tc, dx);
    markFloors(ta, tb, tc, dx);
    if (countRates(ta) > before) modelled++;
  }
  return modelled;
}

