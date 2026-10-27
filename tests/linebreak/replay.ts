// SPDX-License-Identifier: AGPL-3.0-or-later
// Replays a fixture capture.lua wrote through the viewer's line breaker, and
// writes the result in the fixture's own format, to be compared byte for byte
// with what LuaTeX produced (par-NNNN.expected).
//
// The viewer chooses the breaks and sets each line's glue (breaker.ts); what
// TeX does around them is done here, as LuaTeX's post_line_break does it: the
// line's end changed by the kind of break (glue becomes \rightskip, a
// discretionary leaves its pre-break text, a kern loses its width), what a
// break discards pruned at the next line's start, the line packed to \hsize
// (a filled line's glue setting, its height and depth), and the interline
// glue and penalties between the lines. So a difference in the result is a
// difference in the viewer's breaks or glue setting, or in this file.
//
// Only what the viewer models is replayed: no stretch in \leftskip or
// \rightskip, no protrusion or expansion, no directions. A fixture with
// anything else is refused with an error. A \parshape or \hangindent is given
// to the breaker as the serializer records it: one measure per line, from the
// paragraph's first, up to TeX's last special line (shapeOf).

type Dict = Record<string, unknown>;
/** A node as the fixture writes it: its kind, its fields in order, and the
 *  lists it holds. */
interface FNode {
  kind: string;
  f: number[];
  /** a box's glue setting, as the fixture writes it (the double's bits) */
  set?: string;
  list?: FNode[];
  pre?: FNode[]; post?: FNode[]; rep?: FNode[];
}

// The viewer's modules, imported by a path the Node project does not follow
// (see tests/unit/node-kinds.test.ts); the signatures used are written out.
interface BreakCandidate { kind: 'start' | 'end' | 'space' | 'disc' | 'penalty'; nodeIdx: number; trailN: number }
interface Break { bcIdx: number }
interface Line { ratio: number }
interface Breaker {
  buildBreakCandidates(nodes: Dict[], fontInfo: Dict, para: Dict): BreakCandidate[];
  kpBreakpoints(bcs: BreakCandidate[], nodes: Dict[], measure: number | number[], p: Dict): Break[];
  setLines(bcs: BreakCandidate[], breaks: Break[], nodes: Dict[], measure: number | number[], p: Dict): Line[];
  paragraphParams(p: Dict, para: Dict): Dict;
}
interface ParamsModule { paramsFromData(d: Record<string, string | undefined>, align: string): Dict }
const VIEWER = new URL('../../src/viewer/src/', import.meta.url).href;
const breaker: Breaker = await import(`${VIEWER}engine/breaker.ts`);
const params: ParamsModule = await import(`${VIEWER}runtime/params.ts`);

const IGNORE_DEPTH = -65536000;
const RUNNING = -1073741824;

// ── reading ─────────────────────────────────────────────────────────────────

/** A fixture's input: its parameters (P), glue parameters (G), penalty
 *  arrays (A), fonts and characters, and its node list. */
export interface Fixture {
  P: Record<string, number>;
  G: Record<string, number[]>;
  A: Record<string, number[]>;
  fonts: Map<number, { quad: number; expand: number[] }>;
  chars: Map<string, { w: number; h: number; d: number; lp: number; rp: number; ef: number }>;
  nodes: FNode[];
  /** the paragraph's text before a display */
  display: boolean;
  /** \parshape's pairs, {indent, width}; empty when there is none */
  shape: [number, number][];
}

function parseNodes(lines: string[], at: { i: number }, close: string | null): FNode[] {
  const out: FNode[] = [];
  const list = (open: string) => {
    if (lines[at.i++] !== open) throw new Error(`fixture line ${at.i}: expected "${open}"`);
    return parseNodes(lines, at, ')');
  };
  while (at.i < lines.length) {
    const line = lines[at.i++];
    if (line === close) return out;
    const [kind, ...rest] = line.split(' ');
    if (kind === 'hlist' || kind === 'vlist') {
      // hlist subtype width height depth shift glue_set sign order dir
      const f = rest.map(Number);
      out.push({ kind, f: [f[0], f[1], f[2], f[3], f[4], f[6], f[7], f[8]], set: rest[5], list: list('(') });
    } else if (kind === 'disc') {
      out.push({ kind, f: rest.map(Number), pre: list('(pre'), post: list('(post'), rep: list('(rep') });
    } else {
      out.push({ kind, f: rest.map(Number) });
    }
  }
  if (close !== null) throw new Error('fixture: a list is not closed');
  return out;
}

export function parseFixture(text: string): Fixture {
  const lines = text.split('\n');
  if (lines[0] !== 'REFLOWTEX-LINEBREAK-FIXTURE 1') throw new Error('not a line-break fixture');
  const fx: Fixture = { P: {}, G: {}, A: {}, fonts: new Map(), chars: new Map(), nodes: [], shape: [],
                        display: lines[1] === 'CONTEXT math_shift' };
  let i = 1;
  for (; i < lines.length && lines[i] !== 'NODES'; i++) {
    const [tag, name, ...rest] = lines[i].split(' ');
    const v = rest.map(Number);
    if (tag === 'P') fx.P[name] = v[0];
    else if (tag === 'G') fx.G[name] = v;
    else if (tag === 'A') fx.A[name] = v.slice(1);
    else if (tag === 'SHAPE') for (let k = 0; k < Number(name); k++) fx.shape.push([v[2 * k], v[2 * k + 1]]);
    else if (tag === 'F') fx.fonts.set(Number(name), { quad: v[0], expand: v.slice(1) });
    else if (tag === 'C') {
      if (lines[i].endsWith('MISSING')) continue;
      fx.chars.set(`${name} ${v[0]}`, { w: v[1], h: v[2], d: v[3], lp: v[4], rp: v[5], ef: v[6] });
    }
  }
  const at = { i: i + 1 };
  const end = lines.indexOf('END', at.i);
  fx.nodes = parseNodes(lines.slice(0, end), at, null);
  return fx;
}

// ── writing, as capture.lua's ser_list ──────────────────────────────────────

function serialize(out: string[], ns: FNode[]): void {
  for (const n of ns) {
    if (n.kind === 'hlist' || n.kind === 'vlist') {
      const [st, w, h, d, s, sign, order, dir] = n.f;
      out.push(`${n.kind} ${st} ${w} ${h} ${d} ${s} ${n.set} ${sign} ${order} ${dir}`, '(');
      serialize(out, n.list!);
      out.push(')');
    } else if (n.kind === 'disc') {
      out.push(`disc ${n.f.join(' ')}`, '(pre');
      serialize(out, n.pre!); out.push(')', '(post');
      serialize(out, n.post!); out.push(')', '(rep');
      serialize(out, n.rep!); out.push(')');
    } else {
      out.push([n.kind, ...n.f].join(' '));
    }
  }
}

function glueSetBits(v: number): string {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, Math.fround(v));   // TeX keeps a glue setting as a float
  return b.getBigUint64(0).toString(16).padStart(16, '0');
}

// ── the breaker's input ──────────────────────────────────────────────────────

function toTexNodes(fx: Fixture, ns: FNode[]): Dict[] {
  return ns.map((n): Dict => {
    const f = n.f;
    switch (n.kind) {
      case 'glyph': {
        const c = fx.chars.get(`${f[1]} ${f[2]}`);
        if (!c) throw new Error(`no metrics for character ${f[2]} of font ${f[1]}`);
        return { type: 'glyph', font: f[1], char: f[2], width: c.w, height: c.h, depth: c.d };
      }
      case 'glue':
        if (f[0] >= 100) throw new Error('leaders are not replayed');
        return { type: 'glue', subtype: f[0], width: f[1], stretch: f[2], stretch_order: f[3], shrink: f[4], shrink_order: f[5] };
      case 'kern': return { type: 'kern', subtype: f[0], kern: f[1] };
      case 'penalty': return { type: 'penalty', subtype: f[0], penalty: f[1] };
      case 'disc':
        return { type: 'disc', subtype: f[0], penalty: f[1],
                 pre: toTexNodes(fx, n.pre!), post: toTexNodes(fx, n.post!), replace: toTexNodes(fx, n.rep!) };
      case 'hlist': case 'vlist':
        return { type: n.kind, subtype: f[0], width: f[1], height: f[2], depth: f[3], shift: f[4],
                 glue_sign: f[5], glue_order: f[6], children: toTexNodes(fx, n.list!) };
      case 'rule': return { type: 'rule', subtype: f[0], width: f[1], height: f[2], depth: f[3] };
      case 'math':
        if (f[2] || f[3] || f[5]) throw new Error('math skips are not replayed');
        return { type: 'math', subtype: f[0], surround: f[1] };
      case 'localpar': return { type: 'local_par' };
      default: throw new Error(`a ${n.kind} node is not replayed`);
    }
  });
}

/** What the serializer records of the paragraph, TeX's names to the
 *  Paragraph's. */
const RECORDED: Record<string, string> = {
  pretolerance: 'pretolerance', tolerance: 'tolerance', emergencystretch: 'emergency_stretch',
  linepenalty: 'line_penalty', adjdemerits: 'adj_demerits',
  doublehyphendemerits: 'double_hyphen_demerits', finalhyphendemerits: 'final_hyphen_demerits',
};

// ── TeX's side: post_line_break and hpack ────────────────────────────────────

const clone = (n: FNode): FNode => ({ ...n, f: [...n.f], list: n.list?.map(clone),
  pre: n.pre?.map(clone), post: n.post?.map(clone), rep: n.rep?.map(clone) });
const glueNode = (subtype: number, g: number[]): FNode => ({ kind: 'glue', f: [subtype, ...g] });
// LuaTeX's node order: these come before a math node (non_discardable)
const NON_DISCARDABLE = new Set(['hlist', 'vlist', 'rule', 'ins', 'mark', 'adjust', 'boundary', 'disc', 'whatsit', 'localpar', 'dir']);
const EXPLICIT_KERN = 1, ITALIC_KERN = 3, INDENT_LIST = 3;

/** hpack(…, exactly): the box of a line at `width`. The glue setting of a
 *  line with no infinite stretch or shrink is the viewer's (`ratio`, negative
 *  for shrinking): one that stretches where TeX's shrinks shows as NaN. */
function hpack(fx: Fixture, list: FNode[], width: number, ratio: number): FNode {
  let x = 0, h = 0, d = 0;
  const stretch = [0, 0, 0, 0, 0], shrink = [0, 0, 0, 0, 0];
  const walk = (ns: FNode[]) => {
    for (const n of ns) {
      const f = n.f;
      switch (n.kind) {
        case 'glyph': {
          const c = fx.chars.get(`${f[1]} ${f[2]}`)!;
          x += c.w; h = Math.max(h, c.h); d = Math.max(d, c.d);
          break;
        }
        case 'hlist': case 'vlist':
          x += f[1]; h = Math.max(h, f[2] - f[4]); d = Math.max(d, f[3] + f[4]);
          break;
        case 'rule':
          x += f[1]; h = Math.max(h, f[2]); d = Math.max(d, f[3]);
          break;
        case 'math': x += f[1]; break;
        case 'glue': x += f[1]; stretch[f[3]] += f[2]; shrink[f[5]] += f[4]; break;
        case 'kern': x += f[1]; break;
        case 'disc': walk(n.rep!); break;
      }
    }
  };
  walk(list);
  x = width - x;
  let sign = 0, order = 0, set = 0;
  if (x > 0 || x < 0) {
    const tot = x > 0 ? stretch : shrink;
    order = [4, 3, 2, 1].find(o => tot[o] !== 0) ?? 0;
    sign = x > 0 ? 1 : 2;
    if (tot[order] === 0) sign = 0;
    else if (order > 0) set = (x > 0 ? x : -x) / tot[order];
    else set = (x > 0) === (ratio > 0) ? Math.abs(ratio) : NaN;
    // overfull: TeX sets the glue fully shrunk (1), as the viewer's ratio
    // is; a line with nothing to shrink is set at 1 too, by nothing
    if (x < 0 && order === 0 && tot[0] < -x && list.length) {
      if (sign === 0) set = 1;
      const overshoot = -x - tot[0];
      if ((overshoot > fx.P.hfuzz || fx.P.hbadness < 100) && fx.P.overfullrule > 0)
        list.push({ kind: 'rule', f: [0, fx.P.overfullrule, RUNNING, RUNNING, 0] });
    }
  }
  return { kind: 'hlist', f: [1, width, h, d, 0, sign, order, 0], set: glueSetBits(set), list };
}

/** The band, {indent, width}, of each line of the paragraph from its first
 *  (line \prevgraf+1) up to the one after TeX's last special line, which
 *  stands for every line after it (§848-849): \parshape's l-th pair, its last
 *  for every line after; or the first |\hangafter| lines full and the rest
 *  hung by \hangindent (\hangafter < 0: the other way round); or \hsize. */
export function shapeOf(fx: Fixture): [number, number][] {
  const { hsize, hangindent: hi, hangafter: ha, prevgraf } = fx.P;
  let last: number, line: (l: number) => [number, number];
  if (fx.shape.length) {
    const n = fx.shape.length;
    last = n - 1; line = l => fx.shape[Math.min(l, n) - 1];
  } else if (hi) {
    last = Math.abs(ha);
    const hung: [number, number] = [hi >= 0 ? hi : 0, hsize - Math.abs(hi)], full: [number, number] = [0, hsize];
    line = l => (l <= last) === (ha < 0) ? hung : full;
  } else {
    last = 0; line = () => [0, hsize];
  }
  const out: [number, number][] = [];
  for (let l = prevgraf + 1; l <= Math.max(prevgraf + 1, last + 1); l++) out.push(line(l));
  return out;
}

/** The viewer's breaks of the fixture's paragraph, set as LuaTeX sets them:
 *  the text of par-NNNN.expected. */
export function replay(fixtureText: string): string {
  const fx = parseFixture(fixtureText);
  const P = fx.P, G = fx.G;
  if (P.looseness || P.adjustspacing || P.protrudechars || P.lastlinefit || P.bodydirection)
    throw new Error('\\looseness, \\adjustspacing, \\protrudechars, \\lastlinefit and directions are not replayed');
  for (const s of ['leftskip', 'rightskip'])
    if (G[s][1] || G[s][3]) throw new Error(`a \\${s} with stretch or shrink is not replayed`);
  const shape = shapeOf(fx);
  const band = (k: number) => shape[Math.min(k, shape.length - 1)];
  const measures = shape.map(([, w]) => w - G.leftskip[0] - G.rightskip[0]);
  const measure = measures.length === 1 ? measures[0] : measures;

  const nodes = toTexNodes(fx, fx.nodes);
  const fontInfo: Dict = {};
  for (const [id, f] of fx.fonts) fontInfo[String(id)] = { quad: f.quad, expand: null, codes: new Map() };
  const para: Dict = { nodes, width: measures[0] };
  for (const [tex, field] of Object.entries(RECORDED)) para[field] = P[tex];
  const p = breaker.paragraphParams(params.paramsFromData({ texFinalPass: 'strict' }, 'justify'), para);
  const bcs = breaker.buildBreakCandidates(nodes, fontInfo, para);
  const breaks = breaker.kpBreakpoints(bcs, nodes, measure, p);
  const lines = breaker.setLines(bcs, breaks, nodes, measure, p);

  // post_line_break over the fixture's own list. A line is what a break at a
  // discretionary carried over (its post-break text), then the list from
  // `from` to the break.
  const list = fx.nodes.map(clone);
  const out: string[] = ['REFLOWTEX-LINEBREAK-RESULT 1', 'NODES'];
  let prevDepth = P.prevdepth;
  const firstLine = P.prevgraf + 1, bestLine = P.prevgraf + breaks.length + 1;
  const breakNode = (bc: BreakCandidate) => bc.kind === 'end' ? list.length : bc.nodeIdx - (bc.kind === 'space' ? bc.trailN : 0);
  let from = 0, carried: FNode[] = [];
  for (let k = 0; k < breaks.length; k++) {
    const bc = bcs[breaks[k].bcIdx];
    const curLine = firstLine + k;
    // the first math node at the line's start loses its surround
    for (const n of [...carried, ...list.slice(from)]) {
      if (n.kind === 'math') { n.f[1] = 0; break; }
      if (n.kind === 'hlist' && n.f[0] === INDENT_LIST) continue;
      if (n.kind === 'glyph' || NON_DISCARDABLE.has(n.kind)) break;
      if (n.kind === 'kern' && n.f[0] !== EXPLICIT_KERN && n.f[0] !== ITALIC_KERN) break;
    }
    const at = breakNode(bc);
    const line = [...carried, ...list.slice(from, at)];
    carried = [];
    let discBreak = false;
    if (bc.kind !== 'end') {
      const r = list[at];
      if (r.kind === 'glue') { /* it becomes the \rightskip below */ }
      else if (r.kind === 'disc') {
        line.push(...r.pre!, { ...r, pre: [], post: [], rep: [] });
        carried = r.post!;
        discBreak = true;
      } else {
        if (r.kind === 'kern' || r.kind === 'math') r.f[1] = 0;
        else if (r.kind !== 'penalty') throw new Error(`a break at a ${r.kind} node`);
        line.push(r);
      }
    }
    from = at + 1;
    line.push(glueNode(9, G.rightskip));
    if (G.leftskip.some(v => v)) line.unshift(glueNode(8, G.leftskip));
    const box = hpack(fx, line, band(k)[1], lines[k].ratio);
    box.f[4] = band(k)[0];   // shift_amount: the line's indent

    // append_to_vlist
    if (prevDepth > IGNORE_DEPTH) {
      const bs = G.baselineskip, gap = bs[0] - prevDepth - box.f[2];
      out.push(gap < P.lineskiplimit ? `glue 1 ${G.lineskip.join(' ')}` : `glue 2 ${gap} ${bs.slice(1).join(' ')}`);
    }
    serialize(out, [box]);
    prevDepth = box.f[3];

    // the penalty between this line and the next
    if (curLine + 1 !== bestLine) {
      const arr = (name: string, i: number) => { const a = fx.A[name]; return a[Math.min(i, a.length) - 1]; };
      let pen = fx.A.interlinepenalties.length ? arr('interlinepenalties', curLine) : P.interlinepenalty;
      if (fx.A.clubpenalties.length) pen += arr('clubpenalties', curLine - P.prevgraf);
      else if (curLine === firstLine) pen += P.clubpenalty;
      // (the lines before a display: \displaywidowpenalty)
      const widow = fx.display ? 'displaywidow' : 'widow';
      if (fx.A[`${widow}penalties`].length) pen += arr(`${widow}penalties`, bestLine - curLine - 1);
      else if (curLine + 2 === bestLine) pen += P[`${widow}penalty`];
      if (discBreak) pen += P.brokenpenalty;
      if (pen !== 0) out.push(`penalty 1 ${pen}`);
    }

    // what the break discards at the next line's start, unless a
    // discretionary's post-break text starts it
    if (!carried.length && k + 1 < breaks.length) {
      const stop = breakNode(bcs[breaks[k + 1].bcIdx]);
      for (; from < list.length && from !== stop; from++) {
        const n = list[from];
        if (n.kind === 'glyph' || (n.kind !== 'localpar' && NON_DISCARDABLE.has(n.kind))) break;
        if (n.kind === 'kern' && n.f[0] !== EXPLICIT_KERN && n.f[0] !== ITALIC_KERN) break;
      }
    }
  }
  out.push('END', `STATE prevdepth ${prevDepth}`, `STATE prevgraf ${bestLine - 1}`);
  return out.join('\n') + '\n';
}
